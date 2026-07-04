// POST /api/publish-now  { accountId, postId }  -> { status }
// Мгновенно публикует один запланированный пост. Требует авторизации и владения аккаунтом.
import { requireOwnedAccount, requireUser } from './_lib/auth.mjs'
import { publishSinglePost } from './_lib/publisher.mjs'
import { fail, HttpError, json } from './_lib/http.mjs'

export default async (req) => {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Метод не поддерживается', 'METHOD')
    const user = await requireUser(req)
    const body = await req.json().catch(() => ({}))
    await requireOwnedAccount(user.uid, body.accountId) // проверка владения (tenant-изоляция)
    if (!body.postId) throw new HttpError(400, 'Не указан postId', 'NO_POST')

    const result = await publishSinglePost(body.accountId, body.postId)
    return json({ ok: true, ...result })
  } catch (err) {
    return fail(err)
  }
}
