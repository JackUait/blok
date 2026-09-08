import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BoldNormalizationPass } from '../../../../../src/components/inline-tools/services/bold-normalization-pass';

const NBSP = '\u00A0';

const hosts: HTMLElement[] = [];

/**
 * Mounts the scope a test normalizes. The editor attribute is load-bearing:
 * it is the fallback findScopeFromSelection looks for when no block matches.
 */
const mountHost = (html: string): HTMLElement => {
  const element = document.createElement('div');

  element.setAttribute('data-blok-editor', '');
  element.innerHTML = html;
  document.body.appendChild(element);
  hosts.push(element);

  return element;
};

/**
 * querySelector that fails the test instead of returning null.
 */
const queryOne = (root: ParentNode, selector: string): HTMLElement => {
  const found = root.querySelector(selector);

  if (!(found instanceof HTMLElement)) {
    throw new Error(`fixture is missing ${selector}`);
  }

  return found;
};

/**
 * First child of a fixture element, as a plain Node.
 */
const firstChildOf = (element: Element): ChildNode => {
  const child = element.firstChild;

  if (child === null) {
    throw new Error('fixture element has no child node');
  }

  return child;
};

/**
 * findScopeFromSelection reads anchorNode and focusNode only, and the two have
 * to move independently to tell `anchorNode ?? focusNode` from
 * `anchorNode && focusNode` — a real collapsed Selection always keeps them equal.
 */
const fakeSelection = (anchorNode: Node | null, focusNode: Node | null): Selection => {
  const partial: Pick<Selection, 'anchorNode' | 'focusNode'> = { anchorNode, focusNode };

  return partial as unknown as Selection;
};

