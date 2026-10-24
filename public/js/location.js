// 기준 위치: 현재 위치(GPS) 또는 도시 선택
import { setLocation, state } from './state.js';
import { distanceKm, escapeHtml, toast } from './util.js';

const dialog = document.getElementById('locationDialog');
const hintEl = document.getElementById('gpsHint');

const GEO_ERRORS = {
  1: '위치 권한이 거부되었어요. 브라우저 설정에서 위치 권한을 허용하거나 도시를 선택해 주세요.',
  2: '현재 위치를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.',
  3: '위치 확인 시간이 초과되었어요. 다시 시도해 주세요.',
};

function hint(text) {
  hintEl.textContent = text;
}

export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) {
      reject(new Error('현재 위치는 https 주소(또는 localhost)에서만 사용할 수 있어요.'));
      return;
    }
    if (!('geolocation' in navigator)) {
      reject(new Error('이 브라우저는 위치 정보를 지원하지 않아요.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(GEO_ERRORS[err.code] || GEO_ERRORS[2])),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

export async function useGps({ quiet = false } = {}) {
  hint('현재 위치를 확인하는 중…');
  try {
    const pos = await getCurrentPosition();
    const prev = state.location;
    hint('');
    if (dialog.open) dialog.close();
    // 조금 움직인 정도면 다시 불러오지 않음
    if (prev?.source === 'gps' && distanceKm(prev.lat, prev.lng, pos.lat, pos.lng) < 0.3) return true;
    setLocation({ ...pos, label: '현재 위치', source: 'gps' });
    return true;
  } catch (err) {
    hint(err.message);
    if (!quiet) toast(err.message);
    return false;
  }
}

function openDialog() {
  hint('');
  const loc = state.location;
  for (const btn of document.querySelectorAll('#cityGrid button')) {
    const city = state.meta.cities[btn.dataset.index];
    btn.setAttribute('aria-pressed', String(loc?.source === 'city' && loc.label === city.name));
  }
  dialog.showModal();
}

export function initLocation() {
  const grid = document.getElementById('cityGrid');
  grid.innerHTML = state.meta.cities
    .map((c, i) => `<button type="button" data-index="${i}" aria-pressed="false">${escapeHtml(c.name)}</button>`)
    .join('');
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-index]');
    if (!btn) return;
    const city = state.meta.cities[btn.dataset.index];
    setLocation({ lat: city.lat, lng: city.lng, label: city.name, source: 'city' });
    dialog.close();
  });
  document.getElementById('locButton').addEventListener('click', openDialog);
  document.getElementById('useGpsButton').addEventListener('click', () => useGps());
}

export function pickLocationOnMap(lat, lng) {
  setLocation({ lat, lng, label: '지도에서 고른 위치', source: 'map' });
}

/** 처음 열었을 때 기준 위치 정하기 */
export async function resolveInitialLocation() {
  const saved = state.location;
  if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng)) {
    setLocation(saved, { notify: false }); // 화면은 이미 저장된 위치로 불러오는 중
    // 지난번에 현재 위치를 썼다면 새 위치로 조용히 갱신
    if (saved.source === 'gps') useGps({ quiet: true });
    return;
  }
  const fallback = state.meta.cities[0];
  setLocation({ lat: fallback.lat, lng: fallback.lng, label: fallback.name, source: 'city' });
  const ok = await useGps({ quiet: true });
  if (!ok) toast(`${fallback.name} 기준으로 보여드려요. 위쪽 위치 버튼에서 바꿀 수 있어요.`);
}
