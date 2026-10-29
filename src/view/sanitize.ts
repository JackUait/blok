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
  wrapperSignature,
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

/** URL rewrites so far, by attribute: what went into the transform and what came out. */
type UrlRewrites = Map<'href' | 'src', { from: string; to: string }>;

/**
 * Keyed by attribute list, not element: the parser gives an element it reopens
 * (`<a>` split across paragraphs) the same list as the original, and
 * replaceAttrs edits it in place, so both see the first rewrite.
 */
type RewriteMemo = Map<HtmlElement['attrs'], UrlRewrites>;

/**
 * Run the transform on a URL once. A removal makes the walk visit earlier
 * elements again, and a second run would rewrite the rewritten URL. A function
 * or forced-value rule may write the raw URL back, so that maps to the same result.
 * @param node - element that carries the URL
 * @param attr - href or src
 * @param value - the attribute's value now
 * @param transform - URL rewrite hook
 * @param rewritten - rewrites so far in this sanitize call
 */
const rewriteOnce = (
  node: HtmlElement,
  attr: 'href' | 'src',
  value: string,
  transform: FragmentUrlTransform,
  rewritten: RewriteMemo
): string => {
  const own = rewritten.get(node.attrs) ?? new Map<'href' | 'src', { from: string; to: string }>();
  const last = own.get(attr);

  if (last !== undefined && (value === last.to || value === last.from)) {
    return last.to;
  }

  const to = transform(value, attr);

  own.set(attr, { from: value, to });
  rewritten.set(node.attrs, own);

  return to;
};

/**
 * Apply the URL rewrite hook (if any) then strip href/src attributes whose
 * (possibly rewritten) values resolve to unsafe schemes — the shared URL
 * policy (`stripUnsafeUrls` in the DOM pipeline). The transform runs BEFORE the
 * strip, so a rewrite can never smuggle in an unsafe scheme.
 * @param node - element to harden
 * @param transform - optional URL rewrite hook
 * @param rewritten - rewrites so far in this sanitize call
 */
const applyUrlPolicy = (node: HtmlElement, transform: FragmentUrlTransform | undefined, rewritten: RewriteMemo): void => {
  replaceAttrs(node, node.attrs.flatMap((attr) => {
    if (attr.name !== 'href' && attr.name !== 'src') {
      return [attr];
    }

    const resolved = transform === undefined ? attr.value : rewriteOnce(node, attr.name, attr.value, transform, rewritten);

    if (typeof resolved !== 'string' || hasUnsafeUrlProtocol(resolved, attr.name)) {
      return [];
    }

    return [resolved === attr.value ? attr : { name: attr.name, value: resolved }];
  }));
};

/** One parent whose children a walk cleans. */
interface WalkContext {
  parent: HtmlParentNode;
  /** Whether the parent counts as a block element. */
  parentIsBlock: boolean;
  /** Whether the parent is a top container: nested-block unwrapping is off there, as the DOM cleaner's root <div> has no parent. */
  parentIsTop: boolean;
  /** Whether the parent is inside SVG or MathML, or is one of their elements. */
  inForeign: boolean;
}

/** What visiting one element decided. */
type ElementVisit =
  | { kind: 'kept' }
  | { kind: 'removed'; hoisted: HtmlChildNode[] }
  /** Kept, and these must be cleaned before it is settled: its children, then its template content (cleaned first, as the last entry). */
  | { kind: 'descend'; levels: WalkContext[] };

const KEPT: ElementVisit = { kind: 'kept' };

/**
 * Whether two attribute lists are equal, in order.
 * @param before - copy taken before the visit
 * @param after - the element's attributes now
 */
const sameAttrs = (before: HtmlElement['attrs'], after: HtmlElement['attrs']): boolean =>
  before.length === after.length
  && before.every((attr, index) => attr.name === after[index].name && attr.value === after[index].value);

/**
 * Whether a function rule left the children as they were. Rewriting them to
 * the same single text counts as no change: the page-reference rule sets
 * `textContent` on every visit.
 * @param before - copy taken before the visit
 * @param after - the element's children now
 */
const sameChildren = (before: HtmlChildNode[], after: HtmlChildNode[]): boolean => {
  if (before.length !== after.length) {
    return false;
  }

  if (before.length === 1 && isTextNode(before[0]) && isTextNode(after[0])) {
    return before[0].value === after[0].value;
  }

  return before.every((child, index) => child === after[index]);
};

