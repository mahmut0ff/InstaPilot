// Клиент Instagram Platform API (вариант «Instagram API with Instagram Login», Business/Creator).
// Все сетевые вызовы идут через igFetch с уважением к rate limits Meta:
// минимальный интервал между запросами + экспоненциальный backoff на 429/коды лимитов.
import { HttpError, requireEnv, sleep } from './http.mjs'

const AUTH_HOST = 'https://www.instagram.com'
const API_HOST = 'https://api.instagram.com'
const GRAPH_HOST = 'https://graph.instagram.com'

// Scope'ы по умолчанию покрывают этапы 2 (basic), 3 (публикация) и 5 (комментарии).
// Директ (instagram_business_manage_messages) добавляется на этапе 6 через INSTAGRAM_SCOPES.
const DEFAULT_SCOPES = 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments'

// Коды ошибок Meta, означающие превышение лимита частоты запросов.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613])

// ---- Rate limiting (в пределах тёплого контейнера функции) ----
let lastCallAt = 0
const MIN_GAP_MS = Number(process.env.IG_MIN_GAP_MS || 350)

async function throttle() {
  const wait = lastCallAt + MIN_GAP_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastCallAt = Date.now()
}

// Универсальный вызов Graph API с ретраями. url — полный, params — query (для GET) или тело.
// params — query (GET) или form-поля (POST). jsonBody — тело JSON (для Messaging API),
// при этом query-параметры (напр. access_token) передаются в строке запроса.
async function igFetch(url, { method = 'GET', params, jsonBody, retries = 3 } = {}) {
  let attempt = 0
  for (;;) {
    await throttle()
    let res
    let payload
    try {
      if (method === 'GET') {
        const qs = params ? '?' + new URLSearchParams(params).toString() : ''
        res = await fetch(url + qs)
      } else if (jsonBody) {
        const qs = params ? '?' + new URLSearchParams(params).toString() : ''
        res = await fetch(url + qs, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(jsonBody),
        })
      } else {
        res = await fetch(url, {
          method,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(params || {}).toString(),
        })
      }
      payload = await res.json().catch(() => ({}))
    } catch (netErr) {
      if (attempt++ < retries) {
        await sleep(500 * 2 ** attempt)
        continue
      }
      throw new HttpError(502, `Сеть недоступна при обращении к Instagram: ${netErr.message}`, 'IG_NETWORK')
    }

    if (res.ok) return payload

    const err = payload?.error || {}
    const isRateLimit = res.status === 429 || RATE_LIMIT_CODES.has(err.code)
    if (isRateLimit && attempt++ < retries) {
      // экспоненциальная задержка: 1s, 2s, 4s ...
      await sleep(1000 * 2 ** attempt)
      continue
    }
    throw new HttpError(
      res.status === 429 ? 429 : 400,
      `Instagram API: ${err.message || res.statusText || 'ошибка запроса'}`,
      err.code ? `IG_${err.code}` : 'IG_ERROR'
    )
  }
}

// ---- OAuth ----

export function scopes() {
  return (process.env.INSTAGRAM_SCOPES || DEFAULT_SCOPES).trim()
}

// URL окна авторизации Business Login. state — подписанный токен (CSRF + перенос accountId).
export function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: requireEnv('INSTAGRAM_APP_ID'),
    redirect_uri: requireEnv('OAUTH_REDIRECT_URI'),
    response_type: 'code',
    scope: scopes(),
    state,
  })
  return `${AUTH_HOST}/oauth/authorize?${params.toString()}`
}

// code -> короткоживущий токен (1 час). Возвращает { access_token, user_id, permissions }.
export async function exchangeCodeForToken(code) {
  const data = await igFetch(`${API_HOST}/oauth/access_token`, {
    method: 'POST',
    params: {
      client_id: requireEnv('INSTAGRAM_APP_ID'),
      client_secret: requireEnv('INSTAGRAM_APP_SECRET'),
      grant_type: 'authorization_code',
      redirect_uri: requireEnv('OAUTH_REDIRECT_URI'),
      code,
    },
  })
  if (!data.access_token) throw new HttpError(400, 'Instagram не вернул access_token', 'IG_NO_TOKEN')
  return data
}

// короткоживущий -> долгоживущий (~60 дней). Возвращает { access_token, expires_in }.
export async function exchangeForLongLivedToken(shortToken) {
  return igFetch(`${GRAPH_HOST}/access_token`, {
    params: {
      grant_type: 'ig_exchange_token',
      client_secret: requireEnv('INSTAGRAM_APP_SECRET'),
      access_token: shortToken,
    },
  })
}

// Продление долгоживущего токена (нужен возраст >= 24ч и не истёкший). { access_token, expires_in }.
export async function refreshLongLivedToken(longToken) {
  return igFetch(`${GRAPH_HOST}/refresh_access_token`, {
    params: { grant_type: 'ig_refresh_token', access_token: longToken },
  })
}

// Профиль подключённого аккаунта. Возвращает { user_id, username, account_type, ... }.
export async function getProfile(token) {
  return igFetch(`${GRAPH_HOST}/me`, {
    params: {
      fields: 'user_id,username,account_type,name,profile_picture_url,followers_count,media_count',
      access_token: token,
    },
  })
}

// ---- Публикация контента (этап 3) ----
// Публикация в Instagram двухшаговая: сначала создаётся медиа-контейнер,
// затем (когда Meta его обработала) он публикуется.

