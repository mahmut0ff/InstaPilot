// Netlify Scheduled Function — публикует запланированные посты, которым наступило время.
// Идёт каждые 5 минут; сам находит подключённые аккаунты и их очереди.
import { publishDuePosts } from './_lib/publisher.mjs'

export const config = { schedule: '*/5 * * * *' }

export default async () => {
  const summary = await publishDuePosts()
  return new Response(JSON.stringify(summary), {
    headers: { 'content-type': 'application/json' },
  })
}
