// Общие помощники для serverless-функций (Netlify Functions v2, Web Request/Response).

// Ошибка конфигурации/валидации с HTTP-статусом — превращается в аккуратный JSON-ответ.
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code ?? null
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export function fail(err) {
  const status = err instanceof HttpError ? err.status : 500
  if (status >= 500) console.error('function error:', err)
  return json({ ok: false, error: err.message, code: err.code ?? null }, status)
}

// 302-редирект браузера обратно в приложение (используется в OAuth callback).
export function redirect(url) {
  return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store' } })
}

export function requireEnv(name) {
  const v = process.env[name]
  if (!v || !v.trim()) {
    throw new HttpError(
      500,
      `Сервер не сконфигурирован: не задана переменная окружения ${name}`,
      'ENV_MISSING'
    )
  }
  return v.trim()
}

export function appUrl(path = '') {
  const base = requireEnv('APP_URL').replace(/\/+$/, '')
  return path ? `${base}${path.startsWith('/') ? '' : '/'}${path}` : base
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
