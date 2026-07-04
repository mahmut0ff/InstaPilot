// POST /api/moderate-comment
//   { accountId, interactionId, action: 'approve'|'reject'|'regenerate', reply? } -> { status }
// Ручная модерация ответов бота из панели. Требует авторизации и владения аккаунтом.
import { requireOwnedAccount, requireUser } from './_lib/auth.mjs'
import { moderateInteraction } from './_lib/comments.mjs'
import { fail, HttpError, json } from './_lib/http.mjs'

export default async (req) => {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Метод не поддерживается', 'METHOD')
    const user = await requireUser(req)
    const body = await req.json().catch(() => ({}))
    await requireOwnedAccount(user.uid, body.accountId) // tenant-изоляция
    if (!body.interactionId) throw new HttpError(400, 'Не указан interactionId', 'NO_INTERACTION')

    const result = await moderateInteraction(body.accountId, body.interactionId, body.action, body.reply)
    return json({ ok: true, ...result })
  } catch (err) {
    return fail(err)
  }
}
