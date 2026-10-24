// 앱 전체에서 쓰는 고정 목록

export const RADII_KM = [10, 30, 50, 80, 100];
export const MAX_RADIUS_KM = RADII_KM[RADII_KM.length - 1];

// TourAPI 관광타입(contentTypeId)
export const FESTIVAL_TYPE = '15';
export const PLACE_TYPES = ['12', '14', '28'];

export const TYPE_LABELS = {
  12: '관광지',
  14: '문화시설',
  15: '축제·행사',
  28: '레포츠',
};

export const CATEGORIES = [
  { id: 'all', label: '전체' },
  { id: 'festival', label: '축제·행사' },
  { id: '12', label: '관광지' },
  { id: '14', label: '문화시설' },
  { id: '28', label: '레포츠' },
];

export const WHEN_FILTERS = [
  { id: 'all', label: '진행·예정 전체' },
  { id: 'ongoing', label: '진행 중' },
  { id: 'weekend', label: '이번 주말' },
  { id: '30d', label: '30일 이내' },
];

export const SORTS = [
  { id: 'recommend', label: '추천순' },
  { id: 'distance', label: '가까운 순' },
  { id: 'date', label: '행사 날짜순' },
];

// 위치 권한이 없을 때 고를 수 있는 기준 위치
export const CITIES = [
  { name: '서울시청', lat: 37.5665, lng: 126.978 },
  { name: '부산', lat: 35.1796, lng: 129.0756 },
  { name: '대구', lat: 35.8714, lng: 128.6014 },
  { name: '인천', lat: 37.4563, lng: 126.7052 },
  { name: '광주', lat: 35.1595, lng: 126.8526 },
  { name: '대전', lat: 36.3504, lng: 127.3845 },
  { name: '울산', lat: 35.5384, lng: 129.3114 },
  { name: '세종', lat: 36.48, lng: 127.289 },
  { name: '수원', lat: 37.2636, lng: 127.0286 },
  { name: '춘천', lat: 37.8813, lng: 127.7298 },
  { name: '강릉', lat: 37.7519, lng: 128.8761 },
  { name: '청주', lat: 36.6424, lng: 127.489 },
  { name: '천안', lat: 36.8151, lng: 127.1139 },
  { name: '전주', lat: 35.8242, lng: 127.148 },
  { name: '여수', lat: 34.7604, lng: 127.6622 },
  { name: '목포', lat: 34.8118, lng: 126.3922 },
  { name: '포항', lat: 36.019, lng: 129.3435 },
  { name: '경주', lat: 35.8562, lng: 129.2247 },
  { name: '안동', lat: 36.5684, lng: 128.7294 },
  { name: '창원', lat: 35.228, lng: 128.6811 },
  { name: '진주', lat: 35.18, lng: 128.1076 },
  { name: '제주', lat: 33.4996, lng: 126.5312 },
  { name: '서귀포', lat: 33.2541, lng: 126.56 },
];
