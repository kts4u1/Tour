// 카카오 로컬 API(주변 식당·카페 검색)와 카카오맵 장소 정보(평점·리뷰·메뉴·영업시간)
// 한끼 최저가 앱(kts4u1/Restaurant)의 src/providers/kakaoLocal.js, kakaoPlace.js 를 바탕으로
// 관광객용 "주변 맛집"에 맞게 줄였습니다 (최저가 계산 없음).
import { distanceKm } from '../lib/geo.js';
import { EXCLUDED_FOR_TOUR, cafeInfo, classify } from './categories.js';

export class KakaoApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'KakaoApiError';
    this.status = status;
  }
}

function explainError(status, message = '') {
  if (status === 401) return '카카오 REST API 키가 올바르지 않습니다. KAKAO_REST_API_KEY 값을 확인해 주세요.';
  if (/OPEN_MAP_AND_LOCAL|disabled/i.test(message)) {
    return '카카오 개발자 콘솔에서 카카오맵(로컬) 사용 설정이 꺼져 있습니다. [내 애플리케이션 > 앱 설정 > 카카오맵]에서 켜 주세요.';
  }
  if (status === 429) return '카카오 API 일일 사용량을 초과했습니다. 잠시 후 다시 시도해 주세요.';
  return `카카오 API 오류 (${status}): ${message}`;
}

async function fetchWithTimeout(fetchImpl, url, init, ms) {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(ms) });
}

// 종류별 검색: 인기(정확도순) 키워드 검색 + 가까운 순 카테고리 검색
const KINDS = {
  restaurant: { code: 'FD6', keyword: '맛집' },
  cafe: { code: 'CE7', keyword: '카페' },
};

export function toFoodPlace(doc, kind, lat, lng) {
  const plat = Number(doc.y);
  const plng = Number(doc.x);
  if (!Number.isFinite(plat) || !Number.isFinite(plng)) return null;
  const category = doc.category_name || '';
  let label;
  let group;
  if (kind === 'cafe') {
    const info = cafeInfo(category);
    if (info.franchise) return null; // 프랜차이즈 커피점은 추천 카페에서 뺌
    label = info.label;
    group = 'cafe';
  } else {
    if (doc.category_group_code === 'CE7') return null;
    const c = classify(category, doc.place_name);
    if (EXCLUDED_FOR_TOUR.has(c.key)) return null;
    label = c.key === 'etc' ? category.split('>').map((s) => s.trim()).filter(Boolean).at(-1) || '음식점' : c.label;
    group = c.key;
  }
  return {
    id: String(doc.id),
    name: doc.place_name,
    kind,
    group,
    label,
    category,
    address: doc.road_address_name || doc.address_name || '',
    phone: doc.phone || '',
    lat: plat,
    lng: plng,
    url: doc.place_url || `https://place.map.kakao.com/${doc.id}`,
    distanceM: Math.round(distanceKm(lat, lng, plat, plng) * 1000),
  };
}

