// "내 주변" 화면: 반경(10~100km)별 관광지·행사
import { api } from './api.js';
import { openDetail } from './detail.js';
import { pickLocationOnMap } from './location.js';
import { NearbyMap } from './map.js';
import { onLocationChange, state } from './state.js';
import {
  ICON, categoryIcon, escapeHtml, fmtDistance, fmtRange, statusInfo, storage,
} from './util.js';

const PAGE_SIZE = 30;
const MAP_LIMIT = 300;

const prefs = {
  radius: 10,
  category: 'all',
  when: 'all',
  sort: 'recommend',
  view: 'list',
  ...storage.get('nearbyPrefs', {}),
};

const els = {
  radius: document.getElementById('radiusGroup'),
  category: document.getElementById('categoryGroup'),
  when: document.getElementById('whenGroup'),
  sort: document.getElementById('sortSelect'),
  view: document.getElementById('nearbyViewToggle'),
  summary: document.getElementById('nearbySummary'),
  notice: document.getElementById('nearbyNotice'),
  list: document.getElementById('nearbyList'),
  mapWrap: document.getElementById('nearbyMapWrap'),
  map: document.getElementById('nearbyMap'),
  more: document.getElementById('moreButton'),
};

let items = [];
let total = 0;
let controller = null;
let loadedOnce = false;
let nearbyMap = null;
const itemById = new Map();

function savePrefs() {
  storage.set('nearbyPrefs', prefs);
}

function setPressed(container, attr, value) {
  for (const btn of container.querySelectorAll(`[${attr}]`)) {
    btn.setAttribute('aria-pressed', String(btn.getAttribute(attr) === String(value)));
  }
}

function festivalsIncluded() {
  return prefs.category === 'all' || prefs.category === 'festival';
}

function renderControls() {
  const { radii, categories, whenFilters, sorts } = state.meta;
  if (!radii.includes(prefs.radius)) prefs.radius = radii[0];

  els.radius.innerHTML = radii
    .map((r) => `<button type="button" data-radius="${r}" aria-pressed="false"><b>${r}km</b><small data-count></small></button>`)
    .join('');
  els.category.innerHTML = categories
    .map((c) => `<button type="button" class="chip" data-category="${escapeHtml(c.id)}" aria-pressed="false">${escapeHtml(c.label)}</button>`)
    .join('');
  els.when.innerHTML =
    '<span class="row-label">행사</span>' +
    whenFilters
      .map((w) => `<button type="button" class="chip" data-when="${escapeHtml(w.id)}" aria-pressed="false">${escapeHtml(w.label)}</button>`)
      .join('');
  els.sort.innerHTML = sorts.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.label)}</option>`).join('');
  syncControls();
}

function syncControls() {
  setPressed(els.radius, 'data-radius', prefs.radius);
  setPressed(els.category, 'data-category', prefs.category);
  setPressed(els.when, 'data-when', prefs.when);
  setPressed(els.view, 'data-view', prefs.view);
  els.when.hidden = !festivalsIncluded();
  els.sort.value = prefs.sort;
  els.list.hidden = prefs.view !== 'list';
  els.mapWrap.hidden = prefs.view !== 'map';
}

function thumbHtml(item) {
  if (item.thumb) {
    return `<div class="thumb"><img src="${escapeHtml(item.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="${escapeHtml(item.typeId)}"></div>`;
  }
  return `<div class="thumb ph ph-${escapeHtml(item.typeId)}">${categoryIcon(item.typeId)}</div>`;
}

export function cardHtml(item, today) {
  const status = statusInfo(item, today);
  return `
    <article class="card" role="button" tabindex="0" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)} 자세히 보기">
      ${thumbHtml(item)}
      <div class="card-body">
        <div class="card-badges">
          <span class="badge cat-${escapeHtml(item.typeId)}">${escapeHtml(item.typeLabel)}</span>
          ${status ? `<span class="badge ${status.cls}">${escapeHtml(status.label)}</span>` : ''}
        </div>
        <h3 class="card-title">${escapeHtml(item.title)}</h3>
        ${item.start ? `<p class="card-meta period">${ICON.calendar}<span>${escapeHtml(fmtRange(item.start, item.end, today))}</span></p>` : ''}
        <p class="card-meta">${ICON.pin}<span>${escapeHtml(item.addr || item.region || '')}</span></p>
      </div>
      ${item.distanceKm != null ? `<span class="distance">${escapeHtml(fmtDistance(item.distanceKm))}</span>` : ''}
    </article>`;
}

function skeletonHtml(count = 5) {
  return Array.from(
    { length: count },
    () => `<div class="card skeleton" aria-hidden="true"><div class="thumb"></div><div><div class="line" style="width:35%"></div><div class="line" style="width:80%"></div><div class="line" style="width:60%"></div></div></div>`,
  ).join('');
}

function showLoading() {
  els.summary.innerHTML = '불러오는 중…';
  els.notice.hidden = true;
  els.more.hidden = true;
  if (prefs.view === 'list') els.list.innerHTML = skeletonHtml();
}

function showError(err) {
  els.summary.textContent = '';
  const box = `<div class="error-box"><strong>정보를 불러오지 못했어요</strong>${escapeHtml(err.message)}<br><button type="button" class="text-button" data-retry>다시 시도</button></div>`;
  if (prefs.view === 'list') els.list.innerHTML = box;
  else els.summary.innerHTML = box;
  els.more.hidden = true;
}

