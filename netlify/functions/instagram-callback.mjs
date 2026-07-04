// GET /api/instagram-callback?code=...&state=...   (redirect_uri для Meta)
// Это точка, куда Instagram возвращает браузер пользователя после авторизации.
// Здесь нет Firebase ID token — доверие обеспечивает подписанный state.
import { requireOwnedAccount } from './_lib/auth.mjs'
import { verifyState } from './_lib/crypto.mjs'
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getProfile,
  scopes,
  subscribeToWebhooks,
} from './_lib/instagram.mjs'
import { saveConnection } from './_lib/tokens.mjs'
import { appUrl, redirect } from './_lib/http.mjs'

// Единая точка возврата в приложение с результатом.
function back(params) {
  const qs = new URLSearchParams(params).toString()
  return redirect(appUrl(`/accounts?${qs}`))
}

export default async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error')

  // Пользователь отклонил доступ на стороне Instagram.
  if (oauthError) return back({ ig_error: oauthError })
  if (!code || !state) return back({ ig_error: 'Instagram не вернул код авторизации' })

  let accountId
  try {
    const payload = verifyState(state)
    accountId = payload.accountId
    // Проверяем, что аккаунт всё ещё принадлежит тому же пользователю (defense in depth).
    const { ref } = await requireOwnedAccount(payload.uid, accountId)

    // Instagram иногда добавляет '#_' в конец кода — на самом деле это фрагмент URL,
    // до сервера он не доходит, но подстрахуемся.
    const cleanCode = code.replace(/#_$/, '')

    const short = await exchangeCodeForToken(cleanCode)
    const long = await exchangeForLongLivedToken(short.access_token)
    const profile = await getProfile(long.access_token)

    await saveConnection(ref, {
      longLivedToken: long.access_token,
      expiresIn: long.expires_in,
      profile,
      scopeStr: scopes(),
    })

    // Подписываем аккаунт на вебхуки (comments, а с этапа 6 и messages). Не критично.
    try {
      await subscribeToWebhooks(profile.user_id ?? profile.id, long.access_token)
    } catch (e) {
      console.warn('subscribeToWebhooks failed:', e.message)
    }

    const warn =
      profile.account_type && !['BUSINESS', 'MEDIA_CREATOR', 'CREATOR'].includes(profile.account_type)
        ? { ig_warn: 'account_type_personal' }
        : {}

    return back({ connected: accountId, username: profile.username ?? '', ...warn })
  } catch (err) {
    console.error('instagram-callback failed:', err)
    return back({ ig_error: err.message || 'Не удалось завершить подключение', ...(accountId ? { account: accountId } : {}) })
  }
}
