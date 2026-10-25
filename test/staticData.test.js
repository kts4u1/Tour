import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFestivals, decodePlaces, encodeFestivals, encodePlaces } from '../server/staticData.js';

test('정적 데이터: 관광지 압축 후 복원', () => {
  const place = {
    id: '126508', typeId: '12', title: '경복궁', addr: '서울특별시 종로구 사직로 161', region: '서울',
    lat: 37.5796, lng: 126.977, image: null, thumb: 'https://tong.visitkorea.or.kr/cms/resource/33/2678633_image3_1.jpg', tel: null,
  };
  const rows = encodePlaces([place]);
  assert.equal(rows[0][6], '33/2678633_image3_1.jpg'); // 공통 앞부분 제거
  assert.deepEqual(decodePlaces(JSON.parse(JSON.stringify(rows)), '12'), [place]);
});

test('정적 데이터: 행사 압축 후 복원 (사진·좌표 없음 포함)', () => {
  const fest = {
    id: '3000001', typeId: '15', title: '빛 축제', addr: '서울특별시 중구', region: '서울',
    lat: null, lng: null, image: null, thumb: null, tel: '02-123-4567', start: '20261020', end: '20261103',
  };
  const other = { ...fest, id: '2', thumb: 'https://example.kr/a.jpg', tel: null };
  assert.deepEqual(decodeFestivals(JSON.parse(JSON.stringify(encodeFestivals([fest, other])))), [fest, other]);
});