// Собирает поля контейнера под тип медиа. Фото — image_url; видео — REELS + video_url.
// Необязательные поля добавляются только если заданы, чтобы не слать пустые параметры.
export function mediaContainerFields(post) {
  const f = {}
  if (post.caption) f.caption = post.caption

  if (post.mediaType === 'video') {
    f.media_type = 'REELS'
    f.video_url = post.mediaUrl
    if (post.coverUrl) f.cover_url = post.coverUrl
    if (typeof post.shareToFeed === 'boolean') f.share_to_feed = post.shareToFeed
  } else {
    f.image_url = post.mediaUrl
  }

  if (post.altText) f.alt_text = post.altText
  if (post.locationId) f.location_id = post.locationId
  if (Array.isArray(post.collaborators) && post.collaborators.length > 0) {
    f.collaborators = JSON.stringify(post.collaborators.slice(0, 3))
  }
  return f
}

// Создать медиа-контейнер. Возвращает { id } (creation_id).
export async function createMediaContainer(igUserId, token, fields) {
  return igFetch(`${GRAPH_HOST}/${igUserId}/media`, {
    method: 'POST',
    params: { ...fields, access_token: token },
  })
}

// Статус обработки контейнера: { status_code: 'IN_PROGRESS'|'FINISHED'|'ERROR'|'EXPIRED', status }.
export async function getContainerStatus(containerId, token) {
  return igFetch(`${GRAPH_HOST}/${containerId}`, {
    params: { fields: 'status_code,status', access_token: token },
  })
}

// Опубликовать готовый контейнер. Возвращает { id } — id опубликованного медиа.
export async function publishContainer(igUserId, token, creationId) {
  return igFetch(`${GRAPH_HOST}/${igUserId}/media_publish`, {
    method: 'POST',
    params: { creation_id: creationId, access_token: token },
  })
}

// Данные опубликованного медиа (нужна ссылка). Возвращает { permalink, media_type, timestamp }.
export async function getMedia(mediaId, token) {
  return igFetch(`${GRAPH_HOST}/${mediaId}`, {
    params: { fields: 'permalink,media_type,timestamp', access_token: token },
  })
}

// Суточный лимит публикаций аккаунта (Meta: обычно 25/24ч). Возвращает { used, total } или null.
export async function getPublishingLimit(igUserId, token) {
  try {
    const res = await igFetch(`${GRAPH_HOST}/${igUserId}/content_publishing_limit`, {
      params: { fields: 'config,quota_usage', access_token: token },
    })
    const row = res?.data?.[0]
    if (!row) return null
    return { used: Number(row.quota_usage || 0), total: Number(row.config?.quota_total || 25) }
  } catch {
    return null // best-effort: не блокируем публикацию, если лимит не удалось прочитать
  }
}

// Публикует комментарий к медиа (используется для «первого комментария» с хэштегами).
// Требует scope instagram_business_manage_comments. Возвращает { id }.
export async function createComment(mediaId, token, message) {
  return igFetch(`${GRAPH_HOST}/${mediaId}/comments`, {
    method: 'POST',
    params: { message, access_token: token },
  })
}

// Публичный ответ на комментарий (этап 5). Возвращает { id } — id ответа.
export async function replyToComment(commentId, token, message) {
  return igFetch(`${GRAPH_HOST}/${commentId}/replies`, {
    method: 'POST',
    params: { message, access_token: token },
  })
}

// Отправка личного сообщения в директ (этап 6). recipientId — IGSID собеседника.
// Требует scope instagram_business_manage_messages и ответ в пределах 24ч-окна.
// Возвращает { recipient_id, message_id }.
export async function sendMessage(igUserId, token, recipientId, text) {
  return igFetch(`${GRAPH_HOST}/${igUserId}/messages`, {
    method: 'POST',
    params: { access_token: token },
    jsonBody: { recipient: { id: recipientId }, message: { text } },
  })
}

// Поля вебхука для подписки. Директ (messages) включается через INSTAGRAM_WEBHOOK_FIELDS
// после прохождения App Review; по умолчанию — только comments.
export function webhookFields() {
  return (process.env.INSTAGRAM_WEBHOOK_FIELDS || 'comments').trim()
}

// Подписывает приложение на вебхуки аккаунта. Best-effort при подключении.
// Сами поля включаются в дашборде Meta App (через API не подписать).
export async function subscribeToWebhooks(igUserId, token, fields = webhookFields()) {
  return igFetch(`${GRAPH_HOST}/${igUserId}/subscribed_apps`, {
    method: 'POST',
    params: { subscribed_fields: fields, access_token: token },
  })
}

// Последние публикации аккаунта. Нужны, чтобы читать комментарии опросом —
// это путь в обход вебхуков, недоступных без Advanced Access.
export async function getRecentMedia(igUserId, token, limit = 3) {
  return igFetch(`${GRAPH_HOST}/${igUserId}/media`, {
    params: { fields: 'id,timestamp', limit, access_token: token },
  })
}

// Комментарии под конкретной публикацией.
// order=reverse_chronological обязателен: по умолчанию Meta отдаёт самые СТАРЫЕ
// комментарии, и под постом с сотней обсуждений свежие никогда не попадут в выборку.
export async function getMediaComments(mediaId, token, limit = 25) {
  return igFetch(`${GRAPH_HOST}/${mediaId}/comments`, {
    params: {
      fields: 'id,text,username,timestamp',
      order: 'reverse_chronological',
      limit,
      access_token: token,
    },
  })
}

// Что Meta РЕАЛЬНО считает подписанным для этого аккаунта. Без этого отсутствие
// подписки неотличимо от «никто не комментировал»: в обоих случаях вебхук молчит.
export async function getSubscribedApps(igUserId, token) {
  return igFetch(`${GRAPH_HOST}/${igUserId}/subscribed_apps`, {
    params: { access_token: token },
  })
}
