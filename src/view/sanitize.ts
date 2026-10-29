/**
 * DOM-free HTML sanitizer for the synchronous view renderer.
 *
 * Enforces the same {@link SanitizerConfig} rule shapes as the editor's
 * sanitizer pipeline (`src/components/utils/sanitizer.ts` → clean +
 * applyAttributeOverrides + stripUnsafeUrls), but over a src/html tree so it
 * runs in Node / workers / RSC with no `document`/`window` access.
 *
 * Semantics matched against the DOM cleaner (`src/components/utils/html-cleaner.ts`):
 * - non-allowlisted (or `false`) tag → unwrapped, children survive;
 *   `script`/`style` are the exception — dropped with their contents, and so
 *   is any element unwrapped inside SVG or MathML;
 * - `script`/`style` anywhere inside SVG or MathML are dropped with their
 *   contents, whatever the config says;
 * - an HTML `mglyph`/`malignmark` is removed with its contents;
 * - comments are removed;
 * - whitespace-only text nodes adjacent to block-element siblings are removed;
 * - inline elements containing block elements are unwrapped (invalid markup);
 * - nested block elements are unwrapped;
 * - `on*`, `srcdoc` and script URLs in URL attributes never survive;
 * - attr-map string values keep the attribute only when the value matches;
 *   FUNCTION-rule string values are forced onto the element afterwards
 *   (mirrors `applyAttributeOverrides`);
 * - `true` tag rules keep only the safe attribute set (mirrors
 *   `cloneTagConfig` → `preserveExistingAttributesRule`).
 *
 * src/html imports are confined to `src/view/` — never import this module from
 * the editor bundle graph.
 */
import { NS, parseFragment, serialize } from '../html';
import type { ChildNode as HtmlChildNode, DocumentFragment as HtmlDocumentFragment, Element as HtmlElement, ParentNode as HtmlParentNode, Template as HtmlTemplate, TextNode as HtmlTextNode } from '../html';

import type { SanitizerConfig, SanitizerRule } from '../../types';
import type { PlaintextRule, TagConfig } from '../../types/configs/sanitizer-config';
import {
  areInterchangeable,
  decoratesNothing,
  duplicatesAncestor,
  MAX_NORMALIZATION_SWEEPS,
  MERGEABLE_TAGS,
  VOID_CONTENT_TAGS,
  type InlineElementView,
} from '../shared/inline-normalization-policy';
import { isSafeAttribute, PLAINTEXT } from '../shared/sanitize-rules';
import { repairSurrogates } from './html-text';
import { hasUnsafeUrlProtocol, isScriptCarryingAttribute } from '../shared/url-policy';

/**
 * Block/inline tag lists copied from the DOM cleaner — they drive its
 * whitespace-trimming and invalid-nesting heuristics, which must match.
 */
