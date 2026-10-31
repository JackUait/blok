import { describe, expect, it } from 'vitest';
import { parse, parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { DOCUMENT_MODE, NS } from '../../../src/html/tags';
import {
  appendChild,
  createCommentNode,
  createDocumentFragment,
  createElement,
  createTextNode,
  isElementNode,
  isTextNode,
  type ChildNode,
  type Element,
  type Node,
  type ParentNode,
} from '../../../src/html/tree';
import { serialize } from '../../../src/html/serializer';
import { fuzzHtml, realDocuments, storedFields, treeConstructionInputs } from './corpus';

/**
 * Serialize, then parse the output again (with parse5). The HTML spec does not
 * promise that this gives the same tree, so this pins down exactly where it
 * does not, for the sanitizer's mXSS review. The output equals parse5's, so
 * none of this is a serializer bug.
 */

const divContext = ((): DefaultTreeAdapterMap['element'] => {
  const div = parseFragment('<div></div>').childNodes[0];

  if (!('tagName' in div)) {
    throw new Error('expected a div element');
  }

  return div;
})();

const SCRIPTING_OFF = { scriptingEnabled: false };

/** Each mode: how the tree is built (scripting on, like the serializer assumes), and the same parse with scripting off. */
const MODES: Array<[(html: string) => ParentNode, (html: string) => ParentNode]> = [
  [(html) => parse(html), (html) => parse(html, SCRIPTING_OFF)],
  [(html) => parseFragment(html), (html) => parseFragment(html, SCRIPTING_OFF)],
  [(html) => parseFragment(divContext, html, {}), (html) => parseFragment(divContext, html, SCRIPTING_OFF)],
];

const FORMATTING = new Set(['a', 'b', 'big', 'code', 'em', 'font', 'i', 'nobr', 's', 'small', 'strike', 'strong', 'tt', 'u']);
/** Start tags that close an open <p>. */
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset', 'figcaption',
  'figure', 'footer', 'header', 'hgroup', 'main', 'menu', 'nav', 'ol', 'p', 'search', 'section', 'summary', 'ul', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'pre', 'listing', 'form', 'table', 'hr', 'xmp', 'plaintext', 'li', 'dd', 'dt',
]);
const HEADING = /^h[1-6]$/;

const childrenOf = (node: ParentNode): ChildNode[] => ('content' in node ? node.content.childNodes : node.childNodes);

/** Document order. A stack, not recursion: corpus pages nest deeper than the call stack. */
const allNodes = (root: ParentNode): ChildNode[] => {
  const out: ChildNode[] = [];
  const stack = [...childrenOf(root)].reverse();

  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    out.push(node);
    if ('childNodes' in node) {
      stack.push(...[...childrenOf(node)].reverse());
    }
  }

  return out;
};

const isHtml = (node: Node | null, tagName?: string | RegExp): node is Element =>
  node !== null &&
  isElementNode(node) &&
  node.namespaceURI === NS.HTML &&
  (tagName === undefined || (typeof tagName === 'string' ? node.tagName === tagName : tagName.test(node.tagName)));

const hasAncestor = (node: ChildNode, test: (parent: Element) => boolean): boolean => {
  const parent = node.parentNode;

  return parent !== null && isElementNode(parent) && (test(parent) || hasAncestor(parent, test));
};

