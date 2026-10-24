// TourAPI 텍스트 필드에는 <br>, <a> 같은 HTML 이 섞여 옵니다.
// 화면에 그대로 넣지 않고, 서버에서 일반 텍스트로 바꿔서 내려줍니다.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·' };

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

export function htmlToText(value) {
  if (value == null) return '';
  const text = String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(text)
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** href 속성이나 본문에 있는 http(s) 링크를 중복 없이 뽑아냅니다. */
export function extractLinks(value) {
  if (!value) return [];
  const text = String(value);
  const found = new Set();
  for (const m of text.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) found.add(decodeEntities(m[1]).trim());
  for (const m of htmlToText(text).matchAll(/https?:\/\/[^\s<>"']+/gi)) found.add(m[0]);
  for (const m of htmlToText(text).matchAll(/(?:^|\s)(www\.[^\s<>"']+)/gi)) found.add(`http://${m[1]}`);
  return [...found].filter((url) => /^https?:\/\/[^\s]+\.[^\s]+/i.test(url)).slice(0, 5);
}

/** 이미지 주소를 https 로 (https 페이지에서 http 이미지가 막히는 문제 방지) */
export function toHttps(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^http:\/\//i, 'https://');
}
