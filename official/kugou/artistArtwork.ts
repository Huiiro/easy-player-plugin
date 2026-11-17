import type { ArtistArtworkCandidate, SourceCallContext } from '@easy-player/plugin-sdk'
import { SourceCallError } from '@easy-player/plugin-sdk'
import { bodyOf, record, text, coverUrl, KUGOU_PUBLIC_COOKIE } from './shared'

export async function searchKugouArtistArtwork(
  name: string,
  context?: SourceCallContext
): Promise<ArtistArtworkCandidate[]> {
  if (!name.trim()) return []
  context?.signal.throwIfAborted()
  const { default: api } = await import('kugoumusicapi')
  const body = bodyOf(
    await api.search({
      keywords: name.trim(),
      type: 'author',
      pagesize: 12,
      page: 1,
      cookie: KUGOU_PUBLIC_COOKIE
    })
  )
  context?.signal.throwIfAborted()
  const artists = record(body.data).lists
  if (!Array.isArray(artists)) throw new SourceCallError('INVALID_RESPONSE', 'kugou')
  return artists.flatMap((value) => {
    const artist = record(value)
    const id = String(artist.AuthorId ?? artist.SingerId ?? '')
    const artistName = text(artist.AuthorName) || text(artist.SingerName)
    const imageUrl = coverUrl(artist.Avatar || artist.SingerHead || artist.SizableAvatar)
    if (!/^\d+$/.test(id) || !artistName || !imageUrl) return []
    return [
      {
        id,
        name: artistName,
        imageUrl,
        resource: { sourceId: 'kugou', resourceType: 'artist' as const, resourceId: id }
      }
    ]
  })
}
