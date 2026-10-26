// 상세 정보 바텀시트
import { api } from './api.js';
import { state } from './state.js';
import {
  FOOD_KIND, ICON, addDays, categoryIcon, distanceKm, durationText, escapeHtml, fmtDistance, fmtRange, safeUrl, statusInfo, toast,
} from './util.js';

const dialog = document.getElementById('detailDialog');
const body = document.getElementById('detailBody');
let controller = null;
let current = null;

function heroHtml(item) {
  if (item.image) {
    return `<div class="detail-hero"><img src="${escapeHtml(item.image)}" alt="" data-fallback="${escapeHtml(item.typeId)}" referrerpolicy="no-referrer"></div>`;
  }
  return `<div class="detail-hero ph ph-${escapeHtml(item.typeId)}">${categoryIcon(item.typeId)}</div>`;
}

function mapName(title) {
  return encodeURIComponent(String(title).replace(/,/g, ' '));
}

function actionsHtml(item) {
  const out = [];
  if (item.lat != null) {
    out.push(`<a class="primary" href="https://map.kakao.com/link/to/${mapName(item.title)},${item.lat},${item.lng}" target="_blank" rel="noopener">${ICON.route}길찾기</a>`);
    out.push(`<a href="https://map.kakao.com/link/map/${mapName(item.title)},${item.lat},${item.lng}" target="_blank" rel="noopener">${ICON.map}카카오맵</a>`);
  }
  out.push(`<a href="https://map.naver.com/p/search/${encodeURIComponent(item.title)}" target="_blank" rel="noopener">${ICON.pin}네이버지도</a>`);
  if (item.start) {
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: item.title,
      dates: `${item.start}/${addDays(item.end || item.start, 1)}`,
      location: item.addr || '',
      details: '어디갈까에서 찾은 행사입니다. 방문 전 공식 안내를 꼭 확인하세요.',
    });
    out.push(`<a href="https://calendar.google.com/calendar/render?${params}" target="_blank" rel="noopener">${ICON.calendar}캘린더 추가</a>`);
  }
  const tel = item.tel ? String(item.tel).split(/[,\n]/)[0].replace(/[^\d+-]/g, '') : '';
  if (tel.length >= 7) out.push(`<a href="tel:${escapeHtml(tel)}">${ICON.phone}전화</a>`);
  out.push(`<button type="button" data-action="share">${ICON.share}공유</button>`);
  return `<div class="actions">${out.join('')}</div>`;
}

function render(item, detail, { loading = false, error = null } = {}) {
  const today = state.today;
  const status = statusInfo(item, today);
  const loc = state.location;
  const dist = loc && item.lat != null ? distanceKm(loc.lat, loc.lng, item.lat, item.lng) : null;

  let extra = '';
  if (loading) {
    extra = `<div class="detail-section skeleton"><div class="line" style="width:90%"></div><div class="line" style="width:75%"></div><div class="line" style="width:82%"></div></div>`;
  } else if (error) {
    extra = `<div class="detail-section"><p class="hint">상세 정보를 불러오지 못했어요: ${escapeHtml(error)}</p></div>`;
  } else if (detail) {
    if (detail.overview) {
      extra += `<section class="detail-section"><h3>소개</h3><p class="overview">${escapeHtml(detail.overview)}</p></section>`;
    }
    if (detail.info?.length) {
      extra += `<section class="detail-section"><h3>이용 안내</h3><dl class="info-list">${detail.info
        .map((row) => `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`)
        .join('')}</dl></section>`;
    }
    const links = (detail.links || []).map(safeUrl).filter(Boolean);
    if (links.length) {
      extra += `<section class="detail-section"><h3>홈페이지</h3><ul class="homepage-list">${links
        .map((u) => `<li><a href="${escapeHtml(u)}" target="_blank" rel="noopener nofollow">${escapeHtml(u)}</a></li>`)
        .join('')}</ul></section>`;
    }
    extra += `<p class="credit">관광정보 제공: 한국관광공사. 운영 시간과 일정은 바뀔 수 있으니 방문 전 공식 안내를 확인하세요.</p>`;
  }

  body.innerHTML = `
    ${heroHtml(item)}
    <div class="detail-content">
      <div class="card-badges">
        <span class="badge cat-${escapeHtml(item.typeId)}">${escapeHtml(item.typeLabel || '')}</span>
        ${status ? `<span class="badge ${status.cls}">${escapeHtml(status.label)}</span>` : ''}
        ${item.region ? `<span class="badge st-ended">${escapeHtml(item.region)}</span>` : ''}
      </div>
      <h2 id="detailTitle">${escapeHtml(item.title)}</h2>
      ${item.start ? `<p class="detail-period">${escapeHtml(fmtRange(item.start, item.end, today, true))} <span class="len">· ${escapeHtml(durationText(item.start, item.end))}</span></p>` : ''}
      ${item.addr ? `<p class="detail-addr">${escapeHtml(item.addr)}${dist != null ? ` · ${escapeHtml(fmtDistance(dist))}` : ''}</p>` : ''}
      ${actionsHtml(item)}
      ${extra}
    </div>`;
}

function merge(item, detail) {
  const out = { ...item };
  for (const [key, value] of Object.entries(detail)) {
    if (value != null && value !== '' && (out[key] == null || out[key] === '')) out[key] = value;
  }
  // 비어 있는 값만 상세 정보로 채우고, 제목/주소는 상세 정보를 우선
  if (detail.title) out.title = detail.title;
  if (detail.addr) out.addr = detail.addr;
  return out;
}

