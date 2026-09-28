/**
 * Which embed-registry services have a bundled brand mark (brand-marks.ts),
 * and under which Simple Icons slug. Kept apart from the path data so callers
 * can decide synchronously without loading every mark.
 */

// Registry service key -> Simple Icons slug.
const SERVICE_MARKS: Record<string, string> = {
  airtable: 'airtable',
  applemusic: 'applemusic',
  applepodcasts: 'applepodcasts',
  arcgisstorymaps: 'arcgis',
  audioboom: 'audioboom',
  audiomack: 'audiomack',
  beatport: 'beatport',
  behance: 'behance',
  bilibili: 'bilibili',
  calendly: 'calendly',
  castbox: 'castbox',
  chromatic: 'chromatic',
  codesandbox: 'codesandbox',
  dailymotion: 'dailymotion',
  deezer: 'deezer',
  douyin: 'tiktok',
  drawio: 'diagramsdotnet',
  excalidraw: 'excalidraw',
  facebookpost: 'facebook',
  facebookvideo: 'facebook',
  figma: 'figma',
  giphy: 'giphy',
  googledocs: 'googledocs',
  googledocspublished: 'googledocs',
  googledrive: 'googledrive',
  googledrivefolder: 'googledrive',
  googleforms: 'googleforms',
  googlesheets: 'googlesheets',
  googleslides: 'googleslides',
  hearthis: 'hearthisdotat',
  iheart: 'iheartradio',
  instagram: 'instagram',
  internetarchive: 'internetarchive',
  jsfiddle: 'jsfiddle',
  kahoot: 'kahoot',
  kick: 'kick',
  loom: 'loom',
  mailru: 'maildotru',
  mastodon: 'mastodon',
  miro: 'miro',
  mixcloud: 'mixcloud',
  navertv: 'naver',
  netease: 'neteasecloudmusic',
  niconico: 'niconico',
  observable: 'observable',
  odysee: 'odysee',
  okru: 'odnoklassniki',
  openstreetmap: 'openstreetmap',
  p5js: 'p5dotjs',
  pinterest: 'pinterest',
  pocketcasts: 'pocketcasts',
  reddit: 'reddit',
  scratch: 'scratch',
  sketchfab: 'sketchfab',
  snapchat: 'snapchat',
  soundcloud: 'soundcloud',
  spotify: 'spotify',
  spotifypodcasters: 'spotify',
  spreaker: 'spreaker',
  stackblitz: 'stackblitz',
  substack: 'substack',
  suno: 'suno',
  ted: 'ted',
  telegram: 'telegram',
  threads: 'threads',
  tidal: 'tidal',
  tiktok: 'tiktok',
  tldraw: 'tldraw',
  twitter: 'x',
  typeform: 'typeform',
  vimeo: 'vimeo',
  vimeoevent: 'vimeo',
  vimeoshowcase: 'vimeo',
  vkvideo: 'vk',
  wistia: 'wistia',
  wolframcloud: 'wolfram',
  youtube: 'youtube',
  youtubeplaylist: 'youtube',
};

/** Registry services that have a bundled mark. */
export const BRAND_MARK_SERVICES: readonly string[] = Object.keys(SERVICE_MARKS);

/** The Simple Icons slug for a registry service's bundled mark, or null. */
export const brandMarkSlug = (service: string): string | null => SERVICE_MARKS[service] ?? null;

/**
 * An icon element for a service: shows `fallback` at once and swaps in the
 * brand mark when the lazy chunk arrives. Null when the service has no mark.
 */
export function brandMarkElement(service: string, fallback: string): HTMLElement | null {
  const slug = brandMarkSlug(service);
  if (!slug) return null;
  const slot = document.createElement('span');
  slot.className = 'blok-brand-mark';
  slot.innerHTML = fallback;
  void import('./brand-marks').then(({ brandMarkSvg }) => {
    const svg = brandMarkSvg(slug);
    if (svg) slot.innerHTML = svg;
  });
  return slot;
}
