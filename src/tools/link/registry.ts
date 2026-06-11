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
export type EmbedKind = 'iframe' | 'script';

export interface EmbedService {
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
  /** Derives the remote id from regex capture groups (defaults to the first group). */
  id?: (groups: Array<string | undefined>) => string;
}

export interface EmbedMatch {
  service: string;
  remoteId: string;
  embedUrl: string;
  kind: EmbedKind;
}

const REMOTE_ID_TEMPLATE = /<%=\s*remote_id\s*%>/;

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
    regex: /^(?:https?:\/\/)?(?:(?:www|m|music)\.)?(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]+)(\S*)/,
    embedUrl: 'https://www.youtube.com/embed/<%= remote_id %>',
    id: (groups) => {
      const start = parseYoutubeStart(groups[1] ?? '');

      return start !== null && start > 0 ? `${groups[0]}?start=${start}` : groups[0] ?? '';
    },
    width: 580,
    height: 320,
  },
  youtubeplaylist: {
    regex: /^(?:https?:\/\/)?(?:(?:www|m|music)\.)?youtube\.com\/playlist\?(?:.*&)?list=([\w-]+)\S*/,
    embedUrl: 'https://www.youtube.com/embed/videoseries?list=<%= remote_id %>',
    width: 580,
    height: 320,
  },
  vimeo: {
    regex: /^(?:https?:\/\/)?(?:www\.)?(?:player\.)?vimeo\.com\/(?:(?:groups\/[\w-]+\/videos|album\/\d+\/video|showcase\/\d+\/video|video)\/)?(\d+)(?:\/([0-9a-f]+))?\S*/,
    embedUrl: 'https://player.vimeo.com/video/<%= remote_id %>',
    id: (groups) => (groups[1] !== undefined ? `${groups[0]}?h=${groups[1]}` : groups[0] ?? ''),
    width: 580,
    height: 320,
  },
  vimeoshowcase: {
    regex: /^(?:https?:\/\/)?(?:www\.)?vimeo\.com\/showcase\/(\d+)\/?(?:[?#]\S*)?$/,
    embedUrl: 'https://vimeo.com/showcase/<%= remote_id %>/embed',
    width: 580,
    height: 320,
  },
  vimeoevent: {
    regex: /^(?:https?:\/\/)?(?:www\.)?vimeo\.com\/event\/(\d+)\S*/,
    embedUrl: 'https://vimeo.com/event/<%= remote_id %>/embed',
    width: 580,
    height: 320,
  },
  rutube: {
    // Rutube ids are 32-char hex hashes; the length guard keeps listing pages
    // (/video/category/..., /video/person/...) from being claimed.
    regex: /^(?:https?:\/\/)?(?:www\.)?rutube\.ru\/(?:video\/private\/|(?:video|shorts|play\/embed)\/|live\/video\/)([0-9a-f]{32})\/?(?:\?(?:.*&)?p=([\w-]+))?\S*/,
    embedUrl: 'https://rutube.ru/play/embed/<%= remote_id %>',
    id: (groups) => (groups[1] !== undefined ? `${groups[0]}/?p=${groups[1]}` : groups[0] ?? ''),
    width: 580,
    height: 320,
  },
  vkvideo: {
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
    height: 320,
  },
  codepen: {
    regex: /^(?:https?:\/\/)?(?:www\.)?codepen\.io\/((?:team\/|editor\/)?[\w-]+)\/(?:pen|full|details|debug)\/([\w-]+)(?:\/([0-9a-f]+))?\S*/,
    embedUrl: 'https://codepen.io/<%= remote_id %>?default-tab=result',
    id: (groups) => `${groups[0]}/embed/${groups[1]}${groups[2] !== undefined ? `/${groups[2]}` : ''}`,
    width: 580,
    height: 320,
  },
  loom: {
    // Loom video ids are 32-char hex; folder links (loom.com/share/folder/...)
    // are not embeddable and must fall through to the bookmark tool.
    regex: /^(?:https?:\/\/)?(?:www\.)?loom\.com\/(?:share|embed)\/([0-9a-f]{32})\S*/,
    embedUrl: 'https://www.loom.com/embed/<%= remote_id %>',
    width: 580,
    height: 320,
  },
  figma: {
    regex: /^(?:https?:\/\/)?(?:www\.)?figma\.com\/(design|board|proto|file|slides|deck)\/([^/?#]+)\S*/,
    embedUrl: 'https://embed.figma.com/<%= remote_id %>?embed-host=blok',
    id: (groups) => `${groups[0]}/${groups[1]}`,
    width: 580,
    height: 400,
  },
  spotify: {
    regex: /^(?:https?:\/\/)?open\.spotify\.com\/(?:intl-[\w-]+\/)?(?:embed\/)?(track|album|playlist|episode|show|artist)\/([^/?#]+)\S*/,
    embedUrl: 'https://open.spotify.com/embed/<%= remote_id %>',
    id: (groups) => `${groups[0]}/${groups[1]}`,
    width: 580,
    height: 152,
  },
  googledrive: {
    regex: /^(?:https?:\/\/)?drive\.google\.com\/(?:file\/(?:u\/\d+\/)?d\/([\w-]+)|open\?(?:.*&)?id=([\w-]+))\S*/,
    embedUrl: 'https://drive.google.com/file/d/<%= remote_id %>/preview',
    id: (groups) => groups[0] ?? groups[1] ?? '',
    width: 580,
    height: 480,
  },
  googledrivefolder: {
    regex: /^(?:https?:\/\/)?drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)\S*/,
    embedUrl: 'https://drive.google.com/embeddedfolderview?id=<%= remote_id %>#list',
    width: 580,
    height: 480,
  },
  googledocspublished: {
    // "Publish to the web" links carry a 2PACX token under d/e/ that is not a
    // document id: /preview 404s for them, Google's own embed code is /pub?embedded=true.
    regex: /^(?:https?:\/\/)?docs\.google\.com\/document\/(?:u\/\d+\/)?d\/e\/([\w-]+)\S*/,
    embedUrl: 'https://docs.google.com/document/d/e/<%= remote_id %>/pub?embedded=true',
    width: 580,
    height: 480,
  },
  googledocs: {
    // (?!e\/) keeps published d/e/ links out of this entry regardless of registry order.
    regex: /^(?:https?:\/\/)?docs\.google\.com\/document\/(?:u\/\d+\/)?d\/(?!e\/)([\w-]+)\S*/,
    embedUrl: 'https://docs.google.com/document/d/<%= remote_id %>/preview',
    width: 580,
    height: 480,
  },
  googlesheets: {
    // Branch 1 claims published d/e/<2PACX token> links (embedded via Google's own
    // pubhtml?widget=true&headers=false endpoint), branch 2 normal d/<fileId> links.
    regex: /^(?:https?:\/\/)?docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/(?:e\/([\w-]+)|([\w-]+))\S*/,
    embedUrl: 'https://docs.google.com/spreadsheets/d/<%= remote_id %>',
    id: (groups) =>
      groups[0] !== undefined
        ? `e/${groups[0]}/pubhtml?widget=true&headers=false`
        : `${groups[1]}/preview`,
    width: 580,
    height: 480,
  },
  googleslides: {
    // Published links keep the literal e/ segment inside the id, so the same
    // /embed template serves both d/<id> and d/e/<2PACX token> URLs.
    regex: /^(?:https?:\/\/)?docs\.google\.com\/presentation\/(?:u\/\d+\/)?d\/((?:e\/)?[\w-]+)\S*/,
    embedUrl: 'https://docs.google.com/presentation/d/<%= remote_id %>/embed?start=false&loop=false&delayms=3000',
    width: 580,
    height: 480,
  },
  googleforms: {
    // Legacy d/<editId>/viewform links work because Google 301s them to the
    // canonical d/e/ embed URL with the query string preserved.
    regex: /^(?:https?:\/\/)?docs\.google\.com\/forms\/(?:u\/\d+\/)?d\/((?:e\/)?[\w-]+)\/viewform\S*/,
    embedUrl: 'https://docs.google.com/forms/d/<%= remote_id %>/viewform?embedded=true',
    width: 580,
    height: 480,
  },
  drawio: {
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
    height: 480,
  },
  twitter: {
    // Script-only: rendered via platform.twitter.com/widgets.js, not an iframe.
    regex: /^(?:https?:\/\/)?(?:(?:www|mobile)\.)?(?:twitter|x)\.com\/(?:i\/web|\w+)\/status\/(\d+)\S*/,
    embedUrl: 'https://twitter.com/i/status/<%= remote_id %>',
    kind: 'script',
    width: 550,
    height: 0,
  },
  telegram: {
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