const BLOCK_ELEMENT_NAMES = new Set(['p', 'li', 'td', 'th', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre']);
const INLINE_ELEMENT_NAMES = new Set(['a', 'b', 'strong', 'i', 'em', 'sub', 'sup', 'u', 'strike']);

/**
 * As in html-cleaner.ts: an HTML element of these names reparses as MathML
 * inside MathML text, so whatever it holds turns into live markup.
 */
const REPARSE_AS_MATHML = new Set(['mglyph', 'malignmark']);

const ESCAPE_HTML_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Entity-escape a string for safe interpolation into HTML text content or
 * double-quoted attribute values. Exported for the view emitters, which
 * interpolate scalar (non-HTML) block-data fields.
 * @param value - raw string
 */
export const escapeHtml = (value: string): string => {
  return value.replace(/[&<>"']/g, (char) => ESCAPE_HTML_MAP[char]);
};

/**
 * Whether the node is an element (has a tagName).
 * @param node - child node
 */
const isElementNode = (node: HtmlChildNode): node is HtmlElement => {
  return 'tagName' in node;
};

/**
 * Whether the node is a text node.
 * @param node - child node
 */
const isTextNode = (node: HtmlChildNode): node is HtmlTextNode => {
  return node.nodeName === '#text';
};

/**
 * Whether the node is a template element (content lives in a separate fragment).
 * @param node - element
 */
const isTemplateNode = (node: HtmlElement): node is HtmlTemplate => {
  return node.nodeName === 'template' && 'content' in node;
};

/**
 * Whether the element is one of the DOM cleaner's "block" tags.
 * @param node - child node
 */
const isBlockElement = (node: HtmlChildNode | null): boolean => {
  return node !== null && isElementNode(node) && BLOCK_ELEMENT_NAMES.has(node.tagName.toLowerCase());
};

/**
 * Nearest element sibling in the given direction, skipping text/comments —
 * mirrors DOM previousElementSibling/nextElementSibling for the DOM cleaner
 * whitespace heuristic.
 * @param parent - parent node whose children are scanned
 * @param index - index of the node whose sibling is requested
 * @param direction - -1 for previous, +1 for next
 */
const elementSibling = (parent: HtmlParentNode, index: number, direction: -1 | 1): HtmlChildNode | null => {
  const cursor = { at: index + direction };

  while (cursor.at >= 0 && cursor.at < parent.childNodes.length) {
    const sibling = parent.childNodes[cursor.at];

    if (isElementNode(sibling)) {
      return sibling;
    }
    cursor.at += direction;
  }

  return null;
};

/**
 * Read an attribute value from an element (names are lowercased by the
 * HTML parser).
 * @param node - element
 * @param name - attribute name
 */
const getAttr = (node: HtmlElement, name: string): string | null => {
  const attr = node.attrs.find((candidate) => candidate.name === name.toLowerCase());

  return attr ? attr.value : null;
};

/**
 * Set (update-in-place or append) an attribute on an element — mirrors
 * DOM setAttribute ordering so forced values land where the DOM pipeline puts
 * them.
 * @param node - element
 * @param name - attribute name (lowercase)
 * @param value - attribute value
 */
const setAttr = (node: HtmlElement, name: string, value: string): void => {
  const attr = node.attrs.find((candidate) => candidate.name === name);

  if (attr) {
    attr.value = value;

    return;
  }

  node.attrs.push({ name, value });
};

/**
 * Replace an element's attribute list in place (the `attrs` array is
 * mutated rather than reassigned).
 * @param node - element
 * @param attrs - attributes to keep
 */
const replaceAttrs = (node: HtmlElement, attrs: HtmlElement['attrs']): void => {
  node.attrs.splice(0, node.attrs.length, ...attrs);
};

/**
 * Remove an attribute from an element.
 * @param node - element
 * @param name - attribute name (lowercase)
 */
const removeAttr = (node: HtmlElement, name: string): void => {
  replaceAttrs(node, node.attrs.filter((candidate) => candidate.name !== name));
};

/**
 * Concatenated descendant text — mirrors DOM textContent for function rules.
 * @param node - element
 */
const collectText = (node: HtmlElement): string => {
  // A stack, not recursion: deep nesting would overflow the call stack.
  const pending: HtmlChildNode[] = [ ...node.childNodes ].reverse();
  const parts: string[] = [];

  while (pending.length > 0) {
    const child = pending.pop() as HtmlChildNode;

    if (isTextNode(child)) {
      parts.push(child.value);
    } else if (isElementNode(child)) {
      pending.push(...[ ...child.childNodes ].reverse());
    }
  }

  return parts.join('');
};

interface StyleProperty {
  property: string;
  value: string;
}

/**
 * Parse a style attribute into property/value pairs (naive split — no url()
 * or quoted-semicolon handling, matching what the color-preserving rules need).
 * @param styleText - raw style attribute value
 */
const parseStyleText = (styleText: string): StyleProperty[] => {
  return styleText.split(';').flatMap((declaration) => {
    const separatorIndex = declaration.indexOf(':');

    if (separatorIndex === -1) {
      return [];
    }

    const property = declaration.slice(0, separatorIndex).trim().toLowerCase();
    const value = declaration.slice(separatorIndex + 1).trim();

    return property !== '' && value !== '' ? [{ property, value }] : [];
  });
};

/**
 * Minimal style facade for built-in color rules.
 * Mutations normalize the style attribute; untouched attributes stay byte-identical.
 * @param node - element backing the facade
 */
const createStyleFacade = (node: HtmlElement): Pick<CSSStyleDeclaration, 'length' | 'item' | 'removeProperty' | 'getPropertyValue' | 'setProperty'> => {
  const properties = parseStyleText(getAttr(node, 'style') ?? '');

  const writeBack = (): void => {
    if (properties.length === 0) {
      removeAttr(node, 'style');

      return;
    }

    setAttr(node, 'style', properties.map(({ property, value }) => `${property}: ${value};`).join(' '));
  };

  return {
    get length(): number {
      return properties.length;
    },
    item(index: number): string {
      return properties[index]?.property ?? '';
    },
    getPropertyValue(property: string): string {
      return properties.find((candidate) => candidate.property === property.toLowerCase())?.value ?? '';
    },
    setProperty(property: string, value: string): void {
      const name = property.toLowerCase();
      const existing = properties.find((candidate) => candidate.property === name);

      if (existing) {
        existing.value = value;
      } else {
        properties.push({ property: name, value });
      }

      writeBack();
    },
    removeProperty(property: string): string {
      const index = properties.findIndex((candidate) => candidate.property === property.toLowerCase());

      if (index === -1) {
        return '';
      }

      const [removed] = properties.splice(index, 1);

      writeBack();

      return removed.value;
    },
  };
};

/**
 * Minimal DOMTokenList facade over an element's `class` attribute.
 * Supports what `markSanitizerConfig`'s rule uses (`length`, iteration,
 * `remove()`) plus `contains`/`add`/`toggle` for host-authored rules.
 * Mutations are written back to the `class` attribute (space-joined); an
 * emptied list drops the attribute, matching the DOM path. Untouched `class`
 * attributes stay byte-identical.
 * @param node - element backing the facade
 */
const createClassListFacade = (node: HtmlElement): DOMTokenList => {
  const tokens = (getAttr(node, 'class') ?? '').split(/\s+/).filter(Boolean);

  const writeBack = (): void => {
    if (tokens.length === 0) {
      removeAttr(node, 'class');

      return;
    }

    setAttr(node, 'class', tokens.join(' '));
  };

  const facade = {
    get length(): number {
      return tokens.length;
    },
    get value(): string {
      return tokens.join(' ');
    },
    item(index: number): string | null {
      return tokens[index] ?? null;
    },
    contains(token: string): boolean {
      return tokens.includes(token);
    },
    add(...values: string[]): void {
      for (const value of values) {
        if (!tokens.includes(value)) {
          tokens.push(value);
        }
      }
      writeBack();
    },
    remove(...values: string[]): void {
      for (const value of values) {
        const index = tokens.indexOf(value);

        if (index !== -1) {
          tokens.splice(index, 1);
        }
      }
      writeBack();
    },
    toggle(token: string, force?: boolean): boolean {
      const present = tokens.includes(token);
      const shouldHave = force ?? !present;

      if (shouldHave && !present) {
        tokens.push(token);
      } else if (!shouldHave && present) {
        tokens.splice(tokens.indexOf(token), 1);
      }

      writeBack();

      return shouldHave;
    },
    [Symbol.iterator](): IterableIterator<string> {
      return tokens[Symbol.iterator]();
    },
  };

  return facade as unknown as DOMTokenList;
};

/**
 * Minimal Element facade handed to function rules. Supports the surface the
 * repo's real rules use (`getAttribute`, `style`, `classList`) plus tagName /
 * hasAttribute / attributes / textContent for host-authored rules.
 * @param node - element backing the facade
 */
const createElementFacade = (node: HtmlElement): Element => {
  const facade = {
    get tagName(): string {
      return node.tagName.toUpperCase();
    },
    getAttribute(name: string): string | null {
      return getAttr(node, name);
    },
    hasAttribute(name: string): boolean {
      return getAttr(node, name) !== null;
    },
    get attributes(): Array<{ name: string; value: string }> {
      return node.attrs.map(({ name, value }) => ({ name, value }));
    },
    get textContent(): string {
      return collectText(node);
    },
    /**
     * Mirrors the DOM setter: every child is replaced with one text node. A
     * rule that rewrites derived content (the equation mark's KaTeX cache)
     * must behave identically on both sanitizers, and this is the mechanic the
     * DOM one uses. Runs BEFORE the walk recurses into the children, so what
     * is written here is what gets sanitized.
     */
    set textContent(value: string) {
      const textNode: HtmlTextNode = {
        nodeName: '#text',
        value,
        parentNode: node,
      };

      node.childNodes.splice(0, node.childNodes.length, textNode);
    },
    style: createStyleFacade(node),
    classList: createClassListFacade(node),
  };

  return facade as unknown as Element;
};

type RuleResolution =
  | { action: 'unwrap' }
  | { action: 'keep'; attrs: AttrDecision };

type AttrDecision =
  | { kind: 'all' }
  | { kind: 'safe' }
  | { kind: 'map'; map: Record<string, boolean | string>; forceStrings: boolean };

const UNWRAP: RuleResolution = { action: 'unwrap' };

/**
 * Resolve a tag rule against a concrete element into keep/unwrap + an
 * attribute decision, reproducing the editor pipeline's rule shaping
 * (`cloneTagConfig` / `wrapFunctionRule`) on top of the DOM cleaner's raw semantics.
 * @param rule - configured rule for the element's tag (may be undefined)
 * @param node - the element being evaluated
 */
const resolveRule = (rule: SanitizerRule | undefined, node: HtmlElement): RuleResolution => {
  if (rule === true) {
    return { action: 'keep', attrs: { kind: 'safe' } };
  }

  if (typeof rule === 'function') {
    const result: TagConfig | null = rule(createElementFacade(node));

    if (result === false) {
      return UNWRAP;
    }

    if (result === true) {
      return { action: 'keep', attrs: { kind: 'all' } };
    }

    // wrapFunctionRule maps a null/undefined result to {} — tag kept, attrs stripped
    return { action: 'keep', attrs: { kind: 'map', map: result ?? {}, forceStrings: true } };
  }

  if (typeof rule === 'object' && rule !== null) {
    return { action: 'keep', attrs: { kind: 'map', map: rule, forceStrings: false } };
  }

  // undefined, false, PLAINTEXT (clean() drops plaintext entries) and any
  // other malformed rule → not allowlisted
  return UNWRAP;
};

/**
 * Filter an element's attributes per the attr decision, then force
 * function-rule string values (mirrors the DOM cleaner's attr loop +
 * applyAttributeOverrides ordering: matching attrs stay in place, forced
 * values that were absent or mismatched are appended).
 * @param node - element to filter
 * @param decision - attribute decision from {@link resolveRule}
 */
const filterAttributes = (node: HtmlElement, decision: AttrDecision): void => {
  // Same check as html-cleaner.ts, so both sanitizers drop the same attributes.
  // href/src are left to applyUrlPolicy, which runs the URL rewrite first.
  replaceAttrs(node, node.attrs.filter((attr) => {
    const name = attr.name.toLowerCase();

    return name === 'href' || name === 'src' || !isScriptCarryingAttribute(name, attr.value);
  }));

  if (decision.kind === 'all') {
    return;
  }

  if (decision.kind === 'safe') {
    replaceAttrs(node, node.attrs.filter((attr) => isSafeAttribute(attr.name)));

    return;
  }

  const { map, forceStrings } = decision;

  replaceAttrs(node, node.attrs.filter((attr) => {
    const attrName = attr.name.toLowerCase();
    const attrRule = Object.hasOwn(map, attrName) ? map[attrName] : undefined;

    if (attrRule === true) {
      return true;
    }

    if (typeof attrRule === 'string') {
      return attrRule === attr.value;
    }

    return false;
  }));

  if (!forceStrings) {
    return;
  }

  for (const [name, attrRule] of Object.entries(map)) {
    // A forced value is written after the filter above, so it gets the same check.
    if (typeof attrRule === 'string' && !isScriptCarryingAttribute(name, attrRule)) {
      setAttr(node, name.toLowerCase(), attrRule);
    }
  }
};

/**
 * A URL rewrite bridge for inline anchors/media in a fragment: `(url, attr) =>
 * newUrl`, run before the unsafe-scheme strip. Returning `''` drops the URL.
 */
export type FragmentUrlTransform = (url: string, attr: 'href' | 'src') => string;

/**
 * Apply the URL rewrite hook (if any) then strip href/src attributes whose
 * (possibly rewritten) values resolve to unsafe schemes — the shared URL
 * policy (`stripUnsafeUrls` in the DOM pipeline). The transform runs BEFORE the
 * strip, so a rewrite can never smuggle in an unsafe scheme.
 * @param node - element to harden
 * @param transform - optional URL rewrite hook
 */
const applyUrlPolicy = (node: HtmlElement, transform: FragmentUrlTransform | undefined): void => {
  replaceAttrs(node, node.attrs.flatMap((attr) => {
    if (attr.name !== 'href' && attr.name !== 'src') {
      return [attr];
    }

    const resolved = transform === undefined ? attr.value : transform(attr.value, attr.name);

    if (typeof resolved !== 'string' || hasUnsafeUrlProtocol(resolved, attr.name)) {
      return [];
    }

    return [resolved === attr.value ? attr : { name: attr.name, value: resolved }];
  }));
};

/** One parent whose children the walk is cleaning. */
interface WalkLevel {
  parent: HtmlParentNode;
  /** Whether the parent counts as a block element. */
  parentIsBlock: boolean;
  /** Whether the parent is a top container: nested-block unwrapping is off there, as the DOM cleaner's root <div> has no parent. */
  parentIsTop: boolean;
  /** Whether the parent is inside SVG or MathML, or is one of their elements. */
  inForeign: boolean;
  /** Next child to visit; back to 0 after any structural change, as the DOM cleaner restarts the walk. */
  index: number;
}

/** What one child visit decided: the child to visit next, and the levels to clean before that. */
interface WalkStep {
  /** Next child; 0 restarts the walk. */
  next: number;
  /** A kept element's children, then its template content (cleaned first, as the last entry). */
  descend: WalkLevel[];
}

/**
 * A step that goes on among the same children.
 * @param next - next child to visit
 */
const moveTo = (next: number): WalkStep => ({ next, descend: [] });

/**
 * Handle the child at `level.index`.
 * @param level - parent being cleaned
 * @param config - tag allowlist
 * @param transform - optional URL rewrite hook
 */
const sanitizeChildAt = (level: WalkLevel, config: SanitizerConfig, transform: FragmentUrlTransform | undefined): WalkStep => {
  const { parent, parentIsBlock, parentIsTop, inForeign, index } = level;
  const node = parent.childNodes[index];

  if (isTextNode(node)) {
    const strippable = node.value.trim() === ''
      && (isBlockElement(elementSibling(parent, index, -1)) || isBlockElement(elementSibling(parent, index, 1)));

    if (!strippable) {
      return moveTo(index + 1);
    }

    parent.childNodes.splice(index, 1);

    return moveTo(0);
  }

  if (node.nodeName === '#comment') {
    parent.childNodes.splice(index, 1);

    return moveTo(0);
  }

  if (!isElementNode(node)) {
    return moveTo(index + 1);
  }

  const tagName = node.tagName.toLowerCase();
  const isForeign = inForeign || node.namespaceURI !== NS.HTML;

  // Their text re-parses as markup once it moves in or out of foreign content: mutation XSS.
  if (isForeign && (tagName === 'script' || tagName === 'style')) {
    parent.childNodes.splice(index, 1);

    return moveTo(0);
  }

  const resolution = resolveRule(Object.hasOwn(config, tagName) ? config[tagName] : undefined, node);
  const isInvalidInline = INLINE_ELEMENT_NAMES.has(tagName) && node.childNodes.some(isBlockElement);
  const isNestedBlock = parentIsBlock && !parentIsTop && BLOCK_ELEMENT_NAMES.has(tagName);

  if (resolution.action === 'unwrap' || isInvalidInline || isNestedBlock) {
    // Children hoisted into SVG or MathML change namespace on a reparse, so
    // an HTML <iframe> or <style> there turns its text into live markup.
    const intoForeign = 'tagName' in parent && parent.namespaceURI !== NS.HTML;
    // the DOM cleaner drops SCRIPT/STYLE contents instead of hoisting them
    const hoisted = tagName === 'script' || tagName === 'style' || intoForeign ? [] : node.childNodes;

    for (const child of hoisted) {
      child.parentNode = parent;
    }
    parent.childNodes.splice(index, 1, ...hoisted);

    return moveTo(0);
  }

  if (node.namespaceURI === NS.HTML && REPARSE_AS_MATHML.has(tagName)) {
    parent.childNodes.splice(index, 1);

    return moveTo(0);
  }

  filterAttributes(node, resolution.attrs);
  applyUrlPolicy(node, transform);

  const children: WalkLevel = { parent: node, parentIsBlock: BLOCK_ELEMENT_NAMES.has(tagName), parentIsTop: false, inForeign: isForeign, index: 0 };

  // As in the DOM cleaner: the serializer writes template.content, so it must
  // be sanitized or an allowed <template> would leak arbitrary markup.
  return {
    next: index + 1,
    descend: isTemplateNode(node)
      ? [children, { parent: node.content, parentIsBlock: false, parentIsTop: true, inForeign: isForeign, index: 0 }]
      : [children],
  };
};

/**
 * Sanitize a fragment in place with html-janitor's walk: after any removal it
 * restarts from the parent's first child, so hoisted children are judged again
 * in their new parent. The DOM cleaner gives the same output with fewer visits.
 *
 * Depth and restarts both go through an explicit stack, not recursion:
 * deep nesting or a long run of removable siblings would overflow the call stack.
 * @param root - fragment whose children are sanitized
 * @param config - tag allowlist
 * @param transform - optional URL rewrite hook
 */
const sanitizeTree = (root: HtmlParentNode, config: SanitizerConfig, transform: FragmentUrlTransform | undefined): void => {
  const levels: WalkLevel[] = [ { parent: root, parentIsBlock: true, parentIsTop: true, inForeign: false, index: 0 } ];

  while (levels.length > 0) {
    const level = levels[levels.length - 1];

    if (level.index >= level.parent.childNodes.length) {
      levels.pop();
    } else {
      const step = sanitizeChildAt(level, config, transform);

      level.index = step.next;
      levels.push(...step.descend);
    }
  }
};

/**
 * Build the shared normalization policy's element view from an element.
 * @param node - element to describe
 */
const inlineViewOf = (node: HtmlElement): InlineElementView => {
  const hasVoidContentDescendant = (candidate: HtmlElement): boolean => {
    // A stack, not recursion: deep nesting would overflow the call stack.
    const pending: HtmlElement[] = [ candidate ];

    while (pending.length > 0) {
      const elements = (pending.pop() as HtmlElement).childNodes.filter(isElementNode);

      if (elements.some((child) => VOID_CONTENT_TAGS.has(child.tagName.toUpperCase()))) {
        return true;
      }
      pending.push(...elements);
    }

    return false;
  };

  return {
    tagName: node.tagName.toUpperCase(),
    attributes: node.attrs.map((attr) => ({ name: attr.name, value: attr.value })),
    styleDeclarations: parseStyleText(getAttr(node, 'style') ?? ''),
    text: () => collectText(node),
    hasVoidContentDescendant: () => hasVoidContentDescendant(node),
  };
};

/**
 * Unwrap the children of `parent` that decorate nothing or repeat an ancestor.
 * @param parent - element whose children are checked
 * @param ancestors - views of the enclosing wrappers
 * @returns whether anything was unwrapped
 */
const unwrapRedundantChildren = (parent: HtmlParentNode, ancestors: InlineElementView[]): boolean => {
  /**
   * Hoist a redundant wrapper's children into its place.
   * @param node - wrapper to unwrap
   * @param index - its position among the parent's children
   */
  const unwrapAt = (node: HtmlElement, index: number): void => {
    for (const child of node.childNodes) {
      child.parentNode = parent;
    }
    parent.childNodes.splice(index, 1, ...node.childNodes);
  };

  /**
   * Whether a wrapper decorates nothing or repeats an ancestor.
   * @param node - candidate wrapper
   */
  const isRedundant = (node: HtmlElement): boolean => {
    if (!MERGEABLE_TAGS.has(node.tagName.toUpperCase())) {
      return false;
    }
    const view = inlineViewOf(node);

    return decoratesNothing(view) || duplicatesAncestor(view, ancestors);
  };

  /**
   * Walk the children once, unwrapping wrappers that decorate nothing or
   * repeat an ancestor. Rescans from the same index after a mutation.
   * @param start - child position to start from
   * @returns whether anything was unwrapped from here on
   */
  const unwrapFrom = (start: number): boolean => {
    const walk = { index: start, changed: false };

    while (walk.index < parent.childNodes.length) {
      const node = parent.childNodes[walk.index];

      if (isElementNode(node) && isRedundant(node)) {
        unwrapAt(node, walk.index);
        walk.changed = true;
        continue;
      }
      walk.index += 1;
    }

    return walk.changed;
  };

  return unwrapFrom(0);
};

/**
 * Merge adjacent children of `parent` that express the same formatting.
 * @param parent - element whose children are merged
 * @returns whether anything was merged
 */
const mergeAdjacentChildren = (parent: HtmlParentNode): boolean => {
  /**
   * Move every child of `right` to the end of `left`.
   * @param left - element that keeps the children
   * @param right - element that gives them up
   */
  const moveChildren = (left: HtmlElement, right: HtmlElement): void => {
    for (const child of right.childNodes) {
      child.parentNode = left;
      left.childNodes.push(child);
    }
  };

  /**
   * Merge each child with the following sibling while the two express the
   * same formatting.
   * @param start - child position to start from
   * @returns whether anything was merged from here on
   */
  const mergeFrom = (start: number): boolean => {
    const walk = { index: start, changed: false };

    while (walk.index < parent.childNodes.length - 1) {
      const left = parent.childNodes[walk.index];
      const right = parent.childNodes[walk.index + 1];

      if (isElementNode(left) && isElementNode(right) && areInterchangeable(inlineViewOf(left), inlineViewOf(right))) {
        moveChildren(left, right);
        parent.childNodes.splice(walk.index + 1, 1);
        walk.changed = true;
        continue;
      }
      walk.index += 1;
    }

    return walk.changed;
  };

  return mergeFrom(0);
};

/** One element the sweep is inside: its children were unwrapped, and are visited one by one. */
interface SweepFrame {
  parent: HtmlParentNode;
  /** The children after the unwrap pass; a child's sweep never changes this list. */
  children: HtmlChildNode[];
  next: number;
  changed: boolean;
}

/**
 * One normalization sweep over a subtree. Mirrors the DOM
 * implementation in `src/components/utils/inline-normalization.ts` — the two
 * share every decision via the policy module, and differ only in tree
 * mechanics. Returns whether anything changed so the caller can run to a
 * fixpoint.
 *
 * Each element: unwrap its children, sweep each child, then merge its
 * children. An explicit stack, not recursion: deep nesting would overflow the
 * call stack.
 *
 * `<template>` content is deliberately left alone: the DOM twin normalizes via
 * `querySelectorAll`, which does not descend into template content either.
 * @param root - subtree to normalize in place
 */
const normalizeInlineSweep = (root: HtmlParentNode): boolean => {
  // Outermost first. duplicatesAncestor only asks whether any one matches, so the order does not matter.
  const ancestors: InlineElementView[] = [];
  const open = (parent: HtmlParentNode): SweepFrame => {
    const changed = unwrapRedundantChildren(parent, ancestors);

    return { parent, children: [ ...parent.childNodes ], next: 0, changed };
  };
  const frames: SweepFrame[] = [ open(root) ];
  const result = { changed: false };

  while (frames.length > 0) {
    const frame = frames[frames.length - 1];

    const child = frame.next < frame.children.length ? frame.children[frame.next] : undefined;

    frame.next += 1;

    if (child !== undefined && isElementNode(child)) {
      ancestors.push(inlineViewOf(child));
      frames.push(open(child));
    }

    if (child !== undefined) {
      continue;
    }

    // Merge runs even when something already changed.
    const changed = mergeAdjacentChildren(frame.parent) || frame.changed;

    frames.pop();

    if (frames.length === 0) {
      result.changed = changed;
    } else {
      ancestors.pop();
      frames[frames.length - 1].changed ||= changed;
    }
  }

  return result.changed;
};

/**
 * Collapse redundant inline markup in a fragment, in place.
 * @param fragment - parsed fragment to normalize
 */
const normalizeInlineMarkupFragment = (fragment: HtmlParentNode): void => {
  /**
   * @param remaining - sweeps left before the safety valve trips
   */
  const runSweeps = (remaining: number): void => {
    if (remaining === 0 || !normalizeInlineSweep(fragment)) {
      return;
    }

    runSweeps(remaining - 1);
  };

  runSweeps(MAX_NORMALIZATION_SWEEPS);
};

/**
 * The characters a parse-and-serialize round trip can change: `<`, `>` and `&`
 * come back escaped, U+00A0 comes back as `&nbsp;`, a CR becomes a newline and
 * a NUL is dropped. A fragment holding none of them serializes to exactly what
 * went in, so it is returned unparsed. Nothing else may be added here — a tab,
 * a form feed, a lone surrogate and an astral emoji all survive the round trip
 * unchanged and must keep taking the fast path.
 *
 * This is most fields of a prose document, and the tokenizer is a character-by-
 * character tokenizer: the server package runs this on an interpreter, where
 * one skipped parse per field is the difference between a long article
 * rendering and exhausting the runtime's memory budget.
 * @param html - fragment markup
 */
const needsSanitizing = (html: string): boolean => /[<>&\r\u0000\u00A0]/.test(html);

/**
 * The <div> every fragment is parsed in, to match the DOM pipeline (the DOM cleaner
 * parses into a detached <div>); the parser's default context is <template>, which
 * treats table fragments differently. The parser only reads the context element, so
 * one is built once and shared — building it per call parses a second fragment
 * for every inline field in the document.
 */
const DIV_CONTEXT = parseFragment('<div></div>').childNodes[0] as HtmlElement;

/**
 * Sanitize an HTML fragment string against a {@link SanitizerConfig},
 * DOM-free. When the config is the {@link PLAINTEXT} sentinel the input is
 * treated as literal text and returned entity-escaped.
 * @param html - fragment markup to sanitize
 * @param config - tag allowlist, or PLAINTEXT
 * @param transform - optional URL rewrite hook applied before the unsafe-scheme strip
 */
export const sanitizeHtmlFragment = (
  html: string,
  config: SanitizerConfig | PlaintextRule,
  transform?: FragmentUrlTransform
): string => {
  if (config === PLAINTEXT) {
    return escapeHtml(html);
  }

  if (html === '' || !needsSanitizing(html)) {
    return html;
  }

  const contextElement = DIV_CONTEXT;
  /**
   * Retried on the input the parser refuses outright (where parse5 8.0.1 did): two adjacent low surrogates
   * make it throw, and one such field must not cost the whole document. See
   * `repairSurrogates`.
   * @param source - fragment markup to parse in the div context
   */
  const parseInContext = (source: string): HtmlDocumentFragment => {
    try {
      return parseFragment(contextElement, source);
    } catch (error) {
      const repaired = repairSurrogates(source);

      // Same text again would fail again: a stack overflow is a RangeError too.
      if (!(error instanceof RangeError) || repaired === source) {
        throw error;
      }

      return parseFragment(contextElement, repaired);
    }
  };

  const fragment = parseInContext(html);

  sanitizeTree(fragment, config, transform);
  normalizeInlineMarkupFragment(fragment);

  return serialize(fragment);
};
