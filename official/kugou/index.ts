import { searchKugouArtistArtwork } from './artistArtwork'
import { defineSourcePlugin } from '@easy-player/plugin-sdk'
import { officialPluginAuthor } from '../../shared/officialPluginAuthor'
import { searchKugouTracks, getKugouTrack, searchKugouArtwork } from './metadata'
import { searchKugouLyrics, getKugouLyrics } from './lyrics'

export const kugouPlugin = defineSourcePlugin(
  {
    id: 'kugou',
    displayName: 'KuGou',
    capabilities: ['lyrics', 'artwork', 'artistArtwork', 'metadata']
  },
  () => ({
    id: 'kugou',
    displayName: 'KuGou',
    apiVersion: 1,
    lyrics: { search: searchKugouLyrics, get: getKugouLyrics },
    metadata: { search: searchKugouTracks, get: getKugouTrack },
    artistArtwork: { search: searchKugouArtistArtwork },
    artwork: { search: searchKugouArtwork }
  }),
  '1.2.0',
  officialPluginAuthor
)
