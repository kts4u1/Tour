// 보안 헤더 (Node 서버, Cloudflare Worker, Cloudflare 정적 파일 _headers 공통)
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
};
