// Чтение комментариев опросом — обходной путь вместо вебхуков.
//
// Почему так: Meta не доставляет вебхуки о комментариях посторонних людей, пока у
// приложения Standard Access (проверено 5 сентября 2026 — собственный комментарий
// аккаунта доходит за секунды, чужие не приходят вовсе). Но читать комментарии под
// своими медиа обычным запросом она разрешает. Поэтому забираем их сами и кладём в
// ту же очередь `interactions`, откуда их разбирает process-comments.
//
// Главная сложность — порядок. Instagram отдаёт комментарии только от старых к новым
// и игнорирует order=reverse_chronological. Поэтому свежие достаются пролистыванием
// до последней страницы, а курсор `after` сохраняется в accounts/{id}/poll_state/{mediaId}:
// следующий прогон продолжает с того места, а не перечитывает всю историю.
//
// Дедуп общий с вебхуком: id документа = id комментария, .create() падает на повторе.
// Поэтому опрос и вебхуки безопасно работают одновременно — если после App Review
// события всё-таки пойдут, дублей не будет.
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin.mjs'
import { readToken } from './tokens.mjs'
import { getMediaComments, getRecentMedia } from './instagram.mjs'

const MEDIA_PER_RUN = Number(process.env.POLL_MEDIA_LIMIT || 10)
const PAGE_SIZE = Number(process.env.POLL_PAGE_SIZE || 50)
const MAX_PAGES = Number(process.env.POLL_MAX_PAGES || 12) // потолок на медиа за один прогон
const RUN_DEADLINE_MS = 22000

function parseTs(value) {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

// Пролистывает комментарии одной публикации с сохранённого места до конца.
// Первый проход по незнакомому медиа только доходит до конца и запоминает курсор:
// обрабатывать историю нельзя, иначе бот ответит на все старые комментарии разом.
async function pollMedia({ mediaId, token, stateRef, interactions, account, summary, deadline }) {
  const stateDoc = stateRef.doc(mediaId)
  const snap = await stateDoc.get()
  // known — НЕ «видели раньше», а «дочитали историю до конца». Разница принципиальна:
  // первый проход по посту с сотнями комментариев не укладывается в лимит времени,
  // и если считать публикацию известной уже со второго прогона, остаток истории
  // уедет в очередь как новые комментарии (так и случилось 5 сентября — 141 штука).
  const known = snap.data()?.bootstrapped === true
  let after = snap.data()?.after ?? null
  let reachedEnd = false
  // Время последнего обработанного комментария. Без него каждый прогон тратил бы
  // попытку записи на каждый уже известный комментарий: 141 заведомо провальный
  // запрос к базе съедал весь бюджет времени, и до половины публикаций дело не доходило.
  const lastTs = snap.data()?.lastTs ? Date.parse(snap.data().lastTs) : 0
  let newestTs = lastTs

  if (!known) summary.bootstrapping++

  for (let page = 0; page < MAX_PAGES; page++) {
    if (Date.now() > deadline) {
      summary.deadline = true
      break
    }

    let res
    try {
      res = await getMediaComments(mediaId, token, PAGE_SIZE, after)
    } catch (err) {
      summary.errors++
      console.warn('poll: медиа %s страница %d: %s', mediaId, page, err.message)
      break
    }

    const batch = res?.data || []
    summary.pages++

    for (const c of batch) {
      const ts = parseTs(c.timestamp)
      if (ts == null) continue
      summary.seen++
      if (!summary.newestSeen || ts > Date.parse(summary.newestSeen)) {
        summary.newestSeen = new Date(ts).toISOString()
      }

      if (ts > newestTs) newestTs = ts
      if (!known) continue // первый проход: только доходим до конца
      if (ts <= lastTs) {
        summary.alreadySeen++
        continue // уже обрабатывали — в базу не ходим
      }
      if (!c.id || !c.text) continue

      // Защита от петли: собственные комментарии аккаунта не обрабатываем.
      // Сравниваем по нику — id автора этот эндпоинт не отдаёт.
      if (account.instagramUsername && c.username === account.instagramUsername) {
        summary.own++
        continue
      }

      try {
        await interactions.doc(String(c.id)).create({
          type: 'comment',
          igCommentId: String(c.id),
          igMediaId: String(mediaId),
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
        summary.duplicates++ // уже лежит — доставил вебхук или прошлый прогон
      }
    }

    const nextCursor = res?.paging?.cursors?.after
    if (!res?.paging?.next || !nextCursor || batch.length === 0) {
      reachedEnd = true // дочитали до конца ленты — только теперь пост «известен»
      break
    }
    after = nextCursor
  }

  await stateDoc.set(
    {
      after,
      bootstrapped: known || reachedEnd,
      lastTs: newestTs ? new Date(newestTs).toISOString() : null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )
  if (!known && reachedEnd) summary.bootstrapped++
}

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

  let media
  try {
    media = await getRecentMedia(account.instagramBusinessId, token, MEDIA_PER_RUN)
  } catch (err) {
    summary.errors++
    console.warn('poll: не удалось получить публикации: %s', err.message)
    return
  }

  const stateRef = accDoc.ref.collection('poll_state')
  const interactions = accDoc.ref.collection('interactions')

  for (const item of media?.data || []) {
    if (Date.now() > deadline) {
      summary.deadline = true
      break
    }
    summary.media++
    await pollMedia({ mediaId: String(item.id), token, stateRef, interactions, account, summary, deadline })
  }
}

// Cron-обработчик: опрашивает все подключённые аккаунты.
export async function pollComments() {
  const summary = {
    accounts: 0,
    media: 0,
    bootstrapping: 0,
    bootstrapped: 0,
    pages: 0,
    seen: 0,
    newestSeen: null,
    queued: 0,
    duplicates: 0,
    alreadySeen: 0,
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
