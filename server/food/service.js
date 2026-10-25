// "주변 맛집" 서비스 (Node 서버와 Cloudflare Worker 공통)
//   search({ lat, lng, radiusM, kind })  반경 안 식당/카페 후보 (카카오 로컬 API)
//   ratings(ids)                          평점·리뷰·영업시간·대표 메뉴 (카카오맵 장소 정보)
// cache: { get(key) => Promise<value|undefined>, set(key, value, ttlMs) => Promise }
import { createKakaoLocal, fetchPlaceDetail } from './kakao.js';
import { isTasty, qualityScore } from './ranking.js';

const HOUR = 60 * 60 * 1000;
export const FOOD_RADII_M = [500, 1000, 3000, 5000];
export const FOOD_KINDS = ['restaurant', 'cafe'];
export const MAX_RATING_IDS = 10;

export function scoreDetail(detail) {
  if (!detail) return { rating: null, quality: null, tasty: false, open: null, menu: [], closed: false };
  const quality = qualityScore(detail.rating);
  return {
    rating: detail.rating,
    quality: quality == null ? null : Math.round(quality * 1000) / 1000,
    tasty: isTasty(detail.rating),
    open: detail.open,
    menu: detail.menu || [],
    closed: Boolean(detail.closed),
  };
}

export function createFoodService({ kakaoKey, cache, fetchImpl = globalThis.fetch, kakaoBaseUrl, panelBaseUrl }) {
  const local = createKakaoLocal({ apiKey: kakaoKey, fetchImpl, baseUrl: kakaoBaseUrl });

  async function cached(key, ttlMs, load) {
    const hit = await cache.get(key);
    if (hit !== undefined) return hit;
    const value = await load();
    await cache.set(key, value, ttlMs);
    return value;
  }

  return {
    enabled: true,
    demo: false,

    search({ lat, lng, radiusM, kind }) {
      // 위치는 약 100m 단위로 묶어 캐시 (같은 동네에서 다시 찾으면 바로 응답)
      const key = `food:${kind}:${radiusM}:${lat.toFixed(3)}:${lng.toFixed(3)}`;
      // 묶은 위치 기준으로 조금 넓게 찾아 두고, 실제 거리는 api.js 에서 요청 위치 기준으로 다시 계산합니다.
      return cached(key, 6 * HOUR, () =>
        local.searchFood({ lat: Number(lat.toFixed(3)), lng: Number(lng.toFixed(3)), radiusM: radiusM + 150, kind }),
      );
    },

    async ratings(ids) {
      const out = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            out[id] = await cached(`panel:${id}`, 24 * HOUR, async () =>
              scoreDetail(await fetchPlaceDetail(id, { fetchImpl, baseUrl: panelBaseUrl })),
            );
          } catch {
            out[id] = null; // 정보를 못 받은 곳 (평점 없음으로 처리)
          }
        }),
      );
      return out;
    },
  };
}

/** Node 서버용 메모리 캐시 */
export function createMemoryFoodCache(maxEntries = 3000) {
  const map = new Map();
  return {
    async get(key) {
      const e = map.get(key);
      if (!e) return undefined;
      if (e.expires < Date.now()) {
        map.delete(key);
        return undefined;
      }
      return e.value;
    },
    async set(key, value, ttlMs) {
      map.delete(key);
      map.set(key, { value, expires: Date.now() + ttlMs });
      while (map.size > maxEntries) map.delete(map.keys().next().value);
    },
  };
}