export function createKakaoLocal({ apiKey, baseUrl = 'https://dapi.kakao.com', fetchImpl = globalThis.fetch }) {
  async function call(pathname, params) {
    const url = new URL(pathname, baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    let res;
    try {
      res = await fetchWithTimeout(fetchImpl, url, { headers: { Authorization: `KakaoAK ${apiKey}` } }, 10000);
    } catch (err) {
      throw new KakaoApiError(`카카오 API에 연결하지 못했습니다: ${err.message}`);
    }
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* JSON 아님 */
    }
    if (!res.ok) throw new KakaoApiError(explainError(res.status, body?.message || body?.msg || text.slice(0, 200)), res.status);
    return body || { documents: [], meta: { is_end: true } };
  }

  /**
   * 반경 안 맛집(또는 카페) 후보. 인기순 결과를 앞에 두고 가까운 곳을 덧붙입니다.
   * 카카오는 검색 한 번에 최대 45곳만 주고 가운데 쪽에 몰리므로,
   * 넓은 반경(grid > 1)은 영역을 grid×grid 칸으로 나눠 칸마다 인기 맛집을 찾습니다.
   */
  async function searchFood({ lat, lng, radiusM, kind, grid = 1 }) {
    const conf = KINDS[kind];
    const KEYWORD = '/v2/local/search/keyword.json';
    const CATEGORY = '/v2/local/search/category.json';
    const circle = { x: lng, y: lat, radius: Math.min(20000, Math.round(radiusM)) };

    async function pages(path, params, maxPage) {
      const docs = [];
      for (let page = 1; page <= maxPage; page++) {
        const body = await call(path, { ...params, size: 15, page });
        docs.push(...(body.documents || []));
        if (body.meta?.is_end !== false) break;
      }
      return docs;
    }

    // 인기순 검색 영역: 반경 원 하나, 또는 grid×grid 사각형
    const areas = [];
    if (grid <= 1) {
      areas.push(circle);
    } else {
      const dLat = radiusM / 111000;
      const dLng = radiusM / (111000 * Math.cos((lat * Math.PI) / 180));
      const stepLat = (2 * dLat) / grid;
      const stepLng = (2 * dLng) / grid;
      for (let i = 0; i < grid; i++) {
        for (let j = 0; j < grid; j++) {
          const minLat = lat - dLat + i * stepLat;
          const minLng = lng - dLng + j * stepLng;
          areas.push({ rect: `${minLng.toFixed(6)},${minLat.toFixed(6)},${(minLng + stepLng).toFixed(6)},${(minLat + stepLat).toFixed(6)}` });
        }
      }
    }

    const popularLists = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, areas.length) }, async () => {
        while (next < areas.length) {
          const i = next++;
          popularLists[i] = await pages(KEYWORD, { ...areas[i], query: conf.keyword, category_group_code: conf.code, sort: 'accuracy' }, 3);
        }
      }),
    );
    const near = await pages(CATEGORY, { ...circle, category_group_code: conf.code, sort: 'distance' }, 2);

    // 칸마다 1등, 2등 … 순서로 섞어서, 평점을 확인하는 앞쪽 후보가 영역 전체에 고르게 퍼지도록
    const popular = [];
    const longest = Math.max(0, ...popularLists.map((l) => l.length));
    for (let rank = 0; rank < longest; rank++) for (const list of popularLists) if (list[rank]) popular.push(list[rank]);

    const found = new Map();
    for (const doc of [...popular, ...near]) {
      if (found.has(String(doc.id))) continue;
      const place = toFoodPlace(doc, kind, lat, lng);
      if (place && place.distanceM <= radiusM) found.set(place.id, place);
    }
    return [...found.values()];
  }

  return { searchFood };
}

// ---- 카카오맵 장소 정보 (공식 API 가 아니라 카카오맵 웹페이지가 쓰는 데이터) ----

const PANEL_HEADERS = {
  pf: 'web',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://place.map.kakao.com/',
  Origin: 'https://place.map.kakao.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
};

function parsePrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const m = value.replace(/\s/g, '').match(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(만)?/);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (m[2]) n *= 10000;
  return n > 0 ? Math.round(n) : null;
}

/** 카카오맵 평점·리뷰 수와 "맛" 추천 수 (Restaurant 앱의 parseRating) */
export function parseRating(data) {
  const review = data?.kakaomap_review;
  const set = review?.score_set;
  const blog = Number(data?.blog_review?.review_count) || 0;
  if (!set && !blog) return null;
  const idOf = (name) => (review?.strength_description || []).find((s) => s.name === name)?.id;
  const countOf = (id) => (id == null ? 0 : Number((set?.strength_counts || []).find((c) => c.id === id)?.count) || 0);
  const count = Number(set?.review_count) || 0;
  const score = Number(set?.average_score);
  return {
    score: count && Number.isFinite(score) ? Math.round(score * 10) / 10 : null,
    count,
    blog,
    taste: countOf(idOf('맛')),
    mood: countOf(idOf('분위기')),
  };
}

/** 카카오맵 장소 JSON → { rating, open, menu } */
export function parsePlaceDetail(data) {
  if (!data || typeof data !== 'object') return null;
  const menu = [];
  const items = data.menu?.menus?.items;
  if (Array.isArray(items)) {
    for (const it of items) if (it?.name) menu.push({ name: String(it.name).trim(), price: parsePrice(it.price) });
  }
  const legacy = data.menuInfo?.menuList;
  if (!menu.length && Array.isArray(legacy)) {
    for (const it of legacy) if (it?.menu) menu.push({ name: String(it.menu).trim(), price: parsePrice(it.price) });
  }

  let open = null;
  const headline = data.open_hours?.headline;
  if (headline) {
    let today = null;
    for (const period of data.open_hours.week_from_today?.week_periods || []) {
      for (const day of period.days || []) {
        if (day.is_highlight) today = day.on_days?.start_end_time_desc || day.off_days_desc || null;
      }
    }
    open = { code: headline.code || null, text: headline.display_text || '', info: headline.display_text_info || '', today };
  }
  return { rating: parseRating(data), open, menu: menu.slice(0, 8), closed: data.summary?.status === 'N' };
}

export async function fetchPlaceDetail(kakaoId, { fetchImpl = globalThis.fetch, baseUrl = 'https://place-api.map.kakao.com' } = {}) {
  const url = new URL(`/places/panel3/${encodeURIComponent(kakaoId)}`, baseUrl);
  const res = await fetchWithTimeout(fetchImpl, url, { headers: PANEL_HEADERS }, 8000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parsePlaceDetail(await res.json());
}
