// Netlify Scheduled Function (этап 6) — обрабатывает входящие сообщения директа.
// Отключаемый модуль: реально отвечает только если у аккаунта включён тумблер
// «Автоответы в директ» (autoReplyDms) и приложение прошло Meta App Review
// (scope instagram_business_manage_messages + подписка на поле messages).
import { processDueDms } from './_lib/comments.mjs'

export const config = { schedule: '* * * * *' } // каждую минуту

export default async () => {
  const summary = await processDueDms()
  return new Response(JSON.stringify(summary), { headers: { 'content-type': 'application/json' } })
}