/** State shared by every walk of one sanitize call. */
class CleanRun {
  /** Elements whose last visit changed nothing. Visiting them again is a no-op. */
  public readonly stable = new Set<HtmlElement>();
  /** Changes so far; an element is stable when its visit added none. */
  public mutations = 0;
  private readonly rewritten: RewriteMemo = new Map();

  constructor(private readonly config: SanitizerConfig, private readonly transform: FragmentUrlTransform | undefined) {}

  /**
   * Clean one element, except its children.
   * @param context - its parent
   * @param node - element to clean
   */
  public visitElement(context: WalkContext, node: HtmlElement): ElementVisit {
    const { parent, parentIsBlock, parentIsTop, inForeign } = context;
    const tagName = node.tagName.toLowerCase();
    const isForeign = inForeign || node.namespaceURI !== NS.HTML;

    // Their text re-parses as markup once it moves in or out of foreign content: mutation XSS.
    if (isForeign && (tagName === 'script' || tagName === 'style')) {
      return this.removeElement(parent, []);
    }

    if (this.stable.has(node)) {
      return KEPT;
    }

    // Taken before the rule runs: a function rule may rewrite both.
    const attrsBefore = node.attrs.map(({ name, value }) => ({ name, value }));
    const rule = Object.hasOwn(this.config, tagName) ? this.config[tagName] : undefined;
    const childrenBefore = typeof rule === 'function' ? [ ...node.childNodes ] : node.childNodes;
    const resolution = resolveRule(rule, node);
    const isInvalidInline = INLINE_ELEMENT_NAMES.has(tagName) && node.childNodes.some(isBlockElement);
    const isNestedBlock = parentIsBlock && !parentIsTop && BLOCK_ELEMENT_NAMES.has(tagName);

    if (resolution.action === 'unwrap' || isInvalidInline || isNestedBlock) {
      // Children hoisted into SVG or MathML change namespace on a reparse, so
      // an HTML <iframe> or <style> there turns its text into live markup.
      const intoForeign = 'tagName' in parent && parent.namespaceURI !== NS.HTML;

      // the DOM cleaner drops SCRIPT/STYLE contents instead of hoisting them
      return this.removeElement(parent, tagName === 'script' || tagName === 'style' || intoForeign ? [] : node.childNodes);
    }

    if (node.namespaceURI === NS.HTML && REPARSE_AS_MATHML.has(tagName)) {
      return this.removeElement(parent, []);
    }

    filterAttributes(node, resolution.attrs);
    applyUrlPolicy(node, this.transform, this.rewritten);

    if (!sameAttrs(attrsBefore, node.attrs) || !sameChildren(childrenBefore, node.childNodes)) {
      this.mutations += 1;
    }

    const children: WalkContext = { parent: node, parentIsBlock: BLOCK_ELEMENT_NAMES.has(tagName), parentIsTop: false, inForeign: isForeign };

    // As in the DOM cleaner: the serializer writes template.content, so it must
    // be sanitized or an allowed <template> would leak arbitrary markup.
    return {
      kind: 'descend',
      levels: isTemplateNode(node)
        ? [children, { parent: node.content, parentIsBlock: false, parentIsTop: true, inForeign: isForeign }]
        : [children],
    };
  }

  /**
   * Remove an element: `hoisted` takes its place.
   * @param parent - its parent
   * @param hoisted - children that take its place
   */
  private removeElement(parent: HtmlParentNode, hoisted: HtmlChildNode[]): ElementVisit {
    for (const child of hoisted) {
      child.parentNode = parent;
      // A moved child gets a new parent, and the nested-block check depends on it.
      if (isElementNode(child)) {
        this.stable.delete(child);
      }
    }
    this.mutations += 1;

    return { kind: 'removed', hoisted };
  }
}

/** Work a walk does before its next unvisited child. */
type WalkTask =
  | { kind: 'revisit'; element: HtmlElement; at: number }
  /** Decide whether the blank run before a removal goes. */
  | { kind: 'blanks' }
  | { kind: 'strip'; blanks: HtmlTextNode[]; next: number };

/** An element whose children are being cleaned; settled once they are. */
interface FinishFrame {
  kind: 'finish';
  walk: ChildWalk;
  element: HtmlElement;
  mutationsBefore: number;
  /** Index in `kept` when this is a revisit; undefined on the first visit. */
  revisitAt: number | undefined;
}

