import { describe, it, expect, vi } from 'vitest';
import {
  buildListItem,
  buildWrapper,
  buildStandardContent,
  buildChecklistContent,
  createMarker,
  getBulletCharacter,
  LIST_TEST_IDS,
  type DOMBuilderContext,
} from '../../../../src/tools/list/dom-builder';

const createContext = (overrides: Partial<DOMBuilderContext> = {}): DOMBuilderContext => ({
  data: { text: 'Test', style: 'unordered', checked: false, depth: 0 },
  readOnly: false,
  placeholder: 'List item',
  ...overrides,
});

describe('dom-builder', () => {
  describe('buildWrapper', () => {
    it('creates wrapper with correct attributes', () => {
      const context = createContext({
        data: { text: '', style: 'ordered', depth: 1 },
      });

      const wrapper = buildWrapper(context);

      expect(wrapper).toHaveAttribute('data-blok-tool', 'list');
      expect(wrapper).toHaveAttribute('data-list-style', 'ordered');
      expect(wrapper).toHaveAttribute('data-list-depth', '1');
    });

    it('stores start value when not default', () => {
      const context = createContext({
        data: { text: '', style: 'ordered', depth: 0, start: 5 },
      });

      const wrapper = buildWrapper(context);

      expect(wrapper).toHaveAttribute('data-list-start', '5');
    });

    it('does not store start value when default is 1', () => {
      const context = createContext({
        data: { text: '', style: 'ordered', depth: 0, start: 1 },
      });

      const wrapper = buildWrapper(context);

      expect(wrapper).not.toHaveAttribute('data-list-start');
    });

    it('handles unordered list style', () => {
      const context = createContext({
        data: { text: '', style: 'unordered', depth: 0 },
      });

      const wrapper = buildWrapper(context);

      expect(wrapper).toHaveAttribute('data-list-style', 'unordered');
    });

    it('handles checklist style', () => {
      const context = createContext({
        data: { text: '', style: 'checklist', depth: 0 },
      });

      const wrapper = buildWrapper(context);

      expect(wrapper).toHaveAttribute('data-list-style', 'checklist');
    });
  });

  describe('buildStandardContent', () => {
    it('creates standard list item structure', () => {
      const context = createContext({
        data: { text: 'Hello world', style: 'unordered', depth: 0 },
      });

      const content = buildStandardContent(context);

      expect(content).toHaveAttribute('role', 'listitem');
      // Verify content container exists via data-testid
      expect(content.querySelector(`[data-blok-testid="${LIST_TEST_IDS.contentContainer}"]`)).toBeInstanceOf(HTMLElement);
    });

    it('creates marker element', () => {
      const context = createContext({
        data: { text: '', style: 'unordered', depth: 0 },
      });

      const content = buildStandardContent(context);
      const marker = content.querySelector('[data-list-marker]');

      expect(marker).toBeInstanceOf(HTMLElement);
      expect(marker?.getAttribute('data-list-marker')).toBe('true');
      expect(marker?.getAttribute('data-blok-mutation-free')).toBe('true');
    });

    it('creates editable content container', () => {
      const context = createContext({
        data: { text: 'Some text', style: 'unordered', depth: 0 },
      });

      const content = buildStandardContent(context);
      const contentContainer = content.querySelector(`[data-blok-testid="${LIST_TEST_IDS.contentContainer}"]`) as HTMLElement;

      expect(contentContainer).toBeInstanceOf(HTMLElement);
      expect(contentContainer.contentEditable).toBe('true');
      expect(contentContainer.innerHTML).toBe('Some text');
    });

    it('applies indentation for nested items', () => {
      const context = createContext({
        data: { text: '', style: 'unordered', depth: 2 },
      });

      const content = buildStandardContent(context);
      const marginLeft = content.style.marginLeft;

      expect(marginLeft).toBe('48px'); // 2 * 24px
    });

    it('applies custom color when configured', () => {
      const context = createContext({
        data: { text: '', style: 'unordered', depth: 0 },
        itemColor: '#ff0000',
      });

      const content = buildStandardContent(context);

      // Browser converts hex to rgb
      expect(content.style.color).toBe('rgb(255, 0, 0)');
    });

    it('applies custom font size when configured', () => {
      const context = createContext({
        data: { text: '', style: 'unordered', depth: 0 },
        itemSize: '18px',
      });

      const content = buildStandardContent(context);

      expect(content.style.fontSize).toBe('18px');
    });

    it('stores placeholder on content element', () => {
      const context = createContext({
        data: { text: '', style: 'unordered', depth: 0 },
        placeholder: 'Type something...',
      });

      const content = buildStandardContent(context);
      const contentContainer = content.querySelector(`[data-blok-testid="${LIST_TEST_IDS.contentContainer}"]`) as HTMLElement & { getPlaceholder(): string | undefined };

      expect(contentContainer?.getPlaceholder()).toBe('Type something...');
    });

    it('makes content non-editable in read-only mode', () => {
      const context = createContext({
        data: { text: '', style: 'unordered', depth: 0 },
        readOnly: true,
      });

      const content = buildStandardContent(context);
      const contentContainer = content.querySelector(`[data-blok-testid="${LIST_TEST_IDS.contentContainer}"]`) as HTMLElement;

      expect(contentContainer?.contentEditable).toBe('false');
    });
  });

  describe('buildChecklistContent', () => {
    it('creates checkbox input', () => {
      const context = createContext({
        data: { text: '', style: 'checklist', checked: false, depth: 0 },
      });

      const content = buildChecklistContent(context);
      const checkbox = content.querySelector('input[type="checkbox"]') as HTMLInputElement;

      expect(checkbox).toBeInstanceOf(HTMLInputElement);
      expect(checkbox.checked).toBe(false);
    });

    it('creates checked checkbox when data.checked is true', () => {
      const context = createContext({
        data: { text: '', style: 'checklist', checked: true, depth: 0 },
      });

      const content = buildChecklistContent(context);
      const checkbox = content.querySelector('input[type="checkbox"]') as HTMLInputElement;

      expect(checkbox?.checked).toBe(true);
    });

    it('applies strikethrough style when checked', () => {
      const context = createContext({
        data: { text: 'Done', style: 'checklist', checked: true, depth: 0 },
      });

      const content = buildChecklistContent(context);
      const textContent = content.querySelector(`[data-blok-testid="${LIST_TEST_IDS.checklistContent}"]`) as HTMLElement;

      // Verify checked state via data attribute rather than class names
      expect(textContent).toBeInstanceOf(HTMLElement);
      expect(textContent?.getAttribute('data-checked')).toBe('true');
    });

    it('disables checkbox in read-only mode', () => {
      const context = createContext({
        data: { text: '', style: 'checklist', checked: false, depth: 0 },
        readOnly: true,
      });

      const content = buildChecklistContent(context);
      const checkbox = content.querySelector('input[type="checkbox"]') as HTMLInputElement;

      expect(checkbox?.disabled).toBe(true);
    });

    it('applies indentation for nested checklist items', () => {
      const context = createContext({
        data: { text: '', style: 'checklist', checked: false, depth: 1 },
      });

      const content = buildChecklistContent(context);
      const marginLeft = content.style.marginLeft;

      expect(marginLeft).toBe('24px'); // 1 * 24px
    });

    it('creates editable content div', () => {
      const context = createContext({
        data: { text: 'Task item', style: 'checklist', checked: false, depth: 0 },
      });

      const content = buildChecklistContent(context);
      const textContent = content.querySelector(`[data-blok-testid="${LIST_TEST_IDS.checklistContent}"]`) as HTMLElement;

      expect(textContent).toBeInstanceOf(HTMLElement);
      expect(textContent?.contentEditable).toBe('true');
      expect(textContent?.innerHTML).toBe('Task item');
    });
  });

  describe('createMarker', () => {
    it('creates bullet marker for unordered list', () => {
      const marker = createMarker('unordered', 0);

      expect(marker).toHaveTextContent('•');
      expect(marker).toHaveAttribute('aria-hidden', 'true');
      expect(marker.contentEditable).toBe('false');
    });

    it('creates number placeholder for ordered list', () => {
      const marker = createMarker('ordered', 0);

      expect(marker).toHaveTextContent('1.');
      expect(marker).toHaveAttribute('aria-hidden', 'true');
      expect(marker.style.paddingRight).toBe('11px');
      expect(marker.style.minWidth).toBe('fit-content');
    });

    it('uses different bullets at different depths', () => {
      const depth0 = createMarker('unordered', 0);
      const depth1 = createMarker('unordered', 1);
      const depth2 = createMarker('unordered', 2);

      expect(depth0).toHaveTextContent('•');
      expect(depth1).toHaveTextContent('◦');
      expect(depth2).toHaveTextContent('▪');
    });

    it('cycles bullets at depth 3', () => {
      const depth3 = createMarker('unordered', 3);

      expect(depth3).toHaveTextContent('•'); // Back to first bullet
    });

    it('applies ordered list marker styles', () => {
      const marker = createMarker('ordered', 0);

      expect(marker.style.paddingRight).toBe('11px');
      expect(marker.style.minWidth).toBe('fit-content');
    });

    it('applies unordered list marker styles', () => {
      const marker = createMarker('unordered', 0);

      expect(marker.style.paddingLeft).toBe('1px');
      expect(marker.style.paddingRight).toBe('13px');
      expect(marker.style.fontSize).toBe('24px');
      expect(marker.style.fontFamily).toBe('Arial');
    });
  });

  describe('getBulletCharacter', () => {
    it('returns bullet at depth 0', () => {
      expect(getBulletCharacter(0)).toBe('•');
    });

    it('returns white bullet at depth 1', () => {
      expect(getBulletCharacter(1)).toBe('◦');
    });

    it('returns square at depth 2', () => {
      expect(getBulletCharacter(2)).toBe('▪');
    });

    it('cycles back to bullet at depth 3', () => {
      expect(getBulletCharacter(3)).toBe('•');
    });

    it('cycles correctly for deeper depths', () => {
      expect(getBulletCharacter(4)).toBe('◦');
      expect(getBulletCharacter(5)).toBe('▪');
      expect(getBulletCharacter(6)).toBe('•');
    });
  });

  describe('buildListItem integration', () => {
    it('builds complete unordered list item', () => {
      const keydownHandler = vi.fn();
      const context = createContext({
        data: { text: 'Item text', style: 'unordered', depth: 0 },
        keydownHandler,
      });

      const result = buildListItem(context);

      expect(result.wrapper).toBeInstanceOf(HTMLElement);
      expect(result.contentElement).toBeInstanceOf(HTMLElement);
      expect(result.markerElement).toBeInstanceOf(HTMLElement);
      expect(result.checkboxElement).toBeNull();

      // Verify keydown handler is attached
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      result.wrapper.dispatchEvent(event);
      expect(keydownHandler).toHaveBeenCalledWith(event);
    });

    it('builds complete ordered list item', () => {
      const context = createContext({
        data: { text: 'Numbered item', style: 'ordered', depth: 0 },
      });

      const result = buildListItem(context);

      expect(result.markerElement?.textContent).toBe('1.');
    });

    it('builds complete checklist item', () => {
      const context = createContext({
        data: { text: 'Task', style: 'checklist', checked: true, depth: 0 },
      });

      const result = buildListItem(context);

      expect(result.checkboxElement).toBeInstanceOf(HTMLInputElement);
      expect(result.checkboxElement?.checked).toBe(true);
      expect(result.markerElement).toBeNull(); // Checklist doesn't have marker
    });

    it('does not attach keydown handler in read-only mode', () => {
      const keydownHandler = vi.fn();
      const context = createContext({
        data: { text: '', style: 'unordered', depth: 0 },
        readOnly: true,
        keydownHandler,
      });

      const result = buildListItem(context);

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      result.wrapper.dispatchEvent(event);
      expect(keydownHandler).not.toHaveBeenCalled();
    });
  });
});
