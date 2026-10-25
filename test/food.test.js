import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleFoodRequest } from '../server/food/api.js';
import { cafeInfo, classify } from '../server/food/categories.js';
import { createDemoFoodService } from '../server/food/demo.js';
import { parsePlaceDetail, toFoodPlace } from '../server/food/kakao.js';
import { isTasty, qualityScore } from '../server/food/ranking.js';
import { AREA_KEY_RE, areaOf, createFoodService, createMemoryStore, scoreDetail } from '../server/food/service.js';
import { findNamespace, parseNamespaceList } from '../scripts/ensure-kv.js';

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

test('지역 데이터는 12시간 동안 다시 받지 않고, 평점은 지역 데이터에 저장', async () => {
  const calls = [];
  let kakaoDown = false;
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    if (u.hostname === 'kakao.test') {
      if (kakaoDown) return new Response('{"message":"boom"}', { status: 500 });
      assert.equal(init.headers.Authorization, 'KakaoAK test-key');
      const docs = u.pathname.includes('keyword')
        ? [doc(10, '인기 맛집', '음식점 > 한식 > 국밥'), doc(11, '기사식당', '음식점 > 한식')]
        : [doc(10, '인기 맛집', '음식점 > 한식 > 국밥'), doc(12, '먼 식당', '음식점 > 일식', 'FD6', 0.05)];
      return new Response(JSON.stringify({ documents: docs, meta: { is_end: true } }));
    }
    return new Response(JSON.stringify(panel));
  };
  let clock = Date.parse('2026-10-25T00:00:00Z');
  const now = () => clock;
  const service = createFoodService({
    kakaoKey: 'test-key', store: createMemoryStore(), fetchImpl, now,
    kakaoBaseUrl: 'https://kakao.test', panelBaseUrl: 'https://panel.test',
  });
  const search = (lat = CENTER.lat) =>
    handleFoodRequest(service, '/api/food', new URLSearchParams({ lat, lng: CENTER.lng, radius: '1000', kind: 'restaurant' }), { now });

  const first = await search();
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.places.map((p) => p.id), ['10']); // 기사식당·먼 곳 제외
  assert.equal(first.body.cached, false);
  assert.deepEqual(first.body.pending, ['10']);
  assert.match(first.body.area, AREA_KEY_RE);
  const kakaoCalls = calls.length;
  assert.ok(calls.some((c) => c.includes('keyword') && c.includes('sort=accuracy') && c.includes('category_group_code=FD6')));

  // 평점 받기 → 지역 데이터에 저장
  const rated = await handleFoodRequest(service, '/api/food/ratings', new URLSearchParams({ area: first.body.area, ids: '10' }), { now });
  assert.equal(rated.body.ratings['10'].rating.count, 36);
  const panelCalls = calls.filter((c) => c.startsWith('/places/panel3/')).length;

  // 같은 칸에서 다시 검색 (6시간 뒤) → 카카오 호출 없이 평점까지 바로
  clock += 6 * 3600 * 1000;
  const again = await search(CENTER.lat + 0.0003);
  assert.equal(calls.length, kakaoCalls + panelCalls);
  assert.equal(again.body.cached, true);
  assert.deepEqual(again.body.pending, []);
  assert.equal(again.body.places[0].info.rating.count, 36);

  // 13시간 뒤 → 목록은 새로 받지만, 하루가 안 된 평점은 그대로 사용
  clock += 7 * 3600 * 1000;
  const refreshed = await search();
  assert.equal(refreshed.body.cached, false);
  assert.ok(calls.length > kakaoCalls + panelCalls);
  assert.deepEqual(refreshed.body.pending, []);

  // 또 13시간 뒤 카카오 장애 → 이전 데이터를 그대로
  clock += 13 * 3600 * 1000;
  kakaoDown = true;
  const stale = await search();
  assert.equal(stale.status, 200);
  assert.equal(stale.body.stale, true);
  assert.equal(stale.body.places.length, 1);
  assert.deepEqual(stale.body.pending, ['10']); // 평점은 하루가 지나 다시 받을 대상
});

test('지역 칸과 KV 준비 스크립트', () => {
  const a = areaOf(37.56021, 126.97803, 1000, 'restaurant');
  const b = areaOf(37.56099, 126.97888, 1000, 'restaurant');
  assert.equal(a.key, b.key); // 가까운 두 위치는 같은 칸
  assert.ok(a.searchRadiusM > 1000);
  assert.match(a.key, AREA_KEY_RE);
  assert.doesNotMatch('v1:restaurant:1000:../../x:1', AREA_KEY_RE);

  const list = parseNamespaceList('⛅️ wrangler\n[{"id":"abc","title":"other"},{"id":"def","title":"tour-nearby-food-cache"}]\n');
  assert.equal(findNamespace(list).id, 'def');
  assert.deepEqual(parseNamespaceList('error'), []);
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
  const area = ok.body.area;
  const bad = await handleFoodRequest(demo, '/api/food/ratings', new URLSearchParams({ area, ids: '1,abc' }));
  assert.equal(bad.status, 400);
  const many = await handleFoodRequest(demo, '/api/food/ratings', new URLSearchParams({ area, ids: Array.from({ length: 9 }, (_, i) => i + 1).join(',') }));
  assert.equal(many.status, 400);
  const badArea = await handleFoodRequest(demo, '/api/food/ratings', new URLSearchParams({ area: 'x', ids: '1' }));
  assert.equal(badArea.status, 400);
  assert.equal((await handleFoodRequest(null, '/api/food', new URLSearchParams())).status, 503);
});

test('넓은 반경(10km)은 영역을 3×3 칸으로 나눠 찾고, 칸마다 1등부터 섞음', async () => {
  const { createKakaoLocal } = await import('../server/food/kakao.js');
  const rects = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const rect = u.searchParams.get('rect');
    if (rect) {
      rects.push(rect);
      const [x1, y1, x2, y2] = rect.split(',').map(Number);
      const n = rects.length;
      // 칸 가운데에 가게 2곳 (칸 번호로 id)
      const mk = (k) => ({ id: String(n * 100 + k), place_name: `칸${n}-${k}`, category_name: '음식점 > 한식 > 국밥', category_group_code: 'FD6', x: String((x1 + x2) / 2), y: String((y1 + y2) / 2 + k * 0.0001) });
      return new Response(JSON.stringify({ documents: [mk(1), mk(2)], meta: { is_end: true } }));
    }
    return new Response(JSON.stringify({ documents: [], meta: { is_end: true } }));
  };
  const local = createKakaoLocal({ apiKey: 'k', fetchImpl, baseUrl: 'https://kakao.test' });
  const places = await local.searchFood({ lat: 35.15, lng: 126.85, radiusM: 13330, kind: 'restaurant', grid: 3 });
  assert.equal(rects.length, 9);
  // 앞쪽 9곳은 9개 칸의 1등 (한 칸에 몰리지 않음)
  const firstNine = places.slice(0, 9).map((p) => p.name.split('-')[1]);
  assert.deepEqual([...new Set(firstNine)], ['1']);
  assert.ok(Math.max(...places.map((p) => p.distanceM)) > 5000);
});
