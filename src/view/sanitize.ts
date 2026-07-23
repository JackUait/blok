/**
 * DOM-free HTML sanitizer for the synchronous view renderer.
 *
 * Enforces the same {@link SanitizerConfig} rule shapes as the editor's
 * html-janitor pipeline (`src/components/utils/sanitizer.ts` → clean +
 * applyAttributeOverrides + stripUnsafeUrls), but over a parse5 tree so it
 * runs in Node / workers / RSC with no `document`/`window` access.
 *
 * Semantics matched against html-janitor (node_modules/html-janitor):
 * - non-allowlisted (or `false`) tag → unwrapped, children survive;
 *   `script`/`style` are the exception — dropped with their contents;
 * - comments are removed;
 * - whitespace-only text nodes adjacent to block-element siblings are removed;
 * - inline elements containing block elements are unwrapped (invalid markup);
 * - nested block elements are unwrapped (janitor keepNestedBlockElements=false);
 * - attr-map string values keep the attribute only when the value matches;
 *   FUNCTION-rule string values are forced onto the element afterwards
 *   (mirrors `applyAttributeOverrides`);
 * - `true` tag rules keep only the safe attribute set (mirrors
 *   `cloneTagConfig` → `preserveExistingAttributesRule`).
 *
 * parse5 imports are confined to `src/view/` — never import this module from
 * the editor bundle graph.
 */
import { parseFragment, serialize } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

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
import { hasUnsafeUrlProtocol } from '../shared/url-policy';

type P5Element = DefaultTreeAdapterMap['element'];
type P5ChildNode = DefaultTreeAdapterMap['childNode'];
type P5ParentNode = DefaultTreeAdapterMap['parentNode'];
type P5TextNode = DefaultTreeAdapterMap['textNode'];
type P5Template = DefaultTreeAdapterMap['template'];

/**
 * Block/inline tag lists copied from html-janitor — they drive its
 * whitespace-trimming and invalid-nesting heuristics, which must match.
 */
