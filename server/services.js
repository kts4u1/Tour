// 화면에 필요한 데이터를 만드는 핵심 로직 (실제/데모 데이터 소스 공통)
import {
  addDays, daysBetween, eventStatus, monthRange, overlaps, shiftMonth, upcomingWeekend,
} from './lib/dates.js';
import { distanceKm } from './lib/geo.js';
import { FESTIVAL_TYPE, MAX_RADIUS_KM, PLACE_TYPES, RADII_KM, TYPE_LABELS } from './catalog.js';
import { REGIONS } from './lib/regions.js';

const regionOrder = (name) => {
  const i = REGIONS.indexOf(name);
  return i === -1 ? REGIONS.length : i;
};

// 행사 목록은 보려는 달보다 몇 달 앞부터 받아서, 기간이 겹치는 행사를 서버에서 고릅니다.
// TourAPI 의 eventStartDate 가 "그날 이후 진행 중인 행사"이든 "그날 이후 시작하는 행사"이든
// 앞 달에 시작해 이번 달까지 이어지는 행사를 놓치지 않기 위함입니다.
const FESTIVAL_LOOKBACK_MONTHS = 3;

export function festivalQueryStart(year, month) {
  const from = shiftMonth(year, month, -FESTIVAL_LOOKBACK_MONTHS);
  return monthRange(from.year, from.month).start;
}

function ymOf(ymd) {
  return { year: Number(ymd.slice(0, 4)), month: Number(ymd.slice(4, 6)) };
}

export function filterByWhen(festivals, when, today) {
  const weekend = upcomingWeekend(today);
  const in30 = addDays(today, 30);
  return festivals.filter((f) => {
    if (f.end < today) return false;
    switch (when) {
      case 'ongoing': return f.start <= today;
      case 'weekend': return overlaps(f.start, f.end, weekend.start, weekend.end);
      case '30d': return f.start <= in30;
      default: return true;
    }
  });
}

function recommendScore(item, distance, radius, today) {
  let score = 0.55 * (1 - Math.min(distance / radius, 1));
  if (item.image) score += 0.15;
  if (item.typeId === FESTIVAL_TYPE) {
    if (item.start <= today) score += 0.3;
    else {
      const until = daysBetween(today, item.start);
      score += until <= 7 ? 0.25 : until <= 30 ? 0.12 : 0.02;
    }
  } else if (item.typeId === '12') {
    score += 0.05;
  }
  return score;
}

const SORTERS = {
  distance: (a, b) => a.distance - b.distance,
  recommend: (a, b) => b.score - a.score || a.distance - b.distance,
  date: (a, b) => {
    const af = a.item.start ? 0 : 1;
    const bf = b.item.start ? 0 : 1;
    if (af !== bf) return af - bf;
    if (!af) return a.item.start.localeCompare(b.item.start) || a.item.end.localeCompare(b.item.end) || a.distance - b.distance;
    return a.distance - b.distance;
  },
};

export function toListItem(item, today, distance = null) {
  const out = {
    id: item.id,
    typeId: item.typeId,
    typeLabel: TYPE_LABELS[item.typeId] || '관광정보',
    title: item.title,
    addr: item.addr,
    region: item.region,
    lat: item.lat,
    lng: item.lng,
    image: item.image,
    thumb: item.thumb,
    tel: item.tel,
  };
  if (distance != null) out.distanceKm = Math.round(distance * 10) / 10;
  if (item.start) {
    out.start = item.start;
    out.end = item.end;
    out.status = eventStatus(item.start, item.end, today);
  }
  return out;
}

/**
 * 내 주변 검색
 * query: { lat, lng, radius, category, when, sort, offset, limit }
 */
export async function findNearby(source, query, today) {
  const { lat, lng, radius, category, when, sort, offset, limit } = query;
  const wantFestivals = category === 'all' || category === 'festival';
  const placeTypes = category === 'all' ? PLACE_TYPES : PLACE_TYPES.filter((t) => t === category);

  const festivalsPromise = wantFestivals
    ? source.getFestivalsFrom(festivalQueryStart(ymOf(today).year, ymOf(today).month))
    : Promise.resolve([]);

  // 관광지 등: 전국 목록이 준비돼 있으면 사용, 아니면 위치기반 조회(20km 이하) 또는 준비될 때까지 대기
  let complete = true;
  let notice = null;
  const ready = placeTypes.map((t) => source.peekPlaces(t));
  let placesPromise;
  if (ready.every(Boolean)) {
    placesPromise = Promise.resolve(ready.flat());
  } else if (radius <= source.nearbyLimitKm) {
    complete = false;
    notice = '전국 관광지 데이터를 준비하고 있어요. 준비가 끝나면 30km 이상 반경과 반경별 개수를 볼 수 있어요.';
    placeTypes.forEach((t) => source.prefetchPlaces(t));
    placesPromise = Promise.all(
      placeTypes.map((t, i) => ready[i] ?? source.getPlacesNear(t, lat, lng, radius)),
    ).then((lists) => lists.flat());
  } else {
    placesPromise = Promise.all(placeTypes.map((t) => source.ensurePlaces(t))).then((lists) => lists.flat());
  }

  const [festivals, places] = await Promise.all([festivalsPromise, placesPromise]);
  const candidates = filterByWhen(festivals, when, today).concat(places);

  const seen = new Set();
  const withinMax = [];
  for (const item of candidates) {
    if (item.lat == null || seen.has(item.id)) continue;
    seen.add(item.id);
    const distance = distanceKm(lat, lng, item.lat, item.lng);
    if (distance <= MAX_RADIUS_KM) withinMax.push({ item, distance });
  }

  const radiusCounts = {};
  for (const r of RADII_KM) {
    radiusCounts[r] = complete || r <= radius ? withinMax.filter((e) => e.distance <= r).length : null;
  }

  const inRadius = withinMax.filter((e) => e.distance <= radius);
  const typeCounts = {};
  for (const { item } of inRadius) typeCounts[item.typeId] = (typeCounts[item.typeId] || 0) + 1;

  for (const entry of inRadius) entry.score = recommendScore(entry.item, entry.distance, radius, today);
  inRadius.sort(SORTERS[sort] || SORTERS.recommend);

  return {
    center: { lat, lng },
    radius,
    category,
    when,
    sort,
    today,
    total: inRadius.length,
    offset,
    limit,
    items: inRadius.slice(offset, offset + limit).map((e) => toListItem(e.item, today, e.distance)),
    radiusCounts,
    typeCounts,
    complete,
    notice,
  };
}

/** 월별 전국 행사 */
export async function festivalsForMonth(source, year, month, today) {
  const range = monthRange(year, month);
  const all = await source.getFestivalsFrom(festivalQueryStart(year, month));

  const items = all
    .filter((f) => overlaps(f.start, f.end, range.start, range.end))
    .sort(
      (a, b) =>
        a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.title.localeCompare(b.title, 'ko'),
    )
    .map((f) => toListItem(f, today));

  const regionCounts = {};
  const statusCounts = { ongoing: 0, upcoming: 0, ended: 0 };
  for (const item of items) {
    regionCounts[item.region] = (regionCounts[item.region] || 0) + 1;
    statusCounts[item.status] += 1;
  }
  const regions = Object.keys(regionCounts).sort((a, b) => regionOrder(a) - regionOrder(b));

  return {
    year,
    month,
    start: range.start,
    end: range.end,
    today,
    total: items.length,
    regions: regions.map((name) => ({ name, count: regionCounts[name] })),
    statusCounts,
    items,
  };
}
