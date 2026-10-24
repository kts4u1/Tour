// 인증키 없이 실행할 때 쓰는 데이터 소스 (예시 데이터)
import { todayKST } from '../lib/dates.js';
import { TYPE_LABELS } from '../catalog.js';
import { NotFoundError } from '../errors.js';
import { DEMO_PLACES, buildDemoFestivals } from '../demo/data.js';

export function createDemoSource({ now = () => new Date() } = {}) {
  const festivals = () => buildDemoFestivals(todayKST(now()));

  return {
    mode: 'demo',
    nearbyLimitKm: Infinity,

    async init() {},

    async getFestivalsFrom(from) {
      return festivals().filter((f) => f.end >= from);
    },

    peekPlaces(typeId) {
      return DEMO_PLACES.filter((p) => p.typeId === typeId);
    },

    async ensurePlaces(typeId) {
      return this.peekPlaces(typeId);
    },

    prefetchPlaces() {},

    async getPlacesNear(typeId) {
      return this.peekPlaces(typeId);
    },

    async getDetail(id) {
      const item = [...DEMO_PLACES, ...festivals()].find((p) => p.id === id);
      if (!item) throw new NotFoundError('관광정보를 찾을 수 없습니다.');
      const isFestival = item.typeId === '15';
      return {
        ...item,
        typeLabel: TYPE_LABELS[item.typeId],
        overview:
          `${item.title} 항목은 데모 모드에서 보여주는 예시입니다.` +
          (isFestival ? ' 행사 이름과 날짜는 화면 확인용으로 만든 것이며 실제 일정이 아닙니다.' : '') +
          '\n\n.env 파일에 한국관광공사 TourAPI 인증키를 넣고 서버를 다시 시작하면 실제 소개글, 운영 시간, 요금 정보가 표시됩니다.',
        links: [],
        info: [{ label: isFestival ? '행사 장소' : '위치', value: item.addr }],
        start: item.start ?? null,
        end: item.end ?? null,
      };
    },

    status() {
      return Object.fromEntries(
        ['12', '14', '28'].map((typeId) => [
          typeId,
          { ready: true, count: this.peekPlaces(typeId).length, updatedAt: null, building: false, error: null },
        ]),
      );
    },
  };
}
