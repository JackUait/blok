import type { SanitizerConfig, ToolSanitizerConfig } from '../../../../types';
import { BLOCK_COLOR_SANITIZE } from '../../block-color-sanitize';
import { INLINE_TEXT_SANITIZE } from '../../inline-text-sanitize';
import { PAGE_REFERENCE_ATTR, preservePageReferenceAnchor } from '../../page-reference';
import { PLAINTEXT } from '../../sanitize-rules';
import { ALLOWED_MARK_STYLE_PROPS, CELL_BLOCK_TAGS_SANITIZE } from '../../table/cell-sanitize';

export const paragraphSanitize = (): ToolSanitizerConfig => {
  return {
    ...BLOCK_COLOR_SANITIZE,
    text: {
      ...INLINE_TEXT_SANITIZE,
      img: {
        src: true,
        alt: true,
        style: true,
      },
      p: true,
      ul: true,
      li: true,
    },
  };
};

export const headerSanitize = (): SanitizerConfig => {
  return {
    level: false,
    // Spread the shared inline whitelist so bold/italic/underline/strike/link/
    // code/color marks survive save AND "Turn into" conversion (conversion
    // re-sanitizes with the TARGET tool's `text` config). Matches Notion.
    text: {
      ...INLINE_TEXT_SANITIZE,
    },
    isToggleable: false,
    // Plain fragment string, already validated by normalizeHeadingAnchor — pass through.
    anchor: false,
    // Block-level color fields hold plain preset names (not HTML) — pass through.
    ...BLOCK_COLOR_SANITIZE,
  } as SanitizerConfig;
};

/** Inline marks must survive save and conversion. */
export const listSanitize = (): ToolSanitizerConfig => ({
  text: {
    ...INLINE_TEXT_SANITIZE,
  },
});

export const toggleSanitize = (): ToolSanitizerConfig => {
  return {
    ...BLOCK_COLOR_SANITIZE,
    text: {
      ...INLINE_TEXT_SANITIZE,
    },
  };
};

export const calloutSanitize = (): ToolSanitizerConfig => {
  return {
    emoji: false,
    textColor: false,
    backgroundColor: false,
  };
};

export const quoteSanitize = (): ToolSanitizerConfig => {
  return {
    text: {
      ...INLINE_TEXT_SANITIZE,
    },
  };
};

export const codeSanitize = (): ToolSanitizerConfig => {
  return {
    /**
     * `code` is literal source text, not markup. `true` would route it
     * through the HTML parser, which entity-encodes `<`/`&` and deletes
     * anything shaped like a stray end tag — irrecoverable corruption.
     */
    code: PLAINTEXT,
    filename: PLAINTEXT,
  };
};

export const tableOfContentsSanitize = (): SanitizerConfig => {
  return { ...BLOCK_COLOR_SANITIZE };
};

export const spacerSanitize = (): SanitizerConfig => {
  return {};
};

export const dividerSanitize = (): SanitizerConfig => {
  return {};
};

export const imageSanitize = (): SanitizerConfig => {
  return {
    url: PLAINTEXT,
    caption: PLAINTEXT,
    alt: PLAINTEXT,
    fileName: PLAINTEXT,
    // Applies to every string inside the items too: the sanitizer passes the rule down.
    markup: PLAINTEXT,
  };
};

export const videoSanitize = (): SanitizerConfig => {
  return {
    url: PLAINTEXT,
    caption: PLAINTEXT,
    fileName: PLAINTEXT,
    mimeType: PLAINTEXT,
    aspectRatio: PLAINTEXT,
  };
};

export const audioSanitize = (): SanitizerConfig => {
  return {
    url: PLAINTEXT,
    caption: PLAINTEXT,
    title: PLAINTEXT,
    artist: PLAINTEXT,
    coverUrl: PLAINTEXT,
    fileName: PLAINTEXT,
    mimeType: PLAINTEXT,
  };
};

export const fileSanitize = (): SanitizerConfig => {
  return {
    url: PLAINTEXT,
    caption: PLAINTEXT,
    fileName: PLAINTEXT,
    mimeType: PLAINTEXT,
  };
};

export const embedSanitize = (): SanitizerConfig => {
  return {
    service: PLAINTEXT,
    source: PLAINTEXT,
    embed: PLAINTEXT,
    caption: PLAINTEXT,
  };
};

export const bookmarkSanitize = (): SanitizerConfig => {
  return {
    url: PLAINTEXT,
    title: PLAINTEXT,
    description: PLAINTEXT,
    image: PLAINTEXT,
    favicon: PLAINTEXT,
    domain: PLAINTEXT,
  };
};

export const pageSanitize = (): SanitizerConfig => {
  return {
    pageId: PLAINTEXT,
    cache: PLAINTEXT,
  };
};

export const pageLinkSanitize = (): SanitizerConfig => {
  return { pageId: PLAINTEXT };
};

export const databaseSanitize = (): SanitizerConfig => {
  return {
    title: PLAINTEXT,
    schema: PLAINTEXT,
    views: PLAINTEXT,
    activeViewId: PLAINTEXT,
  };
};

export const databaseRowSanitize = (): SanitizerConfig => {
  return {
    title: PLAINTEXT,
    properties: PLAINTEXT,
    position: PLAINTEXT,
    pageId: PLAINTEXT,
    convertedValues: PLAINTEXT,
  };
};

export const tabSanitize = (): SanitizerConfig => {
  return { title: false, icon: false };
};

export const tableSanitize = (): ToolSanitizerConfig => {
  return {
    content: {
      ...INLINE_TEXT_SANITIZE,
      b: true,
      i: true,
      strong: true,
      em: true,
      u: true,
      s: true,
      del: true,
      code: true,
      mark: (node: Element): { [attr: string]: boolean | string } => {
        const el = node as HTMLElement;
        const style = el.style;

        const props = Array.from({ length: style.length }, (_, i) => style.item(i));

        for (const prop of props) {
          if (!ALLOWED_MARK_STYLE_PROPS.has(prop)) {
            style.removeProperty(prop);
          }
        }

        return style.length > 0 ? { style: true } : {};
      },
      a: (node: Element) => node.getAttribute(PAGE_REFERENCE_ATTR)
        ? preservePageReferenceAnchor(node)
        : { href: true, target: '_blank', rel: 'nofollow' },
      // Legacy string cells may hold lists and lines; this runs before
      // parseCellContentToBlocks reads them.
      ...CELL_BLOCK_TAGS_SANITIZE,
    },
  };
};

const none = (): SanitizerConfig => ({});

export const BUILT_IN_BLOCK_SANITIZE: Readonly<Record<string, () => SanitizerConfig>> = {
  paragraph: paragraphSanitize as () => SanitizerConfig,
  header: headerSanitize,
  list: listSanitize as () => SanitizerConfig,
  toggle: toggleSanitize as () => SanitizerConfig,
  callout: calloutSanitize as () => SanitizerConfig,
  quote: quoteSanitize as () => SanitizerConfig,
  code: codeSanitize as () => SanitizerConfig,
  table_of_contents: tableOfContentsSanitize,
  spacer: spacerSanitize,
  divider: dividerSanitize,
  image: imageSanitize,
  video: videoSanitize,
  audio: audioSanitize,
  file: fileSanitize,
  embed: embedSanitize,
  bookmark: bookmarkSanitize,
  page: pageSanitize,
  'page-link': pageLinkSanitize,
  database: databaseSanitize,
  'database-row': databaseRowSanitize,
  tab: tabSanitize,
  column_list: none,
  column: none,
  tabs: none,
  table: tableSanitize as () => SanitizerConfig,
};
