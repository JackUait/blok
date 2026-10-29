import type { AgentWarning } from '../../../../types/agent';
import { blocksToMarkdownWithReport } from '../../../markdown/blocks-to-markdown';
import type { MarkdownDegradation } from '../../../markdown/blocks-to-markdown';
import type { AgentPorts } from '../../../shared/agent/types';
import {
  blockDataToSegments,
  nestedDocumentsFor,
  outputBlocksToHtml,
  outputBlocksToSegments,
} from '../../../shared/rich-text/block-data';
import type { BlokModules } from '../../../types-internal/blok-modules';
import { generateBlockId } from '../../utils/id-generator';
import { resolveLinkAttributes } from '../../utils/resolve-link-attributes';
import { htmlToSegmentsDom } from '../../utils/rich-text-dom';

export const editorRichTextFieldsFor = (Blok: Pick<BlokModules, 'Tools'>): (type: string) => string[] =>
  (type) => Blok.Tools.blockTools.get(type)?.richTextFields ?? [];

const degraded = (item: MarkdownDegradation): AgentWarning => ({
  code: 'MARKDOWN_DEGRADED',
  message: `${item.construct} ${item.action}: ${item.detail}`,
});

// href loads only on these; on <a> it is a link.
const HREF_LOADS = new Set(['image', 'use', 'feimage', 'link']);
const CSS_URL = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

const srcsetUrls = (value: string): string[] =>
  value.split(',').map(candidate => candidate.trim().split(/\s+/)[0]).filter(url => url !== '');

const cssUrls = (css: string): string[] => [...css.matchAll(CSS_URL)].map(match => match[2]);

/** Every URL `html` would load once rendered. DOMParser's document is inert: parsing it fetches nothing. */
const urlsInHtml = (html: string): string[] => {
  const parsed = new DOMParser().parseFromString(html, 'text/html');

  return [...parsed.querySelectorAll('*')].flatMap(element => [...element.attributes].flatMap((attr) => {
    const name = attr.name.toLowerCase();

    if (name === 'srcset' || name === 'imagesrcset') {
      return srcsetUrls(attr.value);
    }
    if (name === 'style') {
      return cssUrls(attr.value);
    }
    if (name === 'href' || name === 'xlink:href') {
      return HREF_LOADS.has(element.localName.toLowerCase()) ? [attr.value] : [];
    }

    return ['src', 'poster', 'data', 'background'].includes(name) ? [attr.value] : [];
  }).concat(element.localName === 'style' ? cssUrls(element.textContent ?? '') : []));
};

/**
 * The host's allowMediaUrl as a port. It sees the absolute URL the browser would fetch.
 * A URL that reaches no server (data:, blob:) or cannot load is not asked about; a hook that throws refuses.
 */
const mediaPort = (allow: (url: string) => boolean): NonNullable<AgentPorts['media']> => ({
  allows: (url) => {
    const resolved = ((): URL | null => {
      try {
        return url.trim() === '' ? null : new URL(url, document.baseURI);
      } catch {
        return null;
      }
    })();

    if (resolved === null || (resolved.protocol !== 'http:' && resolved.protocol !== 'https:')) {
      return true;
    }
    try {
      return allow(resolved.href);
    } catch {
      return false;
    }
  },
  urlsInHtml,
});

export const createEditorPorts = (Blok: BlokModules): AgentPorts => {
  const fieldsFor = editorRichTextFieldsFor(Blok);
  const allowMediaUrl = Blok.API.methods.config.agent?.assistant?.allowMediaUrl;

  return {
    ...(typeof allowMediaUrl === 'function' && { media: mediaPort(allowMediaUrl) }),
    htmlToSegments: htmlToSegmentsDom,
    sanitizeBlockData: (type, data) => {
      const rich = fieldsFor(type);
      const cleaned = Blok.BlocksAPI.hostDataForTool(type, data);

      return blockDataToSegments(cleaned, rich, fieldsFor, htmlToSegmentsDom, nestedDocumentsFor(type));
    },
    markdownToBlocks: async (md) => {
      const { markdownToBlocksWithReport } = await import('../../../markdown/index');
      const { blocks, warnings } = await markdownToBlocksWithReport(md);

      return {
        blocks: outputBlocksToSegments(blocks, fieldsFor, htmlToSegmentsDom),
        warnings: warnings.map(degraded),
      };
    },
    htmlToBlocks: async (html) => ({
      blocks: outputBlocksToSegments(await Blok.Paste.blocksFromHtml(html), fieldsFor, htmlToSegmentsDom),
      warnings: [],
    }),
    blocksToMarkdown: (doc) => {
      const blocks = outputBlocksToHtml(doc.blocks, fieldsFor);
      const parentOf = new Map<string, string | null>();

      for (const block of blocks) {
        if (block.id !== undefined) {
          parentOf.set(block.id, block.parent ?? null);
        }
      }

      const depthOf = (id: string | undefined, seen: Set<string> = new Set()): number => {
        if (id === undefined || seen.has(id)) {
          return 0;
        }

        const parent = parentOf.get(id);

        if (typeof parent !== 'string') {
          return 0;
        }

        seen.add(id);

        return 1 + depthOf(parent, seen);
      };
      const { markdown, warnings } = blocksToMarkdownWithReport(blocks.map((block) => ({
        id: block.id,
        tool: block.type,
        data: block.data,
        parentId: block.parent ?? null,
        ...(block.content !== undefined ? { contentIds: block.content } : {}),
        indent: depthOf(block.id),
      })));

      return { markdown, warnings: warnings.map(degraded) };
    },
    newId: generateBlockId,
    pageTitle: (blockId, pageId) => {
      const titles: string[] = [];

      Blok.BlockManager.getBlockById(blockId)?.call('readPageTitle', { pageId, receive: (title: string) => titles.push(title) });

      return titles[0];
    },
    userName: (userId, databaseId) => {
      if (databaseId === undefined) {
        return Blok.UserDirectory.known(userId)?.name;
      }
      const names: string[] = [];
      const database = Blok.BlockManager.getBlockById(databaseId);

      if (database?.name === 'database') {
        database.call('readPersonName', { id: userId, receive: (name: string) => names.push(name) });
      }

      return names[0];
    },
    resolveLink: (link) => {
      const config = Blok.API.methods.config.link;
      const resolved = resolveLinkAttributes(link.href, document.createElement('a'), config ?? {});

      // A reload forces the host's link config onto every anchor (Renderer); with none set it keeps the stored target and rel.
      return config === undefined
        ? { href: link.href, target: link.target ?? resolved.target, rel: link.rel ?? resolved.rel }
        : { href: resolved.href, target: resolved.target, rel: resolved.rel };
    },
  };
};
