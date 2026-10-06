import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import { ToggleItem } from '../../../../src/tools/toggle';
import type { ToggleItemData, ToggleItemConfig } from '../../../../src/tools/toggle/types';
import { TOGGLE_ATTR } from '../../../../src/tools/toggle/constants';
import { createMemoryViewState } from '../../../helpers/view-state';

const createMockAPI = (): API => ({
  i18n: {
    t: (key: string) => key,
    has: () => false,
  },
  events: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
  blocks: {
    getChildren: vi.fn().mockReturnValue([]),
    getBlockIndex: vi.fn().mockReturnValue(0),
    insertInsideParent: vi.fn().mockReturnValue({ id: 'child-id' }),
  },
  caret: {
    setToBlock: vi.fn(),
  },
  viewState: createMemoryViewState(),
} as unknown as API);

const createToggle = (readOnly: boolean): { toggle: ToggleItem; api: API; element: HTMLElement } => {
  const api = createMockAPI();

  api.viewState.set('toggle-id', 'open', true);
  const options: BlockToolConstructorOptions<ToggleItemData, ToggleItemConfig> = {
    data: { text: 'Title' },
    config: {},
    api,
    readOnly,
    block: { id: 'toggle-id', dispatchChange: vi.fn() } as never,
  };
  const toggle = new ToggleItem(options);
  const element = toggle.render();

  document.body.appendChild(element);
  toggle.rendered();

  return { toggle, api, element };
};

const bodyPlaceholderOf = (element: HTMLElement): HTMLElement => {
  const placeholder = element.querySelector<HTMLElement>(`[${TOGGLE_ATTR.toggleBodyPlaceholder}]`);

  if (placeholder === null) {
    throw new Error('body placeholder not rendered');
  }

  return placeholder;
};

const contentOf = (element: HTMLElement): HTMLElement => {
  const content = element.querySelector<HTMLElement>(`[${TOGGLE_ATTR.toggleContent}]`);

  if (content === null) {
    throw new Error('content not rendered');
  }

  return content;
};

const pressEnter = (target: HTMLElement): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

  target.dispatchEvent(event);

  return event;
};

describe('ToggleItem booted read-only, then made editable in place', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('clicking the body placeholder adds a child, like an editable-boot toggle', () => {
    const { toggle, api, element } = createToggle(true);

    toggle.setReadOnly(false);
    bodyPlaceholderOf(element).click();

    expect(api.blocks.insertInsideParent).toHaveBeenCalledWith('toggle-id', 1);
    expect(api.caret.setToBlock).toHaveBeenCalledWith('child-id', 'start');
  });

  it('the content element handles Enter, like an editable-boot toggle', () => {
    const { toggle, element } = createToggle(true);

    toggle.setReadOnly(false);

    expect(pressEnter(contentOf(element)).defaultPrevented).toBe(true);
  });

  it('shows the body placeholder of an open empty toggle', () => {
    const { toggle, element } = createToggle(true);

    toggle.setReadOnly(false);

    expect(bodyPlaceholderOf(element).classList.contains('hidden')).toBe(false);
  });

  it('repeated setReadOnly(false) does not stack handlers', () => {
    const { toggle, api, element } = createToggle(true);

    toggle.setReadOnly(false);
    toggle.setReadOnly(false);
    bodyPlaceholderOf(element).click();

    expect(api.blocks.insertInsideParent).toHaveBeenCalledTimes(1);
  });

  it('setReadOnly(true) takes the editable handlers back off', () => {
    const { toggle, api, element } = createToggle(false);

    toggle.setReadOnly(true);
    bodyPlaceholderOf(element).click();

    expect(api.blocks.insertInsideParent).not.toHaveBeenCalled();
    expect(pressEnter(contentOf(element)).defaultPrevented).toBe(false);
  });
});
