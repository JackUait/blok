import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import { Header, type HeaderConfig, type HeaderData } from '../../../../src/tools/header';
import { TOGGLE_ATTR } from '../../../../src/tools/toggle/constants';

const createMockAPI = (): API => ({
  styles: {
    block: 'blok-block',
  },
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
} as unknown as API);

const createToggleHeading = (readOnly: boolean): { header: Header; api: API; element: HTMLElement } => {
  const api = createMockAPI();
  const options: BlockToolConstructorOptions<HeaderData, HeaderConfig> = {
    data: { text: 'Title', level: 2, isToggleable: true, isOpen: true },
    config: {},
    api,
    readOnly,
    block: { id: 'heading-id', dispatchChange: vi.fn() } as never,
  };
  const header = new Header(options);
  const element = header.render();

  document.body.appendChild(element);
  header.rendered();

  return { header, api, element };
};

const bodyPlaceholderOf = (element: HTMLElement): HTMLElement => {
  const placeholder = element.querySelector<HTMLElement>(`[${TOGGLE_ATTR.toggleBodyPlaceholder}]`);

  if (placeholder === null) {
    throw new Error('body placeholder not rendered');
  }

  return placeholder;
};

describe('Toggle heading booted read-only, then made editable in place', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows the body placeholder of an open heading with no children, like an editable-boot one', () => {
    const editable = createToggleHeading(false);
    const booted = createToggleHeading(true);

    booted.header.setReadOnly(false);

    expect(bodyPlaceholderOf(booted.element).classList.contains('hidden')).toBe(false);
    expect(bodyPlaceholderOf(editable.element).classList.contains('hidden')).toBe(false);
  });

  it('clicking the body placeholder adds a child, like an editable-boot heading', () => {
    const { header, api, element } = createToggleHeading(true);

    header.setReadOnly(false);
    bodyPlaceholderOf(element).click();

    expect(api.blocks.insertInsideParent).toHaveBeenCalledWith('heading-id', 1);
    expect(api.caret.setToBlock).toHaveBeenCalledWith('child-id', 'start');
  });

  it('listens for child add/remove once editable', () => {
    const { header, api } = createToggleHeading(true);

    header.setReadOnly(false);

    expect(api.events.on).toHaveBeenCalledWith('block changed', expect.any(Function));
  });

  it('repeated setReadOnly(false) does not stack handlers', () => {
    const { header, api, element } = createToggleHeading(true);

    header.setReadOnly(false);
    header.setReadOnly(false);
    bodyPlaceholderOf(element).click();

    expect(api.blocks.insertInsideParent).toHaveBeenCalledTimes(1);
    expect(api.events.on).toHaveBeenCalledTimes(1);
  });

  it('repeated setReadOnly(false) does not stack placeholder focus handlers', () => {
    const { header, element } = createToggleHeading(true);
    const heading = element.querySelector<HTMLElement>('h2');

    if (heading === null) {
      throw new Error('heading not rendered');
    }

    const removeSpy = vi.spyOn(heading, 'removeEventListener');
    const addSpy = vi.spyOn(heading, 'addEventListener');

    header.setReadOnly(false);
    header.setReadOnly(false);

    const focusAdds = addSpy.mock.calls.filter(([type]) => type === 'focus').length;
    const focusRemoves = removeSpy.mock.calls.filter(([type]) => type === 'focus').length;

    expect(focusAdds - focusRemoves).toBe(1);
  });

  it('setReadOnly(true) takes the editable handlers back off and hides the placeholder', () => {
    const { header, api, element } = createToggleHeading(false);

    header.setReadOnly(true);
    bodyPlaceholderOf(element).click();

    expect(api.blocks.insertInsideParent).not.toHaveBeenCalled();
    expect(bodyPlaceholderOf(element).classList.contains('hidden')).toBe(true);
    expect(api.events.off).toHaveBeenCalledWith('block changed', expect.any(Function));
  });
});
