// Cloudflare Worker
// - 화면 파일과 데이터(dist/)는 Cloudflare 가 정적 파일로 바로 내려줍니다.
// - 이 Worker 는 /api/* 요청만 처리합니다.
//   /api/meta          앱 설정
//   /api/detail/:id    상세 정보 (인증키가 필요해 서버에서 TourAPI 호출, 24시간 캐시)
import { fetchDetail } from '../server/detail.js';
import { NotFoundError } from '../server/errors.js';
import { SECURITY_HEADERS } from '../server/headers.js';
import { todayKST } from '../server/lib/dates.js';
import { metaPayload } from '../server/meta.js';
import { createDemoSource } from '../server/sources/demo.js';
import { TourApiError, createTourApi } from '../server/tourApi.js';

const DEFAULT_API_BASE = 'https://apis.data.go.kr/B551011/KorService2';

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...headers },
  });
}

async function readDataMeta(request, env) {
  try {
    const res = await env.ASSETS.fetch(new URL('/data/meta.json', request.url));
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function handleMeta(request, env) {
  const data = await readDataMeta(request, env);
  return json(
    metaPayload({
      mode: 'static',
      demo: data ? Boolean(data.demo) : true,
      today: todayKST(),
      dataBuiltAt: data?.builtAt ?? null,
      dataStatus: data ? { festivals: data.festivals, places: data.places, festivalsFrom: data.festivalsFrom } : null,
    }),
    200,
    { 'Cache-Control': 'no-store' },
  );
}

async function handleDetail(request, env, ctx, id) {
  const url = new URL(request.url);
  const typeId = /^\d{2}$/.test(url.searchParams.get('typeId') || '') ? url.searchParams.get('typeId') : '';
  const cacheKey = new Request(`${url.origin}/api/detail/${id}?typeId=${typeId}`);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let detail;
  if (env.TOUR_API_KEY) {
    const api = createTourApi({
      serviceKey: env.TOUR_API_KEY,
      apiBase: env.TOUR_API_BASE || DEFAULT_API_BASE,
      mobileApp: env.TOUR_API_APP_NAME || 'TourNearby',
    });
    detail = await fetchDetail(api, id, typeId);
  } else {
    detail = await createDemoSource().getDetail(id);
  }

  const res = json(detail, 200, { 'Cache-Control': 'public, max-age=86400' });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.method !== 'GET') return json({ error: '지원하지 않는 요청입니다.' }, 405);

    try {
      if (url.pathname === '/api/meta') return await handleMeta(request, env);
      const match = url.pathname.match(/^\/api\/detail\/(\d{1,12})$/);
      if (match) return await handleDetail(request, env, ctx, match[1]);
      if (url.pathname.startsWith('/api/detail/')) return json({ error: 'id 값이 올바르지 않습니다.' }, 400);
      return json({ error: '없는 API 입니다.' }, 404);
    } catch (err) {
      if (err instanceof NotFoundError) return json({ error: err.message }, 404);
      if (err instanceof TourApiError) return json({ error: err.message, code: err.code }, 502);
      console.error(err);
      return json({ error: '서버 오류가 발생했습니다.' }, 500);
    }
  },
};
