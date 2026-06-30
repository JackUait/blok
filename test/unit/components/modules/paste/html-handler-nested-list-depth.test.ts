import { describe, it } from 'vitest';

/**
 * Notion-parity finding M-18 (live-editor portion) — DEFERRED, intentionally skipped.
 *
 * Pasting rendered nested HTML lists copied from a generic web page
 * (e.g. `<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li></ul>` WITHOUT
 * `aria-level`) should produce list blocks with increasing `data.depth`
 * (0, 1, 2 …). Today the nesting is lost.
 *
 * Root cause (characterized): the list tool registers ONLY the `<li>` tag
 * (src/tools/list/static-configs.ts getListPasteConfig). In the HTML paste
 * splitter (html-handler.ts `processElementNode`), a parent `<li>` that contains
 * a nested `<ul>`/`<ol>` matches `(isSubstitutable && !containsAnotherToolTags)`
 * and is emitted WHOLE — so the nested items are swallowed into the parent
 * item's content rather than becoming separate, deeper blocks.
 *
 * The list tool's own depth detection IS fixed for the CLI / attached-fragment
 * path: src/tools/list/paste-handler.ts `extractDepthFromPastedContent` reads
 * `aria-level` (1-based) and falls back to counting ancestor `<ul>`/`<ol>`. So a
 * clean fix is a SURGICAL pre-pass in `processHTML` (right after
 * `wrapper.innerHTML = innerHTML`, before `getNodes`) that, while the ancestor
 * chain is intact, (a) stamps each `<li>`'s `aria-level` from its ancestor
 * `<ul>`/`<ol>` count and (b) flattens nested `<li>` to siblings so each becomes a
 * separate emittable block.
 *
 * DEFERRED because (b) must also preserve per-item ordered-vs-unordered style,
 * checkbox/checked state, and not regress the toggle-recovery, checklist, and
 * Google-Docs/Word paste paths — a wide regression surface for a MEDIUM-confidence
 * finding (it is unconfirmed that Notion itself preserves depth for generic web
 * `<ul>`/`<ol>` without aria-level). Pasting lists FROM Notion / rich editors
 * already round-trips via their aria-level or JSON clipboard flavors.
 *
 * See docs/plans/list-notion-parity-audit.md (M-18) for the full writeup.
 */
describe('HtmlHandler — nested HTML list paste preserves depth (M-18 live-editor, deferred)', () => {
  it.skip('pasting nested <ul>/<ol> without aria-level yields blocks at depth 0,1,2', () => {
    // Implement the processHTML pre-pass (stamp aria-level + flatten nested <li>)
    // then assert each resulting list block carries its expected depth.
  });
});