export function openDetail(item) {
  controller?.abort();
  controller = new AbortController();
  current = item;
  render(item, null, { loading: true });
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;

  const { signal } = controller;
  api
    .detail(item.id, item.typeId, signal)
    .then((detail) => {
      current = merge(item, detail);
      render(current, detail);
    })
    .catch((err) => {
      if (err.name !== 'AbortError') render(item, null, { error: err.message });
    });
}

/** 주변 맛집·카페 상세 (평점·영업시간·메뉴는 목록에서 이미 받은 정보 사용) */
export function openFoodDetail(item) {
  controller?.abort();
  const info = item.info || null;
  const kind = FOOD_KIND[item.kind] || FOOD_KIND.restaurant;
  const icon = kind.icon;
  const isStay = item.kind === 'stay';
  current = { title: item.name, addr: item.address };
  const r = info?.rating;
  const ratingParts = [];
  if (r?.score != null) ratingParts.push(`<b class="star">${ICON.star}${r.score.toFixed(1)}</b>`);
  if (r?.count) ratingParts.push(`리뷰 ${r.count.toLocaleString()}개`);
  if (r?.blog) ratingParts.push(`블로그 리뷰 ${r.blog.toLocaleString()}개`);
  if (r?.taste && !isStay) ratingParts.push(`"맛" 추천 ${r.taste.toLocaleString()}`);

  const name = encodeURIComponent(String(item.name).replace(/,/g, ' '));
  const placeUrl = safeUrl(item.url);
  const tel = item.phone ? String(item.phone).replace(/[^\d+-]/g, '') : '';
  const actions = [
    `<a class="primary" href="https://map.kakao.com/link/to/${name},${item.lat},${item.lng}" target="_blank" rel="noopener">${ICON.route}길찾기</a>`,
    placeUrl ? `<a href="${escapeHtml(placeUrl)}" target="_blank" rel="noopener">${ICON.map}카카오맵</a>` : '',
    `<a href="https://map.naver.com/p/search/${encodeURIComponent(item.name)}" target="_blank" rel="noopener">${ICON.pin}네이버지도</a>`,
    tel.length >= 7 ? `<a href="tel:${escapeHtml(tel)}">${ICON.phone}전화</a>` : '',
    `<button type="button" data-action="share">${ICON.share}공유</button>`,
  ].join('');

  const open = isStay ? null : info?.open; // 숙소는 영업시간 대신 체크인 정보가 중요해서 표시하지 않음
  const menu = info?.menu || [];
  body.innerHTML = `
    <div class="detail-hero short ph ph-${icon}">${categoryIcon(icon)}</div>
    <div class="detail-content">
      <div class="card-badges">
        <span class="badge cat-${icon}">${escapeHtml(item.label)}</span>
        ${info?.tasty ? `<span class="badge tasty">${kind.tasty}</span>` : ''}
        ${open?.text ? `<span class="badge ${open.code === 'OPEN' ? 'st-ongoing' : 'st-ended'}">${escapeHtml(open.text)}</span>` : ''}
      </div>
      <h2 id="detailTitle">${escapeHtml(item.name)}</h2>
      <p class="detail-period">${ratingParts.length ? ratingParts.join(' · ') : '<span class="len">평점 정보 없음</span>'}</p>
      <p class="detail-addr">${escapeHtml(item.address)} · ${escapeHtml(fmtDistance(item.distanceM / 1000))}</p>
      <div class="actions">${actions}</div>
      ${open ? `<section class="detail-section"><h3>영업 시간</h3><dl class="info-list">
        ${open.today ? `<div><dt>오늘</dt><dd>${escapeHtml(open.today)}</dd></div>` : ''}
        ${open.text || open.info ? `<div><dt>지금</dt><dd>${escapeHtml([open.text, open.info].filter(Boolean).join(' · '))}</dd></div>` : ''}
      </dl></section>` : ''}
      ${isStay ? `<section class="detail-section"><h3>가격·예약</h3><p class="hint">실시간 가격과 빈방은 예약 사이트에서 확인하세요.</p><div class="actions two">
        <a href="https://search.naver.com/search.naver?query=${encodeURIComponent(item.name)}" target="_blank" rel="noopener">네이버에서 가격 보기</a>
        <a href="https://www.google.com/search?q=${encodeURIComponent(`${item.name} 숙박 가격`)}" target="_blank" rel="noopener">구글에서 가격 보기</a>
      </div></section>` : ''}
      ${menu.length && !isStay ? `<section class="detail-section"><h3>메뉴</h3><dl class="info-list menu-list">${menu
        .map((m) => `<div><dt>${escapeHtml(m.name)}</dt><dd>${m.price ? `${m.price.toLocaleString()}원` : ''}</dd></div>`)
        .join('')}</dl></section>` : ''}
      <p class="credit">${isStay ? '평점·리뷰: 카카오맵.' : '평점·리뷰·메뉴·영업시간: 카카오맵. 바뀔 수 있으니 방문 전 확인하세요.'}</p>
    </div>`;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}

async function share() {
  if (!current) return;
  const lines = [current.title];
  if (current.start) lines.push(fmtRange(current.start, current.end, state.today, true));
  if (current.addr) lines.push(current.addr);
  const text = lines.join('\n');
  try {
    if (navigator.share) {
      await navigator.share({ title: current.title, text, url: location.origin });
    } else {
      await navigator.clipboard.writeText(`${text}\n${location.origin}`);
      toast('정보를 복사했어요.');
    }
  } catch (err) {
    if (err.name !== 'AbortError') toast('공유하지 못했어요.');
  }
}

export function initDetail() {
  body.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'share') share();
  });
  dialog.addEventListener('close', () => controller?.abort());
}
