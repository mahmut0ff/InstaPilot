// Ядро автопостинга (этап 3).
// Публикация в Instagram двухшаговая: создать медиа-контейнер -> дождаться обработки -> опубликовать.
// Видео (REELS) обрабатывается не мгновенно, поэтому статус poll'ится; если не готово за прогон —
// пост остаётся 'processing' и до-публикуется на следующем запуске cron.
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin.mjs'
import { HttpError, sleep } from './http.mjs'
import { readToken } from './tokens.mjs'
import {
  createComment,
  createMediaContainer,
  getContainerStatus,
  getMedia,
  getPublishingLimit,
  mediaContainerFields,
  publishContainer,
} from './instagram.mjs'

const BATCH_PER_ACCOUNT = 20 // сколько постов максимум берём за один прогон на аккаунт
const LEASE_MS = 4 * 60 * 1000 // «аренда» поста, чтобы параллельные запуски не дублировали публикацию
const GAP_BETWEEN_POSTS_MS = 500 // бережём rate limits между постами
const RUN_DEADLINE_MS = 22000 // бюджет одного cron-прогона (лимит Netlify ~30с) — с запасом
const CRON_POLLS = 2 // сколько раз проверять готовность за прогон cron (остальное — след. запуск)
const MAX_ATTEMPTS = 6 // предел прогонов на пост, чтобы «зависшее» медиа не поллилось вечно

const postsCol = (accountId) => adminDb.collection('accounts').doc(accountId).collection('scheduled_posts')

// Атомарно «захватывает» пост в работу через транзакцию (защита от двойной публикации).
// Берём pending, либо processing с истёкшей арендой. Возвращает данные поста или null.
async function claimPost(postRef, { allowFuture = false } = {}) {
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(postRef)
    if (!snap.exists) return null
    const d = snap.data()
    const now = Date.now()

    const dueMs = d.scheduledAt?.toMillis ? d.scheduledAt.toMillis() : 0
    if (!allowFuture && dueMs > now) return null // ещё не время

    const leaseFree = !d.leaseUntil || d.leaseUntil < now
    const claimable = d.status === 'pending' || (d.status === 'processing' && leaseFree)
    if (!claimable) return null

    tx.update(postRef, {
      status: 'processing',
      leaseUntil: now + LEASE_MS,
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { id: postRef.id, ...d, status: 'processing' }
  })
}

