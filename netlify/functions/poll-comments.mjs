// Netlify Scheduled Function — раз в 5 минут читает новые комментарии через API
// и кладёт их в очередь interactions. Это обходной путь вместо вебхуков: Meta не
// доставляет события о чужих комментариях без Advanced Access, но отдаёт те же
// комментарии по запросу. Разбирает очередь, как и прежде, process-comments.
import { pollComments } from './_lib/poller.mjs'

export const config = { schedule: '*/5 * * * *' }

export default async () => {
  const summary = await pollComments()
  return new Response(JSON.stringify(summary), { headers: { 'content-type': 'application/json' } })
}
