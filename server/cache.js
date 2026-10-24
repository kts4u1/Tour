import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 메모리 캐시.
 * - 같은 키를 동시에 요청하면 한 번만 불러옵니다.
 * - 새로 불러오다 실패하면, 만료된 값이라도 있으면 그 값을 돌려줍니다.
 */
export class MemoryCache {
  constructor({ maxEntries = 5000 } = {}) {
    this.entries = new Map();
    this.inflight = new Map();
    this.maxEntries = maxEntries;
  }

  peek(key) {
    const entry = this.entries.get(key);
    return entry && entry.expires > Date.now() ? entry.value : undefined;
  }

  set(key, value, ttlMs) {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: Date.now() + ttlMs });
    // 너무 많아지면 가장 오래된 것부터 지움 (Map 은 넣은 순서를 기억함)
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }

  async wrap(key, ttlMs, load) {
    const fresh = this.peek(key);
    if (fresh !== undefined) return fresh;
    if (this.inflight.has(key)) return this.inflight.get(key);

    const promise = (async () => {
      try {
        const value = await load();
        this.set(key, value, ttlMs);
        return value;
      } catch (err) {
        const stale = this.entries.get(key);
        if (stale) {
          console.warn(`[cache] ${key} 갱신 실패, 이전 데이터를 사용합니다: ${err.message}`);
          return stale.value;
        }
        throw err;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise;
  }
}

/** 디스크에 JSON 으로 저장하는 캐시 (서버를 재시작해도 전국 데이터를 다시 받지 않기 위함) */
export class DiskCache {
  constructor(dir) {
    this.dir = dir;
  }

  file(key) {
    return path.join(this.dir, `${key.replace(/[^a-z0-9_-]/gi, '_')}.json`);
  }

  async read(key) {
    try {
      const data = JSON.parse(await fs.readFile(this.file(key), 'utf8'));
      return data && typeof data.savedAt === 'number' ? data : null;
    } catch {
      return null;
    }
  }

  async write(key, value) {
    try {
      await fs.mkdir(this.dir, { recursive: true });
      const target = this.file(key);
      const tmp = `${target}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify({ savedAt: Date.now(), value }));
      await fs.rename(tmp, target);
    } catch (err) {
      console.warn(`[cache] 디스크 저장 실패 (${key}): ${err.message}`);
    }
  }
}
