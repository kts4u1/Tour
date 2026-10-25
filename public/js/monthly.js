// "이달의 행사" 화면: 전국 행사를 월별로 (지역별 / 날짜순 / 일정표)
import { api } from './api.js';
import { openDetail } from './detail.js';
import { onLocationChange, state } from './state.js';
import {
  WEEKDAYS, daysBetween, debounce, distanceKm, durationText, escapeHtml, fmtDistance, fmtLong, fmtShort,
  parseYmd, statusInfo, storage, weekdayOf,
} from './util.js';

const els = {
  title: document.getElementById('monthTitle'),
  prev: document.getElementById('prevMonth'),
  next: document.getElementById('nextMonth'),
  thisMonth: document.getElementById('thisMonth'),
  summary: document.getElementById('monthSummary'),
  region: document.getElementById('regionGroup'),
  radius: document.getElementById('monthRadiusGroup'),
  search: document.getElementById('monthSearch'),
  status: document.getElementById('statusSelect'),
  view: document.getElementById('monthViewToggle'),
  content: document.getElementById('monthContent'),
};

const prefs = { view: 'region', radius: 0, ...storage.get('monthlyPrefs', {}) };
// 상태 기본값: 진행 중 + 예정 (이미 끝난 행사는 숨김)
const filters = { region: 'all', status: 'active', q: '' };
const cache = new Map();
let ym = null;
let data = null;
let controller = null;
let itemById = new Map();

function savePrefs() {
  storage.set('monthlyPrefs', { view: prefs.view, radius: prefs.radius });
}

function setPressed(container, attr, value) {
  for (const btn of container.querySelectorAll(`[${attr}]`)) {
    btn.setAttribute('aria-pressed', String(btn.getAttribute(attr) === String(value)));
  }
}

function monthKey({ year, month }) {
  return `${year}-${month}`;
}