/**
 * One walk over a parent's children: the DOM cleaner's ChildWalk, over arrays.
 *
 * html-janitor started the walk again from the first child after every
 * removal, and output depends on it. Like the DOM cleaner, this repeats only
 * the checks a restart can change, in the same order: the elements whose last
 * visit changed something, then the blank text nodes right before the removal.
 * If a repeated visit removes an element, the walk starts again from the first child.
 */
class ChildWalk {
  public readonly kind = 'walk';
  /** Children still to visit, the next one last. */
  private readonly pending: HtmlChildNode[];
  /** Children visited and kept, in order. Blanks stripped later are in `dropped`. */
  private kept: HtmlChildNode[] = [];
  private readonly dropped = new Set<HtmlChildNode>();
  /** Kept elements whose last visit changed something, with their index in `kept`. */
  private readonly unstable = new Map<HtmlElement, number>();
  /** Blank text nodes kept since the last kept element; they share both neighbours. */
  private runBlanks: HtmlTextNode[] = [];
  private previousElement: HtmlElement | null = null;
  /** First element still pending; undefined until needed. */
  private nextElement: HtmlElement | null | undefined = undefined;
  /** Next task last. */
  private tasks: WalkTask[] = [];

  constructor(private readonly run: CleanRun, private readonly context: WalkContext) {
    this.pending = [ ...context.parent.childNodes ].reverse();
  }

  /**
   * Visit children until one descends or none are left; then write the kept ones back.
   * @param stack - walk stack, for an element that descends
   * @returns true when the walk is done
   */
  public step(stack: Array<ChildWalk | FinishFrame>): boolean {
    while (this.tasks.length > 0 || this.pending.length > 0) {
      const task = this.tasks.pop();
      const descended = task !== undefined
        ? this.runTask(task, stack)
        : this.visitNext(this.pending.pop() as HtmlChildNode, stack);

      if (descended) {
        return false;
      }
    }

    const { childNodes } = this.context.parent;

    childNodes.splice(0, childNodes.length);
    this.kept.filter((node) => !this.dropped.has(node)).forEach((node) => childNodes.push(node));

    return true;
  }

  /**
   * Settle an element once its children are clean.
   * @param frame - the element's finish frame
   */
  public settle(frame: FinishFrame): void {
    if (this.run.mutations === frame.mutationsBefore) {
      this.run.stable.add(frame.element);
    }

    if (frame.revisitAt !== undefined) {
      this.trackStability(frame.element, frame.revisitAt);
    } else {
      this.noteKeptElement(frame.element);
    }
  }

  /**
   * Visit the next pending child. Returns true when it descends.
   * @param node - child to visit
   * @param stack - walk stack
   */
  private visitNext(node: HtmlChildNode, stack: Array<ChildWalk | FinishFrame>): boolean {
    if (isTextNode(node)) {
      this.visitText(node);

      return false;
    }

    if (node.nodeName === '#comment') {
      this.afterRemoval();

      return false;
    }

    if (!isElementNode(node)) {
      this.kept.push(node);

      return false;
    }

    const mutationsBefore = this.run.mutations;
    const visit = this.run.visitElement(this.context, node);

    if (visit.kind === 'kept') {
      this.noteKeptElement(node);

      return false;
    }

    if (visit.kind === 'removed') {
      [ ...visit.hoisted ].reverse().forEach((child) => this.pending.push(child));
      this.nextElement = undefined;
      this.afterRemoval();

      return false;
    }

    return this.descend({ kind: 'finish', walk: this, element: node, mutationsBefore, revisitAt: undefined }, visit.levels, stack);
  }

  /**
   * A blank text node goes when an element next to it is a block.
   * @param node - text child
   */
  private visitText(node: HtmlTextNode): void {
    const blank = node.value.trim() === '';

    if (blank && (isBlockElement(this.previousElement) || isBlockElement(this.nextPendingElement()))) {
      this.afterRemoval();

      return;
    }

    this.kept.push(node);

    if (blank) {
      this.runBlanks.push(node);
    }
  }

