// Tokens and codes. Tokens are stored as SHA-256 hashes. Rejoin codes are stored readable so a
// host can read a lost one out (engineering spec, sections 7.5 and 7.7).
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { CODE_ALPHABET, CODE_LENGTH } from '@lab02/protocol'

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function newCode(length = CODE_LENGTH): string {
  let out = ''
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return out
}

export function newPlayerId(): string {
  return `p${randomBytes(6).toString('hex')}`
}

export function samePasscode(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}
