import { createApp } from './app.js';
import { loadConfig, loadEnvFile } from './config.js';
import { createDemoSource } from './sources/demo.js';
import { createLiveSource } from './sources/live.js';
import { createTourApi } from './tourApi.js';

loadEnvFile();
const config = loadConfig();

const source =
  config.mode === 'live'
    ? createLiveSource({
        api: createTourApi({ serviceKey: config.serviceKey, apiBase: config.apiBase, mobileApp: config.mobileApp }),
        cacheDir: config.cacheDir,
      })
    : createDemoSource();

await source.init({ warmup: config.warmup });

const app = createApp({ source, rootDir: config.rootDir });
const server = app.listen(config.port, () => {
  console.log(`\n  어디갈까 서버가 실행되었습니다: http://localhost:${config.port}`);
  if (config.mode === 'demo') {
    console.log('  [데모 모드] TOUR_API_KEY 가 없어 예시 데이터로 동작합니다. 실제 데이터는 README 를 참고해 키를 설정하세요.\n');
  } else {
    console.log('  [실제 데이터] 한국관광공사 TourAPI 에 연결합니다. 처음 실행 시 전국 관광지 목록을 받는 데 1~2분 걸릴 수 있습니다.\n');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  포트 ${config.port} 을(를) 이미 다른 프로그램이 쓰고 있어요. .env 의 PORT 를 바꾸거나 PORT=3001 npm start 로 실행해 보세요.\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