function updateRadiusCounts(radiusCounts) {
  for (const btn of els.radius.querySelectorAll('[data-radius]')) {
    const n = radiusCounts?.[btn.dataset.radius];
    btn.querySelector('[data-count]').textContent = n == null ? '' : `${n.toLocaleString()}곳`;
  }
}

function renderSummary(data) {
  const loc = state.location;
  const typeLabels = state.meta.typeLabels;
  const whenLabel = festivalsIncluded() && prefs.when !== 'all'
    ? ` · 행사 ${state.meta.whenFilters.find((w) => w.id === prefs.when)?.label}`
    : '';
  const order = ['15', '12', '14', '28'];
  const pills = order
    .filter((t) => data.typeCounts[t])
    .map((t) => `<span class="badge cat-${t}">${escapeHtml(typeLabels[t])} ${data.typeCounts[t].toLocaleString()}</span>`)
    .join('');
  els.summary.innerHTML = `<strong>${escapeHtml(loc.label)}</strong> 기준 반경 <strong>${data.radius}km</strong> 안에서 <strong>${data.total.toLocaleString()}곳</strong>을 찾았어요${escapeHtml(whenLabel)}
    ${pills ? `<div class="pill-list">${pills}</div>` : ''}`;
  els.notice.hidden = !data.notice;
  els.notice.textContent = data.notice || '';
}

function renderList(append) {
  const today = state.today;
  if (!items.length) {
    const radii = state.meta.radii;
    const next = radii.find((r) => r > prefs.radius);
    els.list.innerHTML = `<div class="empty"><strong>이 반경 안에는 결과가 없어요</strong>반경을 넓히거나 다른 분류를 골라 보세요.${
      next ? `<br><button type="button" class="text-button" data-widen="${next}">${next}km로 넓히기</button>` : ''
    }</div>`;
    els.more.hidden = true;
    return;
  }
  const start = append ? els.list.querySelectorAll('.card').length : 0;
  const html = items.slice(start).map((item) => cardHtml(item, today)).join('');
  if (append) els.list.insertAdjacentHTML('beforeend', html);
  else els.list.innerHTML = html;
  els.more.hidden = items.length >= total;
  els.more.disabled = false;
  els.more.textContent = `더 보기 (${items.length.toLocaleString()} / ${total.toLocaleString()})`;
}

async function renderMap() {
  els.more.hidden = true;
  nearbyMap ??= new NearbyMap(els.map, {
    onSelect: (item) => openDetail(item),
    onPick: (lat, lng) => pickLocationOnMap(lat, lng),
  });
  try {
    await nearbyMap.render({ center: state.location, radius: prefs.radius, items, today: state.today });
    if (total > items.length) {
      els.notice.hidden = false;
      els.notice.textContent = `지도에는 추천순 상위 ${items.length}곳만 표시돼요. 반경을 줄이거나 분류를 고르면 더 자세히 볼 수 있어요.`;
    }
  } catch (err) {
    showError(err);
  }
}

async function load({ append = false } = {}) {
  const loc = state.location;
  if (!loc) return;
  controller?.abort();
  controller = new AbortController();
  loadedOnce = true;

  const isMap = prefs.view === 'map';
  if (append) {
    els.more.disabled = true;
    els.more.textContent = '불러오는 중…';
  } else {
    showLoading();
  }

  try {
    const data = await api.nearby(
      {
        lat: loc.lat.toFixed(5),
        lng: loc.lng.toFixed(5),
        radius: prefs.radius,
        category: prefs.category,
        when: prefs.when,
        sort: prefs.sort,
        offset: append ? items.length : 0,
        limit: isMap ? MAP_LIMIT : PAGE_SIZE,
      },
      controller.signal,
    );
    items = append ? items.concat(data.items) : data.items;
    total = data.total;
    for (const item of data.items) itemById.set(item.id, item);
    updateRadiusCounts(data.radiusCounts);
    renderSummary(data);
    if (isMap) await renderMap();
    else renderList(append);
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (append) {
      els.more.disabled = false;
      els.more.textContent = '다시 시도';
    } else {
      showError(err);
    }
  }
}

function update(changes) {
  Object.assign(prefs, changes);
  savePrefs();
  syncControls();
  load();
}

export function initNearby() {
  renderControls();

  els.radius.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-radius]');
    if (btn) update({ radius: Number(btn.dataset.radius) });
  });
  els.category.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-category]');
    if (btn) update({ category: btn.dataset.category });
  });
  els.when.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-when]');
    if (btn) update({ when: btn.dataset.when });
  });
  els.sort.addEventListener('change', () => update({ sort: els.sort.value }));
  els.view.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (btn && btn.dataset.view !== prefs.view) update({ view: btn.dataset.view });
  });
  els.more.addEventListener('click', () => load({ append: true }));

  const section = document.getElementById('view-nearby');
  section.addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) return load();
    const widen = e.target.closest('[data-widen]');
    if (widen) return update({ radius: Number(widen.dataset.widen) });
    const card = e.target.closest('.card[data-id]');
    if (card && itemById.has(card.dataset.id)) openDetail(itemById.get(card.dataset.id));
  });
  section.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.card[data-id]');
    if (!card) return;
    e.preventDefault();
    openDetail(itemById.get(card.dataset.id));
  });

  onLocationChange(() => {
    if (loadedOnce || !document.getElementById('view-nearby').hidden) load();
  });
}

export function activateNearby() {
  if (!loadedOnce) load();
  else nearbyMap?.refreshSize();
}