function shift(delta) {
  const index = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function currentYm() {
  const t = parseYmd(state.today);
  return { year: t.y, month: t.m };
}

/** 이번 달 기준 과거(-1) / 이번 달(0) / 미래(1) */
function tense() {
  const now = currentYm();
  const a = ym.year * 12 + ym.month;
  const b = now.year * 12 + now.month;
  return Math.sign(a - b);
}

function renderRadiusChips() {
  const options = [0, ...state.meta.radii];
  els.radius.innerHTML =
    '<span class="row-label">거리</span>' +
    options
      .map((r) => `<button type="button" class="chip" data-radius="${r}" aria-pressed="false">${r ? `${r}km 이내` : '전국'}</button>`)
      .join('');
  setPressed(els.radius, 'data-radius', prefs.radius);
}

/** 지난달 보기에서는 모든 행사가 끝났으므로 "진행·예정"을 "전체"로 봅니다. */
function currentStatus() {
  return filters.status === 'active' && tense() < 0 ? 'all' : filters.status;
}

function matchStatus(item, status = currentStatus()) {
  if (status === 'all') return true;
  if (status === 'active') return item.status !== 'ended';
  return item.status === status;
}

function syncStatusControls() {
  const status = currentStatus();
  els.status.value = status;
  for (const btn of els.summary.querySelectorAll('[data-status]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.status === status));
  }
}

function setStatus(status) {
  filters.status = status;
  renderRegionChips();
  syncStatusControls();
  renderContent();
}

/** 지역 칩: 지금 고른 상태(진행 중/예정 등)에 맞는 행사 수 */
function renderRegionChips() {
  const counts = new Map();
  let total = 0;
  for (const item of data.items) {
    if (!matchStatus(item)) continue;
    total += 1;
    counts.set(item.region, (counts.get(item.region) || 0) + 1);
  }
  const order = data.regions.map((r) => r.name);
  const chips = [`<button type="button" class="chip" data-region="all" aria-pressed="false">전국 <span class="count">${total}</span></button>`];
  for (const name of order) {
    if (!counts.has(name)) continue;
    chips.push(`<button type="button" class="chip" data-region="${escapeHtml(name)}" aria-pressed="false">${escapeHtml(name)} <span class="count">${counts.get(name)}</span></button>`);
  }
  els.region.innerHTML = chips.join('');
  if (filters.region !== 'all' && !counts.has(filters.region)) filters.region = 'all';
  setPressed(els.region, 'data-region', filters.region);
}

function renderSummary() {
  const { month, total, regions, statusCounts } = data;
  const t = tense();
  if (!total) {
    els.summary.innerHTML = `<p class="headline">${month}월에 등록된 축제·행사가 아직 없어요.</p>`;
    return;
  }
  // 지난달은 전체, 이번 달·다음 달은 아직 갈 수 있는 행사(진행 중 + 예정)를 기준으로 요약
  const items = t < 0 ? data.items : data.items.filter((it) => it.status !== 'ended');
  const counts = new Map();
  for (const it of items) counts.set(it.region, (counts.get(it.region) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const shown = top.slice(0, 6).map(([name, n]) => `${escapeHtml(name)} ${n}`).join(' · ');
  const rest = top.length > 6 ? ` 외 ${top.length - 6}곳` : '';

  let headline;
  if (t < 0) headline = `${month}월에는 전국 <b>${counts.size}개</b> 시·도에서 <b>${total.toLocaleString()}개</b>의 축제·행사가 열렸어요`;
  else if (!items.length) headline = `${month}월 축제·행사는 모두 끝났어요`;
  else if (t > 0) headline = `${month}월에는 전국 <b>${counts.size}개</b> 시·도에서 <b>${items.length.toLocaleString()}개</b>의 축제·행사가 열릴 예정이에요`;
  else headline = `${month}월에 지금 가 볼 수 있는 축제·행사는 전국 <b>${counts.size}개</b> 시·도에서 <b>${items.length.toLocaleString()}개</b>예요`;

  const stat = (key, label, n, extra = '') =>
    `<button type="button" class="stat${extra}" data-status="${key}" aria-pressed="false">${label}<b>${n}</b></button>`;
  els.summary.innerHTML = `
    <p class="headline">${headline}</p>
    ${shown ? `<p class="regions-line">${shown}${rest}</p>` : ''}
    <div class="stats" role="group" aria-label="진행 상태로 보기">
      ${t < 0 ? '' : stat('active', '진행·예정', statusCounts.ongoing + statusCounts.upcoming)}
      ${t < 0 ? '' : stat('ongoing', '진행 중', statusCounts.ongoing)}
      ${t < 0 ? '' : stat('upcoming', '예정', statusCounts.upcoming)}
      ${stat(t < 0 ? 'all' : 'ended', '종료', statusCounts.ended, ' muted-stat')}
    </div>`;
  syncStatusControls();
}

function filteredItems() {
  const loc = state.location;
  const q = filters.q.trim().toLowerCase();
  const out = [];
  for (const item of data.items) {
    const dist = loc && item.lat != null ? distanceKm(loc.lat, loc.lng, item.lat, item.lng) : null;
    if (filters.region !== 'all' && item.region !== filters.region) continue;
    if (!matchStatus(item)) continue;
    if (prefs.radius && (dist == null || dist > prefs.radius)) continue;
    if (q && !`${item.title} ${item.addr} ${item.region}`.toLowerCase().includes(q)) continue;
    out.push({ ...item, distanceKm: dist });
  }
  return out;
}

function eventRowHtml(item) {
  const today = state.today;
  const status = statusInfo(item, today);
  const s = parseYmd(item.start);
  const withYear = item.start.slice(0, 4) !== String(data.year) || item.end.slice(0, 4) !== String(data.year);
  const period = item.start === item.end
    ? `${fmtLong(item.start, withYear)} 하루`
    : `${fmtLong(item.start, withYear)} 시작 <span class="arrow">→</span> ${fmtLong(item.end, withYear)} 종료`;
  return `
    <li class="event-row${item.status === 'ended' ? ' is-ended' : ''}" role="button" tabindex="0" data-id="${escapeHtml(item.id)}">
      <div class="date-tile" aria-hidden="true"><span class="m">${s.m}월</span><span class="d">${s.d}</span><span class="w">${WEEKDAYS[weekdayOf(item.start)]}</span></div>
      <div class="event-main">
        <div class="event-head">
          <span class="event-title">${escapeHtml(item.title)}</span>
          ${status ? `<span class="badge ${status.cls}">${escapeHtml(status.label)}</span>` : ''}
        </div>
        <div class="event-period">${period} <span class="len">· ${escapeHtml(durationText(item.start, item.end))}</span></div>
        <div class="event-addr">${escapeHtml(item.addr || item.region)}${item.distanceKm != null ? ` <span class="dist">· ${escapeHtml(fmtDistance(item.distanceKm))}</span>` : ''}</div>
      </div>
    </li>`;
}

function groupHtml(title, count, list) {
  return `<section class="group"><h3 class="group-title">${escapeHtml(title)} <span>${count}개</span></h3><ul class="event-list">${list.map(eventRowHtml).join('')}</ul></section>`;
}

function renderByRegion(list) {
  const groups = new Map();
  for (const item of list) {
    if (!groups.has(item.region)) groups.set(item.region, []);
    groups.get(item.region).push(item);
  }
  const order = state.meta.regions;
  const rank = (name) => (order.includes(name) ? order.indexOf(name) : order.length);
  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([region, rows]) => groupHtml(region, rows.length, rows))
    .join('');
}

function renderByDate(list) {
  const groups = new Map();
  for (const item of list) {
    const key = item.start < data.start ? 'before' : item.start;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] === 'before' ? -1 : b[0] === 'before' ? 1 : a[0].localeCompare(b[0])))
    .map(([key, rows]) => {
      let title;
      if (key === 'before') title = '지난달부터 이어지는 행사';
      else title = `${fmtLong(key)} 시작${key === state.today ? ' · 오늘' : ''}`;
      return groupHtml(title, rows.length, rows);
    })
    .join('');
}

function renderTimeline(list) {
  const days = Number(data.end.slice(6));
  const monthPrefix = data.start.slice(0, 6);
  const todayInMonth = state.today.startsWith(monthPrefix) ? Number(state.today.slice(6)) : null;
  const dayCells = Array.from({ length: days }, (_, i) => {
    const ymd = `${monthPrefix}${String(i + 1).padStart(2, '0')}`;
    const wd = weekdayOf(ymd);
    const day = i + 1;
    const major = day === 1 || day % 5 === 0;
    const cls = [major ? 'major' : '', wd === 6 ? 'sat' : '', wd === 0 ? 'sun' : '', day === todayInMonth ? 'today' : '']
      .join(' ')
      .trim();
    return `<span class="${cls}">${day}</span>`;
  }).join('');

  const rows = [...list]
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))
    .map((item) => {
      const s = item.start < data.start ? data.start : item.start;
      const e = item.end > data.end ? data.end : item.end;
      const left = ((Number(s.slice(6)) - 1) / days) * 100;
      const width = ((daysBetween(s, e) + 1) / days) * 100;
      const cls = [
        'tl-bar', `st-${item.status}`,
        item.start < data.start ? 'cont-left' : '',
        item.end > data.end ? 'cont-right' : '',
      ].join(' ').trim();
      const range = item.start === item.end ? fmtShort(item.start) : `${fmtShort(item.start)}~${fmtShort(item.end)}`;
      return `
        <div class="tl-row" role="button" tabindex="0" data-id="${escapeHtml(item.id)}" title="${escapeHtml(`${item.title} (${range})`)}">
          <div class="tl-label"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.region)} · ${escapeHtml(range)}</small></div>
          <div class="tl-track"><div class="${cls}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%"><span>${escapeHtml(range)}</span></div></div>
        </div>`;
    })
    .join('');

  const todayPos = todayInMonth ? `--today-pos:${(((todayInMonth - 0.5) / days) * 100).toFixed(3)}%;` : '';
  return `
    <div class="timeline-wrap">
      <div class="timeline" style="--days:${days};${todayPos}">
        <div class="tl-head" aria-hidden="true"><div class="tl-label"><small>행사</small></div><div class="tl-days">${dayCells}</div></div>
        ${rows}
      </div>
    </div>`;
}

