type CacheEntry<T> = { value: T; expiresAt: number };

const store = new Map<string, CacheEntry<any>>();

export function setCache<T>(key: string, value: T, ttlMs = 5 * 60 * 1000): void {
  const expiresAt = Date.now() + ttlMs;
  store.set(key, { value, expiresAt });
}

export function getCache<T>(key: string): { hit: boolean; value?: T } {
  const entry = store.get(key);
  if (!entry) return { hit: false };
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return { hit: false };
  }
  return { hit: true, value: entry.value as T };
}

export function delCache(key: string): void {
  store.delete(key);
}

export function clearCache(): void {
  store.clear();
}