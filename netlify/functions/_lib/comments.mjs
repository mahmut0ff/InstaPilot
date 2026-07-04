// Ядро автоответов на комментарии (этап 5) и директ (этап 6).
// Вебхук кладёт входящее в accounts/{id}/interactions со status 'received' (type comment|dm).
// Здесь: берём в работу (claim+lease), спрашиваем Gemini, и либо кладём в черновик,
// либо отправляем ответ, либо пропускаем/эскалируем — по настройкам бота.
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin.mjs'
import { HttpError, sleep } from './http.mjs'
import { readToken } from './tokens.mjs'
import { replyToComment, sendMessage } from './instagram.mjs'
import { generateReply } from './gemini.mjs'

const LEASE_MS = 3 * 60 * 1000
const RUN_DEADLINE_MS = 22000
const BATCH_PER_ACCOUNT = 15
const GAP_MS = 400

const SETTINGS_DEFAULTS = {
  toneOfVoice: '',
  brandContext: '',
  forbiddenTopics: [],
  language: 'auto',
  useEmojis: true,
  signature: '',
  autoReplyComments: false,
  autoReplyDms: false,
  draftMode: true,
  escalateNegative: true,
}

// Отправляет ответ по нужному каналу: комментарий -> публичный ответ, директ -> сообщение.
// Возвращает id отправленного (для истории). igUserId нужен для messaging-эндпоинта.
async function sendReply(item, igUserId, token, text) {
  if (item.type === 'dm') {
    if (!item.authorId) throw new HttpError(400, 'Нет получателя для директа', 'NO_RECIPIENT')
    const r = await sendMessage(igUserId, token, item.authorId, text)
    return r.message_id ?? null
  }
  const r = await replyToComment(item.igCommentId, token, text)
  return r.id ?? null
}

const interactionsCol = (accountId) => adminDb.collection('accounts').doc(accountId).collection('interactions')

async function getSettings(accountId) {
  const snap = await adminDb.collection('accounts').doc(accountId).collection('settings').doc('bot').get()
  return { ...SETTINGS_DEFAULTS, ...(snap.data() || {}) }
}

function matchesForbidden(text, topics) {
  if (!Array.isArray(topics) || !topics.length) return false
  const t = String(text).toLowerCase()
  return topics.some((topic) => topic && t.includes(String(topic).toLowerCase()))
}

// Атомарно берём взаимодействие в работу (защита от двойной обработки).
async function claimInteraction(ref) {
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return null
    const d = snap.data()
    const now = Date.now()
    const leaseFree = !d.leaseUntil || d.leaseUntil < now
    if (!(d.status === 'received' || (d.status === 'processing' && leaseFree))) return null
    tx.update(ref, { status: 'processing', leaseUntil: now + LEASE_MS, updatedAt: FieldValue.serverTimestamp() })
    return { id: ref.id, ...d, status: 'processing' }
  })
}

