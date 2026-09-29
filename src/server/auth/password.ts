import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const KEYLEN = 64

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = (await scrypt(password, salt, KEYLEN)) as Buffer
  return `scrypt$${salt}$${derived.toString('hex')}`
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [algo, salt, keyHex] = hash.split('$')
  if (algo !== 'scrypt' || !salt || !keyHex) {
    return false
  }

  const derived = (await scrypt(password, salt, KEYLEN)) as Buffer
  const expected = Buffer.from(keyHex, 'hex')
  if (derived.length !== expected.length) {
    return false
  }
  return timingSafeEqual(derived, expected)
}

export function generateTemporaryPassword(length = 20): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'
  const bytes = randomBytes(length)
  let result = ''
  for (let i = 0; i < length; i++) {
    const index = bytes[i] ?? 0
    result += alphabet[index % alphabet.length]
  }
  return result
}
