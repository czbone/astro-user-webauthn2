type Entry = {
  value: string
  expiresAt?: number
}

/**
 * Minimal Redis stand-in for unit tests (get/set/del/incr/expire/pttl/set ops).
 */
export function createMemoryRedis() {
  const store = new Map<string, Entry>()

  function alive(key: string): Entry | null {
    const entry = store.get(key)
    if (!entry) return null
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      store.delete(key)
      return null
    }
    return entry
  }

  const redis = {
    async get(key: string) {
      return alive(key)?.value ?? null
    },
    async set(key: string, value: string, mode?: string, ttl?: number) {
      const entry: Entry = { value }
      if (mode === 'EX' && typeof ttl === 'number') {
        entry.expiresAt = Date.now() + ttl * 1000
      }
      store.set(key, entry)
      return 'OK' as const
    },
    async del(...keys: string[]) {
      let n = 0
      for (const key of keys) {
        if (store.delete(key)) n += 1
      }
      return n
    },
    async incr(key: string) {
      const current = alive(key)
      const next = String(Number(current?.value || '0') + 1)
      const entry: Entry = { value: next }
      if (current?.expiresAt !== undefined) entry.expiresAt = current.expiresAt
      store.set(key, entry)
      return Number(next)
    },
    async expire(key: string, seconds: number) {
      const entry = alive(key)
      if (!entry) return 0
      entry.expiresAt = Date.now() + seconds * 1000
      store.set(key, entry)
      return 1
    },
    async pexpire(key: string, ms: number) {
      const entry = alive(key)
      if (!entry) return 0
      entry.expiresAt = Date.now() + ms
      store.set(key, entry)
      return 1
    },
    async pttl(key: string) {
      const entry = alive(key)
      if (!entry) return -2
      if (entry.expiresAt === undefined) return -1
      return Math.max(0, entry.expiresAt - Date.now())
    },
    async sadd(key: string, ...members: string[]) {
      const entry = alive(key)
      const set = new Set(entry ? entry.value.split('\0').filter(Boolean) : [])
      let added = 0
      for (const member of members) {
        if (!set.has(member)) {
          set.add(member)
          added += 1
        }
      }
      const next: Entry = { value: [...set].join('\0') }
      if (entry?.expiresAt !== undefined) next.expiresAt = entry.expiresAt
      store.set(key, next)
      return added
    },
    async srem(key: string, ...members: string[]) {
      const entry = alive(key)
      if (!entry) return 0
      const set = new Set(entry.value.split('\0').filter(Boolean))
      let removed = 0
      for (const member of members) {
        if (set.delete(member)) removed += 1
      }
      const next: Entry = { value: [...set].join('\0') }
      if (entry.expiresAt !== undefined) next.expiresAt = entry.expiresAt
      store.set(key, next)
      return removed
    },
    async smembers(key: string) {
      const entry = alive(key)
      if (!entry || !entry.value) return []
      return entry.value.split('\0').filter(Boolean)
    },
    async scard(key: string) {
      return (await redis.smembers(key)).length
    },
    pipeline() {
      const ops: Array<() => Promise<unknown>> = []
      const api = {
        set(...args: Parameters<typeof redis.set>) {
          ops.push(() => redis.set(...args))
          return api
        },
        del(...args: Parameters<typeof redis.del>) {
          ops.push(() => redis.del(...args))
          return api
        },
        sadd(...args: Parameters<typeof redis.sadd>) {
          ops.push(() => redis.sadd(...args))
          return api
        },
        srem(...args: Parameters<typeof redis.srem>) {
          ops.push(() => redis.srem(...args))
          return api
        },
        expire(...args: Parameters<typeof redis.expire>) {
          ops.push(() => redis.expire(...args))
          return api
        },
        async exec() {
          const results = []
          for (const op of ops) {
            results.push([null, await op()])
          }
          return results
        }
      }
      return api
    },
    on() {
      return redis
    },
    clear() {
      store.clear()
    }
  }

  return redis
}

/** Shared instance for unit tests that mock `@/lib/redis`. */
export const memoryRedis = createMemoryRedis()
