// /api/food 요청 처리 (Node 서버와 Cloudflare Worker 공통)
//   GET /api/food?lat=&lng=&radius=1000&kind=restaurant|cafe   주변 후보 (가까운 순)
//   GET /api/food/ratings?ids=1,2,3                            평점·영업시간·대표 메뉴 (최대 10곳)
import { distanceKm } from '../lib/geo.js';
import { FOOD_KINDS, FOOD_RADII_M, MAX_RATING_IDS } from './service.js';
import { KakaoApiError } from './kakao.js';

function bad(message) {
  return { status: 400, body: { error: message } };
}

export async function handleFoodRequest(service, pathname, searchParams) {
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

      const places = (await service.search({ lat, lng, radiusM, kind }))
        .map((p) => ({ ...p, distanceM: Math.round(distanceKm(lat, lng, p.lat, p.lng) * 1000) }))
        .filter((p) => p.distanceM <= radiusM)
        .sort((a, b) => a.distanceM - b.distanceM);
      return { status: 200, body: { kind, radius: radiusM, demo: Boolean(service.demo), total: places.length, places } };
    }

    if (pathname === '/api/food/ratings') {
      const ids = String(searchParams.get('ids') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!ids.length || ids.length > MAX_RATING_IDS || !ids.every((id) => /^\d{1,15}$/.test(id))) {
        return bad(`ids 는 숫자 id 를 1~${MAX_RATING_IDS}개까지 넣어 주세요.`);
      }
      return { status: 200, body: { ratings: await service.ratings([...new Set(ids)]) } };
    }

    return { status: 404, body: { error: '없는 API 입니다.' } };
  } catch (err) {
    if (err instanceof KakaoApiError) return { status: 502, body: { error: err.message } };
    console.error(err);
    return { status: 500, body: { error: '서버 오류가 발생했습니다.' } };
  }
}
