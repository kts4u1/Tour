// 서버 API 호출
// Cloudflare 배포(정적 데이터) 모드에서는 반경 검색·월별 행사를 브라우저에서 계산하고,
// 상세 정보만 서버(Worker)에 묻습니다.

let engine = null;

/** 정적 데이터 계산기를 쓰도록 설정 (staticEngine.js) */
export function useStaticEngine(staticEngine) {
  engine = staticEngine;
}

async function getJson(url, signal) {
  let res;
  try {
    res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 본문 없음 */
  }
  if (!res.ok) throw new Error(data?.error || `요청에 실패했어요 (${res.status})`);
  return data;
}

/** 계산이 끝나기 전에 취소된 요청은 결과를 버림 (더 최신 요청이 있다는 뜻) */
async function local(promise, signal) {
  const result = await promise;
  if (signal?.aborted) throw new DOMException('취소됨', 'AbortError');
  return result;
}

function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  return sp.toString();
}

export const api = {
  meta: () => getJson('/api/meta'),
  nearby: (params, signal) =>
    engine ? local(engine.nearby(params), signal) : getJson(`/api/nearby?${qs(params)}`, signal),
  festivals: (year, month, signal) =>
    engine ? local(engine.festivals(year, month), signal) : getJson(`/api/festivals?${qs({ year, month })}`, signal),
  detail: (id, typeId, signal) => getJson(`/api/detail/${encodeURIComponent(id)}?${qs({ typeId })}`, signal),
  food: (params, signal) => getJson(`/api/food?${qs(params)}`, signal),
  foodRatings: (area, ids, signal) => getJson(`/api/food/ratings?${qs({ area, ids: ids.join(',') })}`, signal),
};
