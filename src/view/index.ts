/**
 * `@bloklabs/core/view` — the synchronous, DOM-free view renderer.
 *
 * PURITY CONTRACT: this entry must be importable in bare Node / workers / RSC
 * with zero DOM globals. Never import the `src/components/utils` barrel
 * (browser.ts pollutes `globalThis.window`), any editor module, or any tool
 * class. Enforced by test/unit/view/index.purity.test.ts.
 */
export { blocksToHtml } from './blocks-to-html';
export type { BlocksToHtmlOptions, ViewBlockRenderer, ViewRenderContext } from './blocks-to-html';
export { blocksToPlainText } from './blocks-to-plain-text';
export { htmlTextContent } from './html-text';
export { outlineFromOutputData } from './outline';
export type { OutlineItem } from './outline';
/**
 * `blocksToViewNodes` and the `ViewNode` tree are `@experimental` — not
 * frozen until a second framework adapter consumes them.
 */
export { blocksToViewNodes } from './view-nodes';
export type { ViewNode, ViewElementNode, ViewTextNode } from './view-nodes';
export { sanitizeHtmlFragment } from './sanitize';
export { defineBlokSchema, composeBaseSanitizeConfig } from '../shared/sanitize-schema';
export type { BlokViewSchema, DefinedBlokSchema, BlokSchemaConfig, ResolvedSchemaTool } from '../shared/sanitize-schema';
