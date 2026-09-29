function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (!value) {
    throw new Error(`${name} is not set`)
  }
  return value
}

export function redisUrl(): string {
  return required('REDIS_URL', 'redis://localhost:6379/')
}

export function redisKeyPrefix(): string {
  return process.env.REDIS_KEY_PREFIX ?? ''
}

export function redisKey(logicalKey: string): string {
  return `${redisKeyPrefix()}${logicalKey}`
}