  /**
   * Run one task. Returns true when a revisited element descends.
   * @param task - task to run
   * @param stack - walk stack
   */
  private runTask(task: WalkTask, stack: Array<ChildWalk | FinishFrame>): boolean {
    if (task.kind === 'revisit') {
      return this.revisit(task.element, task.at, stack);
    }

    if (task.kind === 'blanks') {
      // Every blank in the run has the same neighbours. The one before is not a
      // block (they would be gone), so only the one after decides.
      if (this.runBlanks.length > 0 && isBlockElement(this.nextPendingElement())) {
        this.tasks.push({ kind: 'strip', blanks: this.runBlanks, next: 0 });
        this.runBlanks = [];
      }

      return false;
    }

    if (task.next < task.blanks.length) {
      this.dropped.add(task.blanks[task.next]);
      this.run.mutations += 1;
      // Each removal is another restart, so unstable elements are visited again per blank.
      this.queueRevisits({ ...task, next: task.next + 1 });
    }

    return false;
  }

  /**
   * Visit a kept element again. Returns true when it descends.
   * @param element - unstable kept element
   * @param at - its index in `kept`
   * @param stack - walk stack
   */
  private revisit(element: HtmlElement, at: number, stack: Array<ChildWalk | FinishFrame>): boolean {
    const mutationsBefore = this.run.mutations;
    const visit = this.run.visitElement(this.context, element);

    if (visit.kind === 'removed') {
      this.restart(element, visit.hoisted);

      return false;
    }

    if (visit.kind === 'descend') {
      return this.descend({ kind: 'finish', walk: this, element, mutationsBefore, revisitAt: at }, visit.levels, stack);
    }

    this.trackStability(element, at);

    return false;
  }

  /**
   * Clean a kept element's children, then settle it. Returns true when a walk was pushed.
   * @param frame - the element's finish frame
   * @param levels - its children, then its template content
   * @param stack - walk stack
   */
  private descend(frame: FinishFrame, levels: WalkContext[], stack: Array<ChildWalk | FinishFrame>): boolean {
    // A walk over text alone changes nothing: no element, so no block next to a blank.
    const walks = levels
      .filter((level) => !level.parent.childNodes.every(isTextNode))
      .map((level) => new ChildWalk(this.run, level));

    if (walks.length === 0) {
      this.settle(frame);

      return false;
    }
    stack.push(frame, ...walks);

    return true;
  }

  /** Count a removed child, then queue what a restart from the first child would change. */
  private afterRemoval(): void {
    this.run.mutations += 1;
    this.queueRevisits({ kind: 'blanks' });
  }

  /**
   * Queue the unstable elements again, in document order, then `then`.
   * @param then - task to run after the revisits
   */
  private queueRevisits(then: WalkTask): void {
    const ordered = [ ...this.unstable ].sort((a, b) => b[1] - a[1]);

    this.unstable.clear();
    this.tasks.push(then);
    ordered.forEach(([element, at]) => this.tasks.push({ kind: 'revisit', element, at }));
  }

  /**
   * Walk again from the first child, `removed` replaced by `hoisted`.
   * Unlike the DOM cleaner, `unstable` is emptied: only elements before the
   * removal are revisited, as the old restart did.
   * @param removed - kept element that was just removed
   * @param hoisted - children that took its place
   */
  private restart(removed: HtmlElement, hoisted: HtmlChildNode[]): void {
    const order = this.kept.filter((node) => !this.dropped.has(node));
    const at = order.indexOf(removed);

    [ ...order.slice(0, at), ...hoisted, ...order.slice(at + 1) ].reverse().forEach((node) => this.pending.push(node));

    this.kept = [];
    this.dropped.clear();
    this.unstable.clear();
    this.runBlanks = [];
    this.previousElement = null;
    this.nextElement = undefined;
    this.tasks = [];
  }

  /**
   * @param element - kept element
   */
  private noteKeptElement(element: HtmlElement): void {
    this.kept.push(element);
    this.runBlanks = [];
    this.previousElement = element;
    this.nextElement = undefined;
    this.trackStability(element, this.kept.length - 1);
  }

  /**
   * Record whether an element's last visit changed nothing.
   * @param element - visited element
   * @param at - its index in `kept`
   */
  private trackStability(element: HtmlElement, at: number): void {
    if (this.run.stable.has(element)) {
      this.unstable.delete(element);
    } else {
      this.unstable.set(element, at);
    }
  }

