import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, daysBetween, eventStatus, isYmd, monthRange, overlaps, shiftMonth, todayKST, upcomingWeekend,
} from '../server/lib/dates.js';
import { distanceKm, isKoreanCoord } from '../server/lib/geo.js';
import { regionFromAddress, resolveRegion } from '../server/lib/regions.js';
import { extractLinks, htmlToText, toHttps } from '../server/lib/text.js';

test('todayKST 는 한국 시간 기준 날짜', () => {
  // UTC 10월 24일 16시 = 한국 10월 25일 새벽 1시
  assert.equal(todayKST(new Date('2026-10-24T16:00:00Z')), '20261025');
  assert.equal(todayKST(new Date('2026-10-24T14:59:00Z')), '20261024');
});

test('날짜 계산', () => {
  assert.equal(isYmd('20261031'), true);
  assert.equal(isYmd('20260231'), false);
  assert.equal(isYmd('2026-10-01'), false);
  assert.equal(addDays('20261230', 3), '20270102');
  assert.equal(daysBetween('20261025', '20261101'), 7);
  assert.deepEqual(monthRange(2028, 2), { start: '20280201', end: '20280229' });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
});

test('기간 겹침과 진행 상태', () => {
  assert.equal(overlaps('20260925', '20261005', '20261001', '20261031'), true);
  assert.equal(overlaps('20260901', '20260930', '20261001', '20261031'), false);
  assert.equal(overlaps('20261031', '20261102', '20261001', '20261031'), true);
  assert.equal(eventStatus('20261020', '20261103', '20261025'), 'ongoing');
  assert.equal(eventStatus('20261101', '20261103', '20261025'), 'upcoming');
  assert.equal(eventStatus('20261001', '20261003', '20261025'), 'ended');
});

test('다가오는 주말', () => {
  assert.deepEqual(upcomingWeekend('20261021'), { start: '20261024', end: '20261025' }); // 수요일
  assert.deepEqual(upcomingWeekend('20261024'), { start: '20261024', end: '20261025' }); // 토요일
  assert.deepEqual(upcomingWeekend('20261025'), { start: '20261025', end: '20261025' }); // 일요일
});

test('거리 계산 (서울시청 → 부산역 약 325km)', () => {
  const d = distanceKm(37.5665, 126.978, 35.1151, 129.0423);
  assert.ok(d > 315 && d < 335, `got ${d}`);
  assert.equal(isKoreanCoord(0, 0), false);
  assert.equal(isKoreanCoord(37.5, 127), true);
});

test('시도 판별: 법정동코드 > 주소 > 지역코드', () => {
  assert.equal(resolveRegion({ lDongRegnCd: '51', addr1: '' }), '강원');
  assert.equal(resolveRegion({ lDongRegnCd: '31', areacode: '31' }), '울산'); // 법정동 31 = 울산
  assert.equal(resolveRegion({ areacode: '31', addr1: '' }), '경기'); // 지역코드 31 = 경기
  assert.equal(resolveRegion({ addr1: '전북특별자치도 전주시' }), '전북');
  assert.equal(regionFromAddress('경상남도 진주시'), '경남');
  assert.equal(resolveRegion({}), '기타');
});

test('HTML 을 텍스트로', () => {
  assert.equal(htmlToText('첫 줄<br>둘째 줄&nbsp;&amp; <b>굵게</b>'), '첫 줄\n둘째 줄 & 굵게');
  assert.equal(htmlToText('<script>alert(1)</script>안녕'), 'alert(1)안녕');
  assert.equal(htmlToText(null), '');
});

test('링크 추출', () => {
  assert.deepEqual(
    extractLinks('<a href="https://a.example.kr" target="_blank">https://a.example.kr</a>'),
    ['https://a.example.kr'],
  );
  assert.deepEqual(extractLinks('홈페이지 www.b.example.kr 참고'), ['http://www.b.example.kr']);
  assert.deepEqual(extractLinks('<a href="javascript:alert(1)">x</a>'), []);
  assert.equal(toHttps('http://tong.visitkorea.or.kr/a.jpg'), 'https://tong.visitkorea.or.kr/a.jpg');
  assert.equal(toHttps(''), null);
});
