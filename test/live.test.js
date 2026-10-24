// 실제 TourAPI 경로를 가짜 TourAPI 서버로 끝까지 검증
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { ROOT_DIR } from '../server/config.js';
import { NotFoundError } from '../server/errors.js';
import { festivalsForMonth, findNearby } from '../server/services.js';
import { createLiveSource } from '../server/sources/live.js';
import { createTourApi } from '../server/tourApi.js';
import { VALID_KEY, startMockTourApi } from './helpers/mockTourApi.js';

const TODAY = '20261025';
const SEOUL_CITY_HALL = { lat: 37.5665, lng: 126.978 };
const quiet = { info() {}, warn() {} };

let mock;
let cacheDir;

before(async () => {
  mock = await startMockTourApi();
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tour-cache-'));
});
after(async () => {
  await mock.close();
  await fs.rm(cacheDir, { recursive: true, force: true });
});

function makeSource({ key = VALID_KEY, dir = cacheDir } = {}) {
  const api = createTourApi({ serviceKey: key, apiBase: mock.url, retries: 0 });
  return createLiveSource({ api, cacheDir: dir, log: quiet });
}

const query = (over = {}) => ({
  ...SEOUL_CITY_HALL, radius: 10, category: 'all', when: 'all', sort: 'distance', offset: 0, limit: 100, ...over,
});

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test('전국 목록 준비 전: 20km 이하는 위치기반 조회로 응답', async () => {
  const source = makeSource();
  await source.init({ warmup: false });
  const before = mock.requests.length;

  const res = await findNearby(source, query({ radius: 10 }), TODAY);
  const calls = mock.requests.slice(before);
  const near = calls.filter((c) => c.op === 'locationBasedList2');
  assert.deepEqual(near.map((c) => c.params.contentTypeId).sort(), ['12', '14', '28']);
  assert.ok(near.every((c) => c.params.radius === '10000' && c.params.arrange === 'E'));

  assert.equal(res.complete, false);
  assert.ok(res.notice);
  assert.equal(res.radiusCounts[30], null);
  assert.equal(typeof res.radiusCounts[10], 'number');
  const titles = res.items.map((i) => i.title);
  assert.ok(titles.includes('경복궁'));
  assert.ok(titles.includes('서울 빛 축제'));
  assert.ok(!titles.includes('수원화성'));
  assert.ok(!titles.includes('지난 행사'));
  assert.ok(res.items.every((i) => i.distanceKm <= 10));

  // 백그라운드에서 전국 목록을 받기 시작함
  await Promise.all(['12', '14', '28'].map((t) => source.ensurePlaces(t)));
  assert.ok(mock.requests.some((c) => c.op === 'areaBasedList2'));
});

test('전국 목록 준비 후: 30~100km 반경과 반경별 개수', async () => {
  const source = makeSource();
  await source.init({ warmup: false }); // 앞 테스트가 디스크에 저장한 목록 사용
  const res50 = await findNearby(source, query({ radius: 50 }), TODAY);
  assert.equal(res50.complete, true);
  assert.equal(res50.notice, null);
  for (const r of [10, 30, 50, 80, 100]) assert.equal(typeof res50.radiusCounts[r], 'number');
  assert.ok(res50.radiusCounts[30] < res50.radiusCounts[50], '수원(약 31km)은 30km 밖, 50km 안');
  const titles = res50.items.map((i) => i.title);
  assert.ok(titles.includes('수원화성'));
  assert.ok(titles.includes('남이섬') === false || res50.items.find((i) => i.title === '남이섬').distanceKm <= 50);
  assert.ok(!titles.includes('해운대해수욕장'));
  assert.ok(!titles.includes('좌표 없는 곳'));
  const kyungbok = res50.items.find((i) => i.title === '경복궁');
  assert.equal(kyungbok.image, 'https://tong.visitkorea.or.kr/cms/resource/126508_image2_1.jpg');
  assert.equal(kyungbok.region, '서울');
});

test('디스크 캐시: 서버를 다시 켜도 전국 목록을 다시 받지 않음', async () => {
  const source = makeSource();
  const before = mock.requests.filter((c) => c.op === 'areaBasedList2').length;
  await source.init({ warmup: true });
  assert.ok(source.peekPlaces('12').length > 0);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(mock.requests.filter((c) => c.op === 'areaBasedList2').length, before);
  assert.equal(source.status()['12'].ready, true);
});

test('월별 행사: 겹치는 행사만, 상태와 지역 포함', async () => {
  const source = makeSource();
  await source.init({ warmup: false });
  const oct = await festivalsForMonth(source, 2026, 10, TODAY);
  const call = mock.requests.findLast((c) => c.op === 'searchFestival2');
  assert.equal(call.params.eventStartDate, '20260701');

  const byTitle = Object.fromEntries(oct.items.map((i) => [i.title, i]));
  assert.deepEqual(Object.keys(byTitle).sort(), ['9월부터 10월까지', '서울 빛 축제'].sort());
  assert.equal(byTitle['서울 빛 축제'].status, 'ongoing');
  assert.equal(byTitle['9월부터 10월까지'].status, 'ended');
  assert.equal(byTitle['9월부터 10월까지'].region, '부산');

  const nov = await festivalsForMonth(source, 2026, 11, TODAY);
  assert.deepEqual(nov.items.map((i) => i.title).sort(), ['서울 빛 축제', '수원 야행'].sort());
  assert.equal(nov.statusCounts.upcoming, 1);

  // 같은 조회는 캐시 사용
  const count = mock.requests.length;
  await festivalsForMonth(source, 2026, 10, TODAY);
  assert.equal(mock.requests.length, count);
});

test('상세 정보: 소개글 정리, 링크 추출, 행사 안내', async () => {
  const source = makeSource();
  const detail = await source.getDetail('3000001', '15');
  assert.equal(detail.overview, '서울 도심을 밝히는 빛 축제입니다.\n가족과 함께 즐겨보세요.');
  assert.deepEqual(detail.links, ['https://seoul-light.example.kr', 'http://www.festival.example.kr']);
  assert.deepEqual(detail.info.find((r) => r.label === '행사 장소'), { label: '행사 장소', value: '서울광장' });
  assert.equal(detail.start, '20261020');
  assert.equal(detail.end, '20261103');
  await assert.rejects(source.getDetail('1', '12'), NotFoundError);
});

test('잘못된 인증키: API 가 502 와 이해하기 쉬운 메시지를 돌려줌', async () => {
  const source = makeSource({ key: 'wrong-key', dir: path.join(cacheDir, 'wrong') });
  const app = createApp({ source, rootDir: ROOT_DIR, now: () => new Date('2026-10-25T03:00:00Z') });
  const server = await listen(app);
  try {
    const res = await fetch(`${server.base}/api/festivals?year=2026&month=10`);
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.match(body.error, /인증키/);
    assert.equal(body.code, '30');
  } finally {
    await server.close();
  }
});
