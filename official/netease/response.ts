import { SourceCallError } from '@easy-player/plugin-sdk'

export function requireNeteaseSuccess(response: { status?: unknown; body?: unknown }): void {
  if (response.status !== 200)
    throw Object.assign(new Error('NetEase HTTP failure'), { status: response.status })
  const body =
    response.body && typeof response.body === 'object'
      ? (response.body as Record<string, unknown>)
      : {}
  if (body.code === undefined || Number(body.code) === 200) return
  if ([401, 403, 404, 429].includes(Number(body.code)))
    throw Object.assign(new Error('NetEase request rejected'), { status: Number(body.code) })
  throw new SourceCallError('PROVIDER_ERROR', 'netease')
}
