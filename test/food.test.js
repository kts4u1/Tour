import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleFoodRequest } from '../server/food/api.js';
import { cafeInfo, classify } from '../server/food/categories.js';
import { createDemoFoodService } from '../server/food/demo.js';
import { parsePlaceDetail, toFoodPlace } from '../server/food/kakao.js';
import { isTasty, qualityScore } from '../server/food/ranking.js';
import { createFoodService, createMemoryFoodCache, scoreDetail } from '../server/food/service.js';

const panel = JSON.parse(fs.readFileSync(new URL('./fixtures/kakao-panel3.json', import.meta.url), 'utf8'));
const CENTER = { lat: 37.5602, lng: 126.978 }; // 37.560x 는 같은 캐시 칸

const doc = (id, name, category, group = 'FD6', dLat = 0.001) => ({
  id: String(id), place_name: name, category_name: category, category_group_code: group,
  x: String(CENTER.lng), y: String(CENTER.lat + dLat), road_address_name: '서울 중구 어딘가 1', phone: '02-000-0000',
  place_url: `http://place.map.kakao.com/${id}`,
});

test('카카오맵 장소 정보 해석 (실제 응답 형식)', () => {
  const d = parsePlaceDetail(panel);
  assert.equal(d.rating.score, 3.7);
  assert.equal(d.rating.count, 36);
  assert.equal(d.rating.blog, 72);
  assert.equal(d.rating.taste, 7); // "맛" = id 5
  assert.equal(d.open.code, 'OPEN');
  assert.equal(d.open.today, '11:00 ~ 18:00');
  assert.ok(d.menu.length > 0 && d.menu.length <= 8);
  assert.deepEqual(d.menu[0], { name: '칼만두', price: 11000 });
});

test('맛집 점수: 리뷰 적은 높은 평점은 평균 쪽으로 보정', () => {
  const few = qualityScore({ score: 5, count: 2, blog: 0, taste: 2 });
  const many = qualityScore({ score: 4.5, count: 300, blog: 500, taste: 120 });
  assert.ok(many > few);
  assert.equal(qualityScore(null), null);
  assert.equal(isTasty({ score: 4.8, count: 5, blog: 0, taste: 5 }), false); // 리뷰 10개 미만
  assert.equal(isTasty({ score: 4.6, count: 120, blog: 300, taste: 60 }), true);
  const s = scoreDetail(parsePlaceDetail(panel));
  assert.equal(typeof s.quality, 'number');
});

test('관광객용 맛집에서 빼는 곳: 싼 한 끼 식당·술집·카페·프랜차이즈 커피', () => {
  const keep = toFoodPlace(doc(1, '명동칼국수', '음식점 > 한식 > 국수 > 칼국수'), 'restaurant', CENTER.lat, CENTER.lng);
  assert.equal(keep.label, '한식');
  assert.ok(keep.distanceM > 100 && keep.distanceM < 120);
  for (const [name, cat] of [
    ['사랑 기사식당', '음식점 > 한식'],
    ['OO빌딩 구내식당', '음식점 > 한식'],
    ['엄마손 한식뷔페', '음식점 > 한식 > 한식뷔페'],
    ['한솥도시락', '음식점 > 도시락'],
    ['맥도날드', '음식점 > 패스트푸드 > 맥도날드'],
    ['을지로 호프', '음식점 > 술집 > 호프,요리주점'],
  ]) {
    assert.equal(toFoodPlace(doc(2, name, cat), 'restaurant', CENTER.lat, CENTER.lng), null, name);
  }
  assert.equal(toFoodPlace(doc(3, '어떤 카페', '음식점 > 카페', 'CE7'), 'restaurant', CENTER.lat, CENTER.lng), null);

  assert.equal(toFoodPlace(doc(4, '스타벅스 명동점', '음식점 > 카페 > 커피전문점 > 스타벅스', 'CE7'), 'cafe', CENTER.lat, CENTER.lng), null);
  const cafe = toFoodPlace(doc(5, '명동 디저트', '음식점 > 카페 > 디저트카페', 'CE7'), 'cafe', CENTER.lat, CENTER.lng);
  assert.equal(cafe.label, '디저트카페');
  assert.deepEqual(cafeInfo('음식점 > 카페'), { label: '카페', franchise: false });
  assert.equal(classify('음식점 > 일식 > 초밥,롤', '스시 오마카세').label, '일식');
});

test('검색 서비스: 카카오 호출 → 후보, 평점은 캐시', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    if (u.hostname === 'kakao.test') {
      assert.equal(init.headers.Authorization, 'KakaoAK test-key');
      const docs = u.pathname.includes('keyword')
        ? [doc(10, '인기 맛집', '음식점 > 한식 > 국밥'), doc(11, '기사식당', '음식점 > 한식')]
        : [doc(10, '인기 맛집', '음식점 > 한식 > 국밥'), doc(12, '먼 식당', '음식점 > 일식', 'FD6', 0.05)];
      return new Response(JSON.stringify({ documents: docs, meta: { is_end: true } }));
    }
    return new Response(JSON.stringify(panel));
  };
  const service = createFoodService({
    kakaoKey: 'test-key', cache: createMemoryFoodCache(), fetchImpl,
    kakaoBaseUrl: 'https://kakao.test', panelBaseUrl: 'https://panel.test',
  });

  const res = await handleFoodRequest(service, '/api/food', new URLSearchParams({ lat: CENTER.lat, lng: CENTER.lng, radius: '1000', kind: 'restaurant' }));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.places.map((p) => p.id), ['10']); // 기사식당 제외, 5km 밖 제외
  const kakaoCalls = calls.length;
  assert.ok(calls.some((c) => c.includes('keyword') && c.includes('sort=accuracy') && c.includes('category_group_code=FD6')));

  // 같은 동네 다시 검색 → 캐시
  await handleFoodRequest(service, '/api/food', new URLSearchParams({ lat: CENTER.lat + 0.0001, lng: CENTER.lng, radius: '1000', kind: 'restaurant' }));
  assert.equal(calls.length, kakaoCalls);

  const r1 = await handleFoodRequest(service, '/api/food/ratings', new URLSearchParams({ ids: '10,12' }));
  assert.equal(r1.body.ratings['10'].rating.count, 36);
  assert.ok(calls.some((c) => c.startsWith('/places/panel3/10')));
  const before = calls.length;
  await handleFoodRequest(service, '/api/food/ratings', new URLSearchParams({ ids: '10' }));
  assert.equal(calls.length, before);
});

test('맛집 API 입력 검사', async () => {
  const demo = createDemoFoodService();
  const q = (o) => handleFoodRequest(demo, '/api/food', new URLSearchParams(o));
  assert.equal((await q({ lat: 'x', lng: '127' })).status, 400);
  assert.equal((await q({ lat: '37', lng: '127', radius: '777' })).status, 400);
  assert.equal((await q({ lat: '37', lng: '127', kind: 'bar' })).status, 400);
  const ok = await q({ lat: '37.5', lng: '127', radius: '1000', kind: 'cafe' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.demo, true);
  assert.ok(ok.body.places.every((p) => p.distanceM <= 1000 && p.kind === 'cafe'));
  const bad = await handleFoodRequest(demo, '/api/food/ratings', new URLSearchParams({ ids: '1,abc' }));
  assert.equal(bad.status, 400);
  const many = await handleFoodRequest(demo, '/api/food/ratings', new URLSearchParams({ ids: Array.from({ length: 11 }, (_, i) => i + 1).join(',') }));
  assert.equal(many.status, 400);
  assert.equal((await handleFoodRequest(null, '/api/food', new URLSearchParams())).status, 503);
});
