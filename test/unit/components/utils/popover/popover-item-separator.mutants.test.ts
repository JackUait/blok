import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import { twMerge } from '../../../../../src/components/utils/tw';
import {
  css,
  cssInline,
} from '../../../../../src/components/utils/popover/components/popover-item/popover-item-separator/popover-item-separator.const';
import { PopoverItemSeparator } from '../../../../../src/components/utils/popover/components/popover-item/popover-item-separator/popover-item-separator';

/**
 * Mutation coverage for PopoverItemSeparator.
 *
 * Two facts drive the shape of these tests:
 *
 * 1. `twMerge(css.line, cssInline.nestedLine)` collapses to exactly `css.line`
 *    (`h-px` and `w-full` are already the winning values), so a separator with
 *    ONLY `isNestedInline` cannot distinguish the nested line branch from the
 *    default one. It takes `{ isInline: true, isNestedInline: true }` — a
 *    documented combination — to push the nested-branch mutants into the inline
 *    branch, where the line becomes `h-full w-px`.
 * 2. Every class assertion compares the whole `className` string, because the
 *    hidden/inline/nested variants differ only by which Tailwind group wins.
 *
 * Proven-equivalent mutants (1-based coordinates, as reported):
 *
 * - 16:75 `ObjectLiteral: {}` — the `nodes` field initializer becomes `{}`.
 *   Both `root` and `line` are written before any public method can read them
 *   (`this.nodes.root = this.createRootElement()` in the constructor, and
 *   `this.nodes.line = line` inside it), and the class never tests for key
 *   presence, only truthiness. `null` and `undefined` are indistinguishable here.
 * - 53:9 `ConditionalExpression: false` — `if (!this.nodes.root)` becomes
 *   `if (false)`. `nodes.root` is assigned `document.createElement('div')` in
 *   the constructor and is never reassigned by this class or by the
 *   `PopoverItem` base (whose `destroy()` only calls the tooltip `hide()`), and
 *   nothing public exposes the field for writing. The guard is dead code, so
 *   the condition is already constantly false.
 * - 53:27 `BlockStatement: {}` — the same guard body (`return;`) is emptied.
 *   Equivalent for the same reason: the branch is unreachable.
 */
type SeparatorRenderParams = {
  isInline?: boolean;
  isNestedInline?: boolean;
};

type Variant = 'default' | 'inline' | 'nested';

const containerClass = (variant: Variant, isHidden: boolean): string => {
  const hidden = isHidden ? css.containerHidden : undefined;

  if (variant === 'nested') {
    return twMerge(css.container, cssInline.nestedContainer, hidden);
  }
  if (variant === 'inline') {
    return twMerge(css.container, cssInline.container, hidden);
  }

  return twMerge(css.container, hidden);
};

const lineClass = (variant: Variant): string => {
  if (variant === 'nested') {
    return twMerge(css.line, cssInline.nestedLine);
  }
  if (variant === 'inline') {
    return twMerge(css.line, cssInline.line);
  }

  return css.line;
};

const lineOf = (root: HTMLElement): HTMLElement => {
  const line = root.firstElementChild;

  if (!(line instanceof HTMLElement)) {
    throw new Error('separator has no line element');
  }

  return line;
};

const cases: Array<{ title: string; params: SeparatorRenderParams | undefined; variant: Variant }> = [
  { title: 'no render params', params: undefined, variant: 'default' },
  { title: 'empty render params', params: {}, variant: 'default' },
  { title: 'isInline only', params: { isInline: true }, variant: 'inline' },
  { title: 'isNestedInline only', params: { isNestedInline: true }, variant: 'nested' },
  { title: 'both inline flags', params: { isInline: true, isNestedInline: true }, variant: 'nested' },
];

describe('PopoverItemSeparator — styling contexts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  cases.forEach(({ title, params, variant }) => {
    describe(title, () => {
      it('renders the container class for its context', () => {
        const separator = new PopoverItemSeparator(params);

        expect(separator.getElement().className).toBe(containerClass(variant, false));
      });

      it('renders the line class for its context', () => {
        const separator = new PopoverItemSeparator(params);

        expect(lineOf(separator.getElement()).className).toBe(lineClass(variant));
      });

      it('swaps to the hidden container class and back', () => {
        const separator = new PopoverItemSeparator(params);
        const element = separator.getElement();

        separator.toggleHidden(true);
        expect(element.className).toBe(containerClass(variant, true));
        expect(element.getAttribute(DATA_ATTR.hidden)).toBe('true');

        separator.toggleHidden(false);
        expect(element.className).toBe(containerClass(variant, false));
        expect(element.hasAttribute(DATA_ATTR.hidden)).toBe(false);
      });
    });
  });
});

describe('PopoverItemSeparator — markup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks the container and the line with empty-valued data attributes', () => {
    const separator = new PopoverItemSeparator();
    const element = separator.getElement();

    expect(element.getAttribute(DATA_ATTR.popoverItemSeparator)).toBe('');
    expect(lineOf(element).getAttribute(DATA_ATTR.popoverItemSeparatorLine)).toBe('');
  });

  it('starts visible, not in the hidden variant', () => {
    const separator = new PopoverItemSeparator();
    const element = separator.getElement();

    expect(element.className).not.toContain('opacity-0');
    expect(element.hasAttribute(DATA_ATTR.hidden)).toBe(false);
  });
});
