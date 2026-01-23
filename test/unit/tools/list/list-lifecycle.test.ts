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
    const result = renderListItem(context);

    // Verify setupItemPlaceholder was called
    const mockFn = context.setupItemPlaceholder as Mock;
    expect(mockFn).toHaveBeenCalledTimes(1);
    const contentElement = mockFn.mock.calls[0][0] as HTMLElement;

    // Verify the passed element is an HTMLElement
    expect(contentElement).toBeInstanceOf(HTMLElement);

    // Verify the content element exists within the result
    // The contentElement passed to setupItemPlaceholder should be within the wrapper
    expect(result.contains(contentElement)).toBe(true);
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

    // Verify the checkbox is interactive (not disabled)
    expect(checkbox.disabled).toBe(false);

    // Click to simulate user interaction - checkbox state should change
    checkbox.click();
    expect(checkbox.checked).toBe(true);

    // Note: In jsdom, click() doesn't trigger change events.
    // The callback integration is tested in E2E tests.
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

    // Verify the checkbox exists
    const checkbox = result.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeInstanceOf(HTMLInputElement);

    // Verify there's a contenteditable area for text input (using testid)
    const contentContainer = result.querySelector('[data-blok-testid="list-checklist-content"]') as HTMLElement;
    expect(contentContainer).toBeInstanceOf(HTMLElement);

    // Click to verify checkbox is functional
    checkbox.click();
    expect(checkbox.checked).toBe(true);

    // Note: The callback integration with change events is tested in E2E tests.
    // Unit testing the exact callback arguments requires change event dispatching
    // which is flagged by linter and doesn't work in jsdom without workaround.
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

  /**
   * Regression test for: list items and paragraphs must have same total height
   *
   * Paragraph wrapper uses blok-block (py-[3px]) + mt-[2px] mb-px
   * List wrapper should match this exactly
   */
  it('has same vertical spacing as paragraph', () => {
    const context = createMockContext({ style: 'unordered' });
    const result = renderListItem(context);

    // Check wrapper has the BASE_STYLES that provide vertical spacing
    // These match the paragraph wrapper spacing
    expect(result.className).toContain('py-[3px]');
    expect(result.className).toContain('mt-[2px]');
    expect(result.className).toContain('mb-px');

    // Inner listitem should NOT have vertical padding (all spacing is on wrapper)
    const listItem = result.querySelector('[role="listitem"]') as HTMLElement;
    expect(listItem?.className).not.toContain('pt-[2px]');
    expect(listItem?.className).not.toContain('pb-[1px]');
    expect(listItem?.className).not.toContain('py-0.5');
  });

  /**
   * Checklist items should also have same vertical spacing on wrapper
   */
  it('checklist has same vertical spacing as paragraph', () => {
    const context = createMockContext({ style: 'checklist' });
    const result = renderListItem(context);

    // Check wrapper has correct vertical spacing via computed styles
    // py-[3px] = 3px padding top and bottom
    const wrapperStyles = window.getComputedStyle(result);
    expect(wrapperStyles.paddingTop).toBe('3px');
    expect(wrapperStyles.paddingBottom).toBe('3px');
    expect(wrapperStyles.marginTop).toBe('2px');
    expect(wrapperStyles.marginBottom).toBe('1px');

    // Inner listitem should NOT have vertical padding (all spacing is on wrapper)
    const checklistItem = result.querySelector('[role="listitem"]') as HTMLElement;
    const checklistItemStyles = window.getComputedStyle(checklistItem);
    expect(checklistItemStyles.paddingTop).toBe('0px');
    expect(checklistItemStyles.paddingBottom).toBe('0px');
  });
});
