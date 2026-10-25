// /api/food 요청 처리 (Node 서버와 Cloudflare Worker 공통)
//   GET /api/food?lat=&lng=&radius=1000&kind=restaurant|cafe
//       → 저장된 지역 데이터(가게 + 평점). 평점을 더 받아야 하면 pending 에 id 목록
//   GET /api/food/ratings?area=<키>&ids=1,2,3   (최대 8곳)
//       → 평점을 받아 지역 데이터에 저장하고 돌려줌
import { distanceKm } from '../lib/geo.js';
import { AREA_KEY_RE, FOOD_KINDS, FOOD_RADII_M, RATING_BATCH, pendingIds } from './service.js';
import { KakaoApiError } from './kakao.js';

function bad(message) {
  return { status: 400, body: { error: message } };
}

export async function handleFoodRequest(service, pathname, searchParams, { now = Date.now } = {}) {
  if (!service) return { status: 503, body: { error: '맛집 검색이 설정되지 않았습니다 (KAKAO_REST_API_KEY 필요).' } };
  try {
    if (pathname === '/api/food') {
      const lat = Number(searchParams.get('lat'));
      const lng = Number(searchParams.get('lng'));
      const radiusM = Number(searchParams.get('radius') || 1000);
      const kind = searchParams.get('kind') || 'restaurant';
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return bad('위치 좌표가 올바르지 않습니다.');
      if (!FOOD_RADII_M.includes(radiusM)) return bad('반경 값이 올바르지 않습니다.');
      if (!FOOD_KINDS.includes(kind)) return bad('종류 값이 올바르지 않습니다.');

      const area = await service.area({ lat, lng, radiusM, kind });
      const inRange = new Set();
      const places = area.places
        .map((p) => ({ ...p, distanceM: Math.round(distanceKm(lat, lng, p.lat, p.lng) * 1000), info: area.ratings[p.id] ?? undefined }))
        .filter((p) => p.distanceM <= radiusM);
      for (const p of places) inRange.add(p.id);
      return {
        status: 200,
        body: {
          kind,
          radius: radiusM,
          demo: Boolean(service.demo),
          area: area.key,
          fetchedAt: area.fetchedAt,
          cached: Boolean(area.cached),
          stale: Boolean(area.stale),
          total: places.length,
          places,
          pending: pendingIds(area, now()).filter((id) => inRange.has(id)),
          batch: RATING_BATCH,
        },
      };
    }

    if (pathname === '/api/food/ratings') {
      const key = searchParams.get('area') || '';
      const ids = String(searchParams.get('ids') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!AREA_KEY_RE.test(key)) return bad('area 값이 올바르지 않습니다.');
      if (!ids.length || ids.length > RATING_BATCH || !ids.every((id) => /^\d{1,15}$/.test(id))) {
        return bad(`ids 는 숫자 id 를 1~${RATING_BATCH}개까지 넣어 주세요.`);
      }
      const ratings = await service.rate(key, [...new Set(ids)]);
      if (!ratings) return { status: 404, body: { error: '지역 데이터가 없습니다. 다시 검색해 주세요.' } };
      return { status: 200, body: { ratings } };
    }

    return { status: 404, body: { error: '없는 API 입니다.' } };
  } catch (err) {
    if (err instanceof KakaoApiError) return { status: 502, body: { error: err.message } };
    console.error(err);
    return { status: 500, body: { error: '서버 오류가 발생했습니다.' } };
  }
}