/** Why a tree may not survive a round trip. Every changed tree must carry at least one reason. */
const reasons = (tree: ParentNode): Set<string> => {
  const found = new Set<string>();
  const add = (condition: boolean, reason: string): void => {
    if (condition) {
      found.add(reason);
    }
  };

  // Only the doctype name is written, so ids that made the document quirky are lost.
  add('mode' in tree && tree.mode !== DOCUMENT_MODE.NO_QUIRKS && tree.childNodes.some((node) => node.nodeName === '#documentType'), 'doctype ids dropped');
  allNodes(tree).forEach((node) => {
    const parent = node.parentNode;

    if (isTextNode(node)) {
      add(node.value.includes('\r'), 'CR becomes LF');
      add(isHtml(parent, 'script') && node.value.includes('<!--'), 'script text with <!-- hides </script>');
      add(isHtml(parent, /^(pre|textarea|listing)$/) && parent.childNodes[0] === node && node.value.startsWith('\n'), 'leading LF dropped');

      return;
    }
    if (!isElementNode(node)) {
      add(node.nodeName === '#comment' && 'data' in node && node.data.includes('\r'), 'CR becomes LF');

      return;
    }
    add(node.attrs.some((attr) => attr.value.includes('\r')), 'CR becomes LF');
    add(isHtml(node, 'plaintext'), 'plaintext swallows the rest');
    add(isHtml(node, 'a') && hasAncestor(node, (up) => isHtml(up, 'a')), 'misnesting the parser undoes');
    add(isHtml(node, 'nobr') && hasAncestor(node, (up) => isHtml(up, 'nobr')), 'misnesting the parser undoes');
    add(isHtml(node, 'form') && hasAncestor(node, (up) => isHtml(up, 'form')), 'misnesting the parser undoes');
    add(isHtml(node, HEADING) && hasAncestor(node, (up) => isHtml(up, HEADING)), 'misnesting the parser undoes');
    add(isHtml(node) && CLOSES_P.has(node.tagName) && isHtml(parent, 'p'), 'misnesting the parser undoes');
    add(isHtml(node, 'table') && isHtml(parent) && FORMATTING.has(parent.tagName), 'misnesting the parser undoes');
  });

  return found;
};

/** Multiset difference: entries of `after` not matched in `before`. */
const added = (before: string[], after: string[]): string[] => {
  const left = new Map<string, number>();

  before.forEach((key) => left.set(key, (left.get(key) ?? 0) + 1));

  return after.filter((key) => {
    const count = left.get(key) ?? 0;

    left.set(key, count - 1);

    return count <= 0;
  });
};

const elementKeys = (tree: ParentNode): string[] =>
  allNodes(tree).filter(isElementNode).map((node) => `${node.namespaceURI} ${node.tagName}`);

const attributeKeys = (tree: ParentNode): string[] =>
  allNodes(tree)
    .filter(isElementNode)
    .flatMap((node) => node.attrs.map((attr) => `${node.tagName} ${attr.namespace ?? ''} ${attr.name}=${attr.value}`));

const tryParse = (build: (html: string) => ParentNode, html: string): ParentNode | null => {
  try {
    return build(html);
  } catch {
    // parse5 throws a RangeError on adjacent low surrogates.
    return null;
  }
};

