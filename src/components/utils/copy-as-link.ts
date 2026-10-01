import type { BlockToolData } from '../../../types';
import type { BlockToolAdapter } from '../tools/block';
import { convertStringToBlockData } from './blocks';
import { generateBlockId } from './id-generator';

/** What a block with `copyAsLink` copies as. */
export interface CopyLink {
  url: string;
  text: string;
}

/**
 * `<a href="url">text</a>`, both escaped. An empty text shows the url.
 * @param link - the link to write
 */
export const linkToHtml = (link: CopyLink): string => {
  const anchor = document.createElement('a');

  anchor.setAttribute('href', link.url);
  anchor.textContent = link.text === '' ? link.url : link.text;

  return anchor.outerHTML;
};

/**
 * The default block holding the link. Goes through the default tool's import,
 * so a host's default tool need not store text under `text`.
 * @param link - the link to hold
 * @param defaultTool - the editor's default block tool
 */
export const linkToBlock = (link: CopyLink, defaultTool: BlockToolAdapter): { tool: string; data: BlockToolData } => ({
  tool: defaultTool.name,
  data: convertStringToBlockData(linkToHtml(link), defaultTool.conversionConfig, defaultTool.settings),
});

/** Cuts not yet pasted in this tab. Another tab or a reload never sees them. */
const pendingCuts = new Set<string>();

/** Mint a token for a cut. Its first paste may recreate the block. */
export const rememberCut = (): string => {
  const token = generateBlockId();

  pendingCuts.add(token);

  return token;
};

/**
 * True only the first time for a token this tab minted.
 * @param token - the `cut` field of a pasted entry
 */
export const takeCut = (token: unknown): boolean =>
  typeof token === 'string' && pendingCuts.delete(token);
