import { defineSourcePlugin } from '@easy-player/plugin-sdk'
import { biliSource, youtubeSource } from './media/adapter'

export const biliPlugin = defineSourcePlugin(
  {
    id: 'bili',
    displayName: 'Bilibili',
    capabilities: ['download'],
    downloadDomains: ['bilibili.com']
  },
  () => biliSource,
  '1.1.0'
)
export const youtubePlugin = defineSourcePlugin(
  {
    id: 'youtube',
    displayName: 'YouTube',
    capabilities: ['download'],
    downloadDomains: ['youtube.com', 'youtu.be', 'youtube-nocookie.com']
  },
  () => youtubeSource,
  '1.1.0'
)
