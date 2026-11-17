import type { ArtistArtworkCandidate, SourceCallContext } from '@easy-player/plugin-sdk'
import { searchQQSongs, record, text } from './shared'

export async function searchQQMusicArtistArtwork(
  name: string,
  context?: SourceCallContext
): Promise<ArtistArtworkCandidate[]> {
  // Song search exposes canonical singer names and mids, including collaboration artists.
  const songs = await searchQQSongs(name, context, 12)
  context?.signal.throwIfAborted()
  const seen = new Set<string>()
  return songs.flatMap((song) => {
    const singers = record(song).singer
    return (Array.isArray(singers) ? singers : []).flatMap((value) => {
      const artist = record(value),
        id = text(artist.mid),
        artistName = text(artist.name)
      if (!/^[a-zA-Z0-9]{14}$/.test(id) || !artistName || seen.has(id)) return []
      seen.add(id)
      return [
        {
          id,
          name: artistName,
          imageUrl: `https://y.gtimg.cn/music/photo_new/T001R500x500M000${id}.jpg`,
          resource: { sourceId: 'qqmusic', resourceType: 'artist' as const, resourceId: id }
        }
      ]
    })
  })
}
