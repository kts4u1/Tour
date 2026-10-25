// 상세 화면용 데이터 (detailCommon2 + detailIntro2)
import { isYmd } from './lib/dates.js';
import { extractLinks, htmlToText } from './lib/text.js';
import { normalizePlace } from './normalize.js';
import { TYPE_LABELS } from './catalog.js';
import { NotFoundError } from './errors.js';

// 관광타입별 소개정보(detailIntro2) 필드와 화면에 보여줄 이름
const INTRO_FIELDS = {
  15: [
    ['eventplace', '행사 장소'], ['playtime', '행사 시간'], ['usetimefestival', '이용 요금'],
    ['agelimit', '관람 연령'], ['spendtimefestival', '관람 소요시간'], ['bookingplace', '예매처'],
    ['discountinfofestival', '할인 정보'], ['program', '행사 프로그램'], ['subevent', '부대 행사'],
    ['placeinfo', '행사장 위치 안내'], ['sponsor1', '주최'], ['sponsor1tel', '주최 연락처'],
    ['sponsor2', '주관'], ['sponsor2tel', '주관 연락처'],
  ],
  12: [
    ['infocenter', '문의 및 안내'], ['usetime', '이용 시간'], ['restdate', '쉬는 날'], ['parking', '주차'],
    ['expguide', '체험 안내'], ['expagerange', '체험 가능 연령'], ['useseason', '이용 시기'],
    ['chkbabycarriage', '유모차 대여'], ['chkpet', '반려동물 동반'],
  ],
  14: [
    ['infocenterculture', '문의 및 안내'], ['usetimeculture', '이용 시간'], ['restdateculture', '쉬는 날'],
    ['usefee', '이용 요금'], ['spendtime', '관람 소요시간'], ['parkingculture', '주차'], ['parkingfee', '주차 요금'],
    ['discountinfo', '할인 정보'], ['chkbabycarriageculture', '유모차 대여'], ['chkpetculture', '반려동물 동반'],
  ],
  28: [
    ['infocenterleports', '문의 및 안내'], ['openperiod', '개장 기간'], ['usetimeleports', '이용 시간'],
    ['restdateleports', '쉬는 날'], ['usefeeleports', '이용 요금'], ['reservation', '예약 안내'],
    ['expagerangeleports', '체험 가능 연령'], ['parkingleports', '주차'], ['parkingfeeleports', '주차 요금'],
    ['chkbabycarriageleports', '유모차 대여'], ['chkpetleports', '반려동물 동반'],
  ],
};

export function buildDetail(common, intro = {}, typeIdHint = '') {
  const base = normalizePlace(common);
  if (!base) return null;
  const typeId = base.typeId || String(typeIdHint || '');
  intro = intro || {};

  const info = [];
  for (const [field, label] of INTRO_FIELDS[typeId] || []) {
    const value = htmlToText(intro[field]);
    if (value) info.push({ label, value });
  }

  const start = String(intro.eventstartdate || '');
  const end = String(intro.eventenddate || '');

  return {
    ...base,
    typeId,
    typeLabel: TYPE_LABELS[typeId] || '관광정보',
    overview: htmlToText(common.overview),
    links: [...new Set([...extractLinks(common.homepage), ...extractLinks(intro.eventhomepage)])],
    info,
    start: isYmd(start) ? start : null,
    end: isYmd(end) ? end : isYmd(start) ? start : null,
  };
}

/** TourAPI 에서 상세 정보(공통정보 + 소개정보)를 받아 화면용으로 만듭니다. */
export async function fetchDetail(api, id, typeId = '') {
  const commonReq = api.list('detailCommon2', { contentId: id }, { numOfRows: 1 });
  const introReq = (tid) =>
    api
      .list('detailIntro2', { contentId: id, contentTypeId: tid }, { numOfRows: 1 })
      .then((r) => r.items[0] || {})
      .catch(() => ({}));

  let common;
  let intro;
  if (typeId) {
    [common, intro] = await Promise.all([commonReq, introReq(typeId)]);
  } else {
    common = await commonReq;
    const tid = common.items[0]?.contenttypeid;
    intro = tid ? await introReq(tid) : {};
  }
  const detail = common.items[0] && buildDetail(common.items[0], intro, typeId);
  if (!detail) throw new NotFoundError('관광정보를 찾을 수 없습니다.');
  return detail;
}
