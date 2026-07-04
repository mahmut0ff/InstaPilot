// Netlify Scheduled Function — раз в минуту обрабатывает накопившиеся комментарии
// (генерация ответа Gemini, черновик или авто-отправка) по всем подключённым аккаунтам.
import { processDueComments } from './_lib/comments.mjs'

export const config = { schedule: '* * * * *' } // каждую минуту

export default async () => {
  const summary = await processDueComments()
  return new Response(JSON.stringify(summary), { headers: { 'content-type': 'application/json' } })
}