  /** The first element still pending, found once per run. */
  private nextPendingElement(): HtmlElement | null {
    if (this.nextElement === undefined) {
      const cursor = { at: this.pending.length - 1 };

      while (cursor.at >= 0 && !isElementNode(this.pending[cursor.at])) {
        cursor.at -= 1;
      }
      this.nextElement = cursor.at >= 0 ? this.pending[cursor.at] as HtmlElement : null;
    }

    return this.nextElement;
  }
}

/**
 * Sanitize a fragment in place with html-janitor's semantics (see {@link ChildWalk}).
 *
 * Depth goes through an explicit stack, not recursion: deep nesting would
 * overflow the call stack.
 * @param root - fragment whose children are sanitized
 * @param config - tag allowlist
 * @param transform - optional URL rewrite hook
 */
const sanitizeTree = (root: HtmlParentNode, config: SanitizerConfig, transform: FragmentUrlTransform | undefined): void => {
  const run = new CleanRun(config, transform);
  const stack: Array<ChildWalk | FinishFrame> = [ new ChildWalk(run, { parent: root, parentIsBlock: true, parentIsTop: true, inForeign: false }) ];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];

    if (frame.kind === 'finish') {
      stack.pop();
      frame.walk.settle(frame);
    } else if (frame.step(stack)) {
      stack.pop();
    }
  }
};

/**
 * Subtree facts cached for one sweep, so a wrapper in a deep chain does not
 * walk the whole chain below it. Unwrapping keeps every subtree's text. A merge
 * changes its left side's, but only after the unwrap pass that reads it.
 */
interface SweepMemo {
  text: Map<HtmlElement, string>;
  hasVoidContent: Map<HtmlElement, boolean>;
}

/**
 * Fill `memo` for `root` and every uncached element below it, children first.
 * A stack, not recursion: deep nesting would overflow the call stack.
 * @param root - subtree to describe
 * @param memo - map to fill
 * @param summarize - an element's value from its children's values
 */
const fillMemo = <T>(root: HtmlElement, memo: Map<HtmlElement, T>, summarize: (node: HtmlElement) => T): T => {
  const pending: HtmlElement[] = [ root ];

  while (pending.length > 0) {
    const node = pending[pending.length - 1];
    const uncached = node.childNodes.filter((child): child is HtmlElement => isElementNode(child) && !memo.has(child));

    if (uncached.length > 0) {
      uncached.forEach((child) => pending.push(child));
    } else {
      pending.pop();
      memo.set(node, summarize(node));
    }
  }

  return memo.get(root) as T;
};

/**
 * Concatenated descendant text, as {@link collectText}.
 * @param node - element
 * @param memo - sweep cache
 */
const subtreeText = (node: HtmlElement, memo: SweepMemo): string =>
  fillMemo(node, memo.text, (element) => element.childNodes
    .map((child) => {
      if (isTextNode(child)) {
        return child.value;
      }

      return isElementNode(child) ? (memo.text.get(child) as string) : '';
    })
    .join(''));

/**
 * Whether any descendant is content in its own right.
 * @param node - element
 * @param memo - sweep cache
 */
const subtreeHasVoidContent = (node: HtmlElement, memo: SweepMemo): boolean =>
  fillMemo(node, memo.hasVoidContent, (element) => element.childNodes.some((child) => isElementNode(child)
    && (VOID_CONTENT_TAGS.has(child.tagName.toUpperCase()) || memo.hasVoidContent.get(child) === true)));

/**
 * Build the shared normalization policy's element view from an element.
 * @param node - element to describe
 * @param memo - sweep cache for the lazy subtree facts
 */
const inlineViewOf = (node: HtmlElement, memo: SweepMemo): InlineElementView => ({
  tagName: node.tagName.toUpperCase(),
  attributes: node.attrs.map((attr) => ({ name: attr.name, value: attr.value })),
  styleDeclarations: parseStyleText(getAttr(node, 'style') ?? ''),
  text: () => subtreeText(node, memo),
  hasVoidContentDescendant: () => subtreeHasVoidContent(node, memo),
});

/**
 * Replace a parent's children in place (the array is mutated, not reassigned).
 * @param parent - parent to update
 * @param children - its new children
 */
const replaceChildren = (parent: HtmlParentNode, children: HtmlChildNode[]): void => {
  parent.childNodes.splice(0, parent.childNodes.length);
  children.forEach((child) => parent.childNodes.push(child));
};

