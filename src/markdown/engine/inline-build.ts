import type { PhrasingContent } from '../../../types/data-formats/markdown-tree';
import type { BracketItem, DelimItem, Item, LinkTarget } from './inline-items';

/**
 * Builds the phrasing tree from resolved items, without recursion: nesting
 * as deep as the input is long must not overflow the stack.
 */

interface Frame {
  children: PhrasingContent[];
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
export const plainText = (nodes: PhrasingContent[]): string => {
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
class TreeBuilder {
  private readonly frames: Frame[] = [{ children: [] }];

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
      const node = { type, children: [] as PhrasingContent[] };

      this.top.children.push(node);
      this.frames.push({ children: node.children });
    }
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
      this.frames.push({ children: [], image: target });

      return;
    }

    const node = targetNode(target, []);

    this.top.children.push(node);
    this.frames.push({ children: 'children' in node ? node.children : [] });
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
export const buildTree = (items: Item[]): PhrasingContent[] => new TreeBuilder().build(items);
