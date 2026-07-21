/**
 * Embed provider registry for the link/embed tools.
 *
 * Shape mirrors @editorjs/embed: each service has a `regex` that claims a URL,
 * an `embedUrl` template (with a `<%= remote_id %>` placeholder), and an optional
 * `id(groups)` that derives the remote id from the regex capture groups.
 *
 * Every regex is anchored to the start of the pasted text (host lookalikes and
 * URLs nested inside foreign URLs must not match) and consumes trailing query
 * params with `\S*`, because the paste pipeline only claims a pattern when the
 * match covers the entire pasted text (see PasteToolRegistry.findToolForPattern).
 */
import type { SupportedLocale } from '../../../types/configs/i18n-config';

export type EmbedKind = 'iframe' | 'script';

/**
 * Link-type category of a provider's content. Drives which icon the paste UI
 * shows next to the provider name.
 */
export type EmbedServiceType =
  | 'video'
  | 'audio'
  | 'image'
  | 'social'
  | 'document'
  | 'table'
  | 'form'
  | 'code'
  | 'design'
  | 'chart'
  | 'map'
  | 'calendar';

export interface EmbedService {
  /** Official, consumer-facing provider name (e.g. "YouTube") shown in the paste UI. */
  title: string;
  /** Sparse official localized provider names used only for display. */
  localizedTitles?: Readonly<Partial<Record<SupportedLocale, string>>>;
  /** Link-type category of the provider's content. */
  type: EmbedServiceType;
  /** Claims a pasted URL and captures the remote id parts. */
  regex: RegExp;
  /** Embed URL template; `<%= remote_id %>` is replaced with the remote id. */
  embedUrl: string;
  /** Rendering kind. Defaults to 'iframe'; 'script' providers inject a widget script. */
  kind?: EmbedKind;
  /** Default iframe width. */
  width?: number;
  /** Default iframe height. */
  height?: number;
  /**
   * Smallest usable rendered width in pixels. The resize handles refuse to
   * shrink the embed below this (converted to a percent of the live container),
   * so a provider's player/canvas never collapses past the point where its
   * controls or content become unusable. Omit for script-rendered providers,
   * which are not iframe-resizable.
   */
  minWidth?: number;
  /** Derives the remote id from regex capture groups (defaults to the first group). */
  id?: (groups: Array<string | undefined>) => string;
  /**
   * Provider page renders its content at a fixed natural width instead of
   * scaling with the iframe (e.g. TikTok's card). The embed figure is capped
   * at `width` px so resize handles and the block toolbar hug the visible
   * content rather than an oversized empty frame.
   */
  fixedWidth?: boolean;
  /**
   * Provider frames a scrollable document (Google Docs/Sheets/Drive…) rather
   * than fixed-proportion media, so the embed height is user-adjustable: the
   * figure renders at a fixed pixel height (`height`, or the user's saved
   * value) instead of an aspect-ratio box, and gets a bottom resize handle.
   */
  resizableHeight?: boolean;
}

export interface EmbedMatch {
  service: string;
  remoteId: string;
  embedUrl: string;
  kind: EmbedKind;
  /** Display name of the matched provider (e.g. "YouTube"). */
  title: string;
  /** Link-type category of the matched provider. */
  type: EmbedServiceType;
}

/**
 * Resolves a provider's official display name for a locale while preserving the
 * canonical registry title as the fallback.
 */
export function resolveEmbedServiceTitle(
  service: Pick<EmbedService, 'title' | 'localizedTitles'>,
  locale?: SupportedLocale
): string {
  return locale === undefined
    ? service.title
    : service.localizedTitles?.[locale] ?? service.title;
}

const REMOTE_ID_TEMPLATE = /<%=\s*remote_id\s*%>/;
const GOOGLE_DRIVE_LOCALIZED_TITLES = { ja: 'Google ドライブ' } as const;
const GOOGLE_DOCS_LOCALIZED_TITLES = { ja: 'Google ドキュメント' } as const;

/**
 * Parses a YouTube `t=`/`start=` value from a URL tail into whole seconds.
 * Supports plain seconds (43), `43s`, and composite `1h5m20s` forms.
 */
function parseYoutubeStart(tail: string): number | null {
  const raw = /[?&](?:t|start)=([0-9hms]+)/.exec(tail)?.[1];

  if (raw === undefined) {
    return null;
  }

  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }

  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);

  if (!parts || (parts[1] === undefined && parts[2] === undefined && parts[3] === undefined)) {
    return null;
  }

  return Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0);
}

