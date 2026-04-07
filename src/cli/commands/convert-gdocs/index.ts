import { preprocessGoogleDocsHtml } from '../../../components/modules/paste/google-docs-preprocessor';
import { preprocess } from '../convert-html/preprocessor';
import { sanitize } from '../convert-html/sanitizer';
import { buildBlocks } from '../convert-html/block-builder';
import type { OutputData } from '../convert-html/types';

declare const __CLI_VERSION__: string;

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
  const output: OutputData = { version: typeof __CLI_VERSION__ !== 'undefined' ? __CLI_VERSION__ : 'dev', blocks };

  return JSON.stringify(output);
}
