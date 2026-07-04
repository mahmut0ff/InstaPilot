import { auth } from './firebase'

// Вызов Netlify-функции с Firebase ID token в заголовке Authorization.
// Возвращает разобранный JSON; кидает Error с понятным текстом при ошибке.
export async function callFunction(path, body) {
  const user = auth.currentUser
  if (!user) throw new Error('Сессия истекла — войдите заново')

  const token = await user.getIdToken()
  let res
  try {
    res = await fetch(`/api/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body || {}),
    })
  } catch {
    throw new Error('Не удалось связаться с сервером. Запущены ли функции (`netlify dev`)?')
  }

  const ctype = res.headers.get('content-type') || ''
  const raw = await res.text().catch(() => '')
  let data = null
  if (ctype.includes('application/json')) {
    try {
      data = JSON.parse(raw)
    } catch {
      /* оставим null */
    }
  }

  // Нормальный JSON-ответ функции (в т.ч. её собственные ошибки {ok:false, error}).
  if (data && typeof data === 'object') {
    if (!res.ok || data.ok === false) throw new Error(data.error || `Ошибка запроса (${res.status})`)
    return data
  }

  // Ответ не JSON — различаем «нет функций (запущен vite)» и «функция упала».
  if (!res.status || res.status === 200 || ctype.includes('text/html')) {
    throw new Error(
      'Backend-функции недоступны — похоже, запущен `vite` (5173) без функций. Используйте `netlify dev` (порт 8888).'
    )
  }
  const snippet = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
  throw new Error(
    `Функция вернула ошибку (${res.status}). Частая причина — не заданы серверные переменные в .env ` +
      `(FIREBASE_SERVICE_ACCOUNT, INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET).` +
      (snippet ? ` Ответ: ${snippet}` : '')
  )
}
