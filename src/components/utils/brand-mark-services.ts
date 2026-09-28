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
  buzzsprout: 'buzzsprout',
  calendly: 'calendly',
  castbox: 'castbox',
  chromatic: 'chromatic',
  codepen: 'codepen',
  codesandbox: 'codesandbox',
  dailymotion: 'dailymotion',
  deezer: 'deezer',
  douyin: 'tiktok',
  drawio: 'diagramsdotnet',
  excalidraw: 'excalidraw',
  facebookpost: 'facebook',
  facebookvideo: 'facebook',
  figma: 'figma',
  genially: 'genially',
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
  jotform: 'jotform',
  jsfiddle: 'jsfiddle',
  kahoot: 'kahoot',
  kick: 'kick',
  linkedin: 'linkedin',
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
  rutube: 'rutube',
  scratch: 'scratch',
  sketchfab: 'sketchfab',
  snapchat: 'snapchat',
  soop: 'soop',
  soundcloud: 'soundcloud',
  spotify: 'spotify',
  spotifypodcasters: 'spotify',
  spreaker: 'spreaker',
  stackblitz: 'stackblitz',
  substack: 'substack',
  suno: 'suno',
  tally: 'tally',
  ted: 'ted',
  telegram: 'telegram',
  threads: 'threads',
  tidal: 'tidal',
  tiktok: 'tiktok',
  tldraw: 'tldraw',
  transistor: 'transistor',
  tunein: 'tunein',
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

// Site address -> Simple Icons slug, for links that are not embeddable (a
// bare "youtube.com/"). Hosts come from the registry regexes. A key may carry
// one path segment when products share a host (docs.google.com). Never add a
// shared parent (google.com, apple.com, mit.edu, 163.com): every subdomain
// would get one product's mark.
const HOST_MARKS: Record<string, string> = {
  'airtable.com': 'airtable',
  'music.apple.com': 'applemusic',
  'podcasts.apple.com': 'applepodcasts',
  'arcgis.com': 'arcgis',
  'audioboom.com': 'audioboom',
  'audiomack.com': 'audiomack',
  'beatport.com': 'beatport',
  'behance.net': 'behance',
  'bilibili.com': 'bilibili',
  'b23.tv': 'bilibili',
  'buzzsprout.com': 'buzzsprout',
  'calendly.com': 'calendly',
  'castbox.fm': 'castbox',
  'chromatic.com': 'chromatic',
  'codepen.io': 'codepen',
  'codesandbox.io': 'codesandbox',
  'dailymotion.com': 'dailymotion',
  'dai.ly': 'dailymotion',
  'deezer.com': 'deezer',
  'douyin.com': 'tiktok',
  'diagrams.net': 'diagramsdotnet',
  'draw.io': 'diagramsdotnet',
  'excalidraw.com': 'excalidraw',
  'facebook.com': 'facebook',
  'figma.com': 'figma',
  'genially.com': 'genially',
  'genial.ly': 'genially',
  'giphy.com': 'giphy',
  'docs.google.com': 'googledocs',
  'docs.google.com/document': 'googledocs',
  'docs.google.com/forms': 'googleforms',
  'docs.google.com/spreadsheets': 'googlesheets',
  'docs.google.com/presentation': 'googleslides',
  'drive.google.com': 'googledrive',
  'hearthis.at': 'hearthisdotat',
  'iheart.com': 'iheartradio',
  'instagram.com': 'instagram',
  'instagr.am': 'instagram',
  'archive.org': 'internetarchive',
  'jotform.com': 'jotform',
  'jsfiddle.net': 'jsfiddle',
  'kahoot.it': 'kahoot',
  'kick.com': 'kick',
  'linkedin.com': 'linkedin',
  'loom.com': 'loom',
  'mail.ru': 'maildotru',
  'mastodon.social': 'mastodon',
  'mastodon.online': 'mastodon',
  'mstdn.social': 'mastodon',
  'hachyderm.io': 'mastodon',
  'fosstodon.org': 'mastodon',
  'infosec.exchange': 'mastodon',
  'mas.to': 'mastodon',
  'mastodon.world': 'mastodon',
  'techhub.social': 'mastodon',
  'miro.com': 'miro',
  'mixcloud.com': 'mixcloud',
  'naver.com': 'naver',
  'music.163.com': 'neteasecloudmusic',
  'nicovideo.jp': 'niconico',
  'nico.ms': 'niconico',
  'observablehq.com': 'observable',
  'odysee.com': 'odysee',
  'ok.ru': 'odnoklassniki',
  'odnoklassniki.ru': 'odnoklassniki',
  'openstreetmap.org': 'openstreetmap',
  'p5js.org': 'p5dotjs',
  'pinterest.com': 'pinterest',
  'pca.st': 'pocketcasts',
  'reddit.com': 'reddit',
  'rutube.ru': 'rutube',
  'scratch.mit.edu': 'scratch',
  'sketchfab.com': 'sketchfab',
  'snapchat.com': 'snapchat',
  'sooplive.co.kr': 'soop',
  'sooplive.com': 'soop',
  'afreecatv.com': 'soop',
  'soundcloud.com': 'soundcloud',
  'spotify.com': 'spotify',
  'anchor.fm': 'spotify',
  'spreaker.com': 'spreaker',
  'stackblitz.com': 'stackblitz',
  'substack.com': 'substack',
  'suno.com': 'suno',
  'tally.so': 'tally',
  'ted.com': 'ted',
  't.me': 'telegram',
  'telegram.me': 'telegram',
  'telegram.dog': 'telegram',
  'threads.com': 'threads',
  'threads.net': 'threads',
  'tidal.com': 'tidal',
  'tiktok.com': 'tiktok',
  'tldraw.com': 'tldraw',
  'transistor.fm': 'transistor',
  'tunein.com': 'tunein',
  'twitter.com': 'x',
  'x.com': 'x',
  'typeform.com': 'typeform',
  'vimeo.com': 'vimeo',
  'vk.com': 'vk',
  'vk.ru': 'vk',
  'vkvideo.ru': 'vk',
  'wistia.com': 'wistia',
  'wistia.net': 'wistia',
  'wolframcloud.com': 'wolfram',
  'youtube.com': 'youtube',
  'youtube-nocookie.com': 'youtube',
  'youtu.be': 'youtube',
};

/** Every slug a site address can name. */
export const BRAND_MARK_HOST_SLUGS: readonly string[] = [...new Set(Object.values(HOST_MARKS))];

/**
 * The Simple Icons slug for a site address: its host or any parent of it,
 * tried with the first path segment before without. Null for other sites.
 */
export function brandMarkSlugForUrl(url: URL): string | null {
  const segment = url.pathname.split('/')[1] ?? '';
  const labels = url.hostname.toLowerCase().split('.');
  const hosts = labels.slice(0, -1).map((_, i) => labels.slice(i).join('.'));
  const slugs = hosts.map((host) => (segment ? HOST_MARKS[`${host}/${segment}`] : undefined) ?? HOST_MARKS[host]);
  return slugs.find((slug) => slug !== undefined) ?? null;
}

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
