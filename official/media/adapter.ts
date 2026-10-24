import type {
  MediaSearchItem as DownloadSearchItem,
  MediaDownloadQuery,
  HttpMediaDownloadPlan
} from '@easy-player/plugin-sdk'
import type { NetworkSource, SourceCallContext } from '@easy-player/plugin-sdk'
import { SourceCallError } from '@easy-player/plugin-sdk'
type DownloadPlatform = 'youtube' | 'bili'
function toSearchItem(
  entry: Record<string, unknown>,
  platform: DownloadPlatform
): DownloadSearchItem | null {
  const id = typeof entry.id === 'string' ? entry.id : ''
  const title = typeof entry.title === 'string' ? entry.title : ''
  const url =
    typeof entry.webpage_url === 'string'
      ? entry.webpage_url
      : typeof entry.url === 'string'
        ? entry.url
        : ''
  if (!id || !title || !url) return null
  return {
    platform,
    resource: { sourceId: platform, resourceType: 'video', resourceId: id },
    id,
    title,
    url,
    thumbnail: typeof entry.thumbnail === 'string' ? entry.thumbnail : null,
    duration: typeof entry.duration === 'number' ? entry.duration : null,
    uploader:
      typeof entry.uploader === 'string'
        ? entry.uploader
        : typeof entry.channel === 'string'
          ? entry.channel
          : null
  }
}

const BILI_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Origin: 'https://www.bilibili.com',
  Referer: 'https://www.bilibili.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
}

async function biliApi<T>(url: string, context?: SourceCallContext): Promise<T> {
  context?.signal.throwIfAborted()
  const init = { headers: BILI_HEADERS, signal: context?.signal }
  const response = await (context?.host
    ? context.host.network.fetch(url, init, context)
    : fetch(url, init))
  if (!response.ok) throw Object.assign(new Error('Bili HTTP failure'), { status: response.status })
  const parsed = JSON.parse(await response.text()) as { code?: number; data?: T }
  context?.signal.throwIfAborted()
  if (typeof parsed.code !== 'number') throw new SourceCallError('INVALID_RESPONSE', 'bili')
  if (parsed.code !== 0) throw new SourceCallError('PROVIDER_ERROR', 'bili')
  if (!parsed.data) throw new SourceCallError('INVALID_RESPONSE', 'bili')
  return parsed.data
}

function biliBvid(url: string): string | null {
  return url.match(/BV[\w]+/i)?.[0] ?? null
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '').trim()
}

