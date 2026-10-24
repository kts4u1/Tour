// 서버 API 호출

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

function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  return sp.toString();
}

export const api = {
  meta: () => getJson('/api/meta'),
  nearby: (params, signal) => getJson(`/api/nearby?${qs(params)}`, signal),
  festivals: (year, month, signal) => getJson(`/api/festivals?${qs({ year, month })}`, signal),
  detail: (id, typeId, signal) => getJson(`/api/detail/${encodeURIComponent(id)}?${qs({ typeId })}`, signal),
};
