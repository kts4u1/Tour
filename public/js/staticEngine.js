// Cloudflare 배포(정적 데이터) 모드: 반경 검색과 월별 행사를 브라우저에서 계산합니다.
// 계산 코드는 Node 서버와 같은 것(/core/services.js)을 씁니다.
import { decodeFestivals, decodePlaces } from '/core/staticData.js';
import { festivalsForMonth, findNearby } from '/core/services.js';

function createStaticSource(version) {
  const files = new Map();
  const places = new Map();

  function load(name) {
    if (!files.has(name)) {
      const promise = fetch(`/data/${name}?v=${encodeURIComponent(version)}`).then((res) => {
        if (!res.ok) throw new Error(`데이터를 불러오지 못했어요 (${res.status})`);
        return res.json();
      });
      promise.catch(() => files.delete(name)); // 실패하면 다음에 다시 시도
      files.set(name, promise);
    }
    return files.get(name);
  }

  let festivals = null;

  const source = {
    mode: 'static',
    nearbyLimitKm: 0, // 위치기반 조회 없이 항상 전국 데이터로 계산

    async getFestivalsFrom(from) {
      festivals ??= load('festivals.json').then((data) => decodeFestivals(data.rows));
      return (await festivals).filter((f) => f.end >= from);
    },

    peekPlaces(typeId) {
      return places.get(typeId) ?? null;
    },

    async ensurePlaces(typeId) {
      if (!places.has(typeId)) {
        const data = await load(`places-${typeId}.json`);
        places.set(typeId, decodePlaces(data.rows, typeId));
      }
      return places.get(typeId);
    },

    prefetchPlaces(typeId) {
      source.ensurePlaces(typeId).catch(() => {});
    },

    getPlacesNear(typeId) {
      return source.ensurePlaces(typeId);
    },
  };
  return source;
}

const toNumber = (v, fallback) => (v === undefined || v === '' ? fallback : Number(v));

export function createStaticEngine(meta) {
  const source = createStaticSource(meta.dataBuiltAt || meta.today);
  return {
    nearby(params) {
      return findNearby(
        source,
        {
          lat: toNumber(params.lat),
          lng: toNumber(params.lng),
          radius: toNumber(params.radius, 10),
          category: params.category || 'all',
          when: params.when || 'all',
          sort: params.sort || 'recommend',
          offset: toNumber(params.offset, 0),
          limit: toNumber(params.limit, 30),
        },
        meta.today,
      );
    },
    festivals(year, month) {
      return festivalsForMonth(source, year, month, meta.today);
    },
  };
}