function normalizeBiliUrl(value: string): string {
  if (value.startsWith('//')) return `https:${value}`
  return value.replace(/^http:\/\//i, 'https://')
}

async function extractBiliItems(
  target: string,
  search = false,
  context?: SourceCallContext
): Promise<DownloadSearchItem[]> {
  if (search) {
    const query = target.replace(/^bilisearch\d+:/, '')
    const data = await biliApi<{ result?: Array<Record<string, unknown>> }>(
      `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(query)}`,
      context
    )
    return (data.result ?? []).slice(0, 12).flatMap((entry) => {
      const bvid = typeof entry.bvid === 'string' ? entry.bvid : ''
      if (!bvid) return []
      return [
        {
          platform: 'bili' as const,
          resource: { sourceId: 'bili', resourceType: 'video' as const, resourceId: bvid },
          id: bvid,
          title: stripHtml(String(entry.title ?? '未命名视频')),
          url: `https://www.bilibili.com/video/${bvid}`,
          thumbnail: null,
          thumbnailUrl: typeof entry.pic === 'string' ? normalizeBiliUrl(entry.pic) : null,
          duration: null,
          uploader: typeof entry.author === 'string' ? entry.author : null
        }
      ]
    })
  }
  const bvid = biliBvid(target)
  if (!bvid) throw new SourceCallError('INVALID_REQUEST', 'bili')
  const requestedPage = Math.max(1, Number(new URL(target).searchParams.get('p') || '1'))
  const data = await biliApi<{
    bvid: string
    cid: number
    title: string
    pic?: string
    duration?: number
    owner?: { name?: string }
    pages?: Array<{ cid: number; part?: string; duration?: number; page?: number }>
    ugc_season?: {
      sections?: Array<{
        episodes?: Array<{
          bvid: string
          cid: number
          title: string
          cover?: string
          pic?: string
          arc?: { pic?: string }
          pages?: Array<{ cid: number; part?: string; duration?: number; page?: number }>
        }>
      }>
    }
  }>(`https://api.bilibili.com/x/web-interface/wbi/view?bvid=${bvid}`, context)
  const thumbnailUrl = data.pic ? normalizeBiliUrl(data.pic) : null
  const seasonPages = (data.ugc_season?.sections ?? []).flatMap((section) =>
    (section.episodes ?? []).flatMap((episode) => {
      const pages = episode.pages?.length
        ? episode.pages
        : [{ cid: episode.cid, part: episode.title, page: 1 }]
      return pages.map((page, index) => ({
        bvid: episode.bvid,
        cid: page.cid,
        title:
          pages.length > 1
            ? `${episode.title} - P${index + 1} ${page.part || ''}`.trim()
            : episode.title,
        duration: page.duration,
        page: page.page ?? index + 1,
        thumbnail: episode.arc?.pic ?? episode.cover ?? episode.pic ?? data.pic
      }))
    })
  )
  if (seasonPages.length) {
    return seasonPages.map((page) => ({
      platform: 'bili' as const,
      resource: {
        sourceId: 'bili',
        resourceType: 'video' as const,
        resourceId: page.bvid,
        subId: String(page.cid)
      },
      id: `${page.bvid}:${page.cid}`,
      title: page.title,
      url: `https://www.bilibili.com/video/${page.bvid}?p=${page.page}`,
      thumbnail: null,
      thumbnailUrl: page.thumbnail ? normalizeBiliUrl(page.thumbnail) : thumbnailUrl,
      duration: page.duration ?? null,
      uploader: data.owner?.name ?? null,
      selected: page.bvid.toLowerCase() === bvid.toLowerCase() && page.page === requestedPage
    }))
  }
  const pages = data.pages?.length
    ? data.pages
    : [{ cid: data.cid, part: data.title, duration: data.duration }]
  return pages.map((page, index) => ({
    platform: 'bili' as const,
    resource: {
      sourceId: 'bili',
      resourceType: 'video' as const,
      resourceId: data.bvid,
      subId: String(page.cid)
    },
    id: `${data.bvid}:${page.cid}`,
    title:
      pages.length > 1 ? `${data.title} - P${index + 1} ${page.part || ''}`.trim() : data.title,
    url: `https://www.bilibili.com/video/${data.bvid}?p=${page.page ?? index + 1}`,
    thumbnail: null,
    thumbnailUrl,
    duration: page.duration ?? data.duration ?? null,
    uploader: data.owner?.name ?? null,
    selected: (page.page ?? index + 1) === requestedPage
  }))
}

async function extractItems(
  target: string,
  platform: DownloadPlatform,
  context?: SourceCallContext
): Promise<DownloadSearchItem[]> {
  context?.signal.throwIfAborted()
  if (platform === 'bili') return extractBiliItems(target, target.startsWith('bilisearch'), context)
  const media = context?.host?.media
  if (!media) throw new SourceCallError('UNSUPPORTED_CAPABILITY', 'youtube')
  const searchQuery = target.match(/^ytsearch(\d+):(.*)$/s)
  const parsed = await media.extractInfo(
    searchQuery
      ? { type: 'search', query: searchQuery[2], limit: Number(searchQuery[1]) }
      : { type: 'url', url: target },
    context
  )
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [parsed]
  return entries
    .map((entry) => toSearchItem(entry as Record<string, unknown>, platform))
    .filter((item): item is DownloadSearchItem => !!item)
}

async function resolveBiliDownload(
  request: MediaDownloadQuery,
  context?: SourceCallContext
): Promise<HttpMediaDownloadPlan> {
  const bvid = biliBvid(request.url)
  if (!bvid) throw new SourceCallError('INVALID_REQUEST', 'bili')
  const view = await biliApi<{
    cid: number
    pic?: string
    pages?: Array<{ cid: number; page?: number }>
  }>(`https://api.bilibili.com/x/web-interface/wbi/view?bvid=${bvid}`, context)
  const pageNumber = Number(new URL(request.url).searchParams.get('p') || '1')
  const cid = view.pages?.find((page) => page.page === pageNumber)?.cid ?? view.cid
  const play = await biliApi<{
    durl?: Array<{ url?: string }>
    dash?: { audio?: Array<{ baseUrl?: string; base_url?: string; bandwidth?: number }> }
  }>(
    `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=${request.downloadType === 'video' ? '16' : '4048'}&fnver=0&fourk=0`,
    context
  )
  const source =
    request.downloadType === 'video'
      ? play.durl?.[0]?.url
      : ([...(play.dash?.audio ?? [])].sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0]
          ?.baseUrl ??
        [...(play.dash?.audio ?? [])].sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0]
          ?.base_url)
  if (!source) throw new SourceCallError('RESOURCE_NOT_FOUND', 'bili')

  return {
    transport: 'http',
    resource: { sourceId: 'bili', resourceType: 'video', resourceId: bvid, subId: String(cid) },
    url: source,
    headers: { ...BILI_HEADERS, Range: 'bytes=0-' },
    extension: request.downloadType === 'video' ? 'mp4' : 'm4a',
    artwork: view.pic ? { url: normalizeBiliUrl(view.pic), headers: BILI_HEADERS } : undefined,
    finalizeAudio: request.downloadType === 'audio'
  }
}

const hostMatches = (hostname: string, domain: string): boolean =>
  hostname === domain || hostname.endsWith('.' + domain)

export const biliSource: NetworkSource = {
  id: 'bili',
  displayName: 'Bilibili',
  apiVersion: 1,
  download: {
    matchesUrl: (url) => hostMatches(url.hostname, 'bilibili.com'),
    search: (query, context) => extractItems('bilisearch12:' + query, 'bili', context),
    parse: (url, context) => extractItems(url, 'bili', context),
    resolve: resolveBiliDownload
  }
}
export const youtubeSource: NetworkSource = {
  id: 'youtube',
  displayName: 'YouTube',
  apiVersion: 1,
  download: {
    matchesUrl: (url) =>
      hostMatches(url.hostname, 'youtube.com') ||
      hostMatches(url.hostname, 'youtu.be') ||
      hostMatches(url.hostname, 'youtube-nocookie.com'),
    search: (query, context) => extractItems('ytsearch12:' + query, 'youtube', context),
    parse: (url, context) => extractItems(url, 'youtube', context),
    resolve: async (request) => ({
      transport: 'yt-dlp',
      resource: { sourceId: 'youtube', resourceType: 'video', resourceId: request.resourceId },
      url: request.url,
      downloadType: request.downloadType,
      quality: request.quality
    })
  }
}
