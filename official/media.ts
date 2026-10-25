import { defineSourcePlugin } from '@easy-player/plugin-sdk'
import { officialPluginAuthor } from '../shared/officialPluginAuthor'
import { biliSource, youtubeSource } from './media/adapter'

export const biliPlugin = defineSourcePlugin(
  {
    id: 'bili',
    displayName: 'Bilibili',
    capabilities: ['download'],
    downloadDomains: ['bilibili.com']
  },
  () => biliSource,
  '1.1.1',
  officialPluginAuthor
)
export const youtubePlugin = defineSourcePlugin(
  {
    id: 'youtube',
    displayName: 'YouTube',
    capabilities: ['download'],
    downloadDomains: ['youtube.com', 'youtu.be', 'youtube-nocookie.com']
  },
  () => youtubeSource,
  '1.1.1',
  officialPluginAuthor
)
