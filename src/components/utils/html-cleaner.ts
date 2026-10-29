/**
 * Blok's allowlist HTML cleaner. It gives the same output as html-janitor 2.0.4,
 * which it replaced, on everything `test/fixtures/html-cleaner` records, except
 * for these deliberate fixes:
 * - rules are read by own key only (`<constructor>` used to get `Object` as its rule);
 * - `on*` and `srcdoc` never survive, whatever the rule says, nor a script
 *   URL in any URL attribute (`href`, `src`, `xlink:href`, `action`, …);
 * - an allowed `<template>` has its content cleaned too (html-janitor never looked inside);
 * - script/style text is dropped in any namespace, not only HTML;
 * - a `null` rule acts as `{}` instead of throwing on the first attribute;
 * - a `<form>` whose controls shadow its DOM properties (`<input name="nodeName">`)
 *   is removed with its subtree;
 * - an element unwrapped inside SVG or MathML goes with its children, and an
 *   HTML `mglyph`/`malignmark` is removed (both re-parse as live markup);
 * - `script`/`style` anywhere inside SVG or MathML are removed with their
 *   text, whatever the config says;
 * - processing instructions are removed (Chromium parses `<!a …>` as one;
 *   html-janitor's walk skipped them and kept them in its output);
 * - removals no longer recurse, so a long run of removable siblings cannot
 *   overflow the stack.
 *
 * A function rule must depend only on the element it gets and what is inside
 * it: an element whose visit changed nothing is not visited again, so a rule
 * that reads its siblings or parent can see them stale.
 */

import { isScriptCarryingAttribute } from '../../shared/url-policy';

import { isClobbered } from './dom-clobbering';

/** Decides one attribute: kept when true, or when the value matches the string, or when the validator says so. */
export type CleanerAttributeRule = boolean | string | ((value: string, node: Element) => boolean);

/** Rule for one tag, or a function of the element that returns one. */
export type CleanerTagRule =
  | boolean
  | null
  | { [attribute: string]: CleanerAttributeRule }
  | ((node: Element) => unknown);

export type CleanerTags = Record<string, CleanerTagRule>;

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/**
 * In MathML text, these two stay MathML on a reparse while every other tag
 * becomes HTML. An HTML element of that name can only come from a parse that
 * will not round-trip (`<math><mtext><table><mglyph><style>`): mutation XSS.
 */
const REPARSE_AS_MATHML = new Set([ 'MGLYPH', 'MALIGNMARK' ]);

