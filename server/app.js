import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import { CATEGORIES, RADII_KM, SORTS, WHEN_FILTERS } from './catalog.js';
import { BadRequestError, NotFoundError } from './errors.js';
import { todayKST } from './lib/dates.js';
import { handleFoodRequest } from './food/api.js';
import { SECURITY_HEADERS } from './headers.js';
import { metaPayload } from './meta.js';
import { festivalsForMonth, findNearby } from './services.js';
import { TourApiError } from './tourApi.js';

const require = createRequire(import.meta.url);

function oneOf(value, allowed, fallback) {
  if (value === undefined || value === '') return fallback;
  if (!allowed.includes(String(value))) throw new BadRequestError(`허용되지 않는 값입니다: ${value}`);
  return String(value);
}

function number(value, { name, min, max, fallback, integer = false }) {
  if (value === undefined || value === '') {
    if (fallback === undefined) throw new BadRequestError(`${name} 값이 필요합니다.`);
    return fallback;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new BadRequestError(`${name} 값이 올바르지 않습니다.`);
  }
  return n;
}

export function createApp({ source, rootDir, now = () => new Date(), food = null }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', 'strong');

  app.use((req, res, next) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    next();
  });

  const api = express.Router();

  api.get('/meta', (req, res) => {
    res.json(
      metaPayload({
        mode: source.mode,
        demo: source.mode === 'demo',
        today: todayKST(now()),
        dataStatus: source.status(),
        food: food ? { enabled: true, demo: Boolean(food.demo) } : null,
      }),
    );
  });

  api.get('/nearby', async (req, res) => {
    const q = req.query;
    const query = {
      lat: number(q.lat, { name: 'lat', min: -90, max: 90 }),
      lng: number(q.lng, { name: 'lng', min: -180, max: 180 }),
      radius: number(q.radius, { name: 'radius', min: 1, max: RADII_KM.at(-1), fallback: RADII_KM[0] }),
      category: oneOf(q.category, CATEGORIES.map((c) => c.id), 'all'),
      when: oneOf(q.when, WHEN_FILTERS.map((w) => w.id), 'all'),
      sort: oneOf(q.sort, SORTS.map((s) => s.id), 'recommend'),
      offset: number(q.offset, { name: 'offset', min: 0, max: 100000, fallback: 0, integer: true }),
      limit: number(q.limit, { name: 'limit', min: 1, max: 300, fallback: 30, integer: true }),
    };
    res.set('Cache-Control', 'no-store');
    res.json(await findNearby(source, query, todayKST(now())));
  });

  api.get('/festivals', async (req, res) => {
    const today = todayKST(now());
    const year = number(req.query.year, { name: 'year', min: 2000, max: 2100, fallback: Number(today.slice(0, 4)), integer: true });
    const month = number(req.query.month, { name: 'month', min: 1, max: 12, fallback: Number(today.slice(4, 6)), integer: true });
    res.set('Cache-Control', 'no-store');
    res.json(await festivalsForMonth(source, year, month, today));
  });

  api.get('/detail/:id', async (req, res) => {
    const { id } = req.params;
    if (!/^\d{1,12}$/.test(id)) throw new BadRequestError('id 값이 올바르지 않습니다.');
    const typeId = req.query.typeId && /^\d{2}$/.test(req.query.typeId) ? req.query.typeId : '';
    res.set('Cache-Control', 'private, max-age=3600');
    res.json(await source.getDetail(id, typeId));
  });

  const foodRoute = (pathname) => async (req, res) => {
    const { status, body } = await handleFoodRequest(food, pathname, new URLSearchParams(req.query));
    res.set('Cache-Control', 'no-store');
    res.status(status).json(body);
  };
  api.get('/food', foodRoute('/api/food'));
  api.get('/food/ratings', foodRoute('/api/food/ratings'));

  api.use((req, res) => res.status(404).json({ error: '없는 API 입니다.' }));

  app.use('/api', api);

  const leafletDist = path.dirname(require.resolve('leaflet/dist/leaflet.js'));
  app.use('/vendor/leaflet', express.static(leafletDist, { maxAge: '7d' }));
  app.use(express.static(path.join(rootDir, 'public'), { maxAge: 0 }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof BadRequestError) return res.status(400).json({ error: err.message });
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    if (err instanceof TourApiError) {
      console.warn(`[api] ${req.method} ${req.originalUrl}: ${err.message}`);
      return res.status(502).json({ error: err.message, code: err.code });
    }
    console.error(err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  });

  return app;
}
