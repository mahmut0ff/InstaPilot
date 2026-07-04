// Шифрование access-токенов (AES-256-GCM) и подпись OAuth-state (HMAC-SHA256).
// Токены Instagram НИКОГДА не хранятся и не передаются в открытом виде.
import crypto from 'node:crypto'
import { HttpError, requireEnv } from './http.mjs'

function encryptionKey() {
  const key = Buffer.from(requireEnv('TOKEN_ENCRYPTION_KEY'), 'base64')
  if (key.length !== 32) {
    throw new HttpError(500, 'TOKEN_ENCRYPTION_KEY должен быть 32 байта в base64 (сгенерируйте: openssl rand -base64 32)', 'ENV_BAD')
  }
  return key
}

// -> { ciphertext, iv, authTag } (всё base64). Кладётся в accounts/{id}/private/credentials.
export function encrypt(plaintext) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  return {
    ciphertext: enc.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  }
}

export function decrypt({ ciphertext, iv, authTag }) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(authTag, 'base64'))
  const dec = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()])
  return dec.toString('utf8')
}

// ---- Подписанный state для OAuth (защита от CSRF + перенос uid/accountId через redirect) ----

const b64url = (buf) => Buffer.from(buf).toString('base64url')
const fromB64url = (s) => Buffer.from(s, 'base64url')

function hmac(body) {
  return crypto.createHmac('sha256', requireEnv('OAUTH_STATE_SECRET')).update(body).digest('base64url')
}

// payload: произвольный объект. Возвращает "<body>.<signature>".
export function signState(payload) {
  const body = b64url(JSON.stringify(payload))
  return `${body}.${hmac(body)}`
}

export function verifyState(token) {
  if (typeof token !== 'string' || !token.includes('.')) {
    throw new HttpError(400, 'Некорректный OAuth state', 'STATE_INVALID')
  }
  const [body, sig] = token.split('.')
  const expected = hmac(body)
  // Постоянное по времени сравнение подписи.
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(400, 'Подпись OAuth state не совпала (возможна CSRF-атака)', 'STATE_BAD_SIG')
  }
  let payload
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8'))
  } catch {
    throw new HttpError(400, 'Не удалось разобрать OAuth state', 'STATE_INVALID')
  }
  if (!payload.exp || Date.now() > payload.exp) {
    throw new HttpError(400, 'OAuth state истёк, начните подключение заново', 'STATE_EXPIRED')
  }
  return payload
}