const BLOCK_ELEMENT_NAMES = ['P', 'LI', 'TD', 'TH', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE'];
const INLINE_ELEMENT_NAMES = ['A', 'B', 'STRONG', 'I', 'EM', 'SUB', 'SUP', 'U', 'STRIKE'];

const RAW_TEXT_TAGS = new Set([ 'SCRIPT', 'STYLE' ]);

/**
 * Whether the element is SVG or MathML, or sits inside one.
 * @param element - element to check
 */
const isInsideForeign = (element: Element): boolean => {
  const cursor: { at: Element | null } = { at: element };

  while (cursor.at !== null) {
    if (cursor.at.namespaceURI !== HTML_NAMESPACE) {
      return true;
    }
    cursor.at = cursor.at.parentElement;
  }

  return false;
};

const isBlockElement = (node: Node | null): boolean => node !== null && BLOCK_ELEMENT_NAMES.includes(node.nodeName);

const isInlineElement = (node: Node): boolean => INLINE_ELEMENT_NAMES.includes(node.nodeName);

const ownValue = (map: Record<string, unknown>, key: string): unknown => (Object.hasOwn(map, key) ? map[key] : undefined);

/**
 * Siblings read through Node.prototype, not the node: a clobbered `<form>`
 * shadows its own `previousSibling`/`nextSibling` with a named control.
 * @param node - node whose sibling is read
 */
const siblingBefore = (node: ChildNode): ChildNode | null => Reflect.get<Node, 'previousSibling'>(Node.prototype, 'previousSibling', node);

const siblingAfter = (node: ChildNode): ChildNode | null => Reflect.get<Node, 'nextSibling'>(Node.prototype, 'nextSibling', node);

/**
 * Whether an attribute is removed under the tag's resolved rule.
 * @param attribute - attribute to check
 * @param allowed - the tag rule after calling a function rule
 * @param node - element that carries the attribute
 */
const rejectsAttribute = (attribute: Attr, allowed: unknown, node: Element): boolean => {
  const name = attribute.name.toLowerCase();

  if (isScriptCarryingAttribute(name, attribute.value)) {
    return true;
  }

  if (allowed === true) {
    return false;
  }

  const rule = ownValue(Object(allowed ?? {}) as Record<string, unknown>, name);

  if (typeof rule === 'function') {
    return !(rule as (value: string, node: Element) => unknown)(attribute.value, node);
  }

  if (rule === undefined || rule === false) {
    return true;
  }

  if (typeof rule === 'string') {
    return rule !== attribute.value;
  }

  return false;
};

/**
 * The first element at or after `node` among its siblings.
 * @param node - where to start, or null past the end
 */
const elementFrom = (node: ChildNode | null): Element | null =>
  // An element's non-element children are text and comments, both CharacterData.
  node === null || node instanceof Element ? node : (node as CharacterData).nextElementSibling;

/** State of one cleanHtml call. */
class CleanerRun {
  /** Elements whose last visit changed nothing. Visiting them again is a no-op. */
  private readonly stable = new WeakSet<Element>();
  private mutations = 0;

  constructor(private readonly tags: CleanerTags) {}

  /**
   * Clean the children of `parent` in place.
   * @param parent - element (or template content) whose children are cleaned
   */
  public cleanChildren(parent: Element | DocumentFragment): void {
    new ChildWalk(this, parent).run();
  }

  /**
   * Whether an element's last visit changed nothing.
   * @param element - element to check
   */
  public isStable(element: Element): boolean {
    return this.stable.has(element);
  }

  /**
   * Clean one element or comment child. Returns true when it was removed or unwrapped.
   * @param node - child to clean
   * @param parent - its parent
   */
  public removesNode(node: ChildNode, parent: Element | DocumentFragment): boolean {
    // Checked before any property read: a clobbered form shadows even `nodeType`.
    if (node instanceof Element && isClobbered(node)) {
      return this.remove(parent, node);
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return this.remove(parent, node);
    }

    const element = node as Element;

    // Their text re-parses as markup once it moves in or out of foreign content: mutation XSS.
    if (RAW_TEXT_TAGS.has(element.nodeName.toUpperCase()) && isInsideForeign(element)) {
      return this.remove(parent, element);
    }

    if (this.stable.has(element)) {
      return false;
    }

    const mutationsBefore = this.mutations;
    const isInline = isInlineElement(element);
    const containsBlock = isInline && Array.prototype.some.call(element.childNodes, isBlockElement);
    const isNestedBlock = isBlockElement(parent) && isBlockElement(element) && parent.parentNode !== null;
    const rule = ownValue(this.tags, element.nodeName.toLowerCase());
    const allowed = typeof rule === 'function' ? (rule as (el: Element) => unknown)(element) : rule;
    const rejected = allowed === undefined || allowed === false;

    if ((isInline && containsBlock) || rejected || isNestedBlock) {
      return this.unwrap(element, parent);
    }

    if (element.namespaceURI === HTML_NAMESPACE && REPARSE_AS_MATHML.has(element.nodeName.toUpperCase())) {
      return this.remove(parent, element);
    }

    for (const attribute of Array.from(element.attributes)) {
      if (rejectsAttribute(attribute, allowed, element)) {
        element.removeAttribute(attribute.name);
        this.mutations += 1;
      }
    }

    // Its children live in `content`, which the child walk never reaches.
    if (element instanceof HTMLTemplateElement) {
      this.cleanChildren(element.content);
    }

    this.cleanChildren(element);

    if (this.mutations === mutationsBefore) {
      this.stable.add(element);
    }

    return false;
  }

  /**
   * Remove a child and count the change.
   * @param parent - its parent
   * @param node - child to remove
   */
  public remove(parent: Element | DocumentFragment, node: ChildNode): true {
    parent.removeChild(node);
    this.mutations += 1;

    return true;
  }

  /**
   * Replace an element by its children; script and style lose their text.
   * @param element - element to unwrap
   * @param parent - its parent
   */
  private unwrap(element: Element, parent: Element | DocumentFragment): true {
    const tagName = element.nodeName.toUpperCase();
    // Children moved into SVG or MathML change namespace on a reparse, so an
    // HTML <iframe> or <style> there turns its text into live markup.
    const intoForeign = parent instanceof Element && parent.namespaceURI !== HTML_NAMESPACE;
    const children = tagName === 'SCRIPT' || tagName === 'STYLE' || intoForeign ? [] : Array.from(element.childNodes);

    for (const child of children) {
      // A moved child gets a new parent, and the nested-block check depends on it.
      if (child instanceof Element) {
        this.stable.delete(child);
      }
      parent.insertBefore(child, element);
    }

    return this.remove(parent, element);
  }
}

/**
 * One walk over a parent's children.
 *
 * html-janitor started the walk again from the first child after every
 * removal, and output depends on it: an earlier sibling is checked again with
 * its new neighbours and its cleaned children (an inline tag whose child was
 * unwrapped into a block is itself unwrapped on the next pass). Walking from
 * the start each time is quadratic, so this repeats only the checks that can
 * change, in the same order:
 * - elements whose last visit changed something (stable ones would not change again);
 * - blank text nodes in the run right before the removal (their next element changed).
 * Everything else before the removal would be a no-op. If one of those repeated
 * visits removes an element, the walk falls back to starting from the first child.
 *
 * A blank text node goes when an element next to it is a block. The walk keeps
 * those neighbours itself: a browser finds `previousElementSibling` by scanning
 * back over text nodes, which is quadratic on a long run of unwrapped spans.
 */
class ChildWalk {
  /** Children whose last visit changed something. */
  private readonly unstable = new Set<Element>();
  /** Blank text nodes kept since the last kept element; they share both neighbours. */
  private readonly runBlanks: Text[] = [];
  private previousElement: Element | null = null;
  /** First element after the current run; undefined until needed. */
  private nextElement: Element | null | undefined = undefined;

  constructor(private readonly cleaner: CleanerRun, private readonly parent: Element | DocumentFragment) {}

  /** Clean every child. */
  public run(): void {
    // eslint-disable-next-line no-restricted-syntax -- walk cursor: it moves back after a removal
    let node = this.parent.firstChild;

    while (node !== null) {
      const before = siblingBefore(node);
      const isElement = node instanceof Element;

      if (!this.removes(node)) {
        this.noteKept(node);
        node = siblingAfter(node);

        continue;
      }

      if (isElement) {
        this.nextElement = undefined;
      }

      // Read before settling: settling may remove `before` itself.
      const resume = before === null ? this.parent.firstChild : siblingAfter(before);

      if (!this.settleAfterRemoval(resume)) {
        this.restart();
        node = this.parent.firstChild;

        continue;
      }

      node = resume;
    }
  }

  /**
   * Clean one child. Returns true when it was removed or unwrapped.
   * @param node - child to clean
   */
  private removes(node: ChildNode): boolean {
    if (!(node instanceof Text)) {
      return this.cleaner.removesNode(node, this.parent);
    }

    const strippable = node.data.trim() === ''
      && (isBlockElement(this.previousElement) || isBlockElement(this.nextElementAfter(node)));

    return strippable && this.cleaner.remove(this.parent, node);
  }

  /**
   * The element after the current run of non-elements, found once per run.
   * @param node - a node in the run
   */
  private nextElementAfter(node: ChildNode): Element | null {
    if (this.nextElement === undefined) {
      this.nextElement = elementFrom(siblingAfter(node));
    }

    return this.nextElement;
  }

  /**
   * Track a child the walk kept.
   * @param node - kept child
   */
  private noteKept(node: ChildNode): void {
    if (node instanceof Text) {
      if (node.data.trim() === '') {
        this.runBlanks.push(node);
      }

      return;
    }

    const element = node as Element;

    this.runBlanks.splice(0);
    this.previousElement = element;
    this.nextElement = undefined;
    this.trackStability(element);
  }

  /**
   * Do what html-janitor's restart would change after a removal. Returns false
   * when the walk must start again from the first child.
   * @param resume - the node now where the removed one was
   */
  private settleAfterRemoval(resume: ChildNode | null): boolean {
    if (this.revisitRemoves()) {
      return false;
    }

    if (this.runBlanks.length === 0) {
      return true;
    }

    // Every blank in the run has the same neighbours. The one before is not a
    // block (they would be gone), so only the one after decides. Only an
    // element removal can change it, and that clears the cache.
    if (this.nextElement === undefined) {
      this.nextElement = elementFrom(resume);
    }

    if (!isBlockElement(this.nextElement)) {
      return true;
    }

    // Each removal is another restart, so unstable elements are visited again per blank.
    for (const text of this.runBlanks.splice(0)) {
      this.cleaner.remove(this.parent, text);

      if (this.revisitRemoves()) {
        return false;
      }
    }

    return true;
  }

  /** Forget run state before walking again from the first child. */
  private restart(): void {
    this.runBlanks.splice(0);
    this.previousElement = null;
    this.nextElement = undefined;
  }

  /**
   * Record whether an element's last visit changed nothing.
   * @param element - visited element
   */
  private trackStability(element: Element): void {
    if (this.cleaner.isStable(element)) {
      this.unstable.delete(element);
    } else {
      this.unstable.add(element);
    }
  }

  /**
   * Visit again, in document order, the elements whose last visit changed
   * something. Returns true when one of them is removed.
   */
  private revisitRemoves(): boolean {
    if (this.unstable.size === 0) {
      return false;
    }

    const ordered = [ ...this.unstable ]
      .filter((element) => element.parentNode === this.parent)
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

    this.unstable.clear();

    for (const element of ordered) {
      if (this.cleaner.removesNode(element, this.parent)) {
        return true;
      }
      this.trackStability(element);
    }

    return false;
  }
}

/**
 * Keep only the tags and attributes `tags` allows. A tag not in `tags` is
 * unwrapped: its children stay, except for script/style text.
 * @param html - HTML to clean
 * @param tags - tag rules keyed by lowercase tag name
 * @throws {Error} when a rule is not an object, boolean, function or null
 */
export const cleanHtml = (html: string, tags: CleanerTags): string => {
  const valid = Object.values(tags).every((rule) => ['object', 'boolean', 'function'].includes(typeof rule));

  if (!valid) {
    throw new Error('The configuration was invalid');
  }

  const sandbox = document.implementation.createHTMLDocument('');
  const root = sandbox.createElement('div');

  root.innerHTML = html;
  new CleanerRun(tags).cleanChildren(root);

  return root.innerHTML;
};
