import { searchQQMusicArtistArtwork } from './artistArtwork'
import { defineSourcePlugin } from '@easy-player/plugin-sdk'
import { officialPluginAuthor } from '../../shared/officialPluginAuthor'
import { searchQQMusicTracks, getQQMusicTrack, searchQQMusicArtwork } from './metadata'
import { searchQQMusicLyrics, getQQMusicLyrics } from './lyrics'

export const qqmusicPlugin = defineSourcePlugin(
  {
    id: 'qqmusic',
    displayName: 'QQ Music',
    capabilities: ['lyrics', 'artwork', 'artistArtwork', 'metadata']
  },
  () => ({
    id: 'qqmusic',
    displayName: 'QQ Music',
    apiVersion: 1,
    lyrics: { search: searchQQMusicLyrics, get: getQQMusicLyrics },
    metadata: { search: searchQQMusicTracks, get: getQQMusicTrack },
    artistArtwork: { search: searchQQMusicArtistArtwork },
    artwork: { search: searchQQMusicArtwork }
  }),
  '1.2.0',
  officialPluginAuthor
)
