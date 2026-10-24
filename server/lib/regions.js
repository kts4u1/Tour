// 시·도 이름을 짧은 표기로 통일합니다.
// TourAPI(KorService2)는 법정동 시도코드(lDongRegnCd)를 주고, 예전 데이터는 areacode 를 줍니다.
// 둘 다 없으면 주소 앞부분으로 판단합니다.

export const REGIONS = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
];

const BY_LDONG_CODE = {
  11: '서울', 26: '부산', 27: '대구', 28: '인천', 29: '광주', 30: '대전', 31: '울산', 36: '세종',
  41: '경기', 42: '강원', 51: '강원', 43: '충북', 44: '충남', 45: '전북', 52: '전북',
  46: '전남', 47: '경북', 48: '경남', 50: '제주',
};

const BY_AREA_CODE = {
  1: '서울', 2: '인천', 3: '대전', 4: '대구', 5: '광주', 6: '부산', 7: '울산', 8: '세종',
  31: '경기', 32: '강원', 33: '충북', 34: '충남', 35: '경북', 36: '경남', 37: '전북', 38: '전남', 39: '제주',
};

const BY_ADDRESS_PREFIX = [
  ['서울', '서울'], ['부산', '부산'], ['대구', '대구'], ['인천', '인천'], ['광주', '광주'],
  ['대전', '대전'], ['울산', '울산'], ['세종', '세종'], ['경기', '경기'], ['강원', '강원'],
  ['충청북', '충북'], ['충북', '충북'], ['충청남', '충남'], ['충남', '충남'],
  ['전라북', '전북'], ['전북', '전북'], ['전라남', '전남'], ['전남', '전남'],
  ['경상북', '경북'], ['경북', '경북'], ['경상남', '경남'], ['경남', '경남'], ['제주', '제주'],
];

export function regionFromAddress(addr) {
  const text = String(addr || '').trim();
  for (const [prefix, region] of BY_ADDRESS_PREFIX) {
    if (text.startsWith(prefix)) return region;
  }
  return null;
}

export function resolveRegion(raw) {
  return (
    BY_LDONG_CODE[raw.lDongRegnCd] ||
    regionFromAddress(raw.addr1) ||
    BY_AREA_CODE[raw.areacode] ||
    '기타'
  );
}
