import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const isTrue = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());
const isFalse = (v) => /^(0|false|no|off)$/i.test(String(v ?? '').trim());

/** 프로젝트 루트의 .env 파일을 읽습니다 (이미 설정된 환경변수가 우선). */
export function loadEnvFile(file = path.join(ROOT_DIR, '.env')) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

export function loadConfig(env = process.env) {
  const serviceKey = String(env.TOUR_API_KEY || '').trim();
  return {
    port: Number(env.PORT) || 3000,
    serviceKey,
    kakaoKey: String(env.KAKAO_REST_API_KEY || '').trim(),
    mode: serviceKey && !isTrue(env.DEMO_MODE) ? 'live' : 'demo',
    apiBase: String(env.TOUR_API_BASE || 'https://apis.data.go.kr/B551011/KorService2').replace(/\/+$/, ''),
    mobileApp: env.TOUR_API_APP_NAME || 'TourNearby',
    cacheDir: env.CACHE_DIR ? path.resolve(env.CACHE_DIR) : path.join(ROOT_DIR, 'data', 'cache'),
    warmup: !isFalse(env.WARMUP),
    rootDir: ROOT_DIR,
  };
}
