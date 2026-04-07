import { preprocessGoogleDocsHtml } from '../../../components/modules/paste/google-docs-preprocessor';
import { preprocess } from '../convert-html/preprocessor';
import { sanitize } from '../convert-html/sanitizer';
import { buildBlocks } from '../convert-html/block-builder';
import type { OutputData } from '../convert-html/types';

/**
 * Convert Google Docs HTML to Blok JSON.
 * Runs: Google Docs preprocess -> general preprocess -> sanitize -> build blocks -> serialize.
 */
export function convertGdocs(html: string): string {
  const preprocessed = preprocessGoogleDocsHtml(html);

  const dom = new DOMParser().parseFromString(preprocessed, 'text/html');
  const wrapper = dom.body;

  preprocess(wrapper);
  sanitize(wrapper);

  const blocks = buildBlocks(wrapper);
  const output: OutputData = { version: '2.31.0', blocks };

  return JSON.stringify(output);
}