describe('html serializer round trip through parse5', () => {
  it('never adds an attribute, and adds only <p> and formatting elements, on the whole corpus (scripting on both times)', () => {
    const inputs = [
      ...realDocuments().map(({ html }) => html),
      ...treeConstructionInputs(),
      ...storedFields(),
      ...Array.from({ length: 20_000 }, (_, seed) => fuzzHtml(seed)),
    ];
    const tally = { trees: 0, changed: 0, oneReason: 0, reparseThrew: 0, addedAttributes: [] as string[], addedElements: new Set<string>(), unexplained: [] as string[] };
    // Re-parsed with scripting off, noscript content turns from text into markup.
    const scriptingOff = { gainedWithNoscript: 0, gainedWithout: [] as string[] };
    const reasonCounts = new Map<string, number>();

    inputs.forEach((html) => {
      MODES.forEach(([build, buildScriptingOff]) => {
        const tree = tryParse(build, html);

        if (tree === null) {
          return;
        }
        const output = serialize(tree);
        const again = tryParse(build, output);

        tally.trees += 1;
        if (again === null) {
          // A tree can hold two lone low surrogates in separate text nodes; written out, they sit side by side.
          tally.reparseThrew += 1;

          return;
        }
        const original = new Set(attributeKeys(tree));
        // Reconstructing a formatting element clones it with its attributes:
        // another copy of a pair the tree already had, never a new one.
        const newAttributes = (reparsed: ParentNode): string[] =>
          added(attributeKeys(tree), attributeKeys(reparsed)).filter((key) => !(FORMATTING.has(key.split(' ')[0]) && original.has(key)));
        const off = tryParse(buildScriptingOff, output);
        const offGained = off !== null && (added(elementKeys(tree), elementKeys(off)).length > 0 || newAttributes(off).length > 0);

        if (offGained && allNodes(tree).some((node) => isHtml(node, 'noscript'))) {
          scriptingOff.gainedWithNoscript += 1;
        } else if (offGained) {
          scriptingOff.gainedWithout.push(...added(elementKeys(tree), elementKeys(off)), ...newAttributes(off));
        }
        tally.addedAttributes.push(...newAttributes(again));
        added(elementKeys(tree), elementKeys(again)).forEach((key) => tally.addedElements.add(key));
        if (serialize(again) === output) {
          return;
        }
        tally.changed += 1;
        const why = reasons(tree);

        why.forEach((reason) => reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1));
        tally.oneReason += why.size === 1 ? 1 : 0;
        if (why.size === 0) {
          tally.unexplained.push(html.slice(0, 200));
        }
      });
    });

    expect(tally.unexplained.slice(0, 3)).toEqual([]);
    expect(tally.addedAttributes.slice(0, 3)).toEqual([]);
    expect([...tally.addedElements].filter((key) => !key.startsWith(`${NS.HTML} `) || !(key.endsWith(' p') || FORMATTING.has(key.split(' ')[1])))).toEqual([]);
    expect(tally.trees).toBeGreaterThan(50_000);
    // Without noscript, scripting off adds nothing beyond what scripting on adds.
    expect(scriptingOff.gainedWithout.filter((key) => !tally.addedElements.has(key))).toEqual([]);
    expect(scriptingOff.gainedWithNoscript).toBeGreaterThan(0);
    console.log(JSON.stringify({ ...tally, addedElements: [...tally.addedElements], reasons: Object.fromEntries(reasonCounts), scriptingOff }));
  }, 600_000);

  /** Mostly trees parsing never builds but code that edits a tree can. The serializer writes them as the spec says. */
  describe('trees that change on re-parse', () => {
    const fragment = (...children: ChildNode[]): ParentNode => {
      const root = createDocumentFragment();

      children.forEach((child) => appendChild(root, child));

      return root;
    };
    const withText = (tagName: string, text: string, namespaceURI = NS.HTML): Element => {
      const node = createElement(tagName, namespaceURI, []);

      appendChild(node, createTextNode(text));

      return node;
    };
    const tags = (html: string): string[] => allNodes(parseFragment(html)).filter(isElementNode).map((node) => node.tagName);

    it('writes raw-text content unescaped, so a closing tag inside it ends the element early', () => {
      const html = serialize(fragment(withText('style', '</style><img src=x onerror=alert(1)>')));

      expect(html).toBe('<style></style><img src=x onerror=alert(1)></style>');
      expect(tags(html)).toEqual(['style', 'img']);
    });

    it('writes parsed noscript content raw, which a scripting-off parser reads as markup', () => {
      const tree = parseFragment('<noscript><img src=x onerror=alert(1)></noscript>');

      expect(allNodes(tree).filter(isElementNode).map((node) => node.tagName)).toEqual(['noscript']);
      const html = serialize(tree);

      expect(html).toBe('<noscript><img src=x onerror=alert(1)></noscript>');
      expect(allNodes(parseFragment(html, SCRIPTING_OFF)).filter(isElementNode).map((node) => node.tagName)).toEqual(['noscript', 'img']);
    });

    it('escapes the same text inside an SVG style, which is not raw text', () => {
      const html = serialize(fragment(withText('style', '</style><img src=x onerror=alert(1)>', NS.SVG)));

      expect(html).toBe('<style>&lt;/style&gt;&lt;img src=x onerror=alert(1)&gt;</style>');
    });

    it('writes comment data as is, so --> inside it ends the comment early', () => {
      const html = serialize(fragment(createCommentNode('--><img src=x onerror=alert(1)>')));

      expect(html).toBe('<!----><img src=x onerror=alert(1)>-->');
      expect(tags(html)).toEqual(['img']);
    });
  });
});