/**
 * Point each child's `parentNode` at its new parent.
 * @param parent - new parent
 * @param children - moved children
 */
const adopt = (parent: HtmlParentNode, children: HtmlChildNode[]): void => {
  for (const child of children) {
    child.parentNode = parent;
  }
};

/**
 * The enclosing wrappers. A wrapper's signature is worked out only once a
 * lookup needs it: most sweeps never look one up.
 */
class AncestorIndex {
  private readonly entered: InlineElementView[] = [];
  /** How many of `entered`, from the outermost, have a signature in `bySignature`. */
  private indexed = 0;
  private readonly bySignature = new Map<string, { view: InlineElementView; count: number }>();
  private readonly signatures: string[] = [];

  /**
   * An enclosing wrapper with the same signature as `view`, if any.
   * @param view - candidate wrapper
   */
  public matching(view: InlineElementView): InlineElementView | undefined {
    if (this.entered.length === 0) {
      return undefined;
    }

    for (const view of this.entered.slice(this.indexed)) {
      const key = wrapperSignature(view);
      const entry = this.bySignature.get(key) ?? { view, count: 0 };

      entry.count += 1;
      this.bySignature.set(key, entry);
      this.signatures.push(key);
    }
    this.indexed = this.entered.length;

    return this.bySignature.get(wrapperSignature(view))?.view;
  }

  /**
   * Add a wrapper the sweep enters.
   * @param view - the wrapper's view
   */
  public enter(view: InlineElementView): void {
    this.entered.push(view);
  }

  /** Drop the innermost wrapper, as the sweep leaves it. */
  public leave(): void {
    this.entered.pop();

    if (this.indexed <= this.entered.length) {
      return;
    }

    this.indexed = this.entered.length;

    const key = this.signatures.pop() as string;
    const entry = this.bySignature.get(key);

    if (entry !== undefined && --entry.count === 0) {
      this.bySignature.delete(key);
    }
  }
}

/**
 * Unwrap the children of `parent` that decorate nothing or repeat an ancestor.
 * A hoisted child is checked next, in its wrapper's place.
 * @param parent - element whose children are checked
 * @param ancestors - the enclosing wrappers
 * @param memo - sweep cache
 * @returns whether anything was unwrapped
 */
const unwrapRedundantChildren = (parent: HtmlParentNode, ancestors: AncestorIndex, memo: SweepMemo): boolean => {
  /**
   * Whether a wrapper decorates nothing or repeats an ancestor.
   * @param node - candidate wrapper
   */
  const isRedundant = (node: HtmlElement): boolean => {
    if (!MERGEABLE_TAGS.has(node.tagName.toUpperCase())) {
      return false;
    }
    const view = inlineViewOf(node, memo);

    if (decoratesNothing(view)) {
      return true;
    }

    // Only an ancestor with the same signature can match, so the policy gets just that one.
    const match = ancestors.matching(view);

    return duplicatesAncestor(view, match === undefined ? [] : [ match ]);
  };

  const pending = [ ...parent.childNodes ].reverse();
  const kept: HtmlChildNode[] = [];
  const result = { changed: false };

  while (pending.length > 0) {
    const node = pending.pop() as HtmlChildNode;

    if (isElementNode(node) && isRedundant(node)) {
      adopt(parent, node.childNodes);
      [ ...node.childNodes ].reverse().forEach((child) => pending.push(child));
      result.changed = true;
    } else {
      kept.push(node);
    }
  }

  if (result.changed) {
    replaceChildren(parent, kept);
  }

  return result.changed;
};

/**
 * Merge adjacent children of `parent` that express the same formatting: each
 * child joins the last kept one while the two match.
 * @param parent - element whose children are merged
 * @param memo - sweep cache
 * @returns whether anything was merged
 */
const mergeAdjacentChildren = (parent: HtmlParentNode, memo: SweepMemo): boolean => {
  const kept: HtmlChildNode[] = [];
  const result = { changed: false };

  for (const right of parent.childNodes) {
    const left = kept[kept.length - 1];

    if (left !== undefined && isElementNode(left) && isElementNode(right) && areInterchangeable(inlineViewOf(left, memo), inlineViewOf(right, memo))) {
      adopt(left, right.childNodes);
      right.childNodes.forEach((child) => left.childNodes.push(child));
      result.changed = true;
    } else {
      kept.push(right);
    }
  }

  if (result.changed) {
    replaceChildren(parent, kept);
  }

  return result.changed;
};

