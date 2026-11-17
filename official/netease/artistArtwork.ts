import type { ArtistArtworkCandidate, SourceCallContext } from '@easy-player/plugin-sdk'
import { requireNeteaseSuccess } from './response'

export async function searchNeteaseArtistArtwork(
  name: string,
  context?: SourceCallContext
): Promise<ArtistArtworkCandidate[]> {
  if (!name.trim()) return []
  context?.signal.throwIfAborted()
  const api = await import('@neteasecloudmusicapienhanced/api')
  const response = await (api.default ?? api).search({
    keywords: name.trim(),
    type: 100,
    limit: 12
  })
  context?.signal.throwIfAborted()
  requireNeteaseSuccess(response)
  const artists = (response.body as { result?: { artists?: Array<Record<string, unknown>> } })
    .result?.artists
  return (Array.isArray(artists) ? artists : []).flatMap((artist) => {
    const id = String(artist.id ?? '')
    const imageUrl =
      typeof artist.picUrl === 'string' ? artist.picUrl.replace(/^http:\/\//i, 'https://') : ''
    if (!/^\d+$/.test(id) || typeof artist.name !== 'string' || !/^https?:\/\//i.test(imageUrl))
      return []
    return [
      {
        id,
        name: artist.name,
        imageUrl,
        resource: { sourceId: 'netease', resourceType: 'artist' as const, resourceId: id }
      }
    ]
  })
}
