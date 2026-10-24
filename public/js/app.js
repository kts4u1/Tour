// 앱 시작점
import { api } from './api.js';
import { initDetail } from './detail.js';
import { initLocation, resolveInitialLocation } from './location.js';
import { activateMonthly, initMonthly } from './monthly.js';
import { activateNearby, initNearby } from './nearby.js';
import { state } from './state.js';
import { categoryIcon, escapeHtml } from './util.js';

const TABS = {
  nearby: activateNearby,
  monthly: activateMonthly,
};

function showTab(name) {
  if (!TABS[name]) name = 'nearby';
  for (const btn of document.querySelectorAll('.tabs [data-tab]')) {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
  }
  for (const id of Object.keys(TABS)) {
    document.getElementById(`view-${id}`).hidden = id !== name;
  }
  TABS[name]();
}

function initTabs() {
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn) location.hash = btn.dataset.tab;
  });
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
}

function initDialogs() {
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('click', (e) => {
      // 바깥(배경) 누르면 닫기
      if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
    });
  }
}

// 이미지가 깨지면 분류 아이콘으로 바꿔줍니다. (인라인 onerror 는 CSP 로 막혀 있어 여기서 처리)
function initImageFallback() {
  document.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.dataset.fallback) return;
      const box = img.parentElement;
      box.classList.add('ph', `ph-${img.dataset.fallback}`);
      box.innerHTML = categoryIcon(img.dataset.fallback);
    },
    true,
  );
}

// 그룹 제목이 헤더 아래에 붙도록 헤더 높이를 CSS 변수로
function trackHeaderHeight() {
  const header = document.querySelector('.app-header');
  const apply = () => document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
  apply();
  new ResizeObserver(apply).observe(header);
}

async function main() {
  initImageFallback();
  trackHeaderHeight();
  try {
    state.meta = await api.meta();
  } catch (err) {
    document.querySelector('main').innerHTML = `<div class="error-box"><strong>서버에 연결하지 못했어요</strong>${escapeHtml(err.message)}</div>`;
    return;
  }
  state.today = state.meta.today;
  document.getElementById('demoBanner').hidden = state.meta.mode !== 'demo';

  initDialogs();
  initDetail();
  initLocation();
  initNearby();
  initMonthly();
  initTabs();

  showTab(location.hash.slice(1));
  await resolveInitialLocation();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

main();
