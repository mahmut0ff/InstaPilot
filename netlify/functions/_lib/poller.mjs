// Чтение комментариев опросом — обходной путь вместо вебхуков.
//
// Почему так: Meta не доставляет вебхуки о комментариях посторонних людей, пока у
// приложения Standard Access (проверено 5 сентября 2026 — собственный комментарий
// аккаунта доходит за секунды, чужие не приходят вовсе). Но читать комментарии под
// своими медиа обычным запросом она разрешает. Поэтому забираем их сами и кладём в
// ту же очередь `interactions`, откуда их разбирает process-comments.
//
// Дедуп общий с вебхуком: id документа = id комментария, .create() падает на повторе.
// Поэтому опрос и вебхуки безопасно работают одновременно — если после App Review
// события всё-таки пойдут, дублей не будет.
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin.mjs'
import { readToken } from './tokens.mjs'
import { getMediaComments, getRecentMedia } from './instagram.mjs'

const MEDIA_PER_RUN = Number(process.env.POLL_MEDIA_LIMIT || 5)
const COMMENTS_PER_MEDIA = Number(process.env.POLL_COMMENTS_LIMIT || 25)
const RUN_DEADLINE_MS = 22000

// Разбирает время комментария (ISO 8601 с офсетом вида +0000) в миллисекунды.
function parseTs(value) {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

// Обрабатывает один аккаунт. Возвращает, сколько комментариев поставлено в очередь.
async function pollAccount(accDoc, summary, deadline) {
  const account = accDoc.data()
  if (!account.instagramBusinessId) return

  let token
  try {
    token = (await readToken(accDoc.id)).token
  } catch {
    return // нет токена — читать нечем
  }
  summary.accounts++

  // Водяной знак. На первом запуске историю не разгребаем: иначе бот сгенерировал бы
  // ответы на все старые комментарии разом. Просто фиксируем момент и выходим.
  const cursorMs = parseTs(account.commentsPollCursor)
  if (cursorMs == null) {
    await accDoc.ref.set({ commentsPollCursor: new Date().toISOString() }, { merge: true })
    summary.initialized++
    return
  }

  let media
  try {
    media = await getRecentMedia(account.instagramBusinessId, token, MEDIA_PER_RUN)
  } catch (err) {
    summary.errors++
    console.warn('poll: не удалось получить публикации: %s', err.message)
    return
  }

  const interactions = accDoc.ref.collection('interactions')
  let newestMs = cursorMs

  for (const item of media?.data || []) {
    if (Date.now() > deadline) {
      summary.deadline = true
      break
    }
    summary.media++

    let comments
    try {
      comments = await getMediaComments(item.id, token, COMMENTS_PER_MEDIA)
    } catch (err) {
      summary.errors++
      console.warn('poll: комментарии медиа %s недоступны: %s', item.id, err.message)
      continue
    }

    for (const c of comments?.data || []) {
      const ts = parseTs(c.timestamp)
      if (ts == null) continue
      summary.seen++
      if (ts > newestMs) newestMs = ts
      if (ts <= cursorMs) continue // уже видели в прошлый раз

      // Защита от петли: собственные комментарии аккаунта не обрабатываем.
      // Здесь сравниваем по нику — id автора этот эндпоинт не отдаёт.
      if (account.instagramUsername && c.username === account.instagramUsername) {
        summary.own++
        continue
      }
      if (!c.id || !c.text) continue

      try {
        await interactions.doc(String(c.id)).create({
          type: 'comment',
          igCommentId: String(c.id),
          igMediaId: String(item.id),
          parentCommentId: null,
          authorUsername: c.username || null,
          authorId: null, // эндпоинт комментариев id автора не возвращает
          inboundText: String(c.text),
          source: 'poll',
          status: 'received',
          createdAt: FieldValue.serverTimestamp(),
        })
        summary.queued++
      } catch {
        summary.duplicates++ // уже лежит — доставил вебхук или прошлый запуск
      }
    }
  }

  // Двигаем водяной знак только вперёд и только если что-то прочитали.
  if (newestMs > cursorMs) {
    await accDoc.ref.set({ commentsPollCursor: new Date(newestMs).toISOString() }, { merge: true })
  }
}

// Cron-обработчик: опрашивает все подключённые аккаунты.
export async function pollComments() {
  const summary = {
    accounts: 0,
    initialized: 0,
    media: 0,
    seen: 0,
    queued: 0,
    duplicates: 0,
    own: 0,
    errors: 0,
    deadline: false,
  }
  const deadline = Date.now() + RUN_DEADLINE_MS
  const snap = await adminDb.collection('accounts').where('connectionStatus', '==', 'connected').get()

  for (const accDoc of snap.docs) {
    if (Date.now() > deadline) {
      summary.deadline = true
      break
    }
    await pollAccount(accDoc, summary, deadline)
  }

  console.log('pollComments summary:', summary)
  return summary
}
