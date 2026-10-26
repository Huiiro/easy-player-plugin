import { isRelatedTitle } from './lyricUtils'

export function lyricAliases(...values: unknown[]): string[] {
  return [
    ...new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ]
}
const normalize = (value: string): string =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}_]+/gu, '')
const recordingNote =
  /\b(?:live|remix|mix|remaster(?:ed)?|version|ver\.?|edit|acoustic|instrumental|cover|feat\.?|piano|demo|karaoke|mono|stereo)\b|\b(?:sped|speed)\s*up\b|\bslowed\b|\b(?:tv|full)\s*(?:size\b|サイズ)|现场|演唱会|翻唱|伴奏|纯音乐|原唱|重制|版|混音|不插电|钢琴|女声|男声|加速|降速|慢速|カラオケ|アコースティック|バージョン|ライブ/iu
function versionNotes(value: string): string[] {
  const title = value.normalize('NFKC')
  return [...title.matchAll(/[([【]([^\])】]*)[)\]】]/gu)]
    .map((match) => match[1])
    .concat(title.match(/\s+[-–—]\s+(.+)$/u)?.[1] ?? '')
    .filter((note) => recordingNote.test(note))
}
/** Select only provider-declared names; translated display text is not a recording version. */
export function lyricTitle(
  title: string,
  original = title,
  aliases: string[] = [],
  subtitle = '',
  expected?: string,
  artist?: string | null
): string {
  const names = lyricAliases(original, aliases, title)
  const selected =
    (expected ? names.find((name) => isRelatedTitle(name, expected, artist)) : undefined) ??
    names[0] ??
    ''
  const notes = lyricAliases(
    versionNotes(original),
    versionNotes(title),
    versionNotes(subtitle).length
      ? versionNotes(subtitle)
      : recordingNote.test(subtitle)
        ? subtitle.replace(/^[（(【]+|[）)】]+$/gu, '')
        : []
  )
  const existing = new Set(versionNotes(selected).map(normalize))
  const extra = notes.filter((note) => !existing.has(normalize(note)))
  return selected + extra.map((note) => ' (' + note + ')').join('')
}
function requestedArtists(expected?: string | null): string[][] {
  const unknown = new Set([
    'unknown',
    'unknownartist',
    '未知歌手',
    '未知艺术家',
    'variousartists',
    '群星'
  ])
  return (expected ?? '')
    .normalize('NFKC')
    .split(/\s*(?:[/、,，;；&+]|\b(?:feat\.?|ft\.?|and|with)\b)\s*/iu)
    .map((name) =>
      [
        name.replace(/\([^)]*\)/g, ''),
        ...[...name.matchAll(/\(([^)]+)\)/g)].map((match) => match[1])
      ]
        .map(normalize)
        .filter((name) => name && !unknown.has(name))
    )
    .filter((names) => names.length)
}
export interface LyricArtist {
  name: string
  aliases: string[]
}
export function lyricArtistsMatch(artists: LyricArtist[], expected?: string | null): boolean {
  const available = new Set(
    artists
      .flatMap((artist) => lyricAliases(artist.name, artist.aliases))
      .flatMap((name) => requestedArtists(name).flat())
  )
  return requestedArtists(expected).every((group) => group.some((name) => available.has(name)))
}
/** Resolve a requested spelling only when the same artist record declares that alias. */
export function lyricArtists(artists: LyricArtist[], expected?: string | null): string {
  const wanted = new Set(requestedArtists(expected).flat())
  return [
    ...new Set(
      artists
        .map(
          (artist) =>
            lyricAliases(artist.name, artist.aliases).find((name) => wanted.has(normalize(name))) ??
            artist.name
        )
        .filter(Boolean)
    )
  ].join(' / ')
}
