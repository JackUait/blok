import { preprocessLegacyCmsHtmlIn } from '../../../preprocess/legacy-cms-html';
import { sanitize } from './sanitizer';
import { stampPastedTableDirection } from '../../../components/modules/paste/table-direction-preprocessor';
import { carryParagraphAlignmentToCell } from '../../../components/modules/paste/google-docs-preprocessor';
import { buildBlocks } from './block-builder';
import { normalizeInlineMarkupIn } from '../../../components/utils/inline-normalization';
import type { OutputData } from './types';

declare const __CLI_VERSION__: string;

/**
 * Convert HTML to Blok JSON.
 * Runs: preprocess → sanitize → build blocks → serialize.
 */
export function convertHtml(html: string): string {
  // The sanitizer drops wrapper dir and table style, so stamp the grid direction first.
  const dom = new DOMParser().parseFromString(stampPastedTableDirection(html), 'text/html');
  const wrapper = dom.body;

  // Before the legacy pass unwraps cell <p>s and the sanitizer drops their style.
  wrapper.querySelectorAll('td, th').forEach(carryParagraphAlignmentToCell);
  preprocessLegacyCmsHtmlIn(wrapper);
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
