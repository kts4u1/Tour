// 지도 (Leaflet + OpenStreetMap). 지도 보기를 처음 열 때 불러옵니다.
import { fmtDistance, fmtRange } from './util.js';

let leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leafletPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/leaflet/leaflet.js';
    script.onload = () => resolve(window.L);
    script.onerror = () => {
      leafletPromise = null;
      reject(new Error('지도를 불러오지 못했어요.'));
    };
    document.head.append(script);
  });
  return leafletPromise;
}

const COLORS = { 15: '#e11d48', 12: '#0f766e', 14: '#7c3aed', 28: '#c2410c' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export class NearbyMap {
  constructor(container, { onSelect, onPick }) {
    this.container = container;
    this.onSelect = onSelect;
    this.onPick = onPick;
    this.map = null;
  }

  async render({ center, radius, items, today }) {
    const L = await loadLeaflet();
    if (!this.map) {
      this.map = L.map(this.container);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(this.map);
      this.layer = L.layerGroup().addTo(this.map);
      this.map.on('click', (e) => this.showPickPopup(L, e.latlng));
    }
    this.layer.clearLayers();

    const centerLatLng = L.latLng(center.lat, center.lng);
    L.circle(centerLatLng, {
      radius: radius * 1000, color: '#0f766e', weight: 1.5, fillOpacity: 0.05, interactive: false,
    }).addTo(this.layer);

    // 먼 것부터 그려서 가까운 마커가 위에 오도록
    for (const item of [...items].reverse()) {
      if (item.lat == null) continue;
      const marker = L.circleMarker([item.lat, item.lng], {
        radius: item.typeId === '15' ? 8 : 6.5,
        color: '#ffffff',
        weight: 2,
        fillColor: COLORS[item.typeId] || COLORS[12],
        fillOpacity: 0.95,
        bubblingMouseEvents: false,
      });
      marker.bindPopup(() => this.popupFor(item, today));
      marker.addTo(this.layer);
    }

    L.circleMarker(centerLatLng, {
      radius: 8, color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1, bubblingMouseEvents: false,
    })
      .bindTooltip('기준 위치')
      .addTo(this.layer);

    this.map.invalidateSize();
    this.map.fitBounds(centerLatLng.toBounds(radius * 2000), { padding: [8, 8] });
  }

  popupFor(item, today) {
    const box = el('div', 'map-popup');
    box.append(el('strong', null, item.title));
    box.append(el('p', null, `${item.typeLabel} · ${fmtDistance(item.distanceKm)}`));
    if (item.start) box.append(el('p', null, fmtRange(item.start, item.end, today)));
    const button = el('button', null, '자세히 보기');
    button.type = 'button';
    button.addEventListener('click', () => this.onSelect(item));
    box.append(button);
    return box;
  }

  showPickPopup(L, latlng) {
    const box = el('div', 'map-popup');
    box.append(el('p', null, '이 위치를 기준으로 다시 찾을까요?'));
    const button = el('button', null, '여기를 기준 위치로');
    button.type = 'button';
    button.addEventListener('click', () => {
      this.map.closePopup();
      this.onPick(latlng.lat, latlng.lng);
    });
    box.append(button);
    L.popup().setLatLng(latlng).setContent(box).openOn(this.map);
  }

  refreshSize() {
    this.map?.invalidateSize();
  }
}
