// TourAPI 원본 항목을 앱에서 쓰는 형태로 바꿉니다.
import { isYmd } from './lib/dates.js';
import { isKoreanCoord } from './lib/geo.js';
import { resolveRegion } from './lib/regions.js';
import { htmlToText, toHttps } from './lib/text.js';
import { FESTIVAL_TYPE } from './catalog.js';

const round6 = (n) => Math.round(n * 1e6) / 1e6;

export function normalizePlace(raw) {
  if (!raw || raw.contentid == null) return null;
  const lat = parseFloat(raw.mapy);
  const lng = parseFloat(raw.mapx);
  const hasCoord = isKoreanCoord(lat, lng);
  return {
    id: String(raw.contentid),
    typeId: String(raw.contenttypeid || ''),
    title: htmlToText(raw.title) || '(이름 없음)',
    addr: [raw.addr1, raw.addr2].map((s) => (s ? String(s).trim() : '')).filter(Boolean).join(' '),
    region: resolveRegion(raw),
    lat: hasCoord ? round6(lat) : null,
    lng: hasCoord ? round6(lng) : null,
    image: toHttps(raw.firstimage),
    thumb: toHttps(raw.firstimage2) || toHttps(raw.firstimage),
    tel: htmlToText(raw.tel) || null,
  };
}

export function normalizeFestival(raw) {
  const place = normalizePlace(raw);
  if (!place) return null;
  const start = String(raw.eventstartdate || '').trim();
  let end = String(raw.eventenddate || '').trim();
  if (!isYmd(start)) return null;
  if (!isYmd(end) || end < start) end = start;
  return { ...place, typeId: FESTIVAL_TYPE, start, end };
}

/** id 기준 중복 제거 (페이지 경계에서 같은 항목이 두 번 올 수 있음) */
export function uniqueById(items) {
  const seen = new Map();
  for (const item of items) if (item && !seen.has(item.id)) seen.set(item.id, item);
  return [...seen.values()];
}
