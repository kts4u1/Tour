// 한국관광공사 TourAPI 4.0 (국문 관광정보 서비스, KorService2) 클라이언트
// 문서: https://www.data.go.kr/data/15101578/openapi.do

export class TourApiError extends Error {
  constructor(message, { code = null, status = null } = {}) {
    super(message);
    this.name = 'TourApiError';
    this.code = code;
    this.status = status;
  }
}

const HINTS = {
  12: '해당 오퍼레이션이 없거나 서비스가 폐기되었습니다.',
  20: '서비스 접근이 거부되었습니다. 활용신청 상태를 확인하세요.',
  22: '오늘 호출 한도를 넘었습니다. 내일 다시 시도하거나 운영계정 전환을 신청하세요.',
  30: '등록되지 않은 인증키입니다. 키를 다시 확인하세요 (발급 직후라면 1~2시간 뒤에 반영됩니다).',
  31: '기한이 만료된 인증키입니다.',
  32: '등록되지 않은 IP 입니다.',
};

function withHint(message, code) {
  const hint = HINTS[Number(code)];
  return hint ? `${message} - ${hint}` : message;
}

function matchXml(text, tag) {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(text);
  return m ? m[1].trim() : null;
}

/** TourAPI 응답 본문을 해석해 { items, totalCount, pageNo, numOfRows } 로 돌려줍니다. */
export function parseResponse(text, status = 200) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // 인증 오류 등은 _type=json 이어도 XML 로 올 때가 있습니다.
    const code = matchXml(text, 'returnReasonCode') || matchXml(text, 'resultCode');
    const msg = matchXml(text, 'returnAuthMsg') || matchXml(text, 'errMsg') || matchXml(text, 'resultMsg');
    throw new TourApiError(
      msg ? withHint(`TourAPI 오류: ${msg}`, code) : `TourAPI 응답을 해석할 수 없습니다 (HTTP ${status})`,
      { code, status },
    );
  }

  if (data?.OpenAPI_ServiceResponse) {
    const h = data.OpenAPI_ServiceResponse.cmmMsgHeader || {};
    throw new TourApiError(withHint(`TourAPI 오류: ${h.returnAuthMsg || h.errMsg || '알 수 없는 오류'}`, h.returnReasonCode), {
      code: h.returnReasonCode ?? null,
      status,
    });
  }

  const header = data?.response?.header;
  if (!header) {
    if (data?.resultCode) {
      throw new TourApiError(`TourAPI 오류: ${data.resultMsg || data.resultCode}`, { code: data.resultCode, status });
    }
    throw new TourApiError(`TourAPI 응답 형식이 예상과 다릅니다 (HTTP ${status})`, { status });
  }
  if (header.resultCode !== '0000') {
    throw new TourApiError(withHint(`TourAPI 오류: ${header.resultMsg || header.resultCode}`, header.resultCode), {
      code: header.resultCode,
      status,
    });
  }

  const body = data.response.body || {};
  // 결과가 없으면 items 가 빈 문자열(""), 1건이면 배열이 아닌 객체로 옵니다.
  let items = body.items && typeof body.items === 'object' ? body.items.item ?? [] : [];
  if (!Array.isArray(items)) items = [items];
  return {
    items,
    totalCount: Number(body.totalCount) || 0,
    pageNo: Number(body.pageNo) || 1,
    numOfRows: Number(body.numOfRows) || items.length,
  };
}

/** 공공데이터포털의 'Encoding' 키를 넣어도 이중 인코딩되지 않도록 원래 값으로 되돌립니다. */
export function normalizeServiceKey(key) {
  const trimmed = String(key || '').trim();
  if (!trimmed.includes('%')) return trimmed;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

async function mapWithConcurrency(values, limit, fn) {
  const results = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const i = next++;
      results[i] = await fn(values[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

export function createTourApi({
  serviceKey,
  apiBase,
  mobileApp = 'TourNearby',
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
  retries = 1,
}) {
  const key = normalizeServiceKey(serviceKey);

  async function request(operation, params) {
    const query = new URLSearchParams({ MobileOS: 'ETC', MobileApp: mobileApp, _type: 'json' });
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query.set(name, String(value));
    }
    const url = `${apiBase}/${operation}?serviceKey=${encodeURIComponent(key)}&${query}`;

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchImpl(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        if (res.status >= 500 && attempt < retries) {
          lastError = new TourApiError(`TourAPI 서버 오류 (HTTP ${res.status})`, { status: res.status });
          continue;
        }
        return parseResponse(text, res.status);
      } catch (err) {
        if (err instanceof TourApiError) throw err;
        lastError = new TourApiError(`TourAPI 에 연결하지 못했습니다: ${err.message}`, { code: 'NETWORK' });
      }
    }
    throw lastError;
  }

  /** 한 페이지 조회 */
  function list(operation, params = {}, { pageNo = 1, numOfRows = 100 } = {}) {
    return request(operation, { ...params, pageNo, numOfRows });
  }

  /** 모든 페이지를 모아서 조회 */
  async function listAll(operation, params = {}, { pageSize = 1000, maxPages = 100, concurrency = 3 } = {}) {
    const first = await list(operation, params, { pageNo: 1, numOfRows: pageSize });
    // 서버가 요청보다 적은 건수만 주면 그 건수를 한 페이지 크기로 봅니다.
    const size = first.items.length > 0 && first.items.length < pageSize && first.items.length < first.totalCount
      ? first.items.length
      : pageSize;
    const totalPages = Math.ceil(first.totalCount / size);
    const pages = Math.min(maxPages, totalPages);
    if (totalPages > maxPages) {
      console.warn(`[tourapi] ${operation}: ${totalPages}페이지 중 ${maxPages}페이지까지만 받았습니다.`);
    }
    if (pages <= 1) return first.items;
    const rest = await mapWithConcurrency(
      Array.from({ length: pages - 1 }, (_, i) => i + 2),
      concurrency,
      (pageNo) => list(operation, params, { pageNo, numOfRows: size }).then((r) => r.items),
    );
    return first.items.concat(...rest);
  }

  return { request, list, listAll };
}
