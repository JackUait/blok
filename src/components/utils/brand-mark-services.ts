/**
 * Which embed-registry services have a bundled brand mark (brand-marks.ts),
 * and under which Simple Icons slug. Kept apart from the path data so the
 * Link field can decide logo vs. site icon without loading every mark.
 */
// Registry service key -> Simple Icons slug.
const SERVICE_MARKS: Record<string, string> = {
  applemusic: 'applemusic',
  applepodcasts: 'applepodcasts',
  audioboom: 'audioboom',
  audiomack: 'audiomack',
  beatport: 'beatport',
  bilibili: 'bilibili',
  castbox: 'castbox',
  dailymotion: 'dailymotion',
  deezer: 'deezer',
  douyin: 'tiktok',
  facebookvideo: 'facebook',
  giphy: 'giphy',
  iheart: 'iheartradio',
  internetarchive: 'internetarchive',
  kick: 'kick',
  loom: 'loom',
  mailru: 'maildotru',
  mixcloud: 'mixcloud',
  navertv: 'naver',
  netease: 'neteasecloudmusic',
  niconico: 'niconico',
  odysee: 'odysee',
  okru: 'odnoklassniki',
  pocketcasts: 'pocketcasts',
  soundcloud: 'soundcloud',
  spotify: 'spotify',
  spotifypodcasters: 'spotify',
  spreaker: 'spreaker',
  suno: 'suno',
  ted: 'ted',
  tidal: 'tidal',
  tiktok: 'tiktok',
  vimeo: 'vimeo',
  vimeoevent: 'vimeo',
  vimeoshowcase: 'vimeo',
  vkvideo: 'vk',
  wistia: 'wistia',
  youtube: 'youtube',
  youtubeplaylist: 'youtube',
};


/** The Simple Icons slug for a registry service's bundled mark, or null. */
export const brandMarkSlug = (service: string): string | null => SERVICE_MARKS[service] ?? null;
