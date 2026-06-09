/**
 * Embed provider registry for the link/embed tools.
 *
 * Shape mirrors @editorjs/embed: each service has a `regex` that claims a URL,
 * an `embedUrl` template (with a `<%= remote_id %>` placeholder), and an optional
 * `id(groups)` that derives the remote id from the regex capture groups.
 *
 * Providers are added incrementally as the embed tool's tests require them.
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
  id?: (groups: string[]) => string;
}

export interface EmbedMatch {
  service: string;
  remoteId: string;
  embedUrl: string;
  kind: EmbedKind;
}

const REMOTE_ID_TEMPLATE = /<%=\s*remote_id\s*%>/;

export const EMBED_SERVICES: Record<string, EmbedService> = {
  youtube: {
    regex: /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/,
    embedUrl: 'https://www.youtube.com/embed/<%= remote_id %>',
    width: 580,
    height: 320,
  },
  vimeo: {
    regex: /(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d+)/,
    embedUrl: 'https://player.vimeo.com/video/<%= remote_id %>',
    width: 580,
    height: 320,
  },
  rutube: {
    regex: /(?:https?:\/\/)?(?:www\.)?rutube\.ru\/video\/(\w+)\/?/,
    embedUrl: 'https://rutube.ru/play/embed/<%= remote_id %>',
    width: 580,
    height: 320,
  },
  vkvideo: {
    // NOTE: VK normally also needs a `hash` param that is not derivable from the
    // pasted URL. Public videos usually render without it.
    regex: /(?:https?:\/\/)?(?:www\.)?vk\.com\/video(-?\d+)_(\d+)/,
    embedUrl: 'https://vk.com/video_ext.php?oid=<%= remote_id %>',
    id: (groups) => `${groups[0]}&id=${groups[1]}`,
    width: 580,
    height: 320,
  },
  codepen: {
    regex: /(?:https?:\/\/)?(?:www\.)?codepen\.io\/([^/]+)\/pen\/([^/?#]+)/,
    embedUrl: 'https://codepen.io/<%= remote_id %>?default-tab=result',
    id: (groups) => `${groups[0]}/embed/${groups[1]}`,
    width: 580,
    height: 320,
  },
  loom: {
    regex: /(?:https?:\/\/)?(?:www\.)?loom\.com\/share\/([^/?#]+)/,
    embedUrl: 'https://www.loom.com/embed/<%= remote_id %>',
    width: 580,
    height: 320,
  },
  figma: {
    regex: /(?:https?:\/\/)?(?:www\.)?figma\.com\/(design|board|proto|file)\/([^/?#]+)/,
    embedUrl: 'https://embed.figma.com/<%= remote_id %>?embed-host=blok',
    id: (groups) => `${groups[0]}/${groups[1]}`,
    width: 580,
    height: 400,
  },
  spotify: {
    regex: /(?:https?:\/\/)?open\.spotify\.com\/(track|album|playlist|episode|show|artist)\/([^/?#]+)/,
    embedUrl: 'https://open.spotify.com/embed/<%= remote_id %>',
    id: (groups) => `${groups[0]}/${groups[1]}`,
    width: 580,
    height: 152,
  },
  googledrive: {
    regex: /(?:https?:\/\/)?drive\.google\.com\/file\/d\/([^/?#]+)/,
    embedUrl: 'https://drive.google.com/file/d/<%= remote_id %>/preview',
    width: 580,
    height: 480,
  },
  twitter: {
    // Script-only: rendered via platform.twitter.com/widgets.js, not an iframe.
    regex: /(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/\w+\/status\/(\d+)/,
    embedUrl: 'https://twitter.com/i/status/<%= remote_id %>',
    kind: 'script',
    width: 550,
    height: 0,
  },
  telegram: {
    // Script-only: rendered via telegram.org/js/telegram-widget.js.
    regex: /(?:https?:\/\/)?t\.me\/([\w]+)\/(\d+)/,
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

  return config.embedUrl.replace(REMOTE_ID_TEMPLATE, remoteId);
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
