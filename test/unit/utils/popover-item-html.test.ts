import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
}));

import { PopoverItemHtml } from '../../../src/components/utils/popover/components/popover-item/popover-item-html/popover-item-html';
import { css } from '../../../src/components/utils/popover/components/popover-item/popover-item-html/popover-item-html.const';
import { PopoverItemType, type PopoverItemHtmlParams, type PopoverItemRenderParamsMap } from '../../../src/components/utils/popover/components/popover-item';
import * as tooltip from '../../../src/components/utils/tooltip';

type SetupResult = {
  item: PopoverItemHtml;
  params: PopoverItemHtmlParams;
  root: HTMLElement;
};

const createItem = (
  overrides: Partial<PopoverItemHtmlParams> = {},
  renderParams?: PopoverItemRenderParamsMap[PopoverItemType.Html]
): SetupResult => {
  const element = overrides.element ?? document.createElement('div');

  const params: PopoverItemHtmlParams = {
    type: PopoverItemType.Html,
    element,
    name: 'custom-html-item',
    ...overrides,
  };

  const item = new PopoverItemHtml(params, renderParams);
  const root = item.getElement();

  if (!(root instanceof HTMLElement)) {
    throw new Error('PopoverItemHtml should create root element');
  }

  return {
    item,
    params,
    root,
  };
};

describe('PopoverItemHtml', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('wraps provided element into root container and sets dataset name', () => {
    const customElement = document.createElement('button');

    customElement.textContent = 'Custom content';

    const { root, params } = createItem({ element: customElement,
      name: 'html-item' });

    expect(root.classList.contains(css.root)).toBe(true);
    expect(root.dataset.itemName).toBe(params.name);
    expect(root.contains(customElement)).toBe(true);
    expect(customElement.parentElement).toBe(root);
  });

  it('adds hint with provided params when hints are enabled', () => {
    const hint = {
      title: 'HTML hint',
      description: 'Rendered near custom HTML',
    };

    const renderParams: PopoverItemRenderParamsMap[PopoverItemType.Html] = {
      hint: {
        position: 'left',
        enabled: true,
      },
    };

    const { root } = createItem({ hint }, renderParams);

    expect(tooltip.onHover).toHaveBeenCalledTimes(1);
    expect(tooltip.onHover).toHaveBeenCalledWith(
      root,
      expect.any(HTMLElement),
      expect.objectContaining({
        placement: 'left',
      })
    );
  });

  it('falls back to default hint position when render params omit it', () => {
    const hint = { title: 'Needs default position' };

    const { root } = createItem({ hint });

    expect(tooltip.onHover).toHaveBeenCalledWith(
      root,
      expect.any(HTMLElement),
      expect.objectContaining({
        placement: 'right',
      })
    );
  });

  it('skips hint creation when render params disable it', () => {
    createItem(
      {
        hint: { title: 'Should not render' },
      },
      {
        hint: {
          enabled: false,
        },
      }
    );

    expect(tooltip.onHover).not.toHaveBeenCalled();
  });

  it('toggles hidden class on root element', () => {
    const { item, root } = createItem();

    item.toggleHidden(true);
    expect(root.classList.contains(css.hidden)).toBe(true);

    item.toggleHidden(false);
    expect(root.classList.contains(css.hidden)).toBe(false);
  });

  it('returns focusable controls located inside custom html content', () => {
    const htmlContent = document.createElement('div');
    const button = document.createElement('button');
    const textInput = document.createElement('input');

    textInput.type = 'text';

    const numberInput = document.createElement('input');

    numberInput.type = 'number';

    const colorInput = document.createElement('input');

    colorInput.type = 'color';

    const textarea = document.createElement('textarea');

    htmlContent.append(button, textInput, numberInput, colorInput, textarea);

    const { item } = createItem({ element: htmlContent });

    expect(item.getControls()).toEqual([button, textInput, numberInput, textarea]);
  });
});
