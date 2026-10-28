import type { PhrasingContent } from '../../../types/data-formats/markdown-tree';
import type { BracketItem, DelimItem, Item, LinkTarget } from './inline-items';

/**
 * Builds the phrasing tree from resolved items, without recursion: nesting
 * as deep as the input is long must not overflow the stack.
 */

/** Most spans and links one inside another; a deeper one is dropped and its content kept. */
export const MAX_INLINE_DEPTH = 100;

interface Frame {
  children: PhrasingContent[];
  /** Spans and links around this frame's content in the tree. */
  depth: number;
  /** Set for an image, whose children become its `alt`. */
  image?: LinkTarget;
}

/**
 * Append text, merging with a text node just before it.
 * @param children - where to append
 * @param value - the text
 */
const appendText = (children: PhrasingContent[], value: string): void => {
  const last = children[children.length - 1];

  if (value === '') {
    return;
  }

  if (last?.type === 'text') {
    last.value += value;
  } else {
    children.push({ type: 'text', value });
  }
};

/**
 * Plain text of nodes, as an image's alt: text values, code and HTML
 * values, and nested images' alts.
 * @param nodes - the image's content
 */
const plainText = (nodes: PhrasingContent[]): string => {
  const stack = [...nodes].reverse();
  const parts: string[] = [];

  for (const node = { at: stack.pop() }; node.at !== undefined; node.at = stack.pop()) {
    const current = node.at;

    if ('value' in current) {
      parts.push(current.value);
    } else if (current.type === 'image' || current.type === 'imageReference') {
      parts.push(current.alt);
    } else if ('children' in current) {
      [...current.children].reverse().forEach((child) => stack.push(child));
    }
  }

  return parts.join('');
};

/**
 * The node a link or image target makes, with its content.
 * @param target - what the bracket resolved to
 * @param children - the content
 */
const targetNode = (target: LinkTarget, children: PhrasingContent[]): PhrasingContent => {
  switch (target.type) {
    case 'link':
      return { type: 'link', url: target.url, title: target.title, children };
    case 'image':
      return { type: 'image', url: target.url, title: target.title, alt: plainText(children) };
    case 'linkReference':
      return { type: 'linkReference', identifier: target.identifier, label: target.label, referenceType: target.referenceType, children };
    case 'imageReference':
      return { type: 'imageReference', identifier: target.identifier, label: target.label, referenceType: target.referenceType, alt: plainText(children) };
  }
};

/** Walks the items once, keeping the open spans and links as frames. */
class PhrasingBuilder {
  private readonly frames: Frame[] = [{ children: [], depth: 0 }];

  /** The innermost open frame. */
  private get top(): Frame {
    return this.frames[this.frames.length - 1];
  }

  /**
   * @param items - resolved items
   */
  public build(items: Item[]): PhrasingContent[] {
    for (const item of items) {
      this.add(item);
    }

    return this.frames[0].children;
  }

  /**
   * One item.
   * @param item - the item
   */
  private add(item: Item): void {
    switch (item.kind) {
      case 'text':
        appendText(this.top.children, item.value);
        break;
      case 'node':
        this.top.children.push(item.node);
        break;
      case 'delim':
        this.delim(item);
        break;
      case 'bracket':
        this.bracket(item);
        break;
      case 'close':
        this.close();
    }
  }

  /**
   * A run: the spans it closes, its unused characters, the spans it opens.
   * @param run - the run
   */
  private delim(run: DelimItem): void {
    this.frames.length -= run.closes.length;
    appendText(this.top.children, run.char.repeat(run.rest));

    for (const type of [...run.opens].reverse()) {
      this.open({ type, children: [] });
    }
  }

  /**
   * Append a span or link and make it the open frame. Past the depth cap
   * the node is left out and its content goes to the frame around it.
   * @param node - the new wrapper, still empty
   */
  private open(node: PhrasingContent & { children: PhrasingContent[] }): void {
    const top = this.top;

    if (top.depth >= MAX_INLINE_DEPTH) {
      this.frames.push({ children: top.children, depth: top.depth });

      return;
    }

    top.children.push(node);
    this.frames.push({ children: node.children, depth: top.depth + 1 });
  }

  /**
   * `[` or `![`: text, or the start of a link or image.
   * @param bracket - the bracket
   */
  private bracket(bracket: BracketItem): void {
    const target = bracket.target;

    if (target === undefined) {
      appendText(this.top.children, bracket.image ? '![' : '[');

      return;
    }

    if (target.type === 'image' || target.type === 'imageReference') {
      this.frames.push({ children: [], depth: this.top.depth, image: target });

      return;
    }

    const node = targetNode(target, []);

    if ('children' in node) {
      this.open(node);
    }
  }

  /** The end of a link or image. */
  private close(): void {
    const frame = this.frames.pop();

    if (frame?.image !== undefined) {
      this.top.children.push(targetNode(frame.image, frame.children));
    }
  }
}

/**
 * The phrasing tree of resolved items.
 * @param items - items after emphasis resolution
 */
export const buildTree = (items: Item[]): PhrasingContent[] => new PhrasingBuilder().build(items);
