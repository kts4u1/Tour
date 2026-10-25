// 실제 TourAPI 를 사용하는 데이터 소스
//
// TourAPI 의 위치기반 조회(locationBasedList2)는 반경이 최대 20km 입니다.
// 그래서 30km~100km 반경을 지원하려고 관광타입별 전국 목록(areaBasedList2)을 한 번 받아
// 메모리와 디스크에 저장해 두고, 거리는 서버에서 직접 계산합니다.
// 전국 목록이 준비되기 전에는 20km 이하 반경만 위치기반 조회로 응답합니다.
import { MemoryCache, DiskCache } from '../cache.js';
import { fetchDetail } from '../detail.js';
import { normalizeFestival, normalizePlace, uniqueById } from '../normalize.js';
import { PLACE_TYPES } from '../catalog.js';

const HOUR = 60 * 60 * 1000;
const FESTIVAL_TTL = 6 * HOUR;
const PLACE_INDEX_TTL = 72 * HOUR;
const NEARBY_TTL = 0.5 * HOUR;
const DETAIL_TTL = 24 * HOUR;

export function createLiveSource({ api, cacheDir, log = console }) {
  const memory = new MemoryCache();
  const disk = new DiskCache(cacheDir);
  const placeIndex = new Map(); // typeId -> { items, savedAt }
  const building = new Map(); // typeId -> Promise
  const lastErrors = new Map(); // typeId -> message

  function buildPlaceIndex(typeId) {
    if (building.has(typeId)) return building.get(typeId);
    const promise = (async () => {
      const startedAt = Date.now();
      log.info?.(`[tourapi] 관광타입 ${typeId} 전국 목록을 받는 중...`);
      const raw = await api.listAll('areaBasedList2', { contentTypeId: typeId, arrange: 'A' }, { pageSize: 1000 });
      const items = uniqueById(raw.map(normalizePlace)).filter((p) => p.lat != null);
      placeIndex.set(typeId, { items, savedAt: Date.now() });
      lastErrors.delete(typeId);
      await disk.write(`places-${typeId}`, items);
      log.info?.(`[tourapi] 관광타입 ${typeId}: ${items.length}곳 준비 완료 (${((Date.now() - startedAt) / 1000).toFixed(1)}초)`);
      return items;
    })();
    building.set(typeId, promise);
    promise.then(
      () => building.delete(typeId),
      (err) => {
        building.delete(typeId);
        lastErrors.set(typeId, err.message);
      },
    );
    return promise;
  }

  function refreshInBackground(typeId) {
    buildPlaceIndex(typeId).catch((err) => log.warn?.(`[tourapi] 관광타입 ${typeId} 목록 갱신 실패: ${err.message}`));
  }

  function isStale(entry) {
    return Date.now() - entry.savedAt > PLACE_INDEX_TTL;
  }

  return {
    mode: 'live',
    nearbyLimitKm: 20,

    /** 디스크에 저장된 전국 목록을 불러오고, 오래됐거나 없으면 백그라운드로 새로 받습니다. */
    async init({ warmup = true } = {}) {
      for (const typeId of PLACE_TYPES) {
        const saved = await disk.read(`places-${typeId}`);
        if (saved && Array.isArray(saved.value)) placeIndex.set(typeId, { items: saved.value, savedAt: saved.savedAt });
      }
      if (!warmup) return;
      // 호출량을 아끼려고 하나씩 순서대로 받습니다.
      (async () => {
        for (const typeId of PLACE_TYPES) {
          const entry = placeIndex.get(typeId);
          if (!entry || isStale(entry)) await buildPlaceIndex(typeId).catch(() => {});
        }
      })();
    },

    /** 행사 목록: eventStartDate 이후에 진행 중이거나 열리는 행사 */
    getFestivalsFrom(from) {
      return memory.wrap(`festivals:${from}`, FESTIVAL_TTL, async () => {
        const raw = await api.listAll('searchFestival2', { eventStartDate: from, arrange: 'A' }, { pageSize: 500 });
        return uniqueById(raw.map(normalizeFestival));
      });
    },

    /** 준비된 전국 목록 (없으면 null) */
    peekPlaces(typeId) {
      const entry = placeIndex.get(typeId);
      if (!entry) return null;
      if (isStale(entry) && !building.has(typeId)) refreshInBackground(typeId);
      return entry.items;
    },

    /** 전국 목록이 없으면 받을 때까지 기다립니다. */
    async ensurePlaces(typeId) {
      return this.peekPlaces(typeId) ?? buildPlaceIndex(typeId);
    },

    prefetchPlaces(typeId) {
      if (!placeIndex.has(typeId) && !building.has(typeId)) refreshInBackground(typeId);
    },

    /** 위치기반 조회 (반경 20km 이하) */
    getPlacesNear(typeId, lat, lng, radiusKm) {
      const mapY = lat.toFixed(4);
      const mapX = lng.toFixed(4);
      const radius = Math.min(20000, Math.round(radiusKm * 1000));
      return memory.wrap(`near:${typeId}:${mapY}:${mapX}:${radius}`, NEARBY_TTL, async () => {
        const { items } = await api.list(
          'locationBasedList2',
          { contentTypeId: typeId, mapX, mapY, radius, arrange: 'E' },
          { numOfRows: 1000 },
        );
        return uniqueById(items.map(normalizePlace)).filter((p) => p.lat != null);
      });
    },

    getDetail(id, typeId) {
      return memory.wrap(`detail:${id}`, DETAIL_TTL, () => fetchDetail(api, id, typeId));
    },

    status() {
      return Object.fromEntries(
        PLACE_TYPES.map((typeId) => {
          const entry = placeIndex.get(typeId);
          return [
            typeId,
            {
              ready: Boolean(entry),
              count: entry?.items.length ?? 0,
              updatedAt: entry ? new Date(entry.savedAt).toISOString() : null,
              building: building.has(typeId),
              error: lastErrors.get(typeId) || null,
            },
          ];
        }),
      );
    },
  };
}
