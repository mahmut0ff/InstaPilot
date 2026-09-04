// Приёмник вебхуков Meta для Instagram.
//   GET  /api/webhook-instagram  — верификация подписки (hub.challenge)
//   POST /api/webhook-instagram  — события (новые комментарии) -> очередь в Firestore
// Отвечаем 200 максимально быстро; генерацию ответа делает cron process-comments.
import crypto from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './_lib/firebaseAdmin.mjs'

// Проверка подписи Meta: X-Hub-Signature-256 = 'sha256=' + HMAC_SHA256(rawBody, APP_SECRET).
function verifySignature(rawBody, header) {
  const secret = process.env.INSTAGRAM_APP_SECRET
  if (!secret) return false
  if (!header || !header.startsWith('sha256=')) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

async function findAccountByIgId(igUserId) {
  const snap = await adminDb.collection('accounts').where('instagramBusinessId', '==', String(igUserId)).limit(1).get()
  return snap.empty ? null : snap.docs[0]
}

// Создаёт запись взаимодействия с дедупом: docId = id комментария/сообщения,
// .create() падает при повторной доставке Meta — тогда просто пропускаем.
async function createInteraction(accDoc, docId, data) {
  try {
    await accDoc.ref.collection('interactions').doc(docId).create({
      ...data,
      status: 'received',
      createdAt: FieldValue.serverTimestamp(),
    })
    console.log('webhook: поставлено в очередь type=%s account=%s', data.type, accDoc.id)
  } catch {
    console.log('webhook: повторная доставка, документ уже есть — пропуск')
  }
}

export default async (req) => {
  const url = new URL(req.url)

  // --- Верификация подписки (Meta дергает GET при настройке вебхука) ---
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    const expected = process.env.META_WEBHOOK_VERIFY_TOKEN
    // Сравнение за постоянное время (как и подпись POST), незаданный токен = всегда отказ.
    const a = Buffer.from(token || '')
    const b = Buffer.from(expected || '')
    const ok = mode === 'subscribe' && expected && a.length === b.length && crypto.timingSafeEqual(a, b)
    if (ok) {
      return new Response(challenge || '', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    return new Response('Forbidden', { status: 403 })
  }

  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const raw = await req.text()
  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'))) {
    console.warn('webhook: bad signature')
    return new Response('Invalid signature', { status: 401 })
  }

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  // Диагностика доставки: без неё отброшенное событие неотличимо от неприсланного.
  // Логируем только структуру — ни текста комментария, ни ников.
  console.log(
    'webhook: entries=%d fields=%s messaging=%d',
    (payload.entry || []).length,
    JSON.stringify((payload.entry || []).flatMap((e) => (e.changes || []).map((c) => c.field))),
    (payload.entry || []).reduce((n, e) => n + (e.messaging || []).length, 0)
  )

  try {
    for (const entry of payload.entry || []) {
      const igUserId = entry.id
      const accDoc = await findAccountByIgId(igUserId)
      if (!accDoc) {
        console.warn('webhook: нет аккаунта с instagramBusinessId=%s — событие отброшено', igUserId)
        continue // не наш аккаунт
      }

      // --- Комментарии (field: comments) ---
      for (const change of entry.changes || []) {
        if (change.field !== 'comments') continue
        const v = change.value || {}
        const from = v.from || {}

        // Защита от петли: не реагируем на собственные комментарии аккаунта.
        if (String(from.id) === String(igUserId)) {
          console.log('webhook: собственный комментарий аккаунта — пропуск (защита от петли)')
          continue
        }
        if (!v.id || !v.text) {
          console.log('webhook: комментарий без id или текста — пропуск')
          continue
        }

        await createInteraction(accDoc, String(v.id), {
          type: 'comment',
          igCommentId: String(v.id),
          igMediaId: v.media?.id ? String(v.media.id) : null,
          parentCommentId: v.parent_id ? String(v.parent_id) : null,
          authorUsername: from.username || null,
          authorId: from.id ? String(from.id) : null,
          inboundText: String(v.text),
        })
      }

      // --- Директ (messaging, формат Messenger Platform) — этап 6 ---
      for (const m of entry.messaging || []) {
        const msg = m.message
        if (!msg || msg.is_echo) continue // эхо собственных сообщений — пропускаем (петля)
        if (!msg.mid) continue // нет id сообщения (unsend/read/прочие события) — дедуп по mid невозможен
        const text = msg.text
        if (!text) continue // вложения без текста пока не обрабатываем
        const senderId = m.sender?.id
        // Отправитель не должен быть самим аккаунтом.
        if (!senderId || String(senderId) === String(igUserId)) continue

        await createInteraction(accDoc, String(msg.mid), {
          type: 'dm',
          igMessageId: String(msg.mid),
          authorId: String(senderId),
          authorUsername: null, // username в messaging-вебхуке не приходит
          inboundText: String(text),
        })
      }
    }
  } catch (err) {
    console.error('webhook processing error:', err)
    // Всё равно возвращаем 200: событие уже принято, ошибку разберёт cron/логи.
  }

  return new Response('EVENT_RECEIVED', { status: 200 })
}
