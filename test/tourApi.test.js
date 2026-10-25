import test from 'node:test';
import assert from 'node:assert/strict';
import { TourApiError, createTourApi, normalizeServiceKey, parseResponse } from '../server/tourApi.js';
import { normalizeFestival, normalizePlace } from '../server/normalize.js';

const ok = (items, extra = {}) =>
  JSON.stringify({
    response: { header: { resultCode: '0000', resultMsg: 'OK' }, body: { items, numOfRows: 10, pageNo: 1, totalCount: 3, ...extra } },
  });

test('응답 해석: 배열 / 단일 객체 / 빈 결과', () => {
  assert.equal(parseResponse(ok({ item: [{ a: 1 }, { a: 2 }] })).items.length, 2);
  assert.deepEqual(parseResponse(ok({ item: { a: 1 } })).items, [{ a: 1 }]);
  const empty = parseResponse(ok('', { totalCount: 0 }));
  assert.deepEqual(empty.items, []);
  assert.equal(empty.totalCount, 0);
});

test('응답 해석: 각종 오류', () => {
  assert.throws(
    () => parseResponse(JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { returnAuthMsg: '등록되지 않은 서비스키', returnReasonCode: '30' } } })),
    (err) => err instanceof TourApiError && err.code === '30' && /등록되지 않은 인증키/.test(err.message),
  );
  assert.throws(
    () => parseResponse(JSON.stringify({ resultCode: '10', resultMsg: 'INVALID_REQUEST_PARAMETER_ERROR' })),
    /INVALID_REQUEST_PARAMETER_ERROR/,
  );
  assert.throws(
    () => parseResponse('<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>'),
    (err) => err.code === '22' && /호출 한도/.test(err.message),
  );
  assert.throws(
    () => parseResponse(JSON.stringify({ response: { header: { resultCode: '03', resultMsg: 'NO_DATA' } } })),
    /NO_DATA/,
  );
  assert.throws(() => parseResponse('<html>Bad Gateway</html>', 502), /해석할 수 없습니다/);
});

test('Encoding 키를 넣어도 한 번만 인코딩', () => {
  assert.equal(normalizeServiceKey('abc%2Bdef%3D%3D'), 'abc+def==');
  assert.equal(normalizeServiceKey(' abc+def== '), 'abc+def==');
});

test('요청 URL 과 페이지 모으기', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(new URL(url));
    const pageNo = Number(new URL(url).searchParams.get('pageNo'));
    const items = { 1: [{ n: 1 }, { n: 2 }], 2: [{ n: 3 }, { n: 4 }], 3: [{ n: 5 }] }[pageNo];
    return new Response(ok({ item: items }, { totalCount: 5, pageNo }), { status: 200 });
  };
  const api = createTourApi({ serviceKey: 'k%2B1', apiBase: 'https://example.test/KorService2', fetchImpl });
  const items = await api.listAll('areaBasedList2', { contentTypeId: '12', empty: '' }, { pageSize: 2 });
  assert.deepEqual(items.map((i) => i.n), [1, 2, 3, 4, 5]);
  assert.equal(calls.length, 3);
  const first = calls[0];
  assert.equal(first.pathname, '/KorService2/areaBasedList2');
  assert.equal(first.searchParams.get('serviceKey'), 'k+1');
  assert.equal(first.searchParams.get('_type'), 'json');
  assert.equal(first.searchParams.get('MobileOS'), 'ETC');
  assert.equal(first.searchParams.has('empty'), false);
});

test('서버가 numOfRows 를 줄여서 줘도 전부 받음', async () => {
  const all = Array.from({ length: 7 }, (_, i) => ({ n: i + 1 }));
  const fetchImpl = async (url) => {
    const q = new URL(url).searchParams;
    const size = Math.min(3, Number(q.get('numOfRows'))); // 최대 3건씩만 주는 서버
    const pageNo = Number(q.get('pageNo'));
    const items = all.slice((pageNo - 1) * size, pageNo * size);
    return new Response(ok({ item: items }, { totalCount: all.length, pageNo, numOfRows: size }), { status: 200 });
  };
  const api = createTourApi({ serviceKey: 'k', apiBase: 'https://example.test', fetchImpl });
  const items = await api.listAll('areaBasedList2', {}, { pageSize: 1000 });
  assert.deepEqual(items.map((i) => i.n), [1, 2, 3, 4, 5, 6, 7]);
});

test('네트워크 오류는 한 번 재시도', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    if (n === 1) throw new Error('ECONNRESET');
    return new Response(ok({ item: { a: 1 } }), { status: 200 });
  };
  const api = createTourApi({ serviceKey: 'k', apiBase: 'https://example.test', fetchImpl, retryDelayMs: 1 });
  const res = await api.list('areaCode2');
  assert.equal(res.items.length, 1);
  assert.equal(n, 2);
});

test('항목 정규화', () => {
  const p = normalizePlace({
    contentid: 1, contenttypeid: '12', title: '경복궁', addr1: '서울특별시 종로구 사직로 161', addr2: '(세종로)',
    mapx: '126.9770', mapy: '37.5796', firstimage: 'http://tong.visitkorea.or.kr/a.jpg', firstimage2: '', lDongRegnCd: '11',
  });
  assert.equal(p.id, '1');
  assert.equal(p.addr, '서울특별시 종로구 사직로 161 (세종로)');
  assert.equal(p.region, '서울');
  assert.equal(p.lat, 37.5796);
  assert.equal(p.image, 'https://tong.visitkorea.or.kr/a.jpg');
  assert.equal(p.thumb, 'https://tong.visitkorea.or.kr/a.jpg');

  assert.equal(normalizePlace({ contentid: 2, mapx: '0', mapy: '0' }).lat, null);
  assert.equal(normalizeFestival({ contentid: 3, eventstartdate: '20261001', eventenddate: '' }).end, '20261001');
  assert.equal(normalizeFestival({ contentid: 4, eventstartdate: '20261010', eventenddate: '20261001' }).end, '20261010');
  assert.equal(normalizeFestival({ contentid: 5, eventstartdate: 'abc' }), null);
});
