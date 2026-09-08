import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API } from '../../../../types';
import type { ViewType } from '../../../../src/tools/database/types';

/**
 * Mutant sweep for src/tools/database/database-view-popover.ts.
 *
 * Every mutant on the live list is killed here; no survivor remains, so there is
 * no equivalence proof to record.
 *
 * What made the survivors observable:
 * - A recording PopoverDesktop double. The class hands its whole configuration
 *   to the constructor and never reads it back, so the constructor arguments are
 *   the only place width / minWidth / flippable / autoFocusFirstItem exist.
 * - getAttribute, never hasAttribute. Stryker replaces an empty attribute value
 *   with a sentinel string, and the attribute is still present either way.
 * - Positional child lookup (children.item(n)) to pin sibling order, not just
 *   presence, on top of the dropped-appendChild kills querySelector already gets.
 * - A self-echoing i18n stub (t returns "t:" + key) to make the translation key
 *   itself visible in the rendered text.
 * - Firing the popover Closed event twice: the second pass through the handler
 *   dereferences the already-nulled popover once the null guard is removed.
 */

interface RecordedItem {
  element?: HTMLElement;
  closeOnActivate?: boolean;
}

interface RecordedParams {
  items: RecordedItem[];
  trigger?: HTMLElement;
  width?: string;
  minWidth?: string;
  flippable?: boolean;
  autoFocusFirstItem?: boolean;
}

interface PopoverProbe {
  params: RecordedParams;
  destroyCount: number;
  showCount: number;
  /** Simulates the real popover emitting Closed (outside click, Escape). */
  fireClosed(): void;
}

const probes = vi.hoisted(() => ({ list: [] as PopoverProbe[] }));

vi.mock('../../../../src/components/utils/popover', () => {
  class MockPopoverDesktop {
    private readonly closedHandlers: Array<() => void> = [];
    private readonly probe: PopoverProbe;

    constructor(params: RecordedParams) {
      this.probe = {
        params,
        destroyCount: 0,
        showCount: 0,
        fireClosed: (): void => {
          for (const handler of [...this.closedHandlers]) {
            handler();
          }
        },
      };
      probes.list.push(this.probe);
    }

    show(): void {
      this.probe.showCount += 1;
    }

    destroy(): void {
      this.probe.destroyCount += 1;
    }

    on(event: string, handler: () => void): void {
      if (event === 'closed') {
        this.closedHandlers.push(handler);
      }
    }
  }

  return {
    PopoverDesktop: MockPopoverDesktop,
    PopoverItemType: {
      Default: 'default',
      Separator: 'separator',
      Html: 'html',
    },
  };
});

import { DatabaseViewPopover } from '../../../../src/tools/database/database-view-popover';

const lastProbe = (): PopoverProbe => {
  const probe = probes.list.at(-1);

  if (probe === undefined) {
    throw new Error('no popover was constructed');
  }

  return probe;
};

const elementsOf = (probe: PopoverProbe): HTMLElement[] => {
  const found: HTMLElement[] = [];

  for (const item of probe.params.items) {
    if (item.element !== undefined) {
      found.push(item.element);
    }
  }

  return found;
};

const headingElement = (): HTMLElement => {
  for (const element of elementsOf(lastProbe())) {
    if (element.hasAttribute('data-blok-database-view-popover-heading')) {
      return element;
    }
  }

  throw new Error('no heading element among the popover items');
};

const optionElement = (type: ViewType): HTMLElement => {
  for (const element of elementsOf(lastProbe())) {
    if (element.getAttribute('data-blok-database-view-option') === type) {
      return element;
    }
  }

  throw new Error(`no option element for ${type}`);
};

const childAt = (parent: Element, index: number): Element => {
  const child = parent.children.item(index);

  if (child === null) {
    throw new Error(`no child at index ${index}`);
  }

  return child;
};

const descendant = (root: ParentNode, selector: string): Element => {
  const found = root.querySelector(selector);

  if (found === null) {
    throw new Error(`no descendant matching ${selector}`);
  }

  return found;
};

