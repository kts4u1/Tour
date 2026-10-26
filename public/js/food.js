// "주변 맛집" 화면: 내 주변 맛집·추천 카페 (카카오맵 평점 기준)
// 서버가 지역별로 저장해 둔 데이터(하루 최대 두 번 카카오에서 새로 받음)를 받아 맛집 점수 순으로 보여 줍니다.
// 처음 검색되는 지역이라 평점이 비어 있으면, 그 부분만 8곳씩 받아 채웁니다.
import { api } from './api.js';
import { openFoodDetail } from './detail.js';
import { onLocationChange, state } from './state.js';
import { FOOD_KIND, ICON, categoryIcon, escapeHtml, josa, storage } from './util.js';

const PAGE_SIZE = 30;
const RECOMMEND_MIN = 3.85; // server/food/ranking.js 의 RECOMMEND_MIN_SCORE 와 같게

const saved = storage.get('foodPrefs', {});
const prefs = { kind: 'restaurant', radius: 1000, sort: 'quality', ...saved };
// "평점 낮은 곳도 보기"는 종류마다 따로 기억 (숙소는 기본으로 켬)
prefs.showAllByKind = {
  ...Object.fromEntries(Object.entries(FOOD_KIND).map(([k, v]) => [k, v.showAll])),
  ...(typeof saved.showAll === 'boolean' ? { restaurant: saved.showAll, cafe: saved.showAll } : {}),
  ...(saved.showAllByKind || {}),
};
delete prefs.showAll;
if (!FOOD_KIND[prefs.kind]) prefs.kind = 'restaurant';
let group = 'all';
let candidates = [];
const ratings = new Map(); // id -> 평점 정보 (null = 정보 없음)
let ratingProgress = { done: 0, total: 0 };
let areaInfo = null; // { area, fetchedAt, stale }
let shown = PAGE_SIZE;
let loadedOnce = false;
let controller = null;
let lastError = null;
const byId = new Map();

const els = {
  kind: document.getElementById('foodKind'),
  radius: document.getElementById('foodRadius'),
  groups: document.getElementById('foodGroups'),
  sort: document.getElementById('foodSort'),
  showAll: document.getElementById('foodShowAll'),
  summary: document.getElementById('foodSummary'),
  list: document.getElementById('foodList'),
  more: document.getElementById('foodMore'),
  demo: document.getElementById('foodDemoBanner'),
};

const savePrefs = () => storage.set('foodPrefs', prefs);
const fmtM = (m) => (m < 1000 ? `${m}m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`);
const fmtWon = (n) => (n ? `${n.toLocaleString()}원` : '');
const kindText = () => FOOD_KIND[prefs.kind];
const showAll = () => Boolean(prefs.showAllByKind[prefs.kind]);

