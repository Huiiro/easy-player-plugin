import type { SourceCallContext } from '@easy-player/plugin-sdk'
import { lyricAliases, lyricArtistsMatch, type LyricArtist } from '../../shared/lyricIdentity'

interface Artist extends LyricArtist {
  id?: unknown
}
type Lookup = (id: string) => Promise<{ status?: unknown; body?: unknown }>
const cache = new Map<string, { until: number; names: string[] }>()
const pending = new Map<string, Promise<string[]>>()
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
function aliasesFor(id: string, lookup: Lookup): Promise<string[]> {
  const cached = cache.get(id)
  if (cached && cached.until > Date.now()) return Promise.resolve(cached.names)
  const current = pending.get(id)
  if (current) return current
  if (pending.size >= 32) return Promise.resolve([])
  const request = Promise.resolve()
    .then(() => lookup(id))
    .then((response) => {
      const body = record(response.body),
        artist = record(record(body.data).artist)
      if (response.status !== 200 || Number(body.code) !== 200 || String(artist.id) !== id)
        return []
      const names = lyricAliases(artist.name, artist.alias, artist.transNames)
      if (cache.size >= 128) cache.delete(cache.keys().next().value!)
      cache.set(id, { names, until: Date.now() + 30 * 60 * 1000 })
      return names
    })
    .catch(() => [])
    .finally(() => pending.delete(id))
  pending.set(id, request)
  return request
}
/** Search omits aliases; enrich at most two artist IDs, using their public identity records. */
export async function resolveNeteaseArtists(
  artists: Artist[],
  expected: string | null | undefined,
  lookup: Lookup | undefined,
  ids: Set<string>,
  context?: SourceCallContext
): Promise<LyricArtist[]> {
  if (!lookup || lyricArtistsMatch(artists, expected)) return artists
  context?.signal.throwIfAborted()
  const milliseconds = Math.min(1500, (context?.deadline ?? Infinity) - Date.now() - 250)
  if (milliseconds <= 0) return artists
  const result = await Promise.all(
    artists.map(async (artist) => {
      const id = String(artist.id ?? '')
      if (!/^\d+$/.test(id) || Number(id) <= 0 || (!ids.has(id) && ids.size >= 2)) return artist
      ids.add(id)
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const names = await Promise.race([
          aliasesFor(id, lookup),
          new Promise<string[]>((resolve) => {
            timer = setTimeout(() => resolve([]), milliseconds)
          })
        ])
        return { ...artist, aliases: lyricAliases(artist.aliases, names) }
      } finally {
        clearTimeout(timer)
      }
    })
  )
  context?.signal.throwIfAborted()
  return result
}
