// "주변 맛집" 서비스 (Node 서버와 Cloudflare Worker 공통)
//
// 카카오 API 를 검색할 때마다 부르지 않도록, 지역(격자 칸)별로 받아 둔 데이터를 저장소에 보관합니다.
//   - 가게 목록: 칸마다 12시간에 한 번만 카카오에서 새로 받음 (하루 최대 두 번)
//   - 평점·영업시간·메뉴: 처음 받은 뒤 24시간 동안 재사용
//   - 카카오가 실패하면 예전에 받아 둔 데이터를 그대로 보여 줌
//
// store: { get(key) => Promise<value|undefined>, put(key, value) => Promise }
//   Node 서버는 메모리, Cloudflare 는 Workers KV 를 씁니다.
import { createKakaoLocal, fetchPlaceDetail } from './kakao.js';
import { isTasty, qualityScore } from './ranking.js';

const HOUR = 60 * 60 * 1000;
export const AREA_FRESH_MS = 12 * HOUR;
export const RATING_FRESH_MS = 24 * HOUR;
export const FOOD_RADII_M = [1000, 3000, 5000, 10000];
export const FOOD_KINDS = ['restaurant', 'cafe'];
// 평점을 확인하는 후보 수 (인기순 앞쪽부터)와 인기 맛집을 찾는 칸 나누기 (넓은 반경은 영역을 나눠 고르게)
export const MAX_RATED_BY_RADIUS = { 1000: 40, 3000: 48, 5000: 64, 10000: 80 };
const GRID_BY_RADIUS = { 1000: 1, 3000: 1, 5000: 2, 10000: 3 };
export const RATING_BATCH = 8; // 한 번에 확인하는 수 (Cloudflare 무료 플랜 한도 안)

// 반경별 격자 칸 크기(도). 같은 칸에서 찾는 사람은 같은 데이터를 함께 씁니다.
const CELL_DEG = { 1000: 0.004, 3000: 0.01, 5000: 0.02, 10000: 0.04 };

export const AREA_KEY_RE = /^v2:(restaurant|cafe):(1000|3000|5000|10000):-?\d{1,3}\.\d{3}:-?\d{1,3}\.\d{3}$/;

export function areaOf(lat, lng, radiusM, kind) {
  const size = CELL_DEG[radiusM];
  const snap = (v) => (Math.round(v / size) * size).toFixed(3);
  const cellLat = snap(lat);
  const cellLng = snap(lng);
  return {
    key: `v2:${kind}:${radiusM}:${cellLat}:${cellLng}`,
    lat: Number(cellLat),
    lng: Number(cellLng),
    // 칸 중심에서 찾으므로, 칸 안 어디에 있어도 반경이 덮이도록 조금 넓게
    searchRadiusM: radiusM + Math.round(size * 111000 * 0.75),
  };
}

export function scoreDetail(detail, now = Date.now()) {
  if (!detail) return { rating: null, quality: null, tasty: false, open: null, menu: [], closed: false, at: now };
  const quality = qualityScore(detail.rating);
  return {
    rating: detail.rating,
    quality: quality == null ? null : Math.round(quality * 1000) / 1000,
    tasty: isTasty(detail.rating),
    open: detail.open,
    menu: detail.menu || [],
    closed: Boolean(detail.closed),
    at: now,
  };
}

/** 평점을 더 받아야 하는 후보 (인기순 앞쪽 몇 곳 중 평점이 없거나 오래된 곳) */
export function pendingIds(area, radiusM, now = Date.now()) {
  return area.places
    .slice(0, MAX_RATED_BY_RADIUS[radiusM] || 40)
    .map((p) => p.id)
    .filter((id) => {
      const r = area.ratings[id];
      return !r || now - r.at > RATING_FRESH_MS;
    });
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

export function createFoodService({ kakaoKey, store, fetchImpl = globalThis.fetch, kakaoBaseUrl, panelBaseUrl, now = Date.now }) {
  const local = createKakaoLocal({ apiKey: kakaoKey, fetchImpl, baseUrl: kakaoBaseUrl });

  return {
    enabled: true,
    demo: false,

    /** 지역 데이터: 저장된 것이 12시간 안이면 그대로, 아니면 카카오에서 새로 받음 */
    async area({ lat, lng, radiusM, kind }) {
      const cell = areaOf(lat, lng, radiusM, kind);
      const saved = await store.get(cell.key);
      if (saved && now() - saved.fetchedAt < AREA_FRESH_MS) return { key: cell.key, ...saved, cached: true };

      let places;
      try {
        places = await local.searchFood({ lat: cell.lat, lng: cell.lng, radiusM: cell.searchRadiusM, kind, grid: GRID_BY_RADIUS[radiusM] || 1 });
      } catch (err) {
        if (saved) return { key: cell.key, ...saved, cached: true, stale: true };
        throw err;
      }
      // 아직 하루가 안 지난 평점은 이어서 사용
      const ratings = {};
      for (const p of places) {
        const r = saved?.ratings?.[p.id];
        if (r && now() - r.at <= RATING_FRESH_MS) ratings[p.id] = r;
      }
      const value = { fetchedAt: now(), places, ratings };
      await store.put(cell.key, value);
      return { key: cell.key, ...value, cached: false };
    },

    /** 지역 안 가게들의 평점을 받아 지역 데이터에 저장 */
    async rate(key, ids) {
      const saved = await store.get(key);
      if (!saved) return null;
      const known = new Set(saved.places.map((p) => p.id));
      const targets = ids.filter((id) => known.has(id)).slice(0, RATING_BATCH);
      const got = {};
      await mapLimit(targets, 4, async (id) => {
        const cached = saved.ratings[id];
        if (cached && now() - cached.at <= RATING_FRESH_MS) {
          got[id] = cached;
          return;
        }
        try {
          got[id] = scoreDetail(await fetchPlaceDetail(id, { fetchImpl, baseUrl: panelBaseUrl }), now());
        } catch {
          got[id] = scoreDetail(null, now()); // 정보를 못 받은 곳 (평점 없음으로 처리, 하루 뒤 다시 시도)
        }
      });
      // 그 사이 다른 요청이 저장한 평점도 살리도록 다시 읽고 합쳐서 저장
      const latest = (await store.get(key)) || saved;
      latest.ratings = { ...latest.ratings, ...got };
      await store.put(key, latest);
      return got;
    },
  };
}

/** 메모리 저장소 (Node 서버, 또는 Cloudflare 에 KV 가 없을 때) */
export function createMemoryStore(maxEntries = 2000) {
  const map = new Map();
  return {
    async get(key) {
      const v = map.get(key);
      return v === undefined ? undefined : structuredClone(v);
    },
    async put(key, value) {
      map.delete(key);
      map.set(key, structuredClone(value));
      while (map.size > maxEntries) map.delete(map.keys().next().value);
    },
  };
}