/** One element the sweep is inside: its children were unwrapped, and are visited one by one. */
interface SweepFrame {
  parent: HtmlParentNode;
  /** The children after the unwrap pass; a child's sweep never changes this list. */
  children: HtmlChildNode[];
  next: number;
  changed: boolean;
  /** Whether it is in the ancestor index; the root is not. */
  isAncestor: boolean;
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
  const memo: SweepMemo = { text: new Map(), hasVoidContent: new Map() };
  const ancestors = new AncestorIndex();
  const open = (parent: HtmlParentNode, isAncestor: boolean): SweepFrame => {
    const changed = unwrapRedundantChildren(parent, ancestors, memo);

    return { parent, children: [ ...parent.childNodes ], next: 0, changed, isAncestor };
  };
  const frames: SweepFrame[] = [ open(root, false) ];
  const result = { changed: false };

  while (frames.length > 0) {
    const frame = frames[frames.length - 1];

    const child = frame.next < frame.children.length ? frame.children[frame.next] : undefined;

    frame.next += 1;

    if (child !== undefined && isElementNode(child)) {
      ancestors.enter(inlineViewOf(child, memo));
      frames.push(open(child, true));
    }

    if (child !== undefined) {
      continue;
    }

    // Merge runs even when something already changed.
    const changed = mergeAdjacentChildren(frame.parent, memo) || frame.changed;

    frames.pop();

    if (frame.isAncestor) {
      ancestors.leave();
    }

    if (frames.length === 0) {
      result.changed = changed;
    } else {
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
 * Retried on the input the parser refuses outright (where parse5 8.0.1 did): two adjacent low surrogates
 * make it throw, and one such field must not cost the whole document. See
 * `repairSurrogates`.
 * @param source - fragment markup to parse in the div context
 */
const parseInDivContext = (source: string): HtmlDocumentFragment => {
  try {
    return parseFragment(DIV_CONTEXT, source);
  } catch (error) {
    const repaired = repairSurrogates(source);

    // Same text again would fail again: a stack overflow is a RangeError too.
    if (!(error instanceof RangeError) || repaired === source) {
      throw error;
    }

    return parseFragment(DIV_CONTEXT, repaired);
  }
};

const URL_ATTRIBUTE_NAME = /href|src/i;

/** Removes the element's `href`/`src` values whose scheme can execute; true when any went. */
const dropUnsafeUrlAttrs = (element: HtmlElement): boolean => {
  const kept = element.attrs.filter((attr) => !((attr.name === 'href' || attr.name === 'src') && hasUnsafeUrlProtocol(attr.value, attr.name)));

  if (kept.length === element.attrs.length) {
    return false;
  }
  replaceAttrs(element, kept);

  return true;
};

/**
 * Remove `href`/`src` values whose scheme can execute, DOM-free, without tag
 * allowlisting: the headless twin of `stripUnsafeUrls`. Returns the input
 * byte for byte unless an attribute was removed, because a round trip
 * re-escapes text that plaintext-like fields legitimately carry.
 * @param html - fragment markup
 */
export const stripUnsafeUrlsFragment = (html: string): string => {
  // Attribute names are never entity-decoded, so a field without these
  // letters has no URL attribute. Skipping the parse matters on the server's
  // interpreter, where a parse costs far more than this scan.
  if (html.indexOf('<') === -1 || !URL_ATTRIBUTE_NAME.test(html)) {
    return html;
  }

  const fragment = parseInDivContext(html);
  const pending: HtmlParentNode[] = [ fragment ];
  const removed = { any: false };

  // A stack, not recursion: 10 000 nested tags must not overflow.
  while (pending.length > 0) {
    const elements = (pending.pop() as HtmlParentNode).childNodes.filter(isElementNode);

    elements.forEach((element) => {
      removed.any = dropUnsafeUrlAttrs(element) || removed.any;
      pending.push(element, ...(isTemplateNode(element) ? [ element.content ] : []));
    });
  }

  return removed.any ? serialize(fragment) : html;
};

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

  const fragment = parseInDivContext(html);

  sanitizeTree(fragment, config, transform);
  normalizeInlineMarkupFragment(fragment);

  return serialize(fragment);
};
