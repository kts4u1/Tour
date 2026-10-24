// HTTP API 검증 (데모 데이터)
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { ROOT_DIR } from '../server/config.js';
import { createDemoSource } from '../server/sources/demo.js';

const now = () => new Date('2026-10-14T03:00:00Z');
let server;
let base;

before(async () => {
  const app = createApp({ source: createDemoSource({ now }), rootDir: ROOT_DIR, now });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

const get = async (path) => {
  const res = await fetch(base + path);
  const type = res.headers.get('content-type') || '';
  return { res, body: type.includes('json') ? await res.json() : await res.text() };
};

test('GET /api/meta', async () => {
  const { res, body } = await get('/api/meta');
  assert.equal(res.status, 200);
  assert.equal(body.mode, 'demo');
  assert.equal(body.today, '20261014');
  assert.deepEqual(body.radii, [10, 30, 50, 80, 100]);
  assert.ok(body.cities.length > 10);
});

test('GET /api/nearby', async () => {
  const { res, body } = await get('/api/nearby?lat=37.5665&lng=126.978&radius=30&category=all&limit=5');
  assert.equal(res.status, 200);
  assert.equal(body.items.length, 5);
  assert.equal(body.radius, 30);
  assert.ok(body.items.every((i) => typeof i.distanceKm === 'number'));
});

test('GET /api/nearby 잘못된 값은 400', async () => {
  for (const qs of [
    'lng=126.9',
    'lat=abc&lng=126.9',
    'lat=37.5&lng=126.9&radius=500',
    'lat=37.5&lng=126.9&category=hotel',
    'lat=37.5&lng=126.9&limit=1000',
    'lat=37.5&lng=126.9&offset=-1',
  ]) {
    const { res, body } = await get(`/api/nearby?${qs}`);
    assert.equal(res.status, 400, qs);
    assert.ok(body.error, qs);
  }
});

test('GET /api/festivals', async () => {
  const { res, body } = await get('/api/festivals?year=2026&month=10');
  assert.equal(res.status, 200);
  assert.equal(body.start, '20261001');
  assert.equal(body.end, '20261031');
  assert.ok(body.total > 0);
  assert.equal((await get('/api/festivals?year=2026&month=13')).res.status, 400);
  const def = await get('/api/festivals');
  assert.equal(def.body.month, 10);
});

test('GET /api/detail', async () => {
  const ok = await get('/api/detail/900001?typeId=12');
  assert.equal(ok.res.status, 200);
  assert.equal(ok.body.title, '경복궁');
  assert.equal((await get('/api/detail/abc')).res.status, 400);
  assert.equal((await get('/api/detail/123')).res.status, 404);
});

test('화면 파일과 보안 헤더', async () => {
  const { res, body } = await get('/');
  assert.equal(res.status, 200);
  assert.match(body, /어디갈까/);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(`${base}/vendor/leaflet/leaflet.js`)).status, 200);
  assert.equal((await fetch(`${base}/js/app.js`)).status, 200);
  const unknown = await get('/api/unknown');
  assert.equal(unknown.res.status, 404);
});