describe('BoldNormalizationPass — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    hosts.splice(0).forEach((element) => element.remove());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('run — environment guard', () => {
    it('returns without touching the scope when there is no document', () => {
      const scope = mountHost('<b>keep</b>');
      const pass = new BoldNormalizationPass();
      let error: unknown = null;

      vi.stubGlobal('document', undefined);

      try {
        pass.run(scope);
      } catch (caught) {
        error = caught;
      } finally {
        vi.unstubAllGlobals();
      }

      // Without the guard the pass reaches document.createTreeWalker and throws.
      expect(error).toBeNull();
      expect(scope.innerHTML).toBe('<b>keep</b>');
    });
  });

  describe('processNode — node type routing', () => {
    it('ignores a walked node that reports a non-element nodeType', () => {
      const scope = mountHost('<b>x</b>');
      const legacy = queryOne(scope, 'b');

      // jsdom's TreeWalker filters on its internal node, so the element is still
      // walked while processNode reads this shadowed value. Nothing a real
      // TreeWalker yields is both non-element and carries a tagName, so the
      // nodeType guard is only observable with the two forced apart.
      Object.defineProperty(legacy, 'nodeType', {
        configurable: true,
        value: Node.TEXT_NODE,
      });

      // normalizeWhitespace must stay off, or the text-node branch returns first.
      new BoldNormalizationPass({ normalizeWhitespace: false }).run(scope);

      expect(scope.innerHTML).toBe('<b>x</b>');
    });
  });

  describe('processCollectedElements — legacy conversion', () => {
    it('leaves a <b> holding the preserved node as a <b>', () => {
      const scope = mountHost('<b>caret</b><strong>tail</strong>');
      const preserveNode = firstChildOf(queryOne(scope, 'b'));

      new BoldNormalizationPass({ preserveNode }).run(scope);

      expect(scope.innerHTML).toBe('<b>caret</b><strong>tail</strong>');
    });

    it('feeds a converted <b> back into the empty-strong removal', () => {
      const scope = mountHost('<b></b>');

      new BoldNormalizationPass().run(scope);

      // The <b> becomes an empty <strong>; only the push into strongElements
      // gets it removed in the same pass.
      expect(scope.innerHTML).toBe('');
    });
  });

  describe('processCollectedElements — queued elements', () => {
    it('skips a <strong> that an earlier removal in the same pass detached', () => {
      const markup =
        '<strong id="outer"><em><strong id="a"><br></strong><strong id="b"><br></strong></em></strong>';
      const scope = mountHost(markup);
      const outer = queryOne(scope, '#outer');

      new BoldNormalizationPass().run(scope);

      expect(scope.innerHTML).toBe('');
      // outer is empty (only <br>s) so it goes first in document order and takes
      // the two inner <strong>s out of the document with it. They are still
      // queued: the isConnected guard is the only thing that stops the pass from
      // editing the detached subtree.
      expect(outer.outerHTML).toBe(markup);
    });

    it('never restructures the <strong> that holds the preserved node', () => {
      const scope = mountHost('<strong>left</strong><strong>right</strong>');
      const preserveNode = firstChildOf(queryOne(scope, 'strong + strong'));

      new BoldNormalizationPass({ preserveNode }).run(scope);

      expect(scope.innerHTML).toBe('<strong>left</strong><strong>right</strong>');
    });

    it('treats a preserved node outside the scope as no preserved node at all', () => {
      const scope = mountHost('<strong>a</strong><strong>b</strong>');
      const preserveNode = document.createElement('span');

      new BoldNormalizationPass({ preserveNode }).run(scope);

      expect(scope.innerHTML).toBe('<strong>ab</strong>');
    });
  });

  describe('mergeWithAdjacent — next sibling', () => {
    it('merges forward into a bold sibling that is not queued itself', () => {
      // convertLegacyTags:false keeps the <b> out of strongElements, so the
      // previous-sibling branch can never fire for it and the merge can only
      // come from the next-sibling branch.
      const scope = mountHost('<strong>a</strong><b>b</b>');

      new BoldNormalizationPass({ convertLegacyTags: false }).run(scope);

      expect(scope.innerHTML).toBe('<strong>ab</strong>');
    });
  });

  describe('replaceNbspInTextNode — early return', () => {
    it('leaves a text node with no non-breaking space unwritten', () => {
      const scope = mountHost('<p>plain text</p>');
      const observer = new MutationObserver(() => undefined);

      observer.observe(scope, { characterData: true, subtree: true });

      new BoldNormalizationPass().run(scope);

      const records = observer.takeRecords();

      observer.disconnect();

      // Re-assigning the same string still queues a characterData record, so the
      // record count is what separates "returned early" from "wrote back an
      // identical value" — the markup is identical either way.
      expect(records).toHaveLength(0);
      expect(scope.innerHTML).toBe('<p>plain text</p>');
    });

    it('writes back a text node that does contain a non-breaking space', () => {
      const scope = mountHost(`<p>a${NBSP}b</p>`);
      const observer = new MutationObserver(() => undefined);

      observer.observe(scope, { characterData: true, subtree: true });

      new BoldNormalizationPass().run(scope);

      const records = observer.takeRecords();

      observer.disconnect();

      // Proves the observer above is wired to see the write it claims is absent.
      expect(records).toHaveLength(1);
      expect(scope.innerHTML).toBe('<p>a b</p>');
    });
  });

  describe('normalizeAroundSelection — scope resolution', () => {
    it('uses the anchor node when the selection carries no focus node', () => {
      const scope = mountHost('<b>x</b>');
      const anchor = firstChildOf(queryOne(scope, 'b'));

      BoldNormalizationPass.normalizeAroundSelection(fakeSelection(anchor, null));

      expect(scope.innerHTML).toBe('<strong>x</strong>');
    });

    it('scopes to an element anchor itself rather than to its parent', () => {
      const scope = mountHost('<div data-blok-component="paragraph"><b>in</b></div><b>out</b>');
      const paragraph = queryOne(scope, '[data-blok-component="paragraph"]');

      BoldNormalizationPass.normalizeAroundSelection(fakeSelection(paragraph, null));

      expect(scope.innerHTML).toBe(
        '<div data-blok-component="paragraph"><strong>in</strong></div><b>out</b>'
      );
    });

    it('stops when the anchor node has no parent element', () => {
      const scope = mountHost('<b>x</b>');
      const orphan = document.createTextNode('detached');
      let error: unknown = null;

      try {
        BoldNormalizationPass.normalizeAroundSelection(fakeSelection(orphan, null));
      } catch (caught) {
        error = caught;
      }

      // Without the null check the fallback calls closest() on null.
      expect(error).toBeNull();
      expect(scope.innerHTML).toBe('<b>x</b>');
    });

    it('normalizes the containing block only, not the whole editor', () => {
      const scope = mountHost('<div data-blok-component="paragraph"><b>in</b></div><b>out</b>');
      const anchor = firstChildOf(queryOne(scope, '[data-blok-component="paragraph"] b'));

      BoldNormalizationPass.normalizeAroundSelection(fakeSelection(anchor, null));

      // The block wins over the editor fallback; the <b> outside it is untouched.
      expect(scope.innerHTML).toBe(
        '<div data-blok-component="paragraph"><strong>in</strong></div><b>out</b>'
      );
    });
  });

  /*
   * Three survivors in this file are equivalent mutants, not coverage holes.
   *
   * 1. `const bElements: HTMLElement[] = []` → `["Stryker was here"]` (line 108)
   *    and 2. the same on `strongElements` (line 109). The phantom string is the
   *    only reader-visible change, and both readers reject it: line 178 gates on
   *    `b.isConnected` and line 190 on `!strong.isConnected`, and a string's
   *    `.isConnected` is undefined. Neither array is read anywhere else — they
   *    are created in traverseAndNormalize, returned to run, and handed straight
   *    to processCollectedElements.
   *
   * 3. `if (this.options.convertLegacyTags)` → `if (true)` (line 176). Line 148,
   *    `if (this.options.convertLegacyTags && element.tagName === 'B')`, is the
   *    only push into bElements, so the option being false already guarantees the
   *    guarded forEach has nothing to iterate. `this.options` is assigned once in
   *    the constructor and never written again, so the two reads cannot disagree
   *    within one run. Killable only by mutating that private object mid-run from
   *    a getter side effect — not through the public API.
   */
});
