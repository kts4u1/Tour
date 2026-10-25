// Cloudflare 배포용 정적 데이터 형식 (빌드 스크립트와 브라우저가 같이 씀)
// 파일 크기를 줄이려고 객체 대신 배열로 저장하고, 사진 주소의 공통 앞부분을 뺍니다.

const IMAGE_PREFIX = 'https://tong.visitkorea.or.kr/cms/resource/';

function packImage(url) {
  if (!url) return '';
  return url.startsWith(IMAGE_PREFIX) ? url.slice(IMAGE_PREFIX.length) : url;
}

function unpackImage(value) {
  if (!value) return null;
  return /^https?:\/\//.test(value) ? value : IMAGE_PREFIX + value;
}

// 관광지 등: [id, 이름, 주소, 시도, 위도, 경도, 썸네일]
export function encodePlaces(items) {
  return items.map((p) => [p.id, p.title, p.addr, p.region, p.lat, p.lng, packImage(p.thumb)]);
}

export function decodePlaces(rows, typeId) {
  return rows.map(([id, title, addr, region, lat, lng, thumb]) => ({
    id, typeId, title, addr, region, lat, lng, image: null, thumb: unpackImage(thumb), tel: null,
  }));
}

// 행사: [id, 이름, 주소, 시도, 위도, 경도, 썸네일, 시작일, 종료일, 전화]
export function encodeFestivals(items) {
  return items.map((f) => [f.id, f.title, f.addr, f.region, f.lat, f.lng, packImage(f.thumb), f.start, f.end, f.tel || '']);
}

export function decodeFestivals(rows) {
  return rows.map(([id, title, addr, region, lat, lng, thumb, start, end, tel]) => ({
    id, typeId: '15', title, addr, region, lat, lng, image: null, thumb: unpackImage(thumb), tel: tel || null, start, end,
  }));
}
