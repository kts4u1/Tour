// /api/meta 응답 (Node 서버와 Cloudflare Worker 공통)
import { CATEGORIES, CITIES, RADII_KM, SORTS, TYPE_LABELS, WHEN_FILTERS } from './catalog.js';
import { REGIONS } from './lib/regions.js';
import { FOOD_RADII_M } from './food/service.js';

/**
 * mode: 'live' | 'demo' (Node 서버가 직접 계산) 또는 'static' (Cloudflare: 브라우저가 정적 데이터로 계산)
 * demo: 예시 데이터 여부
 */
export function metaPayload({ mode, demo, today, dataStatus = null, dataBuiltAt = null, food = null }) {
  return {
    mode,
    demo,
    food: food ?? { enabled: false, demo: false },
    foodRadii: FOOD_RADII_M,
    today,
    dataBuiltAt,
    radii: RADII_KM,
    categories: CATEGORIES,
    whenFilters: WHEN_FILTERS,
    sorts: SORTS,
    typeLabels: TYPE_LABELS,
    regions: REGIONS,
    cities: CITIES,
    dataStatus,
  };
}
