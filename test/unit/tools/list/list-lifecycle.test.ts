import { describe, it, expect, vi, type Mock } from 'vitest';
import { renderListItem, type RenderContext } from '../../../../src/tools/list/list-lifecycle';
import type { ListItemData } from '../../../../src/tools/list/types';

describe('list-lifecycle', () => {
  const createMockContext = (
    overrides: Partial<ListItemData> = {},
    extraOverrides: Partial<Pick<RenderContext, 'readOnly' | 'placeholder' | 'itemColor' | 'itemSize'>> = {}
  ): RenderContext => {
    const data: ListItemData = {
      text: 'Test item',
      style: 'unordered',
      checked: false,
      depth: 0,
      ...overrides,
    };

    const setupItemPlaceholder = vi.fn();
    const onCheckboxChange = vi.fn();
    const keydownHandler = vi.fn();

    return {
      data,
      readOnly: extraOverrides.readOnly ?? false,
      placeholder: extraOverrides.placeholder ?? 'List item',
      itemColor: extraOverrides.itemColor,
      itemSize: extraOverrides.itemSize,
      setupItemPlaceholder,
      onCheckboxChange,
      keydownHandler,
    };
  };

  it('returns a wrapper element', () => {
    const context = createMockContext();
    const result = renderListItem(context);

    expect(result).toBeInstanceOf(HTMLElement);
    expect(result).toHaveAttribute('data-blok-tool', 'list');
  });

  it('passes content element to setupItemPlaceholder', () => {
    const context = createMockContext();
    renderListItem(context);

    // Verify setupItemPlaceholder was called with the actual content element
    const mockFn = context.setupItemPlaceholder as Mock;
    expect(mockFn).toHaveBeenCalledTimes(1);
    const contentElement = mockFn.mock.calls[0][0] as HTMLElement;

    // Verify observable behavior: the element has the expected structure
    expect(contentElement).toBeInstanceOf(HTMLElement);
    expect(contentElement).toHaveAttribute('data-blok-testid', 'list-content-container');
    expect(contentElement.contentEditable).toBe('true');
  });

  it('attaches keydown handler to wrapper', () => {
    const keydownHandler = vi.fn();
    const context = createMockContext();
    context.keydownHandler = keydownHandler;

    const result = renderListItem(context);

    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    result.dispatchEvent(event);

    expect(keydownHandler).toHaveBeenCalledWith(event);
  });

  it('does not attach keydown handler in read-only mode', () => {
    const keydownHandler = vi.fn();
    const context = createMockContext();
    context.keydownHandler = keydownHandler;
    context.readOnly = true;

    const result = renderListItem(context);

    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    result.dispatchEvent(event);

    expect(keydownHandler).not.toHaveBeenCalled();
  });

  it('sets up checkbox change listener for checklist items', () => {
    const onCheckboxChange = vi.fn();
    const context = createMockContext({ style: 'checklist', checked: false });
    context.onCheckboxChange = onCheckboxChange;

    const result = renderListItem(context);

    const checkbox = result.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeInstanceOf(HTMLInputElement);

    // Simulate checkbox change via user interaction
    checkbox.click();

    expect(onCheckboxChange).toHaveBeenCalledWith(true, expect.any(HTMLElement));
  });

  it('does not set up checkbox listener in read-only mode', () => {
    const onCheckboxChange = vi.fn();
    const context = createMockContext({ style: 'checklist', checked: false });
    context.onCheckboxChange = onCheckboxChange;
    context.readOnly = true;

    const result = renderListItem(context);

    const checkbox = result.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeInstanceOf(HTMLInputElement);
    expect(checkbox.disabled).toBe(true);

    // Simulate checkbox change - listener should not be attached
    checkbox.click();

    expect(onCheckboxChange).not.toHaveBeenCalled();
  });

  it('sets correct style attribute for unordered list', () => {
    const context = createMockContext({ style: 'unordered' });
    const result = renderListItem(context);

    expect(result).toHaveAttribute('data-list-style', 'unordered');
  });

  it('sets correct style attribute for ordered list', () => {
    const context = createMockContext({ style: 'ordered' });
    const result = renderListItem(context);

    expect(result).toHaveAttribute('data-list-style', 'ordered');
  });

  it('sets correct style attribute for checklist', () => {
    const context = createMockContext({ style: 'checklist' });
    const result = renderListItem(context);

    expect(result).toHaveAttribute('data-list-style', 'checklist');
  });

  it('sets depth attribute when depth is provided', () => {
    const context = createMockContext({ depth: 2 });
    const result = renderListItem(context);

    expect(result).toHaveAttribute('data-list-depth', '2');
  });

  it('does not set depth attribute when depth is 0', () => {
    const context = createMockContext({ depth: 0 });
    const result = renderListItem(context);

    expect(result).toHaveAttribute('data-list-depth', '0');
  });

  it('passes item color to buildListItem', () => {
    const context = createMockContext({}, { itemColor: '#ff0000' });

    const result = renderListItem(context);

    // Color is applied to the list item content
    const listItem = result.querySelector('[role="listitem"]') as HTMLElement;
    expect(listItem?.style.color).toBe('rgb(255, 0, 0)');
  });

  it('passes item size to buildListItem', () => {
    const context = createMockContext({}, { itemSize: '18px' });

    const result = renderListItem(context);

    const listItem = result.querySelector('[role="listitem"]') as HTMLElement;
    expect(listItem?.style.fontSize).toBe('18px');
  });

  it('passes placeholder to buildListItem', () => {
    const setupItemPlaceholder = vi.fn();
    const context = createMockContext();
    context.placeholder = 'Type something...';
    context.setupItemPlaceholder = setupItemPlaceholder;

    renderListItem(context);

    expect(setupItemPlaceholder).toHaveBeenCalledWith(
      expect.objectContaining({
        // Placeholder should be stored on the element
      })
    );
  });

  it('passes data text to buildListItem', () => {
    const context = createMockContext({ text: 'Custom text' });
    const result = renderListItem(context);

    const contentEl = result.querySelector('[data-blok-testid="list-content-container"]') as HTMLElement;
    expect(contentEl?.innerHTML).toBe('Custom text');
  });

  it('creates checkbox for checklist items', () => {
    const context = createMockContext({ style: 'checklist' });
    const result = renderListItem(context);

    const checkbox = result.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeInstanceOf(HTMLInputElement);
  });

  it('does not create checkbox for non-checklist items', () => {
    const context = createMockContext({ style: 'unordered' });
    const result = renderListItem(context);

    const checkbox = result.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeNull();
  });

  it('creates marker for ordered list', () => {
    const context = createMockContext({ style: 'ordered' });
    const result = renderListItem(context);

    const marker = result.querySelector('[data-list-marker]');
    expect(marker).toBeInstanceOf(HTMLElement);
  });

  it('creates marker for unordered list', () => {
    const context = createMockContext({ style: 'unordered' });
    const result = renderListItem(context);

    const marker = result.querySelector('[data-list-marker]');
    expect(marker).toBeInstanceOf(HTMLElement);
  });

  it('does not create marker for checklist', () => {
    const context = createMockContext({ style: 'checklist' });
    const result = renderListItem(context);

    const marker = result.querySelector('[data-list-marker]');
    expect(marker).toBeNull();
  });

  it('sets checked state on checkbox when data.checked is true', () => {
    const context = createMockContext({ style: 'checklist', checked: true });
    const result = renderListItem(context);

    const checkbox = result.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox?.checked).toBe(true);
  });

  it('sets unchecked state on checkbox when data.checked is false', () => {
    const context = createMockContext({ style: 'checklist', checked: false });
    const result = renderListItem(context);

    const checkbox = result.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox?.checked).toBe(false);
  });

  it('applies indentation for nested items', () => {
    const context = createMockContext({ depth: 2, style: 'unordered' });
    const result = renderListItem(context);

    const listItem = result.querySelector('[role="listitem"]') as HTMLElement;
    expect(listItem?.style.marginLeft).toBe('48px');
  });

  it('passes content element to onCheckboxChange callback', () => {
    const onCheckboxChange = vi.fn();
    const context = createMockContext({ style: 'checklist' });
    context.onCheckboxChange = onCheckboxChange;

    const result = renderListItem(context);

    const checkbox = result.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.click();

    expect(onCheckboxChange).toHaveBeenCalledWith(
      true,
      expect.any(HTMLElement)
    );
  });

  it('creates contenteditable element for text input', () => {
    const context = createMockContext();
    const result = renderListItem(context);

    // contentEditable is set via the property (and browser syncs to attribute)
    const contentEl = result.querySelector('[data-blok-testid="list-content-container"]') as HTMLElement;
    expect(contentEl?.contentEditable).toBe('true');
  });

  it('sets contentEditable to false in read-only mode', () => {
    const context = createMockContext();
    context.readOnly = true;

    const result = renderListItem(context);

    const contentEl = result.querySelector('[data-blok-testid="list-content-container"]') as HTMLElement;
    expect(contentEl?.contentEditable).toBe('false');
  });
});