// 받은 시각은 한국 시간으로 표시
const KST = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
function fmtTime(ms) {
  const parts = Object.fromEntries(KST.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const today = Object.fromEntries(KST.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const hm = `${parts.hour}:${parts.minute}`;
  return parts.month === today.month && parts.day === today.day ? `오늘 ${hm}` : `${parts.month}/${parts.day} ${hm}`;
}

function setPressed(container, attr, value) {
  for (const btn of container.querySelectorAll(`[${attr}]`)) {
    btn.setAttribute('aria-pressed', String(btn.getAttribute(attr) === String(value)));
  }
}

function renderControls() {
  const radii = state.meta.foodRadii || [1000, 3000, 5000, 10000];
  if (!radii.includes(prefs.radius)) prefs.radius = 1000;
  els.radius.innerHTML = radii.map((r) => `<button type="button" data-radius="${r}" aria-pressed="false"><b>${r < 1000 ? `${r}m` : `${r / 1000}km`}</b></button>`).join('');
  syncControls();
}

function syncControls() {
  setPressed(els.kind, 'data-kind', prefs.kind);
  setPressed(els.radius, 'data-radius', prefs.radius);
  els.sort.value = prefs.sort;
  els.sort.options[0].textContent = kindText().sort;
  els.showAll.checked = showAll();
}

/** 화면에 보일 목록 (필터·정렬 적용) */
function visibleItems() {
  const items = [];
  for (const place of candidates) {
    const info = ratings.get(place.id);
    const item = { ...place, info: info === undefined ? undefined : info };
    if (info?.closed) continue; // 폐업
    const recommended = info && info.quality != null && info.quality >= RECOMMEND_MIN;
    if (!showAll() && !recommended) continue;
    items.push(item);
  }
  const groupCounts = new Map();
  for (const it of items) groupCounts.set(it.label, (groupCounts.get(it.label) || 0) + 1);
  const filtered = group === 'all' ? items : items.filter((it) => it.label === group);

  if (prefs.sort === 'distance') filtered.sort((a, b) => a.distanceM - b.distanceM);
  else {
    filtered.sort((a, b) => {
      const qa = a.info?.quality ?? -1;
      const qb = b.info?.quality ?? -1;
      return qb - qa || a.distanceM - b.distanceM;
    });
  }
  return { items: filtered, total: items.length, groupCounts };
}

function renderGroups(groupCounts, total) {
  if (group !== 'all' && !groupCounts.has(group)) group = 'all';
  const chips = [`<button type="button" class="chip" data-group="all" aria-pressed="false">전체 <span class="count">${total}</span></button>`];
  for (const [label, count] of [...groupCounts.entries()].sort((a, b) => b[1] - a[1])) {
    chips.push(`<button type="button" class="chip" data-group="${escapeHtml(label)}" aria-pressed="false">${escapeHtml(label)} <span class="count">${count}</span></button>`);
  }
  els.groups.innerHTML = chips.join('');
  els.groups.hidden = groupCounts.size <= 1;
  setPressed(els.groups, 'data-group', group);
}

function ratingLine(info) {
  if (info === undefined) return '<span class="muted">평점 확인 중…</span>';
  if (!info || (!info.rating?.count && !info.rating?.blog)) return '<span class="muted">평점 정보 없음</span>';
  const r = info.rating;
  const parts = [];
  if (r.score != null) parts.push(`<b class="star">${ICON.star}${r.score.toFixed(1)}</b>`);
  if (r.count) parts.push(`리뷰 ${r.count.toLocaleString()}`);
  if (r.blog) parts.push(`블로그 ${r.blog.toLocaleString()}`);
  return parts.join(' · ');
}

function openBadge(info) {
  const code = info?.open?.code;
  if (!code) return '';
  const label = info.open.text || (code === 'OPEN' ? '영업 중' : '영업 전/종료');
  const cls = code === 'OPEN' ? 'st-ongoing' : code === 'CLOSE' || code === 'OFF' ? 'st-ended' : 'st-upcoming';
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

function cardHtml(item) {
  const info = item.info;
  const menu = prefs.kind === 'stay' ? [] : (info?.menu || []).filter((m) => m.price).slice(0, 2);
  const icon = kindText().icon;
  return `
    <article class="card food-card" role="button" tabindex="0" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} 자세히 보기">
      <div class="thumb ph ph-${icon}">${categoryIcon(icon)}</div>
      <div class="card-body">
        <div class="card-badges">
          <span class="badge cat-${icon}">${escapeHtml(item.label)}</span>
          ${info?.tasty ? `<span class="badge tasty">${kindText().tasty}</span>` : ''}
          ${prefs.kind === 'stay' ? '' : openBadge(info)}
        </div>
        <h3 class="card-title">${escapeHtml(item.name)}</h3>
        <p class="card-meta rating"><span>${ratingLine(info)}</span></p>
        ${menu.length ? `<p class="card-meta"><span>${menu.map((m) => `${escapeHtml(m.name)} ${fmtWon(m.price)}`).join(' · ')}</span></p>` : ''}
        <p class="card-meta">${ICON.pin}<span>${escapeHtml(item.address)}</span></p>
      </div>
      <span class="distance">${fmtM(item.distanceM)}</span>
    </article>`;
}

function render() {
  if (lastError) return;
  const { items, total, groupCounts } = visibleItems();
  renderGroups(groupCounts, total);
  byId.clear();
  for (const it of items) byId.set(it.id, it);

  const loading = ratingProgress.done < ratingProgress.total;
  const what = kindText().what;
  const radiusText = prefs.radius < 1000 ? `${prefs.radius}m` : `${prefs.radius / 1000}km`;
  const where = `<strong>${escapeHtml(state.location.label)}</strong> 기준 ${radiusText} 안`;
  if (loading) {
    els.summary.innerHTML = `${where}에서 ${josa(what, '을', '를')} 찾는 중이에요… <span class="muted">(평점 확인 ${ratingProgress.done}/${ratingProgress.total})</span>`;
  } else {
    els.summary.innerHTML = `${where}에서 ${what} <strong>${total}곳</strong>을 찾았어요${
      showAll() ? ' <span class="muted">(카카오맵 평점 높은 순)</span>' : ' <span class="muted">(카카오맵 평점이 좋은 곳만)</span>'
    }${areaInfo?.fetchedAt ? `<br><span class="muted data-time">카카오맵 데이터 기준: ${escapeHtml(fmtTime(areaInfo.fetchedAt))}${areaInfo.stale ? ' (새로 받지 못해 이전 데이터)' : ''}</span>` : ''}`;
  }

  if (!items.length) {
    if (loading) {
      els.list.innerHTML = skeleton();
    } else {
      const next = (state.meta.foodRadii || []).find((r) => r > prefs.radius);
      els.list.innerHTML = `<div class="empty"><strong>${showAll() ? `이 반경 안에는 ${josa(what, '이', '가')} 없어요` : `이 반경 안에는 평점 좋은 ${josa(what, '이', '가')} 없어요`}</strong>${showAll() ? '반경을 넓혀 보세요.' : '반경을 넓히거나 "평점 낮은 곳도 보기"를 켜 보세요.'}${
        next ? `<br><button type="button" class="text-button" data-widen="${next}">${next < 1000 ? `${next}m` : `${next / 1000}km`}로 넓히기</button>` : ''
      }</div>`;
    }
    els.more.hidden = true;
    return;
  }
  els.list.innerHTML = items.slice(0, shown).map(cardHtml).join('');
  els.more.hidden = items.length <= shown;
  els.more.textContent = `더 보기 (${Math.min(shown, items.length)} / ${items.length})`;
}

function skeleton(count = 4) {
  return Array.from({ length: count }, () => '<div class="card skeleton" aria-hidden="true"><div class="thumb"></div><div><div class="line" style="width:35%"></div><div class="line" style="width:80%"></div><div class="line" style="width:60%"></div></div></div>').join('');
}

/** 평점이 비어 있는 곳만 서버에 받아 달라고 함 (서버가 지역 데이터에 저장해서 다음 사람은 바로 받음) */
async function fillRatings(pending, batch, signal) {
  ratingProgress = { done: 0, total: pending.length };
  render();
  for (let i = 0; i < pending.length; i += batch) {
    const ids = pending.slice(i, i + batch);
    try {
      const { ratings: got } = await api.foodRatings(areaInfo.area, ids, signal);
      for (const id of ids) ratings.set(id, got[id] ?? null);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      for (const id of ids) ratings.set(id, null);
    }
    if (signal.aborted) return;
    ratingProgress.done += ids.length;
    render();
  }
}

async function load() {
  const loc = state.location;
  if (!loc) return;
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  loadedOnce = true;
  lastError = null;
  shown = PAGE_SIZE;
  candidates = [];
  areaInfo = null;
  ratings.clear();
  ratingProgress = { done: 0, total: 1 };
  els.summary.textContent = '주변 가게를 찾는 중…';
  els.list.innerHTML = skeleton();
  els.more.hidden = true;
  els.groups.hidden = true;
  try {
    const data = await api.food({ lat: loc.lat.toFixed(5), lng: loc.lng.toFixed(5), radius: prefs.radius, kind: prefs.kind }, signal);
    if (signal.aborted) return;
    els.demo.hidden = !data.demo;
    areaInfo = { area: data.area, fetchedAt: data.fetchedAt, stale: data.stale };
    candidates = data.places;
    const pending = new Set(data.pending);
    // 평점 확인 대상이 아닌 곳(인기순 뒤쪽)은 "정보 없음"으로
    for (const p of candidates) ratings.set(p.id, p.info !== undefined ? p.info : pending.has(p.id) ? undefined : null);
    for (const id of pending) ratings.delete(id);
    if (!pending.size) {
      ratingProgress = { done: 0, total: 0 };
      render();
      return;
    }
    await fillRatings([...pending], data.batch || 8, signal);
  } catch (err) {
    if (err.name === 'AbortError') return;
    lastError = err;
    els.summary.textContent = '';
    els.list.innerHTML = `<div class="error-box"><strong>맛집 정보를 불러오지 못했어요</strong>${escapeHtml(err.message)}<br><button type="button" class="text-button" data-retry>다시 시도</button></div>`;
  }
}

function update(changes, { reload = true } = {}) {
  Object.assign(prefs, changes);
  savePrefs();
  syncControls();
  if (reload) load();
  else {
    shown = PAGE_SIZE;
    render();
  }
}

export function initFood() {
  renderControls();
  els.kind.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kind]');
    if (btn && btn.dataset.kind !== prefs.kind) {
      group = 'all';
      update({ kind: btn.dataset.kind });
    }
  });
  els.radius.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-radius]');
    if (btn) update({ radius: Number(btn.dataset.radius) });
  });
  els.groups.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-group]');
    if (!btn) return;
    group = btn.dataset.group;
    shown = PAGE_SIZE;
    render();
  });
  els.sort.addEventListener('change', () => update({ sort: els.sort.value }, { reload: false }));
  els.showAll.addEventListener('change', () =>
    update({ showAllByKind: { ...prefs.showAllByKind, [prefs.kind]: els.showAll.checked } }, { reload: false }),
  );
  els.more.addEventListener('click', () => {
    shown += PAGE_SIZE;
    render();
  });

  const section = document.getElementById('view-food');
  section.addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) return load();
    const widen = e.target.closest('[data-widen]');
    if (widen) return update({ radius: Number(widen.dataset.widen) });
    const card = e.target.closest('.card[data-id]');
    if (card && byId.has(card.dataset.id)) openFoodDetail(byId.get(card.dataset.id));
  });
  section.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.card[data-id]');
    if (!card || !byId.has(card.dataset.id)) return;
    e.preventDefault();
    openFoodDetail(byId.get(card.dataset.id));
  });

  onLocationChange(() => {
    if (loadedOnce || !document.getElementById('view-food').hidden) load();
  });
}

export function activateFood() {
  if (!loadedOnce) load();
}
