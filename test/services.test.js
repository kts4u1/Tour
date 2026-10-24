import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoSource } from '../server/sources/demo.js';
import { festivalsForMonth, filterByWhen, findNearby } from '../server/services.js';

const NOW = new Date('2026-10-14T03:00:00Z'); // 한국 시간 2026-10-14 (수)
const TODAY = '20261014';
const SEOUL = { lat: 37.5665, lng: 126.978 };
const source = createDemoSource({ now: () => NOW });

const query = (over = {}) => ({
  ...SEOUL, radius: 30, category: 'all', when: 'all', sort: 'distance', offset: 0, limit: 300, ...over,
});

test('반경 안의 항목만, 가까운 순으로', async () => {
  const res = await findNearby(source, query({ radius: 10 }), TODAY);
  assert.ok(res.total > 0);
  assert.ok(res.items.every((i) => i.distanceKm <= 10));
  const d = res.items.map((i) => i.distanceKm);
  assert.deepEqual(d, [...d].sort((a, b) => a - b));
  assert.equal(res.complete, true);
});

test('반경별 개수는 반경이 커질수록 같거나 많아지고, 선택한 반경 개수와 일치', async () => {
  const res = await findNearby(source, query({ radius: 50 }), TODAY);
  const counts = [10, 30, 50, 80, 100].map((r) => res.radiusCounts[r]);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] >= counts[i - 1]);
  assert.equal(res.radiusCounts[50], res.total);
  const sum = Object.values(res.typeCounts).reduce((a, b) => a + b, 0);
  assert.equal(sum, res.total);
});

test('분류 필터', async () => {
  const festivals = await findNearby(source, query({ category: 'festival', radius: 100 }), TODAY);
  assert.ok(festivals.items.length > 0);
  assert.ok(festivals.items.every((i) => i.typeId === '15' && i.start && i.status !== 'ended'));
  const culture = await findNearby(source, query({ category: '14', radius: 100 }), TODAY);
  assert.ok(culture.items.every((i) => i.typeId === '14'));
});

test('행사 기간 필터: 진행 중 / 이번 주말 / 30일 이내', () => {
  const list = [
    { id: 'a', start: '20261001', end: '20261013' }, // 어제 끝남
    { id: 'b', start: '20261010', end: '20261020' }, // 진행 중
    { id: 'c', start: '20261017', end: '20261017' }, // 이번 토요일
    { id: 'd', start: '20261120', end: '20261122' }, // 30일 넘게 남음
  ];
  const ids = (when) => filterByWhen(list, when, TODAY).map((f) => f.id);
  assert.deepEqual(ids('all'), ['b', 'c', 'd']);
  assert.deepEqual(ids('ongoing'), ['b']);
  assert.deepEqual(ids('weekend'), ['b', 'c']);
  assert.deepEqual(ids('30d'), ['b', 'c']);
});

test('페이지 나누기', async () => {
  const all = await findNearby(source, query({ radius: 100, limit: 300 }), TODAY);
  const p1 = await findNearby(source, query({ radius: 100, limit: 5, offset: 0 }), TODAY);
  const p2 = await findNearby(source, query({ radius: 100, limit: 5, offset: 5 }), TODAY);
  assert.equal(p1.total, all.total);
  assert.deepEqual([...p1.items, ...p2.items].map((i) => i.id), all.items.slice(0, 10).map((i) => i.id));
});

test('추천순: 진행 중인 행사가 같은 거리의 관광지보다 앞', async () => {
  const res = await findNearby(source, query({ radius: 10, sort: 'recommend' }), TODAY);
  assert.equal(res.items[0].typeId, '15');
});

test('월별 행사: 그 달과 하루라도 겹치는 행사 전부', async () => {
  const res = await festivalsForMonth(source, 2026, 10, TODAY);
  assert.ok(res.total > 0);
  for (const item of res.items) {
    assert.ok(item.start <= '20261031' && item.end >= '20261001', `${item.title} ${item.start}-${item.end}`);
  }
  // 지난달에 시작해 이번 달까지 이어지는 행사 포함
  assert.ok(res.items.some((i) => i.start < '20261001'));
  // 시작일 순 정렬
  const starts = res.items.map((i) => i.start);
  assert.deepEqual(starts, [...starts].sort());
  // 지역/상태 집계
  assert.equal(res.regions.reduce((a, r) => a + r.count, 0), res.total);
  const s = res.statusCounts;
  assert.equal(s.ongoing + s.upcoming + s.ended, res.total);
  assert.equal(res.regions[0].name, '서울'); // 시도 순서
});
