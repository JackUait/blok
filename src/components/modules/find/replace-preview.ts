/**
 * Shows what Replace All would write, in place, without editing the document.
 *
 * Each top-level block holding a match gets a read-only copy of its tool root,
 * with every match struck through and the replacement after it. The real tool
 * root is hidden by an attribute on the holder. Both writes sit outside every
 * tool root, so no block sees a mutation: nothing is saved, synced or undone.
 */
import { DATA_ATTR } from '../../constants/data-attributes';
import type { FindOptions } from './match-text';
import { editableHostOf } from './replace-text';
import { findRanges } from './text-index';

/** Must match the rules in find.css. */
const HOLDER = 'data-blok-find-preview';
const CLONE = 'data-blok-find-preview-clone';
const OLD = 'data-blok-find-preview-old';
const NEW = 'data-blok-find-preview-new';

/** Duplicates would break id references, anchors and e2e strict locators. */
const UNIQUE_ATTRIBUTES = ['id', 'data-blok-testid'];

const isClone = (node: Node): boolean => node instanceof Element && node.hasAttribute(CLONE);

/**
 * Whether a DOM change is only the preview being built or removed.
 * @param record - a change under the redactor
 */
export const isPreviewMutation = (record: MutationRecord): boolean => {
  const target = record.target instanceof Element ? record.target : record.target.parentElement;
  const changed = [...record.addedNodes, ...record.removedNodes];

  return target?.closest(`[${CLONE}]`) != null || (changed.length > 0 && changed.every(isClone));
};

/**
 * Put the old text and the replacement where the match was. Like
 * replaceRangeText, the replacement goes where the match starts, so it takes
 * the same marks.
 * @param range - a match inside the copy
 * @param replacement - the new text
 * @returns a range around the old and the new text
 */
const markReplacement = (range: Range, replacement: string): Range => {
  const start = range.startContainer;
  const offset = range.startOffset;
  const old = document.createElement('span');
  const next = document.createElement('span');

  old.setAttribute(OLD, '');
  next.setAttribute(NEW, '');
  next.textContent = replacement;
  old.append(range.extractContents());

  if (start instanceof Text) {
    if (offset < start.length) {
      start.splitText(offset);
    }
    start.after(old, next);
  } else {
    range.insertNode(next);
    range.insertNode(old);
  }

  const shown = document.createRange();

  shown.setStartBefore(old);
  shown.setEndAfter(next);

  return shown;
};

export class ReplacePreview {
  private readonly redactor: HTMLElement;
  private clones: HTMLElement[] = [];
  /** Real match → where the preview shows it. */
  private shown = new Map<Range, Range>();

  constructor(redactor: HTMLElement) {
    this.redactor = redactor;
  }

  /**
   * Where `range` is on screen: its preview while one is shown, else itself.
   * @param range - a real match
   */
  public rangeFor(range: Range): Range {
    return this.shown.get(range) ?? range;
  }

  /**
   * Preview replacing every editable match. Matches Replace All skips (read-only
   * content) are left as they are.
   * @param ranges - every match, in document order
   * @param query - the find query
   * @param options - case and whole-word switches
   * @param replacement - the new text
   */
  public show(ranges: Range[], query: string, options: FindOptions, replacement: string): void {
    this.clear();

    const byHolder = new Map<HTMLElement, Range[]>();

    ranges.filter((range) => editableHostOf(range) !== null).forEach((range) => {
      const holder = this.topHolderOf(range.startContainer);

      if (holder !== null) {
        byHolder.set(holder, [...byHolder.get(holder) ?? [], range]);
      }
    });

    byHolder.forEach((real, holder) => this.showIn(holder, real, query, options, replacement));
  }

  public clear(): void {
    this.clones.forEach((clone) => {
      clone.parentElement?.closest(`[${HOLDER}]`)?.removeAttribute(HOLDER);
      clone.remove();
    });
    this.clones = [];
    this.shown.clear();
  }

  private showIn(holder: HTMLElement, real: Range[], query: string, options: FindOptions, replacement: string): void {
    const content = holder.querySelector<HTMLElement>(`:scope > [${DATA_ATTR.elementContent}]`);
    const toolRoot = content?.firstElementChild;

    if (content === null || !(toolRoot instanceof HTMLElement)) {
      return;
    }

    const clone = toolRoot.cloneNode(true) as HTMLElement;
    const matches = findRanges(clone, query, options).filter((range) => editableHostOf(range) !== null);

    // A copy that disagrees with the real matches would preview the wrong text.
    if (matches.length !== real.length) {
      return;
    }

    const shown = matches.reverse().map((range) => markReplacement(range, replacement)).reverse();

    real.forEach((range, index) => this.shown.set(range, shown[index]));

    [clone, ...clone.querySelectorAll('*')].forEach((element) => {
      UNIQUE_ATTRIBUTES.forEach((name) => element.removeAttribute(name));
    });
    clone.setAttribute(CLONE, '');
    clone.setAttribute(DATA_ATTR.chrome, '');
    clone.setAttribute('aria-hidden', 'true');
    clone.setAttribute('inert', '');

    // After the tool root: the block finds its tool root as the first child.
    content.appendChild(clone);
    holder.setAttribute(HOLDER, '');
    this.clones.push(clone);
  }

  private topHolderOf(node: Node): HTMLElement | null {
    const parent = node.parentElement;

    if (parent === null || parent === this.redactor) {
      return null;
    }

    const outer = this.topHolderOf(parent);

    return outer ?? (parent.hasAttribute(DATA_ATTR.element) ? parent : null);
  }
}