function renderContent() {
  if (!data) return;
  const list = filteredItems();
  itemById = new Map(list.map((item) => [item.id, item]));
  setPressed(els.view, 'data-view', prefs.view);

  if (!data.total) {
    els.content.innerHTML = '<div class="empty"><strong>이 달에는 행사 정보가 없어요</strong>다른 달을 확인해 보세요.</div>';
    return;
  }
  if (!list.length) {
    els.content.innerHTML = `<div class="empty"><strong>조건에 맞는 행사가 없어요</strong>지역·거리·상태 조건을 바꿔 보세요.${
      currentStatus() !== 'all' ? '<br><button type="button" class="text-button" data-status-all>종료된 행사까지 보기</button>' : ''
    }</div>`;
    return;
  }

  const STATUS_LABEL = { active: '진행·예정', ongoing: '진행 중', upcoming: '예정', ended: '종료된', all: '전체' };
  const notes = [];
  if (filters.region !== 'all') notes.push(escapeHtml(filters.region));
  if (prefs.radius) notes.push(`${escapeHtml(state.location.label)}에서 ${prefs.radius}km 이내`);
  if (filters.q.trim()) notes.push(`"${escapeHtml(filters.q.trim())}" 검색`);
  const line = `<p class="result-line">${STATUS_LABEL[currentStatus()]} 행사 <strong>${list.length}개</strong>${notes.length ? ` · ${notes.join(' · ')}` : ''}</p>`;

  let body;
  if (prefs.view === 'date') body = renderByDate(list);
  else if (prefs.view === 'timeline') body = renderTimeline(list);
  else body = renderByRegion(list);
  els.content.innerHTML = line + body;
}

