import type { SourceCallContext } from '@easy-player/plugin-sdk'
import { cleanNetworkLyric } from '../../shared/lyricNormalizer'
import type { LyricSearchRequest, ProviderLyricCandidate } from '@easy-player/plugin-sdk'
import { isRelatedTitle } from '../../shared/lyricUtils'
import { lyricAliases, lyricArtists, lyricTitle } from '../../shared/lyricIdentity'
import { requireNeteaseSuccess } from './response'
import { resolveNeteaseArtists } from './artists'

function songTitle(song: Record<string, unknown>, request?: LyricSearchRequest): string {
  return lyricTitle(
    String(song.name ?? ''),
    undefined,
    lyricAliases(song.alias, song.alia, song.tns, song.transNames),
    '',
    request?.title,
    request?.artist
  )
}

interface NeteaseLyricResponse {
  status?: number
  body?: {
    lrc?: { lyric?: string }
    yrc?: { lyric?: string }
    tlyric?: { lyric?: string }
    ytlrc?: { lyric?: string }
    romalrc?: { lyric?: string }
    yromalrc?: { lyric?: string }
  }
}

export async function searchNeteaseLyrics(
  request: LyricSearchRequest,
  wordTimed: boolean,
  context?: SourceCallContext
): Promise<ProviderLyricCandidate[]> {
  context?.signal.throwIfAborted()

  if (!request.title.trim()) return []
  const api = await import('@neteasecloudmusicapienhanced/api')
  const { search: searchNetease } = api.default ?? api
  context?.signal.throwIfAborted()

  const response = (await searchNetease({
    keywords: [request.title, request.artist].filter(Boolean).join(' ').trim(),
    limit: 8
  })) as unknown as {
    status?: number
    body?: { result?: { songs?: Array<Record<string, unknown>> } }
  }
  requireNeteaseSuccess(response)
  const songs = (response.body?.result?.songs ?? []).filter((song) =>
    isRelatedTitle(songTitle(song, request), request.title, request.artist)
  )
  context?.signal.throwIfAborted()
  const artistIds = new Set<string>()
  const candidates = await Promise.allSettled(
    songs.slice(0, 6).map(async (song): Promise<ProviderLyricCandidate | null> => {
      const id = song.id as string | number | undefined
      if (id === undefined) return null
      return fetchNeteaseLyric(song, id, wordTimed, context, request, artistIds)
    })
  )
  context?.signal.throwIfAborted()
  if (candidates.length && candidates.every((result) => result.status === 'rejected'))
    throw (candidates[0] as PromiseRejectedResult).reason
  return candidates.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [result.value] : []
  )
}

async function fetchNeteaseLyric(
  song: Record<string, unknown>,
  id: string | number,
  wordTimed: boolean,
  context?: SourceCallContext,
  request?: LyricSearchRequest,
  artistIds = new Set<string>()
): Promise<ProviderLyricCandidate | null> {
  context?.signal.throwIfAborted()

  const api = await import('@neteasecloudmusicapienhanced/api')
  const { lyric: getNeteaseLyric, lyric_new: getNeteaseLyricNew } = api.default ?? api
  context?.signal.throwIfAborted()
  let result: NeteaseLyricResponse
  try {
    result = (await getNeteaseLyricNew({ id })) as NeteaseLyricResponse
    context?.signal.throwIfAborted()
    requireNeteaseSuccess(result)
    const hasYrc = /^\[\d+,\d+\].*\(\d+,\d+,\d+\)/m.test(result.body?.yrc?.lyric ?? '')
    const hasLrc = /^\[\d+:\d/m.test(result.body?.lrc?.lyric ?? '')
    const usable = wordTimed ? hasYrc || hasLrc : hasLrc
    if (!usable) {
      context?.signal.throwIfAborted()
      result = (await getNeteaseLyric({ id })) as NeteaseLyricResponse
    }
  } catch (reason) {
    context?.signal.throwIfAborted()
    if ([401, 403, 429].includes(Number((reason as { status?: number } | null)?.status)))
      throw reason
    result = (await getNeteaseLyric({ id })) as NeteaseLyricResponse
  }
  context?.signal.throwIfAborted()
  const yrcText = result.body?.yrc?.lyric?.trim()
  const yrc = yrcText && /^\[\d+,\d+\].*\(\d+,\d+,\d+\)/m.test(yrcText) ? yrcText : undefined
  const format = wordTimed ? 'yrc' : 'lrc'
  const lrc = cleanNetworkLyric(wordTimed ? yrc || '' : result.body?.lrc?.lyric || '', format)
  requireNeteaseSuccess(result)
  if (!lrc) return null
  const songArtists = song.artists ?? song.ar
  const sdk = api.default ?? api
  const resolvedArtists = await resolveNeteaseArtists(
    Array.isArray(songArtists)
      ? songArtists.map((value) => {
          const artist = value as Record<string, unknown>
          return {
            id: artist.id,
            name: String(artist.name ?? ''),
            aliases: lyricAliases(artist.alias, artist.alia, artist.tns, artist.transNames)
          }
        })
      : [],
    request?.artist,
    typeof sdk.artist_detail === 'function' ? (id) => sdk.artist_detail({ id }) : undefined,
    artistIds,
    context
  )
  const artists = lyricArtists(resolvedArtists, request?.artist)
  const album = ((song.album ?? song.al) as { name?: string } | undefined)?.name
  const translation = cleanNetworkLyric(
    (wordTimed
      ? result.body?.ytlrc?.lyric || result.body?.tlyric?.lyric
      : result.body?.tlyric?.lyric || result.body?.ytlrc?.lyric) || '',
    'lrc'
  )
  const romanization = cleanNetworkLyric(
    (wordTimed
      ? result.body?.yromalrc?.lyric || result.body?.romalrc?.lyric
      : result.body?.romalrc?.lyric || result.body?.yromalrc?.lyric) || '',
    'lrc'
  )
  return {
    id: `netease:${id}:${format}`,
    resourceId: String(id),
    title: songTitle(song, request),
    artist: artists || '',
    album,
    lrc,
    format,
    supportsWordTiming: wordTimed,
    translation: translation || undefined,
    translationFormat: translation ? 'lrc' : undefined,
    romanization: romanization || undefined,
    romanizationFormat: romanization ? 'lrc' : undefined
  }
}
export async function getNeteaseLyrics(
  resourceId: string,
  wordTimed: boolean,
  context?: SourceCallContext
): Promise<ProviderLyricCandidate | null> {
  if (!/^\d+$/.test(resourceId)) throw new Error('Invalid NetEase track ID')
  return fetchNeteaseLyric({}, resourceId, wordTimed, context)
}
