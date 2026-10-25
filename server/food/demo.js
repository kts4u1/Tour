// 카카오 키가 없을 때 쓰는 예시 맛집·카페 (화면 확인용, 실제 가게가 아님)
import { scoreDetail } from './service.js';

const RESTAURANTS = [
  ['한옥 비빔밥집', '한식'], ['바다향 횟집', '해물·회'], ['숯불 갈비 명가', '고기·구이'], ['골목 칼국수', '한식'],
  ['동네 스시', '일식'], ['화덕 피자 공방', '양식'], ['쌀국수 하우스', '아시안'], ['손짜장 반점', '중식'],
  ['시장 순대국', '한식'], ['돈가스 연구소', '일식'], ['장어 구이', '해물·회'], ['파스타 키친', '양식'],
];
const CAFES = [
  ['바다 전망 카페', '카페'], ['한옥 찻집', '전통찻집'], ['로스터리 커피', '카페'], ['디저트 공방', '디저트카페'],
  ['베이커리 숲', '제과,베이커리'], ['루프탑 카페', '카페'], ['빙수 하우스', '디저트카페'], ['책방 카페', '카페'],
];

// 위치마다 늘 같은 결과가 나오도록 하는 간단한 난수
function seeded(seed) {
  let x = Math.sin(seed) * 10000;
  return () => {
    x = Math.sin(x) * 10000;
    return x - Math.floor(x);
  };
}

function demoPlaces(lat, lng, radiusM, kind) {
  const list = kind === 'cafe' ? CAFES : RESTAURANTS;
  const rand = seeded(Math.round(lat * 1000) * 7 + Math.round(lng * 1000) + (kind === 'cafe' ? 3 : 0));
  return list.map(([name, label], i) => {
    const dist = (0.15 + rand() * 0.8) * radiusM;
    const angle = rand() * Math.PI * 2;
    const plat = lat + (dist * Math.cos(angle)) / 111000;
    const plng = lng + (dist * Math.sin(angle)) / (111000 * Math.cos((lat * Math.PI) / 180));
    return {
      id: String(800000 + (kind === 'cafe' ? 100 : 0) + i),
      name: `${name} (예시)`,
      kind,
      group: kind === 'cafe' ? 'cafe' : label,
      label,
      category: `음식점 > ${label}`,
      address: '예시 주소',
      phone: '',
      lat: Math.round(plat * 1e6) / 1e6,
      lng: Math.round(plng * 1e6) / 1e6,
      url: 'https://map.kakao.com/',
    };
  });
}

function demoDetail(id) {
  const rand = seeded(Number(id));
  const count = Math.floor(rand() * 400);
  const score = Math.round((3.4 + rand() * 1.5) * 10) / 10;
  return scoreDetail({
    rating: { score: Math.min(score, 5), count, blog: Math.floor(rand() * 600), taste: Math.floor(count * rand() * 0.5), mood: 0 },
    open: { code: 'OPEN', text: '영업 중', info: '21:00 까지', today: '11:00 ~ 21:00' },
    menu: [
      { name: '대표 메뉴 (예시)', price: 12000 },
      { name: '추천 메뉴 (예시)', price: 15000 },
    ],
  });
}

export function createDemoFoodService() {
  return {
    enabled: true,
    demo: true,
    async area({ lat, lng, radiusM, kind }) {
      const places = demoPlaces(lat, lng, radiusM, kind);
      const ratings = Object.fromEntries(places.map((p) => [p.id, demoDetail(p.id)]));
      return { key: `v3:${kind}:${radiusM}:${lat.toFixed(3)}:${lng.toFixed(3)}`, fetchedAt: Date.now(), places, ratings, cached: true };
    },
    async rate(key, ids) {
      return Object.fromEntries(ids.map((id) => [id, demoDetail(id)]));
    },
  };
}
