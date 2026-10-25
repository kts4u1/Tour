// Cloudflare 배포용 파일(dist/) 만들기
//
//   npm run build:static                 TOUR_API_KEY 가 있으면 실제 데이터, 없으면 예시 데이터
//   npm run build:static -- --require-key 키가 없으면 실패 (GitHub Actions 에서 사용)
//
// 만드는 것
//   dist/            화면 파일(public/) + 지도 라이브러리
//   dist/core/       브라우저에서 반경 검색·월별 행사를 계산하는 공용 코드 (server/ 에서 복사)
//   dist/data/       전국 관광지·행사 데이터 (TourAPI 에서 받음)
//   dist/_headers    보안 헤더
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PLACE_TYPES } from '../server/catalog.js';
import { ROOT_DIR, loadConfig, loadEnvFile } from '../server/config.js';
import { DEMO_PLACES, buildDemoFestivals } from '../server/demo/data.js';
import { SECURITY_HEADERS } from '../server/headers.js';
import { monthRange, shiftMonth, todayKST } from '../server/lib/dates.js';
import { normalizeFestival, normalizePlace, uniqueById } from '../server/normalize.js';
import { encodeFestivals, encodePlaces } from '../server/staticData.js';
import { createTourApi } from '../server/tourApi.js';

const OUT = path.join(ROOT_DIR, 'dist');
// 지난 몇 달치 행사까지 담을지 (이달의 행사 화면에서 이전 달 보기용)
const FESTIVAL_HISTORY_MONTHS = 6;
// 브라우저에서 import 하는 공용 코드 (Node 전용 모듈을 쓰지 않는 파일만)
const CORE_FILES = ['services.js', 'catalog.js', 'staticData.js', 'lib/dates.js', 'lib/geo.js', 'lib/regions.js'];

const requireKey = process.argv.includes('--require-key');
loadEnvFile();
const config = loadConfig();
const demo = config.mode === 'demo';

if (demo && requireKey) {
  console.error('TOUR_API_KEY 가 없습니다. GitHub 저장소 Settings › Secrets and variables › Actions 에 TOUR_API_KEY 를 등록하세요.');
  process.exit(1);
}

const today = todayKST();
const ym = { year: Number(today.slice(0, 4)), month: Number(today.slice(4, 6)) };
const historyStart = shiftMonth(ym.year, ym.month, -FESTIVAL_HISTORY_MONTHS);
const festivalsFrom = monthRange(historyStart.year, historyStart.month).start;

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data));
  const { size } = await fs.stat(file);
  console.log(`  ${path.relative(ROOT_DIR, file)}  ${(size / 1024).toFixed(0)}KB`);
}

async function loadLiveData() {
  const api = createTourApi({ serviceKey: config.serviceKey, apiBase: config.apiBase, mobileApp: config.mobileApp });
  console.log(`TourAPI 에서 ${festivalsFrom} 이후 행사를 받는 중...`);
  const festivals = uniqueById(
    (await api.listAll('searchFestival2', { eventStartDate: festivalsFrom, arrange: 'A' }, { pageSize: 500 })).map(normalizeFestival),
  );
  const places = {};
  for (const typeId of PLACE_TYPES) {
    console.log(`TourAPI 에서 관광타입 ${typeId} 전국 목록을 받는 중...`);
    const raw = await api.listAll('areaBasedList2', { contentTypeId: typeId, arrange: 'A' }, { pageSize: 1000 });
    places[typeId] = uniqueById(raw.map(normalizePlace)).filter((p) => p.lat != null);
  }
  return { festivals, places };
}

function loadDemoData() {
  console.log('TOUR_API_KEY 가 없어 예시 데이터로 만듭니다 (데모).');
  const places = {};
  for (const typeId of PLACE_TYPES) places[typeId] = DEMO_PLACES.filter((p) => p.typeId === typeId);
  return { festivals: buildDemoFestivals(today).filter((f) => f.end >= festivalsFrom), places };
}

async function main() {
  // 데이터를 먼저 받아서, 실패하면 아무것도 바꾸지 않고 끝냄 (배포도 되지 않음)
  const { festivals, places } = demo ? loadDemoData() : await loadLiveData();
  if (!demo && festivals.length === 0 && Object.values(places).every((list) => list.length === 0)) {
    throw new Error('TourAPI 에서 받은 데이터가 하나도 없습니다.');
  }

  await fs.rm(OUT, { recursive: true, force: true });
  await fs.cp(path.join(ROOT_DIR, 'public'), OUT, { recursive: true });

  const require = createRequire(import.meta.url);
  const leafletDist = path.dirname(require.resolve('leaflet/dist/leaflet.js'));
  await fs.cp(leafletDist, path.join(OUT, 'vendor', 'leaflet'), { recursive: true });

  for (const file of CORE_FILES) {
    await fs.mkdir(path.dirname(path.join(OUT, 'core', file)), { recursive: true });
    await fs.copyFile(path.join(ROOT_DIR, 'server', file), path.join(OUT, 'core', file));
  }

  const builtAt = new Date().toISOString();
  console.log('데이터 파일:');
  await writeJson(path.join(OUT, 'data', 'festivals.json'), { from: festivalsFrom, rows: encodeFestivals(festivals) });
  for (const typeId of PLACE_TYPES) {
    await writeJson(path.join(OUT, 'data', `places-${typeId}.json`), { typeId, rows: encodePlaces(places[typeId]) });
  }
  const counts = Object.fromEntries(PLACE_TYPES.map((t) => [t, places[t].length]));
  await writeJson(path.join(OUT, 'data', 'meta.json'), { demo, builtAt, festivalsFrom, festivals: festivals.length, places: counts });

  const securityLines = Object.entries(SECURITY_HEADERS).map(([k, v]) => `  ${k}: ${v}`).join('\n');
  await fs.writeFile(
    path.join(OUT, '_headers'),
    `/*\n${securityLines}\n\n/data/*\n  Cache-Control: public, max-age=600\n\n/vendor/*\n  Cache-Control: public, max-age=604800\n`,
  );

  console.log(`\n완료: dist/ (${demo ? '예시 데이터' : '실제 데이터'}, 행사 ${festivals.length}개, ` +
    `관광지 ${counts[12]} · 문화시설 ${counts[14]} · 레포츠 ${counts[28]})`);
}

main().catch((err) => {
  console.error(`\n빌드 실패: ${err.message}`);
  process.exit(1);
});