// Обрабатывает одно взаимодействие. token может быть null (нужен только для авто-отправки).
async function processInteraction(ref, item, brandName, settings, token, igUserId) {
  try {
    const decision = await generateReply({
      brandName,
      settings,
      comment: item.inboundText,
      authorUsername: item.authorUsername,
      channel: item.type === 'dm' ? 'dm' : 'comment',
    })

    // Страховки поверх решения модели.
    let action = decision.action
    if (action === 'reply' && settings.escalateNegative !== false && decision.sentiment === 'negative') {
      action = 'escalate'
    }
    // Запрещённые темы проверяем и во входящем тексте, и в сгенерированном ответе
    // (защита от prompt-injection, протащившего запрещённую тему в reply).
    if (action === 'reply' && matchesForbidden(`${item.inboundText} ${decision.reply}`, settings.forbiddenTopics)) {
      action = 'skip'
    }

    const base = {
      sentiment: decision.sentiment,
      aiReason: decision.reason,
      aiAction: action,
      processedAt: FieldValue.serverTimestamp(),
      leaseUntil: FieldValue.delete(),
      error: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }

    if (action === 'skip') {
      await ref.set({ ...base, status: 'skipped', botReply: '' }, { merge: true })
      return 'skipped'
    }
    if (action === 'escalate') {
      await ref.set({ ...base, status: 'needs_attention', botReply: decision.reply || '' }, { merge: true })
      return 'needs_attention'
    }

    const reply = decision.reply
    if (!reply) {
      await ref.set({ ...base, status: 'needs_attention', botReply: '', aiReason: 'Gemini не сформировал ответ' }, { merge: true })
      return 'needs_attention'
    }

    // Режим «черновик» — ждём ручного одобрения.
    if (settings.draftMode !== false) {
      await ref.set({ ...base, status: 'draft', botReply: reply }, { merge: true })
      return 'draft'
    }

    // Авто-отправка.
    if (!token) {
      await ref.set({ ...base, status: 'needs_attention', botReply: reply, aiReason: 'Нет токена для отправки' }, { merge: true })
      return 'needs_attention'
    }
    const replyId = await sendReply(item, igUserId, token, reply)
    await ref.set(
      { ...base, status: 'sent', botReply: reply, sentReply: reply, igReplyId: replyId, sentAt: FieldValue.serverTimestamp() },
      { merge: true }
    )
    return 'sent'
  } catch (err) {
    await ref.set(
      { status: 'failed', error: err.message, leaseUntil: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    )
    return 'failed'
  }
}

// Cron-обработчик одного канала. type = 'comment' | 'dm'; settingKey — тумблер автоответов;
// offLabel — причина пропуска, когда автоответы канала выключены.
async function processDue(type, settingKey, offLabel) {
  const summary = { type, accounts: 0, sent: 0, draft: 0, skipped: 0, needs_attention: 0, failed: 0, deadline: false }
  const deadline = Date.now() + RUN_DEADLINE_MS
  const accountsSnap = await adminDb.collection('accounts').where('connectionStatus', '==', 'connected').get()

  for (const accDoc of accountsSnap.docs) {
    if (Date.now() > deadline) {
      summary.deadline = true
      break
    }
    const account = accDoc.data()
    if (!account.instagramBusinessId) continue
    summary.accounts++
    const settings = await getSettings(accDoc.id)

    // Комментарии и директ лежат в одной коллекции. Запрашиваем СРАЗУ по типу, чтобы
    // всплеск одного канала не вытеснял другой из батча (два equality-фильтра —
    // составной индекс Firestore не требуется). type у всех записей проставляет вебхук.
    const receivedSnap = await interactionsCol(accDoc.id)
      .where('status', '==', 'received')
      .where('type', '==', type)
      .limit(BATCH_PER_ACCOUNT)
      .get()
    const docs = receivedSnap.docs

    // Автоответы канала выключены — помечаем, чтобы не крутить вечно (ответить можно вручную).
    if (!settings[settingKey]) {
      for (const d of docs) {
        await d.ref.set(
          { status: 'skipped', aiReason: offLabel, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        )
        summary.skipped++
      }
      continue
    }

    let token = null
    try {
      token = (await readToken(accDoc.id)).token
    } catch {
      /* нет токена — черновики всё равно сгенерируем */
    }

    for (const d of docs) {
      if (Date.now() > deadline) {
        summary.deadline = true
        break
      }
      const claimed = await claimInteraction(d.ref)
      if (!claimed) continue
      const result = await processInteraction(
        d.ref,
        claimed,
        account.brandName,
        settings,
        token,
        account.instagramBusinessId
      )
      summary[result] = (summary[result] || 0) + 1
      await sleep(GAP_MS)
    }
  }

  console.log(`processDue(${type}) summary:`, summary)
  return summary
}

// Cron комментариев (этап 5).
export const processDueComments = () =>
  processDue('comment', 'autoReplyComments', 'Автоответы на комментарии выключены')

// Cron директа (этап 6) — модуль включается тумблером autoReplyDms после App Review.
export const processDueDms = () => processDue('dm', 'autoReplyDms', 'Автоответы в директ выключены')

// Ручная модерация из панели: одобрить (отправить), отклонить или перегенерировать.
// accountId уже проверен на владение вызывающим.
export async function moderateInteraction(accountId, interactionId, action, replyText) {
  const accRef = adminDb.collection('accounts').doc(accountId)
  const accSnap = await accRef.get()
  const account = accSnap.data()
  const ref = interactionsCol(accountId).doc(interactionId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'Взаимодействие не найдено', 'NOT_FOUND')
  const item = snap.data()

  // Нельзя «оживить» уже отправленный ответ — иначе повторная публикация/порча истории.
  if ((action === 'reject' || action === 'regenerate') && item.status === 'sent') {
    throw new HttpError(409, 'Ответ уже отправлен', 'ALREADY_SENT')
  }

  if (action === 'reject') {
    await ref.set({ status: 'rejected', updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return { status: 'rejected' }
  }

  if (action === 'regenerate') {
    const settings = await getSettings(accountId)
    const decision = await generateReply({
      brandName: account?.brandName,
      settings,
      comment: item.inboundText,
      authorUsername: item.authorUsername,
      channel: item.type === 'dm' ? 'dm' : 'comment',
    })
    const status = decision.action === 'reply' ? 'draft' : decision.action === 'skip' ? 'skipped' : 'needs_attention'
    await ref.set(
      {
        status,
        botReply: decision.reply || '',
        sentiment: decision.sentiment,
        aiReason: decision.reason,
        aiAction: decision.action,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    return { status, botReply: decision.reply || '' }
  }

  if (action === 'approve') {
    if (!account || account.connectionStatus !== 'connected' || !account.instagramBusinessId) {
      throw new HttpError(409, 'Instagram не подключён к этому бренду', 'NOT_CONNECTED')
    }
    const reply = String(replyText ?? item.botReply ?? '').trim()
    if (!reply) throw new HttpError(400, 'Пустой текст ответа', 'EMPTY_REPLY')

    // Атомарно «захватываем» на отправку (status -> 'sending'), чтобы два одновременных
    // одобрения (двойной клик, ретрай, две вкладки, гонка с cron) не опубликовали дубль.
    const APPROVABLE = ['draft', 'needs_attention', 'failed', 'skipped']
    await adminDb.runTransaction(async (tx) => {
      const s = await tx.get(ref)
      if (!s.exists) throw new HttpError(404, 'Взаимодействие не найдено', 'NOT_FOUND')
      const d = s.data()
      if (d.status === 'sent') throw new HttpError(409, 'Ответ уже отправлен', 'ALREADY_SENT')
      // «sending» с истёкшей арендой — значит прошлый вызов упал; можно перезабрать.
      const reclaimable = d.status === 'sending' && d.leaseUntil && d.leaseUntil < Date.now()
      if (!APPROVABLE.includes(d.status) && !reclaimable) {
        throw new HttpError(409, 'Ответ сейчас обрабатывается, попробуйте позже', 'BUSY')
      }
      tx.update(ref, { status: 'sending', leaseUntil: Date.now() + 60000, updatedAt: FieldValue.serverTimestamp() })
    })

    let replyId
    try {
      const token = (await readToken(accountId)).token
      replyId = await sendReply(item, account.instagramBusinessId, token, reply)
    } catch (err) {
      // Отправка не удалась — снимаем «замок», помечаем ошибкой (не залипаем в 'sending').
      await ref.set(
        { status: 'failed', error: err.message, leaseUntil: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      )
      throw err instanceof HttpError ? err : new HttpError(502, `Не удалось отправить: ${err.message}`, 'SEND_FAILED')
    }

    await ref.set(
      {
        status: 'sent',
        botReply: reply,
        sentReply: reply,
        igReplyId: replyId,
        sentAt: FieldValue.serverTimestamp(),
        leaseUntil: FieldValue.delete(),
        error: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    return { status: 'sent' }
  }

  throw new HttpError(400, 'Неизвестное действие', 'BAD_ACTION')
}
