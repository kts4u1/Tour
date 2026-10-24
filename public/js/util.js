// 화면 공통 도우미

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** http(s) 주소만 허용 */
export function safeUrl(url) {
  try {
    const u = new URL(url, location.href);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function parseYmd(ymd) {
  return { y: Number(ymd.slice(0, 4)), m: Number(ymd.slice(4, 6)), d: Number(ymd.slice(6, 8)) };
}

export function weekdayOf(ymd) {
  const { y, m, d } = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysBetween(a, b) {
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

export function addDays(ymd, n) {
  const { y, m, d } = parseYmd(ymd);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** 10.15(목) / 2027.1.3(일) */
export function fmtShort(ymd, withYear = false) {
  const { y, m, d } = parseYmd(ymd);
  return `${withYear ? `${y}.` : ''}${m}.${d}(${WEEKDAYS[weekdayOf(ymd)]})`;
}

/** 10월 15일(목) / 2027년 1월 3일(일) */
export function fmtLong(ymd, withYear = false) {
  const { y, m, d } = parseYmd(ymd);
  return `${withYear ? `${y}년 ` : ''}${m}월 ${d}일(${WEEKDAYS[weekdayOf(ymd)]})`;
}

export function fmtRange(start, end, today, long = false) {
  const thisYear = today.slice(0, 4);
  const withYear = start.slice(0, 4) !== thisYear || end.slice(0, 4) !== thisYear;
  const f = long ? fmtLong : fmtShort;
  if (start === end) return `${f(start, withYear)} 하루`;
  return `${f(start, withYear)} ~ ${f(end, withYear)}`;
}

export function durationText(start, end) {
  const days = daysBetween(start, end) + 1;
  return days <= 1 ? '하루' : `${days}일간`;
}

/** 행사 진행 상태 배지 */
export function statusInfo(item, today) {
  if (!item.start) return null;
  if (today > item.end) return { cls: 'st-ended', label: '종료' };
  if (today >= item.start) {
    if (item.end === today) return { cls: 'st-ending', label: '오늘 마감' };
    const left = daysBetween(today, item.end);
    return { cls: 'st-ongoing', label: left <= 3 ? `진행 중 · ${left}일 남음` : '진행 중' };
  }
  const until = daysBetween(today, item.start);
  return { cls: 'st-upcoming', label: until === 1 ? '내일 시작' : `D-${until}` };
}

export function fmtDistance(km) {
  if (km == null) return '';
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)}m`;
  if (km < 10) return `${km.toFixed(1)}km`;
  return `${Math.round(km)}km`;
}

export function distanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(`tour:${key}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`tour:${key}`, JSON.stringify(value));
    } catch {
      /* 저장 불가(사생활 보호 모드 등) - 무시 */
    }
  },
};

let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

// 분류별 아이콘 (고정 SVG)
const ICONS = {
  15: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="2.5"/></svg>',
  12: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 20 6.5-11 4 6.5L16 12l5 8Z"/><circle cx="17" cy="6" r="2"/></svg>',
  14: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18M4 10h16M12 3 3 8v2h18V8Z"/><path d="M6 10v8M10 10v8M14 10v8M18 10v8"/></svg>',
  28: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="17" r="3.5"/><circle cx="18" cy="17" r="3.5"/><path d="M6 17 9.5 9h5l3.5 8M9.5 9 12 17M14 5h3l-2.5 4"/></svg>',
};
export function categoryIcon(typeId) {
  return ICONS[typeId] || ICONS[12];
}

export const ICON = {
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.6"/></svg>',
  route: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
};
