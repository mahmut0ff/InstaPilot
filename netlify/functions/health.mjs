// Smoke-тест деплоя функций: GET /api/health
export default async () =>
  Response.json({
    ok: true,
    service: 'instapilot',
    ts: new Date().toISOString(),
  })