const BLOCK_ELEMENT_NAMES = new Set(['p', 'li', 'td', 'th', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre']);
const INLINE_ELEMENT_NAMES = new Set(['a', 'b', 'strong', 'i', 'em', 'sub', 'sup', 'u', 'strike']);

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
 * @param node - parse5 child node
 */
const isElementNode = (node: P5ChildNode): node is P5Element => {
  return 'tagName' in node;
};

/**
 * Whether the node is a text node.
 * @param node - parse5 child node
 */
const isTextNode = (node: P5ChildNode): node is P5TextNode => {
  return node.nodeName === '#text';
};

/**
 * Whether the node is a template element (content lives in a separate fragment).
 * @param node - parse5 element
 */
const isTemplateNode = (node: P5Element): node is P5Template => {
  return node.nodeName === 'template' && 'content' in node;
};

/**
 * Whether the element is one of html-janitor's "block" tags.
 * @param node - parse5 child node
 */
const isBlockElement = (node: P5ChildNode | null): boolean => {
  return node !== null && isElementNode(node) && BLOCK_ELEMENT_NAMES.has(node.tagName.toLowerCase());
};

/**
 * Nearest element sibling in the given direction, skipping text/comments —
 * mirrors DOM previousElementSibling/nextElementSibling for the janitor
 * whitespace heuristic.
 * @param parent - parent node whose children are scanned
 * @param index - index of the node whose sibling is requested
 * @param direction - -1 for previous, +1 for next
 */
const elementSibling = (parent: P5ParentNode, index: number, direction: -1 | 1): P5ChildNode | null => {
  const step = (i: number): P5ChildNode | null => {
    if (i < 0 || i >= parent.childNodes.length) {
      return null;
    }

    const sibling = parent.childNodes[i];

    return isElementNode(sibling) ? sibling : step(i + direction);
  };

  return step(index + direction);
};

/**
 * Read an attribute value from a parse5 element (names are lowercased by the
 * HTML parser).
 * @param node - parse5 element
 * @param name - attribute name
 */
const getAttr = (node: P5Element, name: string): string | null => {
  const attr = node.attrs.find((candidate) => candidate.name === name.toLowerCase());

  return attr ? attr.value : null;
};

/**
 * Set (update-in-place or append) an attribute on a parse5 element — mirrors
 * DOM setAttribute ordering so forced values land where the DOM pipeline puts
 * them.
 * @param node - parse5 element
 * @param name - attribute name (lowercase)
 * @param value - attribute value
 */
const setAttr = (node: P5Element, name: string, value: string): void => {
  const attr = node.attrs.find((candidate) => candidate.name === name);

  if (attr) {
    attr.value = value;

    return;
  }

  node.attrs.push({ name, value });
};

/**
 * Replace a parse5 element's attribute list in place (the `attrs` array is
 * mutated rather than reassigned).
 * @param node - parse5 element
 * @param attrs - attributes to keep
 */
const replaceAttrs = (node: P5Element, attrs: P5Element['attrs']): void => {
  node.attrs.splice(0, node.attrs.length, ...attrs);
};

/**
 * Remove an attribute from a parse5 element.
 * @param node - parse5 element
 * @param name - attribute name (lowercase)
 */
const removeAttr = (node: P5Element, name: string): void => {
  replaceAttrs(node, node.attrs.filter((candidate) => candidate.name !== name));
};

/**
 * Concatenated descendant text — mirrors DOM textContent for function rules.
 * @param node - parse5 element
 */
const collectText = (node: P5Element): string => {
  return node.childNodes.map((child) => {
    if (isTextNode(child)) {
      return child.value;
    }

    return isElementNode(child) ? collectText(child) : '';
  }).join('');
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
 * Minimal CSSStyleDeclaration facade over a parse5 element's style attribute.
 * Supports exactly what `preserveColorStyles` uses: `length`, `item()`,
 * `removeProperty()` (plus `getPropertyValue()` for symmetry). Mutations are
 * written back to the style attribute in CSSOM serialization form
 * ("prop: value;") — the same normalization the DOM path produces when a
 * property is removed. Untouched style attributes stay byte-identical.
 * @param node - parse5 element backing the facade
 */
const createStyleFacade = (node: P5Element): Pick<CSSStyleDeclaration, 'length' | 'item' | 'removeProperty' | 'getPropertyValue'> => {
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
 * Minimal DOMTokenList facade over a parse5 element's `class` attribute.
 * Supports what `markSanitizerConfig`'s rule uses (`length`, iteration,
 * `remove()`) plus `contains`/`add`/`toggle` for host-authored rules.
 * Mutations are written back to the `class` attribute (space-joined); an
 * emptied list drops the attribute, matching the DOM path. Untouched `class`
 * attributes stay byte-identical.
 * @param node - parse5 element backing the facade
 */
const createClassListFacade = (node: P5Element): DOMTokenList => {
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
 * @param node - parse5 element backing the facade
 */
const createElementFacade = (node: P5Element): Element => {
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
 * (`cloneTagConfig` / `wrapFunctionRule`) on top of janitor's raw semantics.
 * @param rule - configured rule for the element's tag (may be undefined)
 * @param node - the element being evaluated
 */
const resolveRule = (rule: SanitizerRule | undefined, node: P5Element): RuleResolution => {
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
 * function-rule string values (mirrors janitor attr loop +
 * applyAttributeOverrides ordering: matching attrs stay in place, forced
 * values that were absent or mismatched are appended).
 * @param node - parse5 element to filter
 * @param decision - attribute decision from {@link resolveRule}
 */
const filterAttributes = (node: P5Element, decision: AttrDecision): void => {
  if (decision.kind === 'all') {
    return;
  }

  if (decision.kind === 'safe') {
    replaceAttrs(node, node.attrs.filter((attr) => isSafeAttribute(attr.name)));

    return;
  }

  const { map, forceStrings } = decision;

  replaceAttrs(node, node.attrs.filter((attr) => {
    const attrRule = map[attr.name.toLowerCase()];

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
    if (typeof attrRule === 'string') {
      setAttr(node, name.toLowerCase(), attrRule);
    }
  }
};

/**
 * Strip href/src attributes whose values resolve to unsafe schemes —
 * the shared URL policy (`stripUnsafeUrls` in the DOM pipeline).
 * @param node - parse5 element to harden
 */
const applyUrlPolicy = (node: P5Element): void => {
  replaceAttrs(node, node.attrs.filter((attr) => {
    if (attr.name !== 'href' && attr.name !== 'src') {
      return true;
    }

    return !hasUnsafeUrlProtocol(attr.value, attr.name);
  }));
};

/**
 * Sanitize a parent's children in place — a direct port of html-janitor's
 * `_sanitize` walk (including its restart-after-mutation behavior, which
 * re-evaluates hoisted children in their new parent context).
 * @param parent - node whose children are sanitized
 * @param config - tag allowlist
 * @param parentIsBlock - whether the parent counts as a block element
 * @param parentIsTop - whether the parent is the top container (nested-block
 * unwrapping is suppressed there, as janitor's root <div> has no parent)
 */
const sanitizeChildren = (
  parent: P5ParentNode,
  config: SanitizerConfig,
  parentIsBlock: boolean,
  parentIsTop: boolean
): void => {
  /**
   * Handle one child; returns the index to continue scanning from
   * (0 after any structural mutation — janitor restarts the parent walk).
   * @param index - position of the child in parent.childNodes
   */
  const sanitizeChildAt = (index: number): number => {
    const node = parent.childNodes[index];

    if (isTextNode(node)) {
      const strippable = node.value.trim() === ''
        && (isBlockElement(elementSibling(parent, index, -1)) || isBlockElement(elementSibling(parent, index, 1)));

      if (!strippable) {
        return index + 1;
      }

      parent.childNodes.splice(index, 1);

      return 0;
    }

    if (node.nodeName === '#comment') {
      parent.childNodes.splice(index, 1);

      return 0;
    }

    if (!isElementNode(node)) {
      return index + 1;
    }

    const tagName = node.tagName.toLowerCase();
    const resolution = resolveRule(config[tagName], node);
    const isInvalidInline = INLINE_ELEMENT_NAMES.has(tagName) && node.childNodes.some(isBlockElement);
    const isNestedBlock = parentIsBlock && !parentIsTop && BLOCK_ELEMENT_NAMES.has(tagName);

    if (resolution.action === 'unwrap' || isInvalidInline || isNestedBlock) {
      // janitor drops SCRIPT/STYLE contents instead of hoisting them
      const hoisted = tagName === 'script' || tagName === 'style' ? [] : node.childNodes;

      for (const child of hoisted) {
        child.parentNode = parent;
      }
      parent.childNodes.splice(index, 1, ...hoisted);

      return 0;
    }

    filterAttributes(node, resolution.attrs);
    applyUrlPolicy(node);

    if (isTemplateNode(node)) {
      // Stricter than janitor (which cannot see template content via its
      // TreeWalker): parse5 serializes template.content, so it must be
      // sanitized or an allowed <template> would leak arbitrary markup.
      sanitizeChildren(node.content, config, false, true);
    }

    sanitizeChildren(node, config, BLOCK_ELEMENT_NAMES.has(tagName), false);

    return index + 1;
  };

  const scan = (index: number): void => {
    if (index >= parent.childNodes.length) {
      return;
    }

    scan(sanitizeChildAt(index));
  };

  scan(0);
};

/**
 * Build the shared normalization policy's element view from a parse5 element.
 * @param node - parse5 element to describe
 */
const inlineViewOf = (node: P5Element): InlineElementView => {
  const hasVoidContentDescendant = (candidate: P5Element): boolean =>
    candidate.childNodes.some(
      (child) =>
        isElementNode(child) &&
        (VOID_CONTENT_TAGS.has(child.tagName.toUpperCase()) || hasVoidContentDescendant(child))
    );

  return {
    tagName: node.tagName.toUpperCase(),
    attributes: node.attrs.map((attr) => ({ name: attr.name, value: attr.value })),
    styleDeclarations: parseStyleText(getAttr(node, 'style') ?? ''),
    text: () => collectText(node),
    hasVoidContentDescendant: () => hasVoidContentDescendant(node),
  };
};

/**
 * One normalization sweep over a parse5 subtree. Mirrors the DOM
 * implementation in `src/components/utils/inline-normalization.ts` — the two
 * share every decision via the policy module, and differ only in tree
 * mechanics. Returns whether anything changed so the caller can run to a
 * fixpoint.
 *
 * `<template>` content is deliberately left alone: the DOM twin normalizes via
 * `querySelectorAll`, which does not descend into template content either.
 * @param parent - subtree to normalize in place
 * @param ancestors - views of the enclosing wrappers, innermost first
 */
const normalizeInlineSweep = (parent: P5ParentNode, ancestors: InlineElementView[]): boolean => {
  /**
   * Hoist a redundant wrapper's children into its place.
   * @param node - wrapper to unwrap
   * @param index - its position among the parent's children
   */
  const unwrapAt = (node: P5Element, index: number): void => {
    for (const child of node.childNodes) {
      child.parentNode = parent;
    }
    parent.childNodes.splice(index, 1, ...node.childNodes);
  };

  /**
   * Walk the children once, unwrapping wrappers that decorate nothing or
   * repeat an ancestor. Rescans from the same index after a mutation.
   * @param index - child position to examine
   * @returns whether anything was unwrapped from here on
   */
  const unwrapFrom = (index: number): boolean => {
    if (index >= parent.childNodes.length) {
      return false;
    }

    const node = parent.childNodes[index];

    if (!isElementNode(node) || !MERGEABLE_TAGS.has(node.tagName.toUpperCase())) {
      return unwrapFrom(index + 1);
    }

    const view = inlineViewOf(node);

    if (decoratesNothing(view) || duplicatesAncestor(view, ancestors)) {
      unwrapAt(node, index);
      unwrapFrom(index);

      return true;
    }

    return unwrapFrom(index + 1);
  };

  /**
   * Merge each child with the following sibling while the two express the
   * same formatting.
   * @param index - child position to examine
   * @returns whether anything was merged from here on
   */
  const mergeFrom = (index: number): boolean => {
    if (index >= parent.childNodes.length - 1) {
      return false;
    }

    const left = parent.childNodes[index];
    const right = parent.childNodes[index + 1];
    const mergeable =
      isElementNode(left) && isElementNode(right) && areInterchangeable(inlineViewOf(left), inlineViewOf(right));

    if (!mergeable) {
      return mergeFrom(index + 1);
    }

    for (const child of right.childNodes) {
      child.parentNode = left;
      left.childNodes.push(child);
    }
    parent.childNodes.splice(index + 1, 1);
    mergeFrom(index);

    return true;
  };

  const unwrapped = unwrapFrom(0);
  const descended = [...parent.childNodes]
    .map((node) => isElementNode(node) && normalizeInlineSweep(node, [inlineViewOf(node), ...ancestors]))
    .some(Boolean);
  const merged = mergeFrom(0);

  return unwrapped || descended || merged;
};

/**
 * Collapse redundant inline markup in a parse5 fragment, in place.
 * @param fragment - parsed fragment to normalize
 */
const normalizeInlineMarkupFragment = (fragment: P5ParentNode): void => {
  /**
   * @param remaining - sweeps left before the safety valve trips
   */
  const runSweeps = (remaining: number): void => {
    if (remaining === 0 || !normalizeInlineSweep(fragment, [])) {
      return;
    }

    runSweeps(remaining - 1);
  };

  runSweeps(MAX_NORMALIZATION_SWEEPS);
};

/**
 * Sanitize an HTML fragment string against a {@link SanitizerConfig},
 * DOM-free. When the config is the {@link PLAINTEXT} sentinel the input is
 * treated as literal text and returned entity-escaped.
 * @param html - fragment markup to sanitize
 * @param config - tag allowlist, or PLAINTEXT
 */
export const sanitizeHtmlFragment = (html: string, config: SanitizerConfig | PlaintextRule): string => {
  if (config === PLAINTEXT) {
    return escapeHtml(html);
  }

  /**
   * Parse in a <div> context to match the DOM pipeline (janitor parses into a
   * detached <div>); parse5's default context is <template>, which treats
   * table fragments differently.
   */
  const contextElement = parseFragment('<div></div>').childNodes[0] as P5Element;
  const fragment = parseFragment(contextElement, html, {});

  sanitizeChildren(fragment, config, true, true);
  normalizeInlineMarkupFragment(fragment);

  return serialize(fragment);
};
