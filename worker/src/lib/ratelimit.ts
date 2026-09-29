// KV-backed fixed-window rate limiter.
export async function rateLimit(
  kv: KVNamespace,
  scope: string,
  limit: number,
  windowSec = 60,
): Promise<{ ok: boolean; retryIn: number }> {
  const win = Math.floor(Date.now() / 1000 / windowSec)
  const key = `rl:${scope}:${win}`
  const cur = parseInt((await kv.get(key)) || '0', 10)
  if (cur >= limit) return { ok: false, retryIn: windowSec - (Math.floor(Date.now() / 1000) % windowSec) }
  await kv.put(key, String(cur + 1), { expirationTtl: windowSec * 2 })
  return { ok: true, retryIn: 0 }
}
