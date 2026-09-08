import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sanitize } from '../../../../src/cli/commands/convert-html/sanitizer';

/**
 * Mutation-coverage tests for `src/cli/commands/convert-html/sanitizer.ts`.
 *
 * Equivalence proofs for the two mutants left alive, both on L55
 * `return grandchildren.filter((gc) => gc.nodeType === gc.ELEMENT_NODE)`:
 *
 * - the `.filter(...)` call dropped (returns `grandchildren`), and
 * - the predicate replaced by `true` (which returns a copy of the same list).
 *
 * Both make `unwrapElement` hand back every moved child node, text and comment
 * nodes included, instead of only the elements. That return value has exactly
 * one consumer - `queue.push(...unwrapElement(el))` in `sanitizeNode` - and the
 * first statement of that loop is `if (child.nodeType !== child.ELEMENT_NODE)
 * continue`. So the extra entries are skipped on arrival: the same elements are
 * re-processed, in the same order, and nothing else reads the array. `nodeType`
 * and `ELEMENT_NODE` are both defined on `Node`, so neither the guard nor the
 * predicate can throw on a text or comment node.
 *
 * The mixed-children tests below are the ones that put text and comment nodes
 * into that return value; they pass either way, which is the point.
 */

const run = (html: string): string => {
  const dom = new DOMParser().parseFromString(html, 'text/html');

  sanitize(dom.body);

  return dom.body.innerHTML;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sanitize mutants - unwrapping a disallowed tag', () => {
  it('keeps text and elements in source order when the wrapper is dropped', () => {
    expect(run('<div>before <b>bold</b> after</div>')).toBe('before <b>bold</b> after');
  });

  it('sanitizes elements that were only reached by unwrapping their parent', () => {
    expect(run('<div>text<span class="x"><b style="color:red">kept</b></span>tail</div>'))
      .toBe('text<b>kept</b>tail');
  });

  it('unwraps a chain of disallowed wrappers around mixed content', () => {
    expect(run('<section>a<article>b<font>c<i>d</i></font></article></section>')).toBe('abc<i>d</i>');
  });

  it('keeps comments and text siblings of an unwrapped element in place', () => {
    expect(run('<div><!--note-->head<span>mid</span>tail</div>')).toBe('<!--note-->headmidtail');
  });
});

describe('sanitize mutants - attributes', () => {
  it('strips every attribute from a tag allowed with none', () => {
    expect(run('<p class="x" id="y">text</p>')).toBe('<p>text</p>');
  });

  it('keeps only the whitelisted attribute', () => {
    expect(run('<table><tr><td style="width:10px" colspan="2">cell</td></tr></table>'))
      .toBe('<table><tbody><tr><td style="width:10px">cell</td></tr></tbody></table>');
  });
});
