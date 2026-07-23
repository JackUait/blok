import { preprocess } from './preprocessor';
import { sanitize } from './sanitizer';
import { buildBlocks } from './block-builder';
import { normalizeInlineMarkupIn } from '../../../components/utils/inline-normalization';
import type { OutputData } from './types';

declare const __CLI_VERSION__: string;

/**
 * Convert HTML to Blok JSON.
 * Runs: preprocess → sanitize → build blocks → serialize.
 */
export function convertHtml(html: string): string {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const wrapper = dom.body;

  preprocess(wrapper);
  sanitize(wrapper);
  /**
   * buildBlocks stores element innerHTML verbatim, so any fragmentation in the
   * source survives into the emitted JSON. This is a separate pipeline from
   * the editor's paste path and has to collapse it for itself.
   */
  normalizeInlineMarkupIn(wrapper);

  const blocks = buildBlocks(wrapper);
  const output: OutputData = { version: typeof __CLI_VERSION__ !== 'undefined' ? __CLI_VERSION__ : 'dev', blocks };

  return JSON.stringify(output);
}