function showLoading() {
  els.summary.innerHTML = '<p class="headline">행사 일정을 불러오는 중…</p>';
  els.region.innerHTML = '';
  els.content.innerHTML = Array.from({ length: 4 }, () => '<div class="card skeleton" aria-hidden="true"><div class="thumb"></div><div><div class="line" style="width:40%"></div><div class="line" style="width:85%"></div><div class="line" style="width:60%"></div></div></div>').join('');
}

async function load() {
  els.title.textContent = `${ym.year}년 ${ym.month}월`;
  els.thisMonth.hidden = tense() === 0;
  const key = monthKey(ym);
  controller?.abort();

  if (cache.has(key)) {
    data = cache.get(key);
  } else {
    controller = new AbortController();
    showLoading();
    try {
      data = await api.festivals(ym.year, ym.month, controller.signal);
      cache.set(key, data);
    } catch (err) {
      if (err.name === 'AbortError') return;
      data = null;
      els.summary.innerHTML = '<p class="headline">행사 일정을 불러오지 못했어요</p>';
      els.content.innerHTML = `<div class="error-box"><strong>잠시 후 다시 시도해 주세요</strong>${escapeHtml(err.message)}<br><button type="button" class="text-button" data-retry>다시 시도</button></div>`;
      return;
    }
  }
  renderRegionChips();
  renderSummary();
  renderContent();
}

function goTo(next) {
  ym = next;
  filters.status = 'active'; // 달을 바꾸면 상태 필터는 기본값(진행·예정)으로
  load();
}

export function initMonthly() {
  ym = currentYm();
  if (!['region', 'date', 'timeline'].includes(prefs.view)) prefs.view = 'region';
  if (![0, ...state.meta.radii].includes(prefs.radius)) prefs.radius = 0;
  renderRadiusChips();
  setPressed(els.view, 'data-view', prefs.view);

  els.prev.addEventListener('click', () => goTo(shift(-1)));
  els.next.addEventListener('click', () => goTo(shift(1)));
  els.thisMonth.addEventListener('click', () => goTo(currentYm()));

  els.region.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-region]');
    if (!btn) return;
    filters.region = btn.dataset.region;
    setPressed(els.region, 'data-region', filters.region);
    renderContent();
  });
  els.radius.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-radius]');
    if (!btn) return;
    prefs.radius = Number(btn.dataset.radius);
    savePrefs();
    setPressed(els.radius, 'data-radius', prefs.radius);
    renderContent();
  });
  els.status.addEventListener('change', () => setStatus(els.status.value));
  // 요약 카드의 진행 중 / 예정 / 종료를 누르면 그 행사만 (다시 누르면 진행·예정으로)
  els.summary.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-status]');
    if (!btn) return;
    const pressed = btn.getAttribute('aria-pressed') === 'true';
    setStatus(pressed && btn.dataset.status !== 'active' ? 'active' : btn.dataset.status);
    els.content.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  els.search.addEventListener('input', debounce(() => {
    filters.q = els.search.value;
    renderContent();
  }, 200));
  els.view.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    prefs.view = btn.dataset.view;
    savePrefs();
    renderContent();
  });

  els.content.addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) return load();
    if (e.target.closest('[data-status-all]')) return setStatus('all');
    const row = e.target.closest('[data-id]');
    if (row && itemById.has(row.dataset.id)) openDetail(itemById.get(row.dataset.id));
  });
  els.content.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('[data-id]');
    if (!row || !itemById.has(row.dataset.id)) return;
    e.preventDefault();
    openDetail(itemById.get(row.dataset.id));
  });

  onLocationChange(() => renderContent());
}

export function activateMonthly() {
  if (!data) load();
}
