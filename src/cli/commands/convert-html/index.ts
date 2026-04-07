import { preprocess } from './preprocessor';
import { sanitize } from './sanitizer';
import { buildBlocks } from './block-builder';
import type { OutputData } from './types';

/**
 * Convert HTML to Blok JSON.
 * Runs: preprocess → sanitize → build blocks → serialize.
 */
export function convertHtml(html: string): string {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const wrapper = dom.body;

  preprocess(wrapper);
  sanitize(wrapper);

  const blocks = buildBlocks(wrapper);
  const output: OutputData = { version: '2.31.0', blocks };

  return JSON.stringify(output);
}
