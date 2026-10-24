// 테스트용 가짜 TourAPI 서버 (KorService2 응답 형식과 특이점을 흉내냄)
// - 결과가 1건이면 item 이 배열이 아닌 객체
// - 결과가 없으면 items 가 빈 문자열
// - 잘못된 키는 OpenAPI_ServiceResponse 오류
import http from 'node:http';

export const VALID_KEY = 'test-key/with+special=chars';

function toRad(d) {
  return (d * Math.PI) / 180;
}
function distKm(lat1, lng1, lat2, lng2) {
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

const place = (contentid, contenttypeid, title, addr1, mapy, mapx, extra = {}) => ({
  contentid: String(contentid),
  contenttypeid: String(contenttypeid),
  title,
  addr1,
  addr2: '',
  mapx: String(mapx),
  mapy: String(mapy),
  firstimage: `http://tong.visitkorea.or.kr/cms/resource/${contentid}_image2_1.jpg`,
  firstimage2: `http://tong.visitkorea.or.kr/cms/resource/${contentid}_image3_1.jpg`,
  tel: '',
  areacode: '1',
  lDongRegnCd: '11',
  ...extra,
});

export const PLACES = [
  place(126508, 12, '경복궁', '서울특별시 종로구 사직로 161', 37.5796, 126.977),
  place(126535, 12, '남산서울타워', '서울특별시 용산구 남산공원길 105', 37.5512, 126.9882),
  place(129703, 14, '국립중앙박물관', '서울특별시 용산구 서빙고로 137', 37.524, 126.9804),
  place(125405, 12, '수원화성', '경기도 수원시 팔달구 정조로 825', 37.2871, 127.0119, { areacode: '31', lDongRegnCd: '41' }),
  place(126748, 12, '남이섬', '강원특별자치도 춘천시 남산면 남이섬길 1', 37.7906, 127.5256, { areacode: '32', lDongRegnCd: '51' }),
  place(2600001, 28, '한강 수상스키', '서울특별시 광진구 강변북로 139', 37.5297, 127.067),
  place(126081, 12, '해운대해수욕장', '부산광역시 해운대구 우동', 35.1587, 129.1604, { areacode: '6', lDongRegnCd: '26' }),
  place(999999, 12, '좌표 없는 곳', '서울특별시 어딘가', 0, 0),
];

export const FESTIVALS = [
  place(3000001, 15, '서울 빛 축제', '서울특별시 중구 세종대로 110', 37.5665, 126.978, { eventstartdate: '20261020', eventenddate: '20261103' }),
  place(3000002, 15, '수원 야행', '경기도 수원시 팔달구 정조로 825', 37.2871, 127.0119, { eventstartdate: '20261101', eventenddate: '20261103', areacode: '31', lDongRegnCd: '41' }),
  place(3000003, 15, '지난 행사', '서울특별시 종로구 사직로 161', 37.5796, 126.977, { eventstartdate: '20260901', eventenddate: '20260905' }),
  place(3000004, 15, '9월부터 10월까지', '부산광역시 해운대구 우동', 35.1587, 129.1604, { eventstartdate: '20260925', eventenddate: '20261005', areacode: '6', lDongRegnCd: '26' }),
  place(3000005, 15, '날짜 이상한 행사', '서울특별시 중구', 37.56, 126.97, { eventstartdate: '2026-10-01', eventenddate: '' }),
];

const DETAILS = {
  3000001: {
    common: {
      ...FESTIVALS[0],
      homepage: '<a href="https://seoul-light.example.kr" target="_blank" title="새창">https://seoul-light.example.kr</a>',
      overview: '서울 도심을 밝히는 빛 축제입니다.<br>가족과 함께 즐겨보세요.&nbsp;',
    },
    intro: {
      contentid: '3000001', contenttypeid: '15', eventstartdate: '20261020', eventenddate: '20261103',
      eventplace: '서울광장', playtime: '18:00~22:00', usetimefestival: '무료', sponsor1: '서울특별시',
      eventhomepage: '<a href="http://www.festival.example.kr">홈페이지</a>',
    },
  },
};

function envelope(items, { pageNo = 1, numOfRows = 10, totalCount = items.length } = {}) {
  let wrapped;
  if (items.length === 0) wrapped = '';
  else if (items.length === 1) wrapped = { item: items[0] };
  else wrapped = { item: items };
  return {
    response: {
      header: { resultCode: '0000', resultMsg: 'OK' },
      body: { items: wrapped, numOfRows, pageNo, totalCount },
    },
  };
}

function page(all, q) {
  const numOfRows = Number(q.get('numOfRows') || 10);
  const pageNo = Number(q.get('pageNo') || 1);
  const items = all.slice((pageNo - 1) * numOfRows, pageNo * numOfRows);
  return envelope(items, { pageNo, numOfRows, totalCount: all.length });
}

export function startMockTourApi() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const q = url.searchParams;
    const op = url.pathname.split('/').pop();
    requests.push({ op, params: Object.fromEntries(q) });
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json;charset=UTF-8' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };

    if (q.get('serviceKey') !== VALID_KEY) {
      return send(401, {
        OpenAPI_ServiceResponse: {
          cmmMsgHeader: { errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', returnAuthMsg: '등록되지 않은 서비스키', returnReasonCode: '30' },
        },
      });
    }
    if (q.get('_type') !== 'json' || !q.get('MobileOS') || !q.get('MobileApp')) {
      return send(200, { resultCode: '10', resultMsg: 'INVALID_REQUEST_PARAMETER_ERROR' });
    }

    switch (op) {
      case 'areaBasedList2': {
        const type = q.get('contentTypeId');
        return send(200, page(PLACES.filter((p) => !type || p.contenttypeid === type), q));
      }
      case 'locationBasedList2': {
        const radius = Number(q.get('radius'));
        if (!(radius > 0 && radius <= 20000)) return send(200, { resultCode: '10', resultMsg: 'INVALID_REQUEST_PARAMETER_ERROR' });
        const lat = Number(q.get('mapY'));
        const lng = Number(q.get('mapX'));
        const type = q.get('contentTypeId');
        const found = PLACES.filter((p) => (!type || p.contenttypeid === type) && Number(p.mapy) > 0)
          .map((p) => ({ ...p, dist: String(distKm(lat, lng, Number(p.mapy), Number(p.mapx)) * 1000) }))
          .filter((p) => Number(p.dist) <= radius)
          .sort((a, b) => a.dist - b.dist);
        return send(200, page(found, q));
      }
      case 'searchFestival2': {
        const from = q.get('eventStartDate');
        if (!from) return send(200, { resultCode: '10', resultMsg: 'INVALID_REQUEST_PARAMETER_ERROR' });
        // 실제 API 처럼: 종료일이 eventStartDate 이후인 행사 (날짜가 이상한 항목도 그대로 내려줌)
        return send(200, page(FESTIVALS.filter((f) => !/^\d{8}$/.test(f.eventenddate) || f.eventenddate >= from), q));
      }
      case 'detailCommon2': {
        const d = DETAILS[q.get('contentId')];
        return send(200, envelope(d ? [d.common] : []));
      }
      case 'detailIntro2': {
        const d = DETAILS[q.get('contentId')];
        return send(200, envelope(d ? [d.intro] : []));
      }
      default:
        return send(200, { resultCode: '12', resultMsg: 'NO_OPENAPI_SERVICE_ERROR' });
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/B551011/KorService2`,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
