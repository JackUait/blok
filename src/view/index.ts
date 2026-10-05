/**
 * `@bloklabs/core/view` — the synchronous, DOM-free view renderer.
 *
 * PURITY CONTRACT: this entry must be importable in bare Node / workers / RSC
 * with zero DOM globals. Never import the `src/components/utils` barrel
 * (browser.ts pollutes `globalThis.window`), any editor module, or any tool
 * class. Enforced by test/unit/view/index.purity.test.ts.
 */
export { blocksToHtml } from './blocks-to-html';
export type {
  BlocksToHtmlOptions,
  ViewBlockRenderer,
  ViewRenderContext,
  ViewUrlContext,
  ViewUrlTransform,
} from './blocks-to-html';
export type { ViewInlineElement, ViewInlineRenderer } from './inline-renderers';
export { blocksToPlainText } from './blocks-to-plain-text';
export type { BlocksToPlainTextOptions } from './blocks-to-plain-text';
export { pageIndex } from './page-index';
export type { PageIndex, PageOwnerEdge, PageReference, PageTextEntry } from './page-index';
export { projectPageTree } from './page-tree';
export type { HostPageEdge, PageTreeNode, PageTreeDiagnostic, PageTreeProjection } from './page-tree';
export { blokDocumentSchema } from './document-schema';
export { extractTexts, injectTexts } from './document-texts';
export type { DocumentTextsOptions } from './document-texts';
export { blocksToMarkdown, blocksToMarkdownWithReport } from './blocks-to-markdown';
export type { MarkdownDegradation, MarkdownSerializationResult } from './blocks-to-markdown';
export { htmlTextContent } from './html-text';
export { outlineFromOutputData } from './outline';
export type { OutlineItem } from './outline';
export { restoreHeadingAnchors } from './restore-heading-anchors';
export type {
  HeadingAnchorReport,
  HeadingAnchorResult,
  HeadingAnchorSkipReason,
  RestoredHeadingAnchor,
  SkippedHeadingAnchor,
} from './restore-heading-anchors';
/**
 * `blocksToViewNodes` and the `ViewNode` tree are `@experimental` — not
 * frozen until a second framework adapter consumes them.
 */
export { blocksToViewNodes } from './view-nodes';
export type { ViewNode, ViewElementNode, ViewTextNode } from './view-nodes';
export { sanitizeHtmlFragment } from './sanitize';
/**
 * The KaTeX renderer blok already bundles, hardened for untrusted input — so a
 * `ViewInlineRenderer` for equations reuses it instead of adding katex as a
 * second dependency. `createLatexRenderer` is the one to reach for inside
 * `inlineRenderers`, which is synchronous (see their own docs).
 */
export { renderLatex, createLatexRenderer } from '../shared/katex';
export type { LatexRenderOptions } from '../shared/katex';
export { defineBlokSchema, composeBaseSanitizeConfig } from '../shared/sanitize-schema';
export type { BlokViewSchema, DefinedBlokSchema, BlokSchemaConfig, ResolvedSchemaTool } from '../shared/sanitize-schema';
export { htmlToBlocks, htmlToBlocksWithReport } from './html-to-blocks';
export type { HtmlImportResult } from './html-to-blocks';
export { movePageBlocks, turnBlocksIntoPage, turnPageIntoBlocks } from './page-transfer';
export type { PageBlockPlacement, PageBlockMove } from './page-transfer';
export { executePageTransfer, undoPageTransfer } from './page-transfer-host';
export type {
  PageTransferRequest,
  PageTransferReceipt,
  PageTransferHost,
  PageTransferUndoRequest,
  PageTransferUndoReceipt,
  PageTransferUndoHost,
} from './page-transfer-host';
export { remapPageDocument } from './page-document-remap';
