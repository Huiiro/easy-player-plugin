import type { SourceCallContext } from '@easy-player/plugin-sdk'
import { SourceCallError } from '@easy-player/plugin-sdk'
import { cleanNetworkLyric, normalizeKrc } from '../../shared/lyricNormalizer'
import type { LyricSearchRequest, ProviderLyricCandidate } from '@easy-player/plugin-sdk'
import { isRelatedTitle, searchKeyword } from '../../shared/lyricUtils'
import {
  KUGOU_PUBLIC_COOKIE,
  record,
  text,
  trackId,
  trackTitle,
  artistNames,
  bodyOf,
  fetchKugouTrack,
  type KugouRecord
} from './shared'

function lyricTitle(song: KugouRecord): string {
  const title = trackTitle(song)
  const original =
    text(record(song.base).songname) ||
    text(song.OriSongName) ||
    text(song.SongName) ||
    text(record(song.extra).ori_audio_name)
  if (!original || isRelatedTitle(title, original)) return title
  // Catalog suffixes also contain translated names (e.g. 花之塔 / Tower of Flower).
  // Use the original name for lyric identity, retaining recording-version notes.
  const note = title.startsWith(original) ? title.slice(original.length) : title
  const recordingNote =
    /\bpiano\b|\b(?:sped|speed)\s*up\b|\bslowed\b|\b(?:tv|full)\s*(?:size\b|サイズ)|\b(?:demo|karaoke|mono|stereo)\b|演唱会|混音|不插电|钢琴|女声|男声|加速|降速|慢速|カラオケ|アコースティック|バージョン|ライブ/iu
  return recordingNote.test(note) ? title : original
}

async function fetchKugouLyric(
  song: KugouRecord,
  wordTimed: boolean,
  context?: SourceCallContext
): Promise<ProviderLyricCandidate | null> {
  context?.signal.throwIfAborted()

  const { default: api } = await import('kugoumusicapi')
  context?.signal.throwIfAborted()
  const base = record(song.base),
    audio = record(song.audio_info)
  const hash = text(song.FileHash) || text(audio.hash)
  if (!hash) return null
  const albumAudioId = base.album_audio_id ?? song.MixSongID
  const response = await api.search_lyric({
    hash,
    ...(albumAudioId ? { album_audio_id: trackId(albumAudioId) } : {})
  })
  context?.signal.throwIfAborted()
  const matches = bodyOf(response)
  if (!Array.isArray(matches.candidates)) throw new SourceCallError('INVALID_RESPONSE', 'kugou')
  const match = matches.candidates
    .map(record)
    .find(
      (candidate) =>
        (typeof candidate.id === 'string' || typeof candidate.id === 'number') &&
        text(candidate.accesskey)
    )
  if (!match) return null
  const format = wordTimed ? 'krc' : 'lrc'
  const lyricResponse = await api.lyric({
    id: String(match.id),
    accesskey: text(match.accesskey),
    decode: true,
    fmt: format
  })
  context?.signal.throwIfAborted()
  const content = text(bodyOf(lyricResponse).decodeContent)
  const hasWordTiming = /^\[\d+,\d+\].*<\d+,\d+,\d+>/m.test(content)
  if (wordTimed && !hasWordTiming) return null
  const normalized = wordTimed ? normalizeKrc(content) : undefined
  const lrc = wordTimed ? normalized?.lrc : cleanNetworkLyric(content, 'lrc')
  if (!lrc) return null
  return {
    id: 'kugou:' + String(match.id) + ':' + format,
    resourceId: albumAudioId ? trackId(albumAudioId) : hash,
    title: lyricTitle(song) || text(match.song),
    artist:
      text(base.author_name) ||
      artistNames(song.Singers) ||
      text(song.SingerName) ||
      text(match.singer),
    album: text(base.album_name) || text(song.AlbumName) || undefined,
    lrc,
    format,
    supportsWordTiming: wordTimed,
    translation: normalized?.translation,
    translationFormat: normalized?.translationFormat,
    romanization: normalized?.romanization,
    romanizationFormat: normalized?.romanizationFormat
  }
}
export async function searchKugouLyrics(
  request: LyricSearchRequest,
  wordTimed: boolean,
  context?: SourceCallContext
): Promise<ProviderLyricCandidate[]> {
  context?.signal.throwIfAborted()
  if (!request.title.trim()) return []
  const { default: api } = await import('kugoumusicapi')
  context?.signal.throwIfAborted()
  const response = await api.search({
    keywords: searchKeyword(request),
    cookie: KUGOU_PUBLIC_COOKIE
  })
  context?.signal.throwIfAborted()
  const songs = record(bodyOf(response).data).lists
  if (!Array.isArray(songs)) throw new SourceCallError('INVALID_RESPONSE', 'kugou')
  const candidates = await Promise.allSettled(
    songs.slice(0, 4).map((song) => fetchKugouLyric(record(song), wordTimed, context))
  )
  context?.signal.throwIfAborted()
  if (candidates.length && candidates.every((result) => result.status === 'rejected'))
    throw (candidates[0] as PromiseRejectedResult).reason
  return candidates.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [result.value] : []
  )
}
export async function getKugouLyrics(
  resourceId: string,
  wordTimed: boolean,
  context?: SourceCallContext
): Promise<ProviderLyricCandidate | null> {
  context?.signal.throwIfAborted()

  // Metadata uses the album-specific MixSongID. Older lyric candidates use a file hash.
  if (/^[a-f0-9]{32}$/i.test(resourceId))
    return fetchKugouLyric({ FileHash: resourceId.toUpperCase() }, wordTimed, context)
  const song = await fetchKugouTrack(trackId(resourceId), context)
  context?.signal.throwIfAborted()
  return fetchKugouLyric(song, wordTimed, context)
}