// Идемпотентно фиксирует факт публикации. Сначала минимальной записью сохраняем
// publishedMediaId (чтобы повторный прогон не опубликовал заново даже при сбое), затем —
// необязательную ссылку. Повторный вызов безопасен.
async function markPublished(postRef, mediaId, token) {
  await postRef.set(
    {
      status: 'published',
      publishedMediaId: mediaId,
      publishedAt: FieldValue.serverTimestamp(),
      leaseUntil: FieldValue.delete(),
      error: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )
  try {
    const permalink = (await getMedia(mediaId, token)).permalink
    if (permalink) await postRef.set({ permalink }, { merge: true })
  } catch {
    /* ссылка необязательна */
  }
}

// «Первый комментарий» (обычно хэштеги). Постится один раз — флаг firstCommentPosted
// защищает от повторной отправки при идемпотентном до-финализировании.
async function maybePostFirstComment(postRef, post, mediaId, token) {
  const message = (post.firstComment || '').trim()
  if (!message || post.firstCommentPosted) return
  try {
    await createComment(mediaId, token, message)
    await postRef.set(
      { firstCommentPosted: true, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    )
    post.firstCommentPosted = true
  } catch (err) {
    console.error(`first comment failed for ${postRef.id}:`, err.message)
  }
}

// Продвигает один пост по машине состояний. maxPolls — сколько раз проверить готовность контейнера.
async function advancePost(postRef, post, igUserId, token, { maxPolls } = {}) {
  const polls = maxPolls ?? (post.mediaType === 'video' ? 4 : 2)
  // Если публикация в IG уже произошла в этом вызове — держим id, чтобы при последующем
  // сбое НЕ пометить пост failed и не опубликовать повторно (публикация не идемпотентна).
  let publishedId = post.publishedMediaId || null
  try {
    // Идемпотентность: пост уже опубликован (например, прошлый прогон упал после publish) —
    // только до-финализируем, публиковать повторно НЕЛЬЗЯ.
    if (publishedId) {
      await markPublished(postRef, publishedId, token)
      await maybePostFirstComment(postRef, post, publishedId, token)
      return 'published'
    }

    // 1) контейнер: создаём, если ещё нет. Счётчик прогонов привязан к контейнеру —
    // на свежем контейнере (в т.ч. после «Вернуть в очередь») бюджет попыток обнуляется.
    let containerId = post.containerId
    if (!containerId) {
      if (!post.mediaUrl) throw new Error('Не указана ссылка на медиа')
      const created = await createMediaContainer(igUserId, token, mediaContainerFields(post))
      containerId = created.id
      if (!containerId) throw new Error('Instagram не вернул id контейнера')
      await postRef.set({ containerId, attempts: 0, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      post.attempts = 0
    }

    // 2) ждём готовности и публикуем
    for (let i = 0; i < polls; i++) {
      const st = await getContainerStatus(containerId, token)
      const code = st.status_code
      if (code === 'FINISHED') {
        const pub = await publishContainer(igUserId, token, containerId)
        publishedId = pub.id // side-effect свершился — дальше пост уже не может стать failed
        await markPublished(postRef, publishedId, token)
        await maybePostFirstComment(postRef, post, publishedId, token)
        return 'published'
      }
      if (code === 'ERROR' || code === 'EXPIRED') {
        throw new Error(`Обработка медиа завершилась статусом ${code}`)
      }
      // IN_PROGRESS — подождём и проверим снова (актуально для видео)
      if (i < polls - 1) await sleep(2500)
    }

    // Не успело обработаться. Считаем прогоны; после лимита — в failed, чтобы не поллить вечно.
    const attempts = (post.attempts || 0) + 1
    if (attempts >= MAX_ATTEMPTS) {
      await postRef.set(
        {
          status: 'failed',
          error: 'Instagram слишком долго обрабатывает медиа — проверьте ссылку/формат и повторите',
          leaseUntil: FieldValue.delete(),
          failedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
      return 'failed'
    }
    // Аренду не трогаем: она истечёт (4 мин) до следующего прогона cron (5 мин) — тогда пере-возьмём.
    await postRef.set(
      { status: 'processing', attempts, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    )
    return 'processing'
  } catch (err) {
    // Публикация уже произошла — НЕ помечаем failed (иначе retry опубликует повторно),
    // а оставляем publishedMediaId, чтобы следующий прогон до-финализировал пост.
    if (publishedId) {
      try {
        await markPublished(postRef, publishedId, token)
        return 'published'
      } catch {
        await postRef.set(
          {
            status: 'processing',
            publishedMediaId: publishedId,
            leaseUntil: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
        return 'processing'
      }
    }
    await postRef.set(
      {
        status: 'failed',
        error: err.message,
        leaseUntil: FieldValue.delete(),
        failedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    return 'failed'
  }
}

// Cron: публикует все посты, у которых наступило время, по всем подключённым аккаунтам.
// Ограничен бюджетом времени (лимит Netlify ~30с): не успевшее берётся следующим прогоном.
export async function publishDuePosts() {
  const summary = { accounts: 0, published: 0, processing: 0, failed: 0, skipped: 0, deadline: false }
  const deadline = Date.now() + RUN_DEADLINE_MS
  const accountsSnap = await adminDb.collection('accounts').where('connectionStatus', '==', 'connected').get()

  for (const accDoc of accountsSnap.docs) {
    if (Date.now() > deadline) {
      summary.deadline = true
      break
    }
    const account = accDoc.data()
    const igUserId = account.instagramBusinessId
    if (!igUserId) continue
    summary.accounts++

    let token
    try {
      token = (await readToken(accDoc.id)).token
    } catch {
      continue // нет токена — пропускаем аккаунт
    }

    // Уважаем суточный лимит публикаций Meta (best-effort).
    const limit = await getPublishingLimit(igUserId, token)
    let remaining = limit ? Math.max(0, limit.total - limit.used) : Infinity

    const dueSnap = await postsCol(accDoc.id)
      .where('scheduledAt', '<=', Timestamp.now())
      .orderBy('scheduledAt')
      .limit(BATCH_PER_ACCOUNT)
      .get()

    for (const postDoc of dueSnap.docs) {
      if (Date.now() > deadline) {
        summary.deadline = true
        break
      }
      if (!['pending', 'processing'].includes(postDoc.data().status)) continue
      if (remaining <= 0) {
        summary.skipped++
        continue // лимит на сутки исчерпан — оставляем в очереди до завтра
      }
      const claimed = await claimPost(postDoc.ref)
      if (!claimed) continue

      const result = await advancePost(postDoc.ref, claimed, igUserId, token, { maxPolls: CRON_POLLS })
      summary[result] = (summary[result] || 0) + 1
      if (result === 'published') remaining--
      await sleep(GAP_BETWEEN_POSTS_MS)
    }
  }

  console.log('publishDuePosts summary:', summary)
  return summary
}

// Мгновенная публикация одного поста (кнопка «Опубликовать сейчас»).
// accountId уже проверен на владение вызывающим. Возвращает итоговый статус.
export async function publishSinglePost(accountId, postId) {
  const accRef = adminDb.collection('accounts').doc(accountId)
  const accSnap = await accRef.get()
  const account = accSnap.data()
  if (!account || account.connectionStatus !== 'connected' || !account.instagramBusinessId) {
    throw new HttpError(409, 'Instagram не подключён к этому бренду', 'NOT_CONNECTED')
  }

  const token = (await readToken(accountId)).token
  const postRef = postsCol(accountId).doc(postId)
  // allowFuture: публикуем немедленно, даже если запланировано на будущее.
  const claimed = await claimPost(postRef, { allowFuture: true })
  if (!claimed) {
    const cur = (await postRef.get()).data()
    if (!cur) throw new HttpError(404, 'Пост не найден', 'NOT_FOUND')
    throw new HttpError(409, `Пост нельзя опубликовать сейчас (статус: ${cur.status})`, 'BAD_STATE')
  }

  const result = await advancePost(postRef, claimed, account.instagramBusinessId, token, { maxPolls: 8 })
  return { status: result }
}