export const EMBED_SERVICES: Record<string, EmbedService> = {
  youtube: {
    title: 'YouTube',
    type: 'video',
    regex: /^(?:https?:\/\/)?(?:(?:www|m|music)\.)?(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]+)(\S*)/,
    embedUrl: 'https://www.youtube.com/embed/<%= remote_id %>',
    id: (groups) => {
      const start = parseYoutubeStart(groups[1] ?? '');

      return start !== null && start > 0 ? `${groups[0]}?start=${start}` : groups[0] ?? '';
    },
    width: 580,
    minWidth: 200,
    height: 320,
  },
  youtubeplaylist: {
    title: 'YouTube',
    type: 'video',
    regex: /^(?:https?:\/\/)?(?:(?:www|m|music)\.)?youtube\.com\/playlist\?(?:.*&)?list=([\w-]+)\S*/,
    embedUrl: 'https://www.youtube.com/embed/videoseries?list=<%= remote_id %>',
    width: 580,
    minWidth: 200,
    height: 320,
  },
  vimeo: {
    title: 'Vimeo',
    type: 'video',
    regex: /^(?:https?:\/\/)?(?:www\.)?(?:player\.)?vimeo\.com\/(?:(?:groups\/[\w-]+\/videos|album\/\d+\/video|showcase\/\d+\/video|video)\/)?(\d+)(?:\/([0-9a-f]+))?\S*/,
    embedUrl: 'https://player.vimeo.com/video/<%= remote_id %>',
    id: (groups) => (groups[1] !== undefined ? `${groups[0]}?h=${groups[1]}` : groups[0] ?? ''),
    width: 580,
    minWidth: 300,
    height: 320,
  },
  vimeoshowcase: {
    title: 'Vimeo',
    type: 'video',
    regex: /^(?:https?:\/\/)?(?:www\.)?vimeo\.com\/showcase\/(\d+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://vimeo.com/showcase/<%= remote_id %>/embed',
    width: 580,
    minWidth: 300,
    height: 320,
  },
  vimeoevent: {
    title: 'Vimeo',
    type: 'video',
    regex: /^(?:https?:\/\/)?(?:www\.)?vimeo\.com\/event\/(\d+)\S*/,
    embedUrl: 'https://vimeo.com/event/<%= remote_id %>/embed',
    width: 580,
    minWidth: 300,
    height: 320,
  },
  rutube: {
    title: 'RUTUBE',
    type: 'video',
    // Rutube ids are 32-char hex hashes; the length guard keeps listing pages
    // (/video/category/..., /video/person/...) from being claimed.
    regex: /^(?:https?:\/\/)?(?:www\.)?rutube\.ru\/(?:video\/private\/|(?:video|shorts|play\/embed)\/|live\/video\/)([0-9a-f]{32})\/?(?:\?(?:.*&)?p=([\w-]+))?\S*/,
    embedUrl: 'https://rutube.ru/play/embed/<%= remote_id %>',
    id: (groups) => (groups[1] !== undefined ? `${groups[0]}/?p=${groups[1]}` : groups[0] ?? ''),
    width: 580,
    minWidth: 280,
    height: 320,
  },
  vkvideo: {
    title: 'VK Video',
    type: 'video',
    // NOTE: VK normally also needs a `hash` param that is not derivable from the
    // pasted URL (it IS kept when a video_ext.php iframe src is pasted directly).
    // Public videos usually render without it.
    regex: /^(?:https?:\/\/)?(?:[\w-]+\.)*(?:vk\.(?:com|ru)|vkvideo\.ru)\/(?:(?:video|clip)(-?\d+)_(\d+)\S*|video_ext\.php\?(\S+)|\S*?[?&]z=(?:video|clip)(-?\d+)_(\d+)\S*)/,
    embedUrl: 'https://vk.com/video_ext.php?oid=<%= remote_id %>',
    id: (groups) => {
      if (groups[2] !== undefined) {
        const params = new URLSearchParams(groups[2]);
        const hash = params.get('hash');

        return `${params.get('oid') ?? ''}&id=${params.get('id') ?? ''}${hash !== null ? `&hash=${hash}` : ''}`;
      }

      return `${groups[0] ?? groups[3] ?? ''}&id=${groups[1] ?? groups[4] ?? ''}`;
    },
    width: 580,
    minWidth: 280,
    height: 320,
  },
  codepen: {
    title: 'CodePen',
    type: 'code',
    regex: /^(?:https?:\/\/)?(?:www\.)?codepen\.io\/((?:team\/|editor\/)?[\w-]+)\/(?:pen|full|details|debug)\/([\w-]+)(?:\/([0-9a-f]+))?\S*/,
    embedUrl: 'https://codepen.io/<%= remote_id %>?default-tab=result',
    id: (groups) => `${groups[0]}/embed/${groups[1]}${groups[2] !== undefined ? `/${groups[2]}` : ''}`,
    width: 580,
    minWidth: 480,
    height: 320,
  },
  loom: {
    title: 'Loom',
    type: 'video',
    // Loom video ids are 32-char hex; folder links (loom.com/share/folder/...)
    // are not embeddable and must fall through to the bookmark tool.
    regex: /^(?:https?:\/\/)?(?:www\.)?loom\.com\/(?:share|embed)\/([0-9a-f]{32})\S*/,
    embedUrl: 'https://www.loom.com/embed/<%= remote_id %>',
    width: 580,
    minWidth: 280,
    height: 320,
  },
  figma: {
    title: 'Figma',
    type: 'design',
    regex: /^(?:https?:\/\/)?(?:www\.)?figma\.com\/(design|board|proto|file|slides|deck)\/([^/?#]+)\S*/,
    embedUrl: 'https://embed.figma.com/<%= remote_id %>?embed-host=blok',
    id: (groups) => `${groups[0]}/${groups[1]}`,
    width: 580,
    minWidth: 400,
    height: 400,
  },
  spotify: {
    title: 'Spotify',
    type: 'audio',
    regex: /^(?:https?:\/\/)?open\.spotify\.com\/(?:intl-[\w-]+\/)?(?:embed\/)?(track|album|playlist|episode|show|artist)\/([^/?#]+)\S*/,
    embedUrl: 'https://open.spotify.com/embed/<%= remote_id %>',
    id: (groups) => `${groups[0]}/${groups[1]}`,
    width: 580,
    minWidth: 250,
    height: 152,
  },
  googledrive: {
    title: 'Google Drive',
    localizedTitles: GOOGLE_DRIVE_LOCALIZED_TITLES,
    type: 'document',
    regex: /^(?:https?:\/\/)?drive\.google\.com\/(?:file\/(?:u\/\d+\/)?d\/([\w-]+)|open\?(?:.*&)?id=([\w-]+))\S*/,
    embedUrl: 'https://drive.google.com/file/d/<%= remote_id %>/preview',
    id: (groups) => groups[0] ?? groups[1] ?? '',
    width: 580,
    minWidth: 320,
    height: 480,
    resizableHeight: true,
  },
  googledrivefolder: {
    title: 'Google Drive',
    localizedTitles: GOOGLE_DRIVE_LOCALIZED_TITLES,
    type: 'document',
    regex: /^(?:https?:\/\/)?drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)\S*/,
    embedUrl: 'https://drive.google.com/embeddedfolderview?id=<%= remote_id %>#list',
    width: 580,
    minWidth: 320,
    height: 480,
    resizableHeight: true,
  },
  googledocspublished: {
    title: 'Google Docs',
    localizedTitles: GOOGLE_DOCS_LOCALIZED_TITLES,
    type: 'document',
    // "Publish to the web" links carry a 2PACX token under d/e/ that is not a
    // document id: /preview 404s for them, Google's own embed code is /pub?embedded=true.
    regex: /^(?:https?:\/\/)?docs\.google\.com\/document\/(?:u\/\d+\/)?d\/e\/([\w-]+)\S*/,
    embedUrl: 'https://docs.google.com/document/d/e/<%= remote_id %>/pub?embedded=true',
    width: 580,
    minWidth: 320,
    height: 480,
    resizableHeight: true,
  },
  googledocs: {
    title: 'Google Docs',
    localizedTitles: GOOGLE_DOCS_LOCALIZED_TITLES,
    type: 'document',
    // (?!e\/) keeps published d/e/ links out of this entry regardless of registry order.
    regex: /^(?:https?:\/\/)?docs\.google\.com\/document\/(?:u\/\d+\/)?d\/(?!e\/)([\w-]+)\S*/,
    embedUrl: 'https://docs.google.com/document/d/<%= remote_id %>/preview',
    width: 580,
    minWidth: 320,
    height: 480,
    resizableHeight: true,
  },
  googlesheets: {
    title: 'Google Sheets',
    localizedTitles: { ja: 'Google スプレッドシート' },
    type: 'table',
    // Branch 1 claims published d/e/<2PACX token> links (embedded via Google's own
    // pubhtml?widget=true&headers=false endpoint), branch 2 normal d/<fileId> links.
    regex: /^(?:https?:\/\/)?docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/(?:e\/([\w-]+)|([\w-]+))\S*/,
    embedUrl: 'https://docs.google.com/spreadsheets/d/<%= remote_id %>',
    id: (groups) =>
      groups[0] !== undefined
        ? `e/${groups[0]}/pubhtml?widget=true&headers=false`
        : `${groups[1]}/preview`,
    width: 580,
    minWidth: 400,
    height: 480,
    resizableHeight: true,
  },
  googleslides: {
    title: 'Google Slides',
    localizedTitles: { ja: 'Google スライド' },
    type: 'document',
    // Published links keep the literal e/ segment inside the id, so the same
    // /embed template serves both d/<id> and d/e/<2PACX token> URLs.
    regex: /^(?:https?:\/\/)?docs\.google\.com\/presentation\/(?:u\/\d+\/)?d\/((?:e\/)?[\w-]+)\S*/,
    embedUrl: 'https://docs.google.com/presentation/d/<%= remote_id %>/embed?start=false&loop=false&delayms=3000',
    width: 580,
    minWidth: 480,
    height: 480,
    resizableHeight: true,
  },
  googleforms: {
    title: 'Google Forms',
    localizedTitles: { ja: 'Google フォーム' },
    type: 'form',
    // Legacy d/<editId>/viewform links work because Google 301s them to the
    // canonical d/e/ embed URL with the query string preserved.
    regex: /^(?:https?:\/\/)?docs\.google\.com\/forms\/(?:u\/\d+\/)?d\/((?:e\/)?[\w-]+)\/viewform\S*/,
    embedUrl: 'https://docs.google.com/forms/d/<%= remote_id %>/viewform?embedded=true',
    width: 580,
    minWidth: 400,
    height: 480,
    resizableHeight: true,
  },
  drawio: {
    title: 'draw.io',
    type: 'design',
    // Frameable only on viewer.diagrams.net (app.diagrams.net sends frame-ancestors),
    // so every variant is normalized onto the viewer host. #G drive refs are rewritten
    // to the same #U published-link form draw.io itself generates (file must be
    // link-shared). #H (GitHub) / #W (OneDrive) refs are auth-bound and excluded.
    // Note: #R inline-XML links over 450 chars never reach the registry (paste cap).
    regex: /^(?:https?:\/\/)?(?:(?:viewer|app)\.diagrams\.net|(?:www\.)?draw\.io)\/(\?[^#\s]*)?#(?:([UR])(\S+)|G([\w-]+)\S*)/,
    embedUrl: 'https://viewer.diagrams.net/<%= remote_id %>',
    id: (groups) => {
      const [query, urType, urPayload, driveId] = groups;

      if (driveId !== undefined) {
        return `?tags=%7B%7D&lightbox=1&highlight=0000ff&layers=1&nav=1#Uhttps%3A%2F%2Fdrive.google.com%2Fuc%3Fid%3D${driveId}%26export%3Ddownload`;
      }

      return `${query ?? '?lightbox=1&nav=1'}#${urType}${urPayload}`;
    },
    width: 580,
    minWidth: 350,
    height: 480,
  },
  bilibili: {
    title: 'bilibili',
    type: 'video',
    // BV ids are base58 (no 0/O/I/l); legacy av ids are numeric. Opaque b23.tv
    // shortcodes resolve only via redirect and are excluded; literal-id b23.tv
    // links carry the id in the path and are claimed. Player autoplays by
    // default, so autoplay=0 is forced into the query.
    regex: /^(?:https?:\/\/)?(?:(?:(?:www|m)\.)?bilibili\.com\/video|b23\.tv)\/(?:(BV[1-9A-HJ-NP-Za-km-z]{10})|av(\d+))\/?\S*/,
    embedUrl: 'https://player.bilibili.com/player.html?<%= remote_id %>',
    id: (groups) => (groups[0] !== undefined ? `bvid=${groups[0]}&autoplay=0` : `aid=${groups[1]}&autoplay=0`),
    width: 580,
    minWidth: 300,
    height: 320,
  },
  niconico: {
    title: 'niconico',
    type: 'video',
    // Ids keep their sm/nm/so prefix; nico.ms short links carry the id in the
    // path. so (official channel) videos may refuse embedding per-publisher.
    regex: /^(?:https?:\/\/)?(?:(?:www|sp)\.nicovideo\.jp\/watch|nico\.ms)\/((?:sm|nm|so)\d+)\S*/,
    embedUrl: 'https://embed.nicovideo.jp/watch/<%= remote_id %>',
    width: 580,
    minWidth: 280,
    height: 320,
  },
  youku: {
    title: 'Youku',
    type: 'video',
    // Ids are base64-ish (may end in = padding, sometimes %3D-encoded when
    // copied). Playback of many videos is mainland-China-only at stream level.
    regex: /^(?:https?:\/\/)?(?:v|m)\.youku\.com\/(?:v_show|video|alipay_video)\/id_((?:%3D|[A-Za-z0-9+=])+)\.html?\S*/,
    embedUrl: 'https://player.youku.com/embed/<%= remote_id %>',
    id: (groups) => (groups[0] ?? '').replace(/%3D/g, '='),
    width: 580,
    minWidth: 300,
    height: 320,
  },
  navertv: {
    title: 'Naver TV',
    type: 'video',
    // Param is camelCase autoPlay; the embed host is the same tv.naver.com.
    regex: /^(?:https?:\/\/)?tv\.naver\.com\/(?:v|embed)\/(\d+)\S*/,
    embedUrl: 'https://tv.naver.com/embed/<%= remote_id %>?autoPlay=false',
    width: 580,
    minWidth: 280,
    height: 320,
  },
  kakaotv: {
    title: 'KakaoTV',
    type: 'video',
    // tv.kakao.com itself sends X-Frame-Options: DENY — only the
    // play-tv.kakao.com embed host is frameable.
    regex: /^(?:https?:\/\/)?tv\.kakao\.com\/(?:v|channel\/\d+\/cliplink)\/(\d+)\S*/,
    embedUrl: 'https://play-tv.kakao.com/embed/player/cliplink/<%= remote_id %>?service=player_share',
    width: 580,
    minWidth: 280,
    height: 320,
  },
  dailymotion: {
    title: 'Dailymotion',
    type: 'video',
    // dai.ly short links carry the video id literally in the path.
    regex: /^(?:https?:\/\/)?(?:(?:www\.)?dailymotion\.com\/video|dai\.ly)\/([a-z0-9]+)\S*/,
    embedUrl: 'https://geo.dailymotion.com/player.html?video=<%= remote_id %>',
    width: 580,
    minWidth: 320,
    height: 320,
  },
  okru: {
    title: 'OK.ru',
    type: 'video',
    // m.ok.ru pages send X-Frame-Options: DENY — always rewrite onto the
    // ok.ru/videoembed endpoint. Ids may carry a -N suffix.
    regex: /^(?:https?:\/\/)?(?:(?:www|m|mobile)\.)?(?:ok\.ru|odnoklassniki\.ru)\/(?:video|videoembed|live)\/(\d+(?:-\d+)?)\S*/,
    embedUrl: 'https://ok.ru/videoembed/<%= remote_id %>',
    width: 580,
    minWidth: 280,
    height: 320,
  },
  yandexmusic: {
    title: 'Yandex Music',
    type: 'audio',
    // The iframe widget reverses the share-URL slot order for tracks:
    // /album/<albumId>/track/<trackId> embeds as /iframe/track/<trackId>/<albumId>.
    regex: /^(?:https?:\/\/)?music\.yandex\.(?:ru|com|kz|by|uz)\/(?:album\/(\d+)(?:\/track\/(\d+))?|users\/([\w.-]+)\/playlists\/(\d+))\S*/,
    embedUrl: 'https://music.yandex.ru/iframe/<%= remote_id %>',
    id: (groups) => {
      const [albumId, trackId, login, kind] = groups;

      if (trackId !== undefined) {
        return `track/${trackId}/${albumId}`;
      }

      if (albumId !== undefined) {
        return `album/${albumId}`;
      }

      return `playlist/${login}/${kind}`;
    },
    width: 580,
    minWidth: 280,
    height: 180,
  },
  arte: {
    title: 'ARTE',
    type: 'video',
    // Program ids are NNNNNN-NNN-L; geo-rights vary per program inside the player.
    regex: /^(?:https?:\/\/)?(?:www\.)?arte\.tv\/(fr|de|en|es|pl|it)\/videos\/(\d{6}-\d{3}-[A-Z])\S*/,
    embedUrl: 'https://www.arte.tv/embeds/<%= remote_id %>',
    id: (groups) => `${groups[0]}/${groups[1]}`,
    width: 580,
    minWidth: 280,
    height: 320,
  },
  deezer: {
    title: 'Deezer',
    type: 'audio',
    // link.deezer.com short links are opaque redirects and excluded.
    regex: /^(?:https?:\/\/)?(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?(track|album|playlist|artist|episode)\/(\d+)\S*/,
    embedUrl: 'https://widget.deezer.com/widget/auto/<%= remote_id %>',
    id: (groups) => `${groups[0]}/${groups[1]}`,
    width: 580,
    minWidth: 270,
    height: 300,
  },
  soundcloud: {
    title: 'SoundCloud',
    type: 'audio',
    // The widget takes the whole permalink percent-encoded in ?url=. Profile
    // tab pages (tracks/albums/likes/...) and opaque on.soundcloud.com short
    // links are excluded; the latter resolve only via redirect.
    regex: /^(?:https?:\/\/)?(?:(?:www|m)\.)?soundcloud\.com\/([\w-]+)\/(?!(?:tracks|albums|reposts|likes|followers|following|comments|popular-tracks)(?:[/?#]|$))(sets\/)?([\w-]+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://w.soundcloud.com/player/?url=<%= remote_id %>',
    id: (groups) =>
      encodeURIComponent(`https://soundcloud.com/${groups[0]}/${groups[1] !== undefined ? 'sets/' : ''}${groups[2]}`),
    width: 580,
    minWidth: 300,
    height: 166,
  },
  mixcloud: {
    title: 'Mixcloud',
    type: 'audio',
    // Only shows have widget feeds; playlist pages are excluded.
    regex: /^(?:https?:\/\/)?(?:(?:www|m)\.)?mixcloud\.com\/([\w-]+)\/(?!playlists(?:[/?#]|$))([\w-]+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://www.mixcloud.com/widget/iframe/?feed=<%= remote_id %>&hide_cover=1',
    id: (groups) => encodeURIComponent(`https://www.mixcloud.com/${groups[0]}/${groups[1]}/`),
    width: 580,
    minWidth: 180,
    height: 120,
  },
  applemusic: {
    title: 'Apple Music',
    type: 'audio',
    // Pure host swap onto embed.music.apple.com; ?i= selects a single track
    // inside an album embed and must be preserved.
    regex: /^(?:https?:\/\/)?music\.apple\.com\/([a-z]{2}\/(?:album|playlist|song)\/[^\s/?]+\/(?:pl\.[\w-]+|\d+))(?:\?(\S*))?$/,
    embedUrl: 'https://embed.music.apple.com/<%= remote_id %>',
    id: (groups) => {
      const trackId = /(?:^|&)i=(\d+)/.exec(groups[1] ?? '')?.[1];

      return trackId !== undefined ? `${groups[0]}?i=${trackId}` : groups[0] ?? '';
    },
    width: 580,
    minWidth: 300,
    height: 450,
  },
  applepodcasts: {
    title: 'Apple Podcasts',
    type: 'audio',
    // Pure host swap onto embed.podcasts.apple.com; ?i= selects an episode.
    regex: /^(?:https?:\/\/)?podcasts\.apple\.com\/([a-z]{2}\/podcast\/[^\s/?]+\/id\d+)(?:\?(\S*))?$/,
    embedUrl: 'https://embed.podcasts.apple.com/<%= remote_id %>',
    id: (groups) => {
      const episodeId = /(?:^|&)i=(\d+)/.exec(groups[1] ?? '')?.[1];

      return episodeId !== undefined ? `${groups[0]}?i=${episodeId}` : groups[0] ?? '';
    },
    width: 580,
    minWidth: 290,
    height: 450,
  },
  audiomack: {
    title: 'Audiomack',
    type: 'audio',
    // Share path /<artist>/<type>/<slug> rearranges to /embed/<type>/<artist>/<slug>.
    regex: /^(?:https?:\/\/)?(?:www\.)?audiomack\.com\/([\w-]+)\/(song|album|playlist)\/([\w-]+)\S*/,
    embedUrl: 'https://audiomack.com/embed/<%= remote_id %>',
    id: (groups) => `${groups[1]}/${groups[0]}/${groups[2]}`,
    width: 580,
    minWidth: 280,
    height: 252,
  },
  anghami: {
    title: 'Anghami',
    type: 'audio',
    // play.anghami.com/embed/... sends X-Frame-Options: DENY on its redirect —
    // only the widget.anghami.com host is frameable.
    regex: /^(?:https?:\/\/)?play\.anghami\.com\/(song|album|playlist|artist)\/(\d+)\S*/,
    embedUrl: 'https://widget.anghami.com/<%= remote_id %>',
    id: (groups) => `${groups[0]}/${groups[1]}`,
    width: 580,
    minWidth: 280,
    height: 170,
  },
  streamable: {
    title: 'Streamable',
    type: 'video',
    // Codes are short lowercase alnum, so common site pages must be excluded
    // explicitly to keep them on the bookmark fallback.
    regex: /^(?:https?:\/\/)?(?:www\.)?streamable\.com\/(?:e\/)?(?!(?:login|signup|recover|documentation)(?:[/?#]|$))([a-z0-9]+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://streamable.com/e/<%= remote_id %>',
    width: 580,
    minWidth: 280,
    height: 320,
  },
  tiktok: {
    title: 'TikTok',
    type: 'video',
    // Opaque vm./vt. short links resolve only via redirect and are excluded;
    // photo posts render inconsistently in embed/v2 and are excluded too.
    regex: /^(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/(\d+)\S*/,
    embedUrl: 'https://www.tiktok.com/embed/v2/<%= remote_id %>',
    width: 325,
    minWidth: 325,
    height: 580,
    fixedWidth: true,
  },
  wistia: {
    title: 'Wistia',
    type: 'video',
    // Account subdomains are arbitrary; both wistia.com and wistia.net occur.
    regex: /^(?:https?:\/\/)?(?:[\w-]+\.)?wistia\.(?:com|net)\/(?:medias|embed\/iframe)\/([A-Za-z0-9]+)\S*/,
    embedUrl: 'https://fast.wistia.net/embed/iframe/<%= remote_id %>',
    width: 580,
    minWidth: 300,
    height: 320,
  },
  vidyard: {
    title: 'Vidyard',
    type: 'video',
    // Share hosts are per-customer subdomains, optionally with one path segment
    // before /watch/. The embed host returns 200 even for bogus ids.
    regex: /^(?:https?:\/\/)?[\w-]+\.vidyard\.com\/(?:[\w-]+\/)?watch\/([\w-]+)\S*/,
    embedUrl: 'https://play.vidyard.com/<%= remote_id %>.html',
    width: 580,
    minWidth: 300,
    height: 320,
  },
  giphy: {
    title: 'GIPHY',
    type: 'image',
    // The id is the trailing token after the last hyphen of the slug. Direct
    // media.giphy.com links carry the id as a path segment. gph.is short links
    // are opaque redirects and excluded.
    regex: /^(?:https?:\/\/)?(?:www\.)?giphy\.com\/(?:gifs|clips|stickers)\/(?:[\w-]+-)?([A-Za-z0-9]+)\/?(?:[?#]\S*)?$|^(?:https?:\/\/)?media\d*\.giphy\.com\/media\/([A-Za-z0-9]+)\/\S+/,
    embedUrl: 'https://giphy.com/embed/<%= remote_id %>',
    id: (groups) => groups[0] ?? groups[1] ?? '',
    width: 480,
    minWidth: 200,
    height: 360,
  },
  codesandbox: {
    title: 'CodeSandbox',
    type: 'code',
    // /p/devbox/ URLs are excluded: their /embed/ mapping is unverified.
    regex: /^(?:https?:\/\/)?codesandbox\.io\/(?:s|p\/sandbox|embed)\/([\w-]+)\S*/,
    embedUrl: 'https://codesandbox.io/embed/<%= remote_id %>',
    width: 580,
    minWidth: 480,
    height: 500,
  },
  stackblitz: {
    title: 'StackBlitz',
    type: 'code',
    // embed=1 is appended ahead of any user params (file=, view=, ...).
    regex: /^(?:https?:\/\/)?stackblitz\.com\/edit\/([\w-]+)(?:\?(\S+))?$/,
    embedUrl: 'https://stackblitz.com/edit/<%= remote_id %>',
    id: (groups) => `${groups[0]}?embed=1${groups[1] !== undefined ? `&${groups[1]}` : ''}`,
    width: 580,
    minWidth: 480,
    height: 500,
  },
  typeform: {
    title: 'Typeform',
    type: 'form',
    // Form pages are frameable as-is; the original subdomain must be kept
    // (private forms 301 to a marketing page, which simply renders inside).
    regex: /^(?:https?:\/\/)?([\w-]+)\.typeform\.com\/to\/(\w+)\S*/,
    embedUrl: 'https://<%= remote_id %>',
    id: (groups) => `${groups[0]}.typeform.com/to/${groups[1]}`,
    width: 580,
    minWidth: 320,
    height: 500,
  },
  airtable: {
    title: 'Airtable',
    type: 'table',
    // Only shr... share links are embeddable; app/tbl/viw workspace URLs are
    // auth-only. The optional app prefix is kept (airtable 302s to it anyway).
    regex: /^(?:https?:\/\/)?(?:www\.)?airtable\.com\/(?:embed\/)?(?:(app\w+)\/)?(shr\w+)\S*/,
    embedUrl: 'https://airtable.com/embed/<%= remote_id %>',
    id: (groups) => (groups[0] !== undefined ? `${groups[0]}/${groups[1]}` : groups[1] ?? ''),
    width: 580,
    minWidth: 450,
    height: 533,
  },
  miro: {
    title: 'Miro',
    type: 'design',
    // Board ids often end in = padding (sometimes %3D-encoded). Boards must be
    // link-shared to render; private boards show a login wall inside the frame.
    regex: /^(?:https?:\/\/)?miro\.com\/app\/(?:board|live-embed)\/((?:%3D|[\w=-])+)\/?\S*/,
    embedUrl: 'https://miro.com/app/live-embed/<%= remote_id %>/',
    id: (groups) => (groups[0] ?? '').replace(/%3D/g, '='),
    width: 580,
    minWidth: 400,
    height: 500,
  },
  desmos: {
    title: 'Desmos',
    type: 'chart',
    // ?embed strips the site chrome down to the graph + keypad.
    regex: /^(?:https?:\/\/)?(?:www\.)?desmos\.com\/calculator\/([a-z0-9]+)\S*/,
    embedUrl: 'https://www.desmos.com/calculator/<%= remote_id %>?embed',
    width: 580,
    minWidth: 256,
    height: 450,
  },
  observable: {
    title: 'Observable',
    type: 'code',
    // Notebook app pages send frame-ancestors 'none'; /embed/ sends
    // frame-ancestors *. Profile pages (single @user segment) are excluded.
    regex: /^(?:https?:\/\/)?(?:www\.)?observablehq\.com\/(?:embed\/)?(@[\w-]+\/[\w-]+)\S*/,
    embedUrl: 'https://observablehq.com/embed/<%= remote_id %>',
    width: 580,
    minWidth: 320,
    height: 500,
  },
  jsfiddle: {
    title: 'JSFiddle',
    type: 'code',
    // Shapes: /<id>/, /<user>/<id>/, /<user>/<id>/<rev>/ — captured whole and
    // suffixed with /embedded/. Reserved site paths are excluded.
    regex: /^(?:https?:\/\/)?(?:www\.)?jsfiddle\.net\/(?!(?:embedded|api|user|docs|blog|about)(?:[/?#]|$))(\w+(?:\/\w+){0,2})\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://jsfiddle.net/<%= remote_id %>/embedded/',
    width: 580,
    minWidth: 400,
    height: 400,
  },
  reddit: {
    title: 'Reddit',
    type: 'social',
    // Mobile share /s/<token> links and redd.it shortcodes are opaque
    // redirects and excluded; only canonical /r/<sub>/comments/<id>/ permalinks
    // are claimed.
    regex: /^(?:https?:\/\/)?(?:(?:www|old|new|np)\.)?reddit\.com\/(r\/\w+\/comments\/\w+(?:\/[^/?#\s]+)?)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://embed.reddit.com/<%= remote_id %>?embed=true&ref_source=embed&ref=share',
    width: 580,
    minWidth: 320,
    height: 500,
  },
  instagram: {
    title: 'Instagram',
    type: 'social',
    // The server sends X-Frame-Options: DENY only to requests without
    // Sec-Fetch-Dest: iframe — browsers embed fine, naive curl checks
    // false-negative. All post kinds (p/reel/reels/tv, + instagr.am) embed
    // via the same /p/<code>/embed/captioned/ endpoint.
    regex: /^(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\/(?:p|reels?|tv)\/([\w-]+)\S*/,
    embedUrl: 'https://www.instagram.com/p/<%= remote_id %>/embed/captioned/',
    width: 400,
    minWidth: 326,
    height: 620,
    fixedWidth: true,
  },
  facebookvideo: {
    title: 'Facebook',
    type: 'video',
    // The plugin takes the canonical watch URL percent-encoded in ?href=.
    // Opaque fb.watch short links resolve only via redirect and are excluded.
    regex: /^(?:https?:\/\/)?(?:(?:www|m|web|mbasic)\.)?facebook\.com\/(?:([\w.-]+)\/videos\/(?:[\w.-]+\/)?(\d+)|watch\/?\?(?:\S*?&)?v=(\d+)|reel\/(\d+))\S*/,
    embedUrl: 'https://www.facebook.com/plugins/video.php?href=<%= remote_id %>',
    id: (groups) => {
      const [page, pageVideoId, watchId, reelId] = groups;

      if (watchId !== undefined) {
        return encodeURIComponent(`https://www.facebook.com/watch/?v=${watchId}`);
      }

      if (reelId !== undefined) {
        return encodeURIComponent(`https://www.facebook.com/reel/${reelId}`);
      }

      return encodeURIComponent(`https://www.facebook.com/${page}/videos/${pageVideoId}/`);
    },
    width: 580,
    minWidth: 220,
    height: 320,
  },
  facebookpost: {
    title: 'Facebook',
    type: 'social',
    // The plugin takes the canonical permalink percent-encoded in ?href=.
    // Opaque /share/p/<token> share links resolve only via redirect and are
    // excluded. Must stay after facebookvideo so /videos|watch|reel URLs are
    // never up for grabs here.
    regex: /^(?:https?:\/\/)?(?:(?:www|m|web|mbasic)\.)?facebook\.com\/(?:([\w.-]+)\/posts\/([\w-]+)|permalink\.php\?(\S+)|photo(?:\.php)?\/?\?(\S+))\S*/,
    embedUrl: 'https://www.facebook.com/plugins/post.php?href=<%= remote_id %>&show_text=true',
    id: (groups) => {
      const [page, postToken, permalinkQuery, photoQuery] = groups;

      if (permalinkQuery !== undefined) {
        const params = new URLSearchParams(permalinkQuery);

        return encodeURIComponent(
          `https://www.facebook.com/permalink.php?story_fbid=${params.get('story_fbid') ?? ''}&id=${params.get('id') ?? ''}`
        );
      }

      if (photoQuery !== undefined) {
        const params = new URLSearchParams(photoQuery);

        return encodeURIComponent(`https://www.facebook.com/photo.php?fbid=${params.get('fbid') ?? ''}`);
      }

      return encodeURIComponent(`https://www.facebook.com/${page}/posts/${postToken}`);
    },
    width: 500,
    minWidth: 350,
    height: 600,
  },
  linkedin: {
    title: 'LinkedIn',
    type: 'social',
    // Both share forms carry the numeric activity id; the urn type
    // (activity/share/ugcPost) is mirrored into the embed path. Opaque
    // lnkd.in short links are excluded.
    regex: /^(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/(?:posts\/[\w%~.-]+-activity-(\d+)|feed\/update\/urn:li:(activity|share|ugcPost):(\d+))\S*/,
    embedUrl: 'https://www.linkedin.com/embed/feed/update/urn:li:<%= remote_id %>',
    id: (groups) => (groups[0] !== undefined ? `activity:${groups[0]}` : `${groups[1]}:${groups[2]}`),
    width: 504,
    minWidth: 400,
    height: 540,
  },
  mastodon: {
    title: 'Mastodon',
    type: 'social',
    // Curated instance allowlist: any host can run Mastodon, so only
    // known-frameable instances are claimed. The remote id carries host+path
    // because each instance serves its own /embed endpoint.
    regex: /^(?:https?:\/\/)?(mastodon\.social|mastodon\.online|mstdn\.social|hachyderm\.io|fosstodon\.org|infosec\.exchange|mas\.to|mastodon\.world|techhub\.social)\/(@\w+(?:@[\w.-]+)?)\/(\d+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://<%= remote_id %>/embed',
    id: (groups) => `${groups[0]}/${groups[1]}/${groups[2]}`,
    width: 580,
    minWidth: 270,
    height: 320,
  },
  pinterest: {
    title: 'Pinterest',
    type: 'social',
    // Regional TLDs and subdomains (ru.pinterest.com, pinterest.co.uk) share
    // the same numeric pin id. Opaque pin.it short links are excluded.
    regex: /^(?:https?:\/\/)?(?:[\w-]+\.)?pinterest\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})\/pin\/(\d+)(?:[/?#]\S*)?$/,
    embedUrl: 'https://assets.pinterest.com/ext/embed.html?id=<%= remote_id %>',
    width: 345,
    minWidth: 236,
    height: 560,
    fixedWidth: true,
  },
  snapchat: {
    title: 'Snapchat',
    type: 'social',
    // CSP frame-ancestors * overrides the bogus X-Frame-Options header, so
    // framing works. The embed is the share URL itself + /embed; lens ids are
    // 32-char hex.
    regex: /^(?:https?:\/\/)?(?:www\.)?snapchat\.com\/(spotlight\/[\w-]+|lens\/[0-9a-f]{32})\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://www.snapchat.com/<%= remote_id %>/embed',
    width: 416,
    minWidth: 326,
    height: 692,
    fixedWidth: true,
  },
  substack: {
    title: 'Substack',
    type: 'document',
    // Post pages lock frame-ancestors to substack — only the /embed/p/
    // preview card is open (renders a card, not the full post). Publications
    // on custom domains can't be claimed (no recognizable host).
    regex: /^(?:https?:\/\/)?(?!(?:www|open)\.)([\w-]+)\.substack\.com\/p\/([\w-]+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://<%= remote_id %>',
    id: (groups) => `${groups[0]}.substack.com/embed/p/${groups[1]}`,
    width: 580,
    minWidth: 320,
    height: 280,
  },
  ted: {
    title: 'TED',
    type: 'video',
    // Slug is required — the bare /talks index page must fall through to bookmark.
    regex: /^(?:https?:\/\/)?(?:www\.)?ted\.com\/talks\/([\w-]+)\S*/,
    embedUrl: 'https://embed.ted.com/talks/<%= remote_id %>',
    width: 580,
    minWidth: 320,
    height: 320,
  },
  internetarchive: {
    title: 'Internet Archive',
    type: 'video',
    // Identifiers are case-sensitive and may contain dots; deep links
    // (/details/<id>/<file>) keep only the first path segment — the embed
    // player takes the bare item identifier.
    regex: /^(?:https?:\/\/)?(?:www\.)?archive\.org\/(?:details|embed)\/([^\s/?#]+)\S*/,
    embedUrl: 'https://archive.org/embed/<%= remote_id %>',
    width: 580,
    minWidth: 320,
    height: 320,
  },
  kick: {
    title: 'Kick',
    type: 'video',
    // Live channel pages are single-segment, so /<channel>/videos/... VODs and
    // reserved site paths fall through to the bookmark tool. player.kick.com
    // needs no parent param (unlike twitch). Cloudflare bot-walls curl/headless
    // requests — never smoke-test this embed live.
    regex: /^(?:https?:\/\/)?(?:www\.)?kick\.com\/(?!(?:browse|categories|category|video|clips|search|support|terms|privacy|community-guidelines|dmca|help|about|blog|store|transparency)(?:[/?#]|$))([\w-]+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://player.kick.com/<%= remote_id %>?autoplay=false',
    width: 580,
    minWidth: 320,
    height: 320,
  },
  peertube: {
    title: 'PeerTube',
    type: 'video',
    // PeerTube is federated — only verified flagship instances are allowlisted.
    // The remote id carries the host (each instance embeds via its own
    // /videos/embed/ path), so the template is a bare https:// prefix.
    regex: /^(?:https?:\/\/)?(framatube\.org|tilvids\.com|video\.blender\.org|makertube\.net)\/(?:w|videos\/watch)\/([\w-]+)\S*/,
    embedUrl: 'https://<%= remote_id %>',
    id: (groups) => `${groups[0]}/videos/embed/${groups[1]}`,
    width: 580,
    minWidth: 300,
    height: 320,
  },
  odysee: {
    title: 'Odysee',
    type: 'video',
    // Claim paths carry @ and : (colons sometimes %3A-encoded when copied) and
    // are passed through to $/embed verbatim. $/... app paths and channel-only
    // URLs (single @segment, no video) are excluded; the anonymous single-segment
    // form requires a colon, which keeps plain site pages out.
    regex: /^(?:https?:\/\/)?(?:www\.)?odysee\.com\/(@[^\s/?#]+\/[^\s/?#]+|[^\s/@$?#][^\s/?#]*(?::|%3A)[^\s/?#]+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://odysee.com/$/embed/<%= remote_id %>',
    id: (groups) => (groups[0] ?? '').replace(/%3A/gi, ':'),
    width: 580,
    minWidth: 320,
    height: 320,
  },
  soop: {
    title: 'SOOP',
    type: 'video',
    // Legacy afreecatv.com and Korean sooplive.co.kr hosts normalize onto the
    // global sooplive.com player. The player page itself is frameable;
    // gated/missing VODs error gracefully inside the frame.
    regex: /^(?:https?:\/\/)?vod\.(?:sooplive\.co\.kr|sooplive\.com|afreecatv\.com)\/player\/(\d+)\S*/,
    embedUrl: 'https://vod.sooplive.com/player/<%= remote_id %>',
    width: 580,
    minWidth: 320,
    height: 320,
  },
  coub: {
    title: 'Coub',
    type: 'video',
    // /embed serves X-Frame-Options: ALLOWALL.
    regex: /^(?:https?:\/\/)?(?:www\.)?coub\.com\/view\/(\w+)\S*/,
    embedUrl: 'https://coub.com/embed/<%= remote_id %>',
    width: 580,
    minWidth: 320,
    height: 320,
  },
  bitchute: {
    title: 'BitChute',
    type: 'video',
    // Ids may contain - and _; the embed path keeps the trailing slash.
    regex: /^(?:https?:\/\/)?(?:www\.)?bitchute\.com\/video\/([\w-]+)\/?\S*/,
    embedUrl: 'https://www.bitchute.com/embed/<%= remote_id %>/',
    width: 580,
    minWidth: 320,
    height: 320,
  },
  tidal: {
    title: 'TIDAL',
    type: 'audio',
    // Numeric ids for track/album/video, UUID for playlist; the embed host
    // pluralizes the type segment (track -> tracks). Mix pages have no verified
    // embed.tidal.com mapping and are excluded. Natural player heights differ
    // per type (track 120, video 320, album/playlist 400) but one entry gets
    // one height, so the tallest (400) is used for all.
    regex: /^(?:https?:\/\/)?(?:www\.|listen\.)?tidal\.com\/(?:browse\/)?(track|album|playlist|video)\/([\w-]+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://embed.tidal.com/<%= remote_id %>',
    id: (groups) => `${groups[0]}s/${groups[1]}`,
    width: 580,
    minWidth: 300,
    height: 400,
  },
  spotifypodcasters: {
    title: 'Spotify for Creators',
    type: 'audio',
    // Spotify for Creators (ex Podcasters, ex Anchor). All three hosts carry the
    // same <show>/episodes/<slug>-<episodeId> shape; the embed form inserts
    // /embed before /episodes on the current creators.spotify.com host.
    regex: /^(?:https?:\/\/)?(?:(?:creators|podcasters)\.spotify\.com\/pod\/show|(?:www\.)?anchor\.fm)\/([\w-]+)\/episodes\/([\w-]+)\S*/,
    embedUrl: 'https://creators.spotify.com/pod/show/<%= remote_id %>',
    id: (groups) => `${groups[0]}/embed/episodes/${groups[1]}`,
    width: 580,
    minWidth: 200,
    height: 152,
  },
  pocketcasts: {
    title: 'Pocket Casts',
    type: 'audio',
    // Share codes are short opaque tokens in the root path, so known site pages
    // must be excluded explicitly to keep them on the bookmark fallback.
    regex: /^(?:https?:\/\/)?pca\.st\/(?!(?:discover|search|podcasts?|episode|support|sign-in|register|get|plus|about|privacy|terms)(?:[/?#]|$))([\w-]+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://pca.st/embed/<%= remote_id %>',
    width: 580,
    minWidth: 300,
    height: 200,
  },
  iheart: {
    title: 'iHeart',
    type: 'audio',
    // Podcast shows, episodes and live stations all embed as the original page
    // path with ?embed=true appended; ids are the trailing -<digits> of each slug.
    regex: /^(?:https?:\/\/)?(?:www\.)?iheart\.com\/(podcast\/[\w-]+-\d+(?:\/episode\/[\w-]+-\d+)?|live\/[\w-]+-\d+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://www.iheart.com/<%= remote_id %>/?embed=true',
    width: 580,
    minWidth: 300,
    height: 250,
  },
  acast: {
    title: 'Acast',
    type: 'audio',
    // Episode pages live at shows.acast.com/<show>/episodes/<episode> (the
    // /episodes/ segment is optional on older links); the embed host drops it.
    // Bare show pages and the /episodes listing are excluded.
    regex: /^(?:https?:\/\/)?shows\.acast\.com\/([\w-]+)\/(?:episodes\/)?(?!episodes(?:[/?#]|$))([\w-]+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://embed.acast.com/<%= remote_id %>',
    id: (groups) => `${groups[0]}/${groups[1]}`,
    width: 580,
    minWidth: 300,
    height: 190,
  },
  podbean: {
    title: 'Podbean',
    type: 'audio',
    // Only /ew/pb-... share links carry the player key; per-show subdomain
    // episode pages (myshow.podbean.com/e/...) have no derivable key and fall
    // through to the bookmark tool. The player-v2 widget rejects the share
    // key verbatim — the pb- prefix must move to the tail (pb-a-b → a-b-pb).
    regex: /^(?:https?:\/\/)?(?:www\.)?podbean\.com\/ew\/pb-([a-z0-9]+)-([a-z0-9]+)\S*/,
    embedUrl: 'https://www.podbean.com/player-v2/?i=<%= remote_id %>',
    id: (groups) => `${groups[0]}-${groups[1]}-pb`,
    width: 580,
    minWidth: 300,
    height: 150,
  },
  spreaker: {
    title: 'Spreaker',
    type: 'audio',
    // The widget wants the numeric episode id: trailing --<id> on current slug
    // URLs, the whole segment on legacy /episode/<id> links.
    regex: /^(?:https?:\/\/)?(?:www\.)?spreaker\.com\/episode\/(?:[\w-]*?--)?(\d+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://widget.spreaker.com/player?episode_id=<%= remote_id %>',
    width: 580,
    minWidth: 200,
    height: 200,
  },
  buzzsprout: {
    title: 'Buzzsprout',
    type: 'audio',
    // Episode pages embed as-is with the small-player query appended; the
    // /episodes/ segment is optional and the -slug suffix may be absent.
    regex: /^(?:https?:\/\/)?(?:www\.)?buzzsprout\.com\/(\d+\/(?:episodes\/)?\d+(?:-[\w-]+)?)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://www.buzzsprout.com/<%= remote_id %>?client_source=small_player&iframe=true',
    width: 580,
    minWidth: 300,
    height: 200,
  },
  castbox: {
    title: 'Castbox',
    type: 'audio',
    // Ids are the trailing -id<channel>-id<episode> (episode) or -id<channel>
    // (channel) of the slug; slugs may carry percent-encoded punctuation, so the
    // slug part is consumed lazily and only the trailing id pair is captured.
    regex: /^(?:https?:\/\/)?(?:www\.)?castbox\.fm\/(?:episode\/\S*?-id(\d+)-id(\d+)|channel\/\S*?-id(\d+))\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://castbox.fm/app/castbox/player/<%= remote_id %>?v=8.22.11&autoplay=0',
    id: (groups) => (groups[2] !== undefined ? `id${groups[2]}` : `id${groups[0]}/id${groups[1]}`),
    width: 580,
    minWidth: 300,
    height: 500,
  },
  transistor: {
    title: 'Transistor',
    type: 'audio',
    // /s/ share pages send frame-ancestors 'self' — the rewrite onto the /e/
    // embed path is mandatory, not cosmetic.
    regex: /^(?:https?:\/\/)?share\.transistor\.fm\/(?:s|e)\/([0-9a-f]+)\S*/,
    embedUrl: 'https://share.transistor.fm/e/<%= remote_id %>',
    width: 580,
    minWidth: 300,
    height: 180,
  },
  audioboom: {
    title: 'Audioboom',
    type: 'audio',
    // The numeric post id leads the slug; the v4 player lives on the
    // embeds.audioboom.com subdomain.
    regex: /^(?:https?:\/\/)?(?:www\.)?audioboom\.com\/posts\/(\d+)\S*/,
    embedUrl: 'https://embeds.audioboom.com/posts/<%= remote_id %>/embed/v4',
    width: 580,
    minWidth: 300,
    height: 150,
  },
  tunein: {
    title: 'TuneIn',
    type: 'audio',
    // Stations only: the trailing s<digits> of the slug is the station id.
    // Program/podcast pages use p-ids and have no station player — excluded.
    regex: /^(?:https?:\/\/)?(?:www\.)?tunein\.com\/radio\/(?:[\w-]+-)?s(\d+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://tunein.com/embed/player/s<%= remote_id %>/',
    width: 580,
    minWidth: 300,
    height: 100,
  },
  beatport: {
    title: 'Beatport',
    type: 'audio',
    // The numeric id after the slug feeds the embed player query.
    regex: /^(?:https?:\/\/)?(?:www\.)?beatport\.com\/track\/[^/?#\s]+\/(\d+)\S*/,
    embedUrl: 'https://embed.beatport.com/?id=<%= remote_id %>&type=track',
    width: 580,
    minWidth: 300,
    height: 162,
  },
  netease: {
    title: 'NetEase Cloud Music',
    type: 'audio',
    // Song pages are SPA hash routes (#/song?id=) but share links also occur
    // without the hash; both carry id= in the query. type=2 is the song player.
    regex: /^(?:https?:\/\/)?music\.163\.com\/(?:#\/)?song\?(?:.*&)?id=(\d+)\S*/,
    embedUrl: 'https://music.163.com/outchain/player?type=2&id=<%= remote_id %>&auto=0&height=66',
    width: 580,
    minWidth: 330,
    height: 86,
  },
  suno: {
    title: 'Suno',
    type: 'audio',
    // Song ids are full UUIDs; the strict shape keeps other /song-ish pages out.
    regex: /^(?:https?:\/\/)?(?:www\.)?suno\.com\/song\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\S*/,
    embedUrl: 'https://suno.com/embed/<%= remote_id %>',
    width: 580,
    minWidth: 300,
    height: 240,
  },
  hearthis: {
    title: 'hearthis.at',
    type: 'audio',
    // Tracks are exactly /<user>/<slug>/; the player is the same path + /embed/.
    // Known two-segment site sections are excluded; profile pages (one segment)
    // and set pages (three segments) never fit the shape.
    regex: /^(?:https?:\/\/)?(?:www\.)?hearthis\.at\/(?!(?:categories|charts|search|pages|set)(?:[/?#]|$))([\w.-]+)\/([\w-]+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://hearthis.at/<%= remote_id %>/embed/',
    id: (groups) => `${groups[0]}/${groups[1]}`,
    width: 580,
    minWidth: 300,
    height: 150,
  },
  boomplay: {
    title: 'Boomplay',
    type: 'audio',
    // Songs only; the /MUSIC suffix is the player's content-type discriminator.
    regex: /^(?:https?:\/\/)?(?:www\.)?boomplay\.com\/songs\/(\d+)\S*/,
    embedUrl: 'https://www.boomplay.com/embed/<%= remote_id %>/MUSIC',
    width: 580,
    minWidth: 300,
    height: 130,
  },
  calendly: {
    title: 'Calendly',
    type: 'calendar',
    // Scheduling pages are frameable as-is once embed_domain/embed_type are
    // appended (same params Calendly's own inline widget passes). Shapes:
    // /<user>[/<event-type>] and one-off /d/<code>/<slug> links. Reserved
    // site sections are excluded so marketing pages fall back to the bookmark.
    regex: /^(?:https?:\/\/)?(?:www\.)?calendly\.com\/(?:(d\/[\w-]+\/[\w-]+)|(?!(?:app|event_types|login|signup|integrations|pricing|blog|help|features|teams|solutions|customers|resources|legal|security|api|embed|d)(?:[/?#]|$))([\w-]+(?:\/[\w-]+)?))\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://calendly.com/<%= remote_id %>?embed_domain=blok&embed_type=Inline',
    id: (groups) => groups[0] ?? groups[1] ?? '',
    width: 580,
    minWidth: 360,
    height: 700,
  },
  tally: {
    title: 'Tally',
    type: 'form',
    // Share links are /r/<formId>; the iframe endpoint is /embed/<formId>
    // (also accepted directly when pasted from Tally's embed snippet).
    regex: /^(?:https?:\/\/)?tally\.so\/(?:r|embed)\/(\w+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://tally.so/embed/<%= remote_id %>',
    width: 580,
    minWidth: 400,
    height: 500,
  },
  jotform: {
    title: 'Jotform',
    type: 'form',
    // Numeric form ids only — slug-based form URLs share their shape with
    // marketing pages and are too risky to claim. All regional hosts
    // (form./www./eu.) serve the same form; normalized onto form.jotform.com.
    regex: /^(?:https?:\/\/)?(?:form|www|eu)\.jotform\.com\/(\d+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://form.jotform.com/<%= remote_id %>',
    width: 580,
    minWidth: 400,
    height: 540,
  },
  whimsical: {
    title: 'Whimsical',
    type: 'design',
    // Board ids are the trailing base62 token after the last hyphen of the
    // slug (or the whole segment for bare links). The 16+ length guard plus
    // the reserved-path exclusion keeps marketing pages on the bookmark tool.
    regex: /^(?:https?:\/\/)?(?:www\.)?whimsical\.com\/(?!(?:wireframes|templates|learn|blog|pricing|mind-maps|flowcharts|docs|ai|downloads|careers|contact|terms|privacy)(?:[/?#]|$))(?:[\w-]*-)?([A-Za-z0-9]{16,})\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://whimsical.com/embed/<%= remote_id %>',
    width: 580,
    minWidth: 400,
    height: 420,
  },
  excalidraw: {
    title: 'Excalidraw',
    type: 'design',
    // Shareable #json= links carry the scene E2E-encrypted: the decryption
    // key lives in the fragment and never reaches the server, so the whole
    // <docId>,<key> pair must be passed through verbatim. #room= collab
    // links are live sessions, not documents, and are excluded.
    regex: /^(?:https?:\/\/)?(?:www\.)?excalidraw\.com\/#json=([\w-]+),([\w-]+)$/,
    embedUrl: 'https://excalidraw.com/#json=<%= remote_id %>',
    id: (groups) => `${groups[0]},${groups[1]}`,
    width: 580,
    minWidth: 380,
    height: 420,
  },
  tldraw: {
    title: 'tldraw',
    type: 'design',
    // Share kinds: r (editable room), ro (read-only), v (snapshot), p (publish).
    // /f/ file links are auth-only and excluded; the kind segment is kept
    // because each renders through a different route.
    regex: /^(?:https?:\/\/)?(?:www\.)?tldraw\.com\/(ro|r|v|p)\/([\w-]+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://www.tldraw.com/<%= remote_id %>',
    id: (groups) => `${groups[0]}/${groups[1]}`,
    width: 580,
    minWidth: 400,
    height: 420,
  },
  mentimeter: {
    title: 'Mentimeter',
    type: 'form',
    // Public presentation links append /embed for the frameable viewer; an
    // optional trailing slide id is dropped (the embed plays the whole deck).
    // menti.com voting-code URLs are a different product surface and excluded.
    regex: /^(?:https?:\/\/)?(?:www\.)?mentimeter\.com\/app\/presentation\/([\w-]+)(?:\/[\w-]+)?\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://www.mentimeter.com/app/presentation/<%= remote_id %>/embed',
    width: 580,
    minWidth: 420,
    height: 400,
  },
  behance: {
    title: 'Behance',
    type: 'design',
    // Project pages are /gallery/<digits>/<slug>; only the numeric id feeds
    // the /embed/project endpoint.
    regex: /^(?:https?:\/\/)?(?:www\.)?behance\.net\/gallery\/(\d+)(?:[/?#]\S*)?$/,
    embedUrl: 'https://www.behance.net/embed/project/<%= remote_id %>',
    width: 580,
    minWidth: 400,
    height: 460,
  },
  chromatic: {
    title: 'Chromatic',
    type: 'code',
    // Published Storybook permalinks live on per-build subdomains; the
    // ?path= value contains slashes, so the story/docs id is captured after
    // its /story/ or /docs/ marker and rebuilt onto the iframe.html endpoint
    // of the same host (full host+path in remote_id, as with typeform).
    regex: /^(?:https?:\/\/)?([\w-]+)\.chromatic\.com\/\?(?:.*&)?path=\/(story|docs)\/([^\s&]+)\S*/,
    embedUrl: 'https://<%= remote_id %>',
    id: (groups) => `${groups[0]}.chromatic.com/iframe.html?id=${groups[2]}&viewMode=${groups[1] === 'docs' ? 'docs' : 'story'}`,
    width: 580,
    minWidth: 320,
    height: 400,
  },
  plunker: {
    title: 'Plunker',
    type: 'code',
    // Editor (/edit/), share (/plunk/) and direct embed-host links all map
    // onto embed.plnkr.co; ?show=preview opens on the rendered output.
    regex: /^(?:https?:\/\/)?(?:(?:www\.)?plnkr\.co\/(?:edit|plunk)\/|embed\.plnkr\.co\/)([\w-]+)\S*/,
    embedUrl: 'https://embed.plnkr.co/<%= remote_id %>?show=preview',
    width: 580,
    minWidth: 480,
    height: 400,
  },
  datawrapper: {
    title: 'Datawrapper',
    type: 'chart',
    // dwcdn ids are 5-char alnum; the optional numeric path segment is a chart
    // version and is dropped (the bare id serves the latest published version).
    regex: /^(?:https?:\/\/)?(?:datawrapper\.dwcdn\.net\/([A-Za-z0-9]{5})|(?:www\.)?datawrapper\.de\/_\/([A-Za-z0-9]{5}))(?:[/?#]\S*)?$/,
    embedUrl: 'https://datawrapper.dwcdn.net/<%= remote_id %>/',
    id: (groups) => groups[0] ?? groups[1] ?? '',
    width: 580,
    minWidth: 320,
    height: 400,
  },
  flourish: {
    title: 'Flourish',
    type: 'chart',
    // /story/ links use the same flo.uri.sh embed shape as visualisations;
    // the story render is unverified but the template is documented.
    regex: /^(?:https?:\/\/)?public\.flourish\.studio\/(visualisation|story)\/(\d+)\S*/,
    embedUrl: 'https://flo.uri.sh/<%= remote_id %>/embed',
    id: (groups) => `${groups[0]}/${groups[1]}`,
    width: 580,
    minWidth: 320,
    height: 450,
  },
  ourworldindata: {
    title: 'Our World in Data',
    type: 'chart',
    // Grapher/explorer pages are frameable as-is; query params encode chart
    // state (countries, time range, tab) and must be preserved.
    regex: /^(?:https?:\/\/)?(?:www\.)?ourworldindata\.org\/(grapher|explorers)\/([\w-]+)\/?(\?[^#\s]*)?(?:#\S*)?$/,
    embedUrl: 'https://ourworldindata.org/<%= remote_id %>',
    id: (groups) => `${groups[0]}/${groups[1]}${groups[2] ?? ''}`,
    width: 580,
    minWidth: 360,
    height: 480,
  },
  geogebra: {
    title: 'GeoGebra',
    type: 'chart',
    // The dedicated /material/iframe/id/ embed endpoint is 410-dead, so the
    // resource page is framed as-is (site chrome shows inside the frame).
    regex: /^(?:https?:\/\/)?(?:www\.)?geogebra\.org\/(m|calculator|classic)\/(\w+)\S*/,
    embedUrl: 'https://www.geogebra.org/<%= remote_id %>',
    id: (groups) => `${groups[0]}/${groups[1]}`,
    width: 580,
    minWidth: 320,
    height: 480,
  },
  scratch: {
    title: 'Scratch',
    type: 'code',
    // The /embed player renders at its fixed 485x402 stage size.
    regex: /^(?:https?:\/\/)?scratch\.mit\.edu\/projects\/(\d+)\S*/,
    embedUrl: 'https://scratch.mit.edu/projects/<%= remote_id %>/embed',
    width: 485,
    minWidth: 400,
    height: 402,
    fixedWidth: true,
  },
  kahoot: {
    title: 'Kahoot!',
    type: 'form',
    // Share pages send X-Frame-Options: DENY — the rewrite onto
    // embed.kahoot.it is mandatory. The kahoot id is the trailing UUID.
    regex: /^(?:https?:\/\/)?create\.kahoot\.it\/(?:details|share)\/(?:[\w-]+\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\S*/,
    embedUrl: 'https://embed.kahoot.it/<%= remote_id %>',
    width: 580,
    minWidth: 480,
    height: 420,
  },
  genially: {
    title: 'Genially',
    type: 'document',
    // Ids are 24-char hex; legacy view.genial.ly links carry the same id.
    // The bare view URL is frameable, the slug tail is dropped.
    regex: /^(?:https?:\/\/)?view\.(?:genially\.com|genial\.ly)\/([0-9a-f]{24})\S*/,
    embedUrl: 'https://view.genially.com/<%= remote_id %>',
    width: 580,
    minWidth: 400,
    height: 420,
  },
  infogram: {
    title: 'Infogram',
    type: 'chart',
    // The embed host wants the FULL slug — the trailing id token alone 404s.
    // Reserved site paths are excluded to keep them on the bookmark fallback.
    regex: /^(?:https?:\/\/)?(?:www\.)?infogram\.com\/(?!(?:blog|examples|templates|features|create|api|pricing|login|signup|app|charts|maps|dashboards|reports|infographics|teams|education|about|careers|contact|terms|privacy|webinars|academy)(?:[/?#]|$))([\w-]+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://e.infogram.com/<%= remote_id %>?src=embed',
    width: 580,
    minWidth: 320,
    height: 480,
  },
  arcgisstorymaps: {
    title: 'ArcGIS StoryMaps',
    type: 'map',
    // Sends X-Frame-Options: SAMEORIGIN, but the CSP frame-ancestors https:
    // directive overrides it in browsers (browser-verified) — passthrough works.
    regex: /^(?:https?:\/\/)?storymaps\.arcgis\.com\/(stories|collections)\/([0-9a-f]{32})\S*/,
    embedUrl: 'https://storymaps.arcgis.com/<%= remote_id %>',
    id: (groups) => `${groups[0]}/${groups[1]}`,
    width: 580,
    minWidth: 480,
    height: 480,
  },
  felt: {
    title: 'Felt',
    type: 'map',
    // Share pages send X-Frame-Options: SAMEORIGIN — the rewrite onto the
    // /embed/map/ path is mandatory.
    regex: /^(?:https?:\/\/)?(?:www\.)?felt\.com\/(?:embed\/)?map\/([\w-]+)\S*/,
    embedUrl: 'https://felt.com/embed/map/<%= remote_id %>',
    width: 580,
    minWidth: 360,
    height: 480,
  },
  p5js: {
    title: 'p5.js',
    type: 'code',
    // /full/ is the chrome-less running sketch; sketch editor pages and
    // /embed / /present variants all carry the same <user>/<id> pair.
    regex: /^(?:https?:\/\/)?editor\.p5js\.org\/([\w.-]+)\/(?:sketches|full|embed|present)\/([\w-]+)\S*/,
    embedUrl: 'https://editor.p5js.org/<%= remote_id %>',
    id: (groups) => `${groups[0]}/full/${groups[1]}`,
    width: 580,
    minWidth: 400,
    height: 420,
  },
  wakelet: {
    title: 'Wakelet',
    type: 'document',
    regex: /^(?:https?:\/\/)?(?:www\.)?wakelet\.com\/wake\/([\w-]+)\S*/,
    embedUrl: 'https://embed.wakelet.com/wakes/<%= remote_id %>/list',
    width: 580,
    minWidth: 320,
    height: 480,
  },
  pollev: {
    title: 'Poll Everywhere',
    type: 'form',
    // Embeds the presenter's currently active poll. Usernames are a single
    // lowercase segment; reserved site paths fall through to the bookmark tool.
    regex: /^(?:https?:\/\/)?(?:www\.)?pollev\.com\/(?!(?:home|login|signup|register|app|features|pricing|support|mobile|proctor|clear|terms|privacy)(?:[/?#]|$))([a-z0-9]+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://pollev-embeds.com/<%= remote_id %>',
    width: 580,
    minWidth: 400,
    height: 480,
  },
  wolframcloud: {
    title: 'Wolfram Cloud',
    type: 'code',
    // Published objects are frameable as-is; non-public objects 302 to a
    // Wolfram login page inside the frame.
    regex: /^(?:https?:\/\/)?(?:www\.)?wolframcloud\.com\/obj\/(\S+)/,
    embedUrl: 'https://www.wolframcloud.com/obj/<%= remote_id %>',
    width: 580,
    minWidth: 480,
    height: 480,
  },
  sketchfab: {
    title: 'Sketchfab',
    type: 'design',
    // Model ids are the 32-char hex tail of the slug. Share pages send
    // X-Frame-Options: SAMEORIGIN — the /embed rewrite is mandatory.
    regex: /^(?:https?:\/\/)?(?:www\.)?sketchfab\.com\/(?:3d-models\/(?:[\w-]+-)?([0-9a-f]{32})|models\/([0-9a-f]{32}))\S*/,
    embedUrl: 'https://sketchfab.com/models/<%= remote_id %>/embed',
    id: (groups) => groups[0] ?? groups[1] ?? '',
    width: 580,
    minWidth: 400,
    height: 400,
  },
  openstreetmap: {
    title: 'OpenStreetMap',
    type: 'map',
    // The view URL only carries zoom/lat/lon, but export/embed.html wants a
    // bbox, so id() reconstructs the 580x420 viewport in degrees (Mercator
    // approximation: latitude degrees-per-pixel shrink by cos(lat)), clamped
    // to world bounds. ?mlat/&mlon marker params are carried over as &marker=.
    regex: /^(?:https?:\/\/)?(?:www\.)?openstreetmap\.org\/(?:\?(?:[^#\s]*&)?mlat=(-?[\d.]+)&mlon=(-?[\d.]+)[^#\s]*)?#map=(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\S*/,
    embedUrl: 'https://www.openstreetmap.org/export/embed.html?<%= remote_id %>',
    id: (groups) => {
      const [mlat, mlon, zoom, lat, lon] = groups.map((value) => (value !== undefined ? Number(value) : undefined));
      const degPerPx = 360 / (256 * 2 ** (zoom ?? 0));
      const halfWidth = (580 / 2) * degPerPx;
      const halfHeight = (420 / 2) * degPerPx * Math.cos(((lat ?? 0) * Math.PI) / 180);
      const clamp = (value: number, limit: number): string => Math.min(limit, Math.max(-limit, value)).toFixed(6);
      const bbox = `${clamp((lon ?? 0) - halfWidth, 180)},${clamp((lat ?? 0) - halfHeight, 85)},${clamp((lon ?? 0) + halfWidth, 180)},${clamp((lat ?? 0) + halfHeight, 85)}`;
      const marker = mlat !== undefined && mlon !== undefined ? `&marker=${mlat},${mlon}` : '';

      return `bbox=${bbox}&layer=mapnik${marker}`;
    },
    width: 580,
    minWidth: 300,
    height: 420,
  },
  tencentvideo: {
    title: 'Tencent Video',
    type: 'video',
    // vid is the last path token on both cover and page URLs; mobile pages
    // carry it in ?vid=. Like youku, many streams play mainland-China-only
    // at stream level; the txp player itself frames anywhere.
    regex: /^(?:https?:\/\/)?(?:m\.)?v\.qq\.com\/x\/(?:(?:cover\/\w+\/|page\/)([a-z0-9]+)\.html?|m\/play\?(?:.*&)?vid=([a-z0-9]+))\S*/,
    embedUrl: 'https://v.qq.com/txp/iframe/player.html?vid=<%= remote_id %>',
    id: (groups) => groups[0] ?? groups[1] ?? '',
    width: 580,
    minWidth: 320,
    height: 320,
  },
  douyin: {
    title: 'Douyin',
    type: 'video',
    // Official no-permission iframe player (developer.open-douyin.com).
    // Opaque v.douyin.com / iesdouyin.com short links resolve only via
    // redirect and are excluded.
    regex: /^(?:https?:\/\/)?(?:www\.)?douyin\.com\/video\/(\d+)\S*/,
    embedUrl: 'https://open.douyin.com/player/video?vid=<%= remote_id %>&autoplay=0',
    width: 325,
    minWidth: 325,
    height: 580,
    fixedWidth: true,
  },
  kinescope: {
    title: 'Kinescope',
    type: 'video',
    // Video ids are long base62 tokens; the length guard keeps site pages
    // (kinescope.io/pricing, /blog, ...) on the bookmark fallback. Per-video
    // domain-allowlist/DRM are customer options — restricted videos error
    // inside the frame.
    regex: /^(?:https?:\/\/)?(?:www\.)?kinescope\.io\/(?:embed\/)?([A-Za-z0-9]{16,})\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://kinescope.io/embed/<%= remote_id %>',
    width: 580,
    minWidth: 320,
    height: 320,
  },
  vidio: {
    title: 'Vidio',
    type: 'video',
    // Watch pages are /watch/<numericId>-<slug>; only the numeric id feeds
    // the embed. The embed host sends X-Frame-Options: ALLOWALL; premium/DRM
    // titles show an upsell inside the frame.
    regex: /^(?:https?:\/\/)?(?:www\.)?vidio\.com\/watch\/(\d+)-[\w-]+\S*/,
    embedUrl: 'https://www.vidio.com/embed/<%= remote_id %>',
    width: 580,
    minWidth: 320,
    height: 320,
  },
  mailru: {
    title: 'Mail.ru',
    type: 'video',
    // Portal pages send X-Frame-Options: DENY — only the /video/embed/ form
    // is frameable (insert embed/ after /video/, drop .html). Legacy
    // videoapi.my.mail.ru embed links 301 onto this same form.
    regex: /^(?:https?:\/\/)?my\.mail\.ru\/(mail|inbox|list|bk|community|v)\/([\w.-]+)\/video\/([\w-]+)\/(\d+)\.html?\S*/,
    embedUrl: 'https://my.mail.ru/<%= remote_id %>',
    id: (groups) => `${groups[0]}/${groups[1]}/video/embed/${groups[2]}/${groups[3]}`,
    width: 580,
    minWidth: 320,
    height: 320,
  },
  smotrim: {
    title: 'Smotrim',
    type: 'video',
    // The player shell 200s for any id (invalid ids error inside the frame);
    // many streams are RU/CIS-geo-locked at stream level.
    regex: /^(?:https?:\/\/)?(?:www\.)?smotrim\.ru\/video\/(\d+)\S*/,
    embedUrl: 'https://player.smotrim.ru/iframe/video/id/<%= remote_id %>/sid/smotrim',
    width: 580,
    minWidth: 320,
    height: 320,
  },
  twitter: {
    title: 'X (Twitter)',
    type: 'social',
    // Script-only: rendered via platform.twitter.com/widgets.js, not an iframe.
    regex: /^(?:https?:\/\/)?(?:(?:www|mobile)\.)?(?:twitter|x)\.com\/(?:i\/web|\w+)\/status\/(\d+)\S*/,
    embedUrl: 'https://twitter.com/i/status/<%= remote_id %>',
    kind: 'script',
    width: 550,
    height: 0,
  },
  telegram: {
    title: 'Telegram',
    type: 'social',
    // Script-only: rendered via telegram.org/js/telegram-widget.js.
    // t.me/c/... private links are excluded: the post widget renders only
    // public channels/groups, so those must fall back to the bookmark tool.
    // Forum links (t.me/<group>/<topicId>/<msgId>) target the final message id.
    regex: /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.(?:me|dog))\/(?:s\/)?(?!c\/)(\w+)\/(?:\d+\/)?(\d+)\S*/,
    embedUrl: 'https://t.me/<%= remote_id %>',
    kind: 'script',
    id: (groups) => `${groups[0]}/${groups[1]}`,
    width: 580,
    height: 0,
  },
  threads: {
    title: 'Threads',
    type: 'social',
    // Script-only: rendered via www.threads.com/embed.js scanning a
    // text-post-media blockquote. The .net mirror is normalized onto .com.
    regex: /^(?:https?:\/\/)?(?:www\.)?threads\.(?:com|net)\/(@[\w.]+)\/post\/([\w-]+)\S*/,
    embedUrl: 'https://www.threads.com/<%= remote_id %>',
    kind: 'script',
    id: (groups) => `${groups[0]}/post/${groups[1]}`,
    width: 550,
    height: 0,
  },
};

/**
 * Matches a URL against the embed registry.
 * @returns the matched service, remote id and resolved embed URL, or null.
 */
export function matchEmbedService(url: string): EmbedMatch | null {
  for (const [service, config] of Object.entries(EMBED_SERVICES)) {
    const match = config.regex.exec(url);

    if (!match) {
      continue;
    }

    const groups = match.slice(1);
    const remoteId = config.id ? config.id(groups) : groups[0];

    return {
      service,
      remoteId,
      embedUrl: buildEmbedUrl(service, remoteId),
      kind: config.kind ?? 'iframe',
      title: config.title,
      type: config.type,
    };
  }

  return null;
}

/**
 * Builds the embed URL for a service by substituting the remote id into its template.
 * @throws if the service is not registered.
 */
export function buildEmbedUrl(service: string, remoteId: string): string {
  const config = EMBED_SERVICES[service];

  if (!config) {
    throw new Error(`Unknown embed service: ${service}`);
  }

  // Replacer fn so remote ids containing `$&`-style patterns are inserted literally.
  return config.embedUrl.replace(REMOTE_ID_TEMPLATE, () => remoteId);
}

/**
 * True only for safe http(s) URLs. Rejects javascript:, data:, ftp:, and non-URLs.
 */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);

    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * True only for absolute https URLs. The strict variant of {@link isHttpUrl}
 * used for anything that becomes an iframe `src` or embed-widget href: it
 * rejects javascript:, data:, http:, protocol-relative (`//…`) and non-URLs,
 * so stored block data can never smuggle a script-executing scheme into a
 * rendered frame (stored-XSS guard).
 */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Sets an anchor's href only when the URL is a safe navigable link (absolute
 * http/https). Unsafe values (javascript:, data:, protocol-relative, …) leave
 * the anchor without an href entirely — an anchor with href="" would still
 * navigate (to the current page), so omitting the attribute is the inert
 * option. Every href assignment in the link toolset must go through this
 * helper or toSafeEmbedSrc (enforced by the link-url-sink-law architecture
 * test), because link/embed block data is attacker-controllable in host apps.
 */
export function setSafeLinkHref(anchor: HTMLAnchorElement, url: string | undefined): void {
  if (url !== undefined && isHttpUrl(url)) {
    anchor.setAttribute('href', url);
  }
}

/**
 * Whether a link points at the current page: a bare anchor ("#results") or any
 * URL that resolves to the document's own origin + pathname. Such destinations
 * always open in the same window, so in-article navigation never spawns a tab.
 * @param value - raw href to test
 */
export function isSamePageLink(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed.charAt(0) === '#') {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const current = new URL(window.location.href);
    const resolved = new URL(trimmed, current.href);

    return resolved.origin === current.origin && resolved.pathname === current.pathname;
  } catch {
    return false;
  }
}