/** i18n stub that echoes the key back, so the key is readable off the DOM. */
const echoingApi = (): API => ({
  i18n: {
    t: (key: string): string => `t:${key}`,
  },
} as unknown as API);

describe('DatabaseViewPopover mutants', () => {
  let onSelect: (type: ViewType) => void;
  let popover: DatabaseViewPopover;
  let anchor: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    probes.list.length = 0;
    onSelect = vi.fn<(type: ViewType) => void>();
    anchor = document.createElement('button');
    document.body.appendChild(anchor);
    popover = new DatabaseViewPopover({ onSelect });
  });

  afterEach(() => {
    popover.destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('hands the popover its exact sizing and focus configuration', () => {
    popover.open(anchor);

    const { params } = lastProbe();

    expect(params.width).toBe('auto');
    expect(params.minWidth).toBe('200px');
    expect(params.flippable).toBe(false);
    expect(params.autoFocusFirstItem).toBe(false);
    expect(params.trigger).toBe(anchor);
  });

  it('stamps the heading marker with an empty attribute value', () => {
    popover.open(anchor);

    expect(headingElement().getAttribute('data-blok-database-view-popover-heading')).toBe('');
  });

  it('translates the heading through the addView key', () => {
    const translated = new DatabaseViewPopover({ onSelect,
      api: echoingApi() });

    translated.open(anchor);

    expect(headingElement().textContent).toBe('t:tools.database.addView');

    translated.destroy();
  });

  it('stamps every option marker with an empty attribute value', () => {
    popover.open(anchor);

    const board = optionElement('board');

    expect(board.getAttribute('data-blok-database-view-option')).toBe('board');
    expect(descendant(board, '[data-blok-database-view-option-icon]')
      .getAttribute('data-blok-database-view-option-icon')).toBe('');
    expect(descendant(board, '[data-blok-database-view-option-text]')
      .getAttribute('data-blok-database-view-option-text')).toBe('');
    expect(descendant(board, '[data-blok-database-view-option-label]')
      .getAttribute('data-blok-database-view-option-label')).toBe('');
    expect(descendant(board, '[data-blok-database-view-option-desc]')
      .getAttribute('data-blok-database-view-option-desc')).toBe('');
  });

  it('nests the icon and the text wrapper directly under the option, in that order', () => {
    popover.open(anchor);

    const list = optionElement('list');

    expect(list.children.length).toBe(2);
    expect(childAt(list, 0).hasAttribute('data-blok-database-view-option-icon')).toBe(true);
    expect(childAt(list, 1).hasAttribute('data-blok-database-view-option-text')).toBe(true);
  });

  it('nests the label and the description directly under the text wrapper, in that order', () => {
    popover.open(anchor);

    const textEl = childAt(optionElement('list'), 1);

    expect(textEl.children.length).toBe(2);
    expect(childAt(textEl, 0).hasAttribute('data-blok-database-view-option-label')).toBe(true);
    expect(childAt(textEl, 1).hasAttribute('data-blok-database-view-option-desc')).toBe(true);
  });

  it('renders empty label and description text when no api is supplied', () => {
    popover.open(anchor);

    const board = optionElement('board');

    expect(descendant(board, '[data-blok-database-view-option-label]').textContent).toBe('');
    expect(descendant(board, '[data-blok-database-view-option-desc]').textContent).toBe('');
  });

  it('translates the label and the description through their own keys', () => {
    const translated = new DatabaseViewPopover({ onSelect,
      api: echoingApi() });

    translated.open(anchor);

    const board = optionElement('board');

    expect(descendant(board, '[data-blok-database-view-option-label]').textContent)
      .toBe('t:tools.database.viewTypeBoard');
    expect(descendant(board, '[data-blok-database-view-option-desc]').textContent)
      .toBe('t:tools.database.viewTypeBoardDescription');

    translated.destroy();
  });

  it('ignores a repeated Closed event once the popover reference is gone', () => {
    const onClose = vi.fn<() => void>();
    const withClose = new DatabaseViewPopover({ onSelect,
      onClose });

    withClose.open(anchor);

    const probe = lastProbe();

    probe.fireClosed();
    probe.fireClosed();

    expect(probe.destroyCount).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    withClose.destroy();
  });
});
