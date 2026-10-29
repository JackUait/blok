import { describe, expect, it } from 'vitest';
import { parse, parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { DOCUMENT_MODE, NS } from '../../../src/html/tags';
import {
  appendChild,
  createCommentNode,
  createDocumentFragment,
  createElement,
  createTextNode,
  isCommentNode,
  isElementNode,
  isTextNode,
  type ChildNode,
  type Element,
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

const MODES: Array<[string, (html: string) => ParentNode]> = [
  ['parse', (html) => parse(html)],
  ['parseFragment', (html) => parseFragment(html)],
  ['parseFragment(div)', (html) => parseFragment(divContext, html, {})],
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

const allNodes = (root: ParentNode): ChildNode[] =>
  childrenOf(root).flatMap((child) => [child, ...('childNodes' in child ? allNodes(child) : [])]);

const isHtml = (node: ParentNode | null, tagName?: string | RegExp): node is Element =>
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
      add(isCommentNode(node) && node.data.includes('\r'), 'CR becomes LF');

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
  it('never adds an attribute, and adds only <p> and formatting elements, on the whole corpus', () => {
    const inputs = [
      ...realDocuments().map(({ html }) => html),
      ...treeConstructionInputs(),
      ...storedFields(),
      ...Array.from({ length: 20_000 }, (_, seed) => fuzzHtml(seed)),
    ];
    const tally = { trees: 0, changed: 0, reparseThrew: 0, addedAttributes: [] as string[], addedElements: new Set<string>(), unexplained: [] as string[] };
    const reasonCounts = new Map<string, number>();

    inputs.forEach((html) => {
      MODES.forEach(([, build]) => {
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
        tally.addedAttributes.push(...added(attributeKeys(tree), attributeKeys(again)));
        added(elementKeys(tree), elementKeys(again)).forEach((key) => tally.addedElements.add(key));
        if (serialize(again) === output) {
          return;
        }
        tally.changed += 1;
        const why = reasons(tree);

        why.forEach((reason) => reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1));
        if (why.size === 0) {
          tally.unexplained.push(html.slice(0, 200));
        }
      });
    });

    expect(tally.unexplained.slice(0, 3)).toEqual([]);
    expect(tally.addedAttributes.slice(0, 3)).toEqual([]);
    expect([...tally.addedElements].filter((key) => !key.startsWith(`${NS.HTML} `) || !(key.endsWith(' p') || FORMATTING.has(key.split(' ')[1])))).toEqual([]);
    expect(tally.trees).toBeGreaterThan(60_000);
    console.log(JSON.stringify({ ...tally, addedElements: [...tally.addedElements], reasons: Object.fromEntries(reasonCounts) }));
  }, 600_000);

  /** Trees parsing never builds, but code that edits a tree can. The serializer writes them as the spec says. */
  describe('hand-built trees that change on re-parse', () => {
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
