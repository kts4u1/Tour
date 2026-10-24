// 날짜는 TourAPI 형식과 같은 'YYYYMMDD' 문자열로 다룹니다.
// 같은 길이의 문자열이라 크기 비교(<, >)가 곧 날짜 비교가 됩니다.

const KST_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 한국 시간 기준 오늘 날짜 (YYYYMMDD) */
export function todayKST(now = new Date()) {
  return KST_FORMAT.format(now).replaceAll('-', '');
}

export function isYmd(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return false;
  const d = ymdToDate(value);
  return dateToYmd(d) === value;
}

export function ymdToDate(ymd) {
  return new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
}

export function dateToYmd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function addDays(ymd, days) {
  const d = ymdToDate(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return dateToYmd(d);
}

/** b - a (일 단위) */
export function daysBetween(a, b) {
  return Math.round((ymdToDate(b) - ymdToDate(a)) / 86400000);
}

/** 0=일요일 ... 6=토요일 */
export function weekday(ymd) {
  return ymdToDate(ymd).getUTCDay();
}

export function monthRange(year, month) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { start: `${year}${mm}01`, end: `${year}${mm}${String(last).padStart(2, '0')}` };
}

export function shiftMonth(year, month, delta) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** 두 기간이 하루라도 겹치는지 */
export function overlaps(start, end, rangeStart, rangeEnd) {
  return start <= rangeEnd && end >= rangeStart;
}

export function eventStatus(start, end, today) {
  if (today < start) return 'upcoming';
  if (today > end) return 'ended';
  return 'ongoing';
}

/** 다가오는(또는 진행 중인) 주말: 토~일 */
export function upcomingWeekend(today) {
  const day = weekday(today);
  if (day === 6) return { start: today, end: addDays(today, 1) };
  if (day === 0) return { start: today, end: today };
  const saturday = addDays(today, 6 - day);
  return { start: saturday, end: addDays(saturday, 1) };
}
