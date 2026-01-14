import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PopoverHeader } from '../../../../src/components/utils/popover/components/popover-header';

const { iconMarkup } = vi.hoisted(() => ({
  iconMarkup: '<svg data-blok-testid="chevron"></svg>',
}));

vi.mock('../../../../src/components/icons', () => ({
  IconChevronLeft: iconMarkup,
}));

const innerTextPolyfill = vi.hoisted(() => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
  let polyfillDescriptor: PropertyDescriptor | undefined;

  const apply = (): void => {
    if (originalDescriptor !== undefined) {
      return;
    }

    polyfillDescriptor = {
      configurable: true,
      get(this: HTMLElement) {
        return this.textContent ?? '';
      },
      set(this: HTMLElement, value: string) {
        this.textContent = value;
      },
    };

    Object.defineProperty(HTMLElement.prototype, 'innerText', polyfillDescriptor);
  };

  const restore = (): void => {
    if (originalDescriptor !== undefined) {
      Object.defineProperty(HTMLElement.prototype, 'innerText', originalDescriptor);

      return;
    }

    // Instead of deleting the property, redefine it with an empty descriptor
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        return this.textContent ?? '';
      },
      set(this: HTMLElement, value: string) {
        this.textContent = value;
      },
    });
  };

  return { apply,
    restore };
});

describe('PopoverHeader', () => {
  beforeAll(() => {
    innerTextPolyfill.apply();
  });

  afterAll(() => {
    innerTextPolyfill.restore();
  });

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const createHeader = (overrides: Partial<ConstructorParameters<typeof PopoverHeader>[0]> = {}): PopoverHeader => {
    return new PopoverHeader({
      text: 'Nested level',
      onBackButtonClick: vi.fn(),
      ...overrides,
    });
  };

  it('renders root, back button, and text nodes with expected content and classes', () => {
    const header = createHeader({ text: 'Section title' });
    const root = header.getElement();

    expect(root).not.toBeNull();
    expect(root?.dataset.blokTestid).toBe('popover-header');

    const backButton = root?.querySelector('[data-blok-testid="popover-header-back-button"]');
    const textElement = root?.querySelector('[data-blok-testid="popover-header-text"]');

    expect(backButton).not.toBeNull();
    expect(backButton?.getAttribute('data-blok-testid')).toBe('popover-header-back-button');
    expect(backButton?.innerHTML).toBe(iconMarkup);
    expect(root?.firstChild).toBe(backButton);

    expect(textElement).not.toBeNull();
    expect(textElement?.textContent).toBe('Section title');
    expect(root?.lastChild).toBe(textElement);
  });

  it('returns the same root element via getElement', () => {
    const header = createHeader();
    const element = header.getElement();

    expect(element).not.toBeNull();
    expect(header.getElement()).toBe(element);
  });

  it('invokes provided back button handler on click', () => {
    let handlerCalled = false;
    const handler = () => {
      handlerCalled = true;
    };
    const header = createHeader({ onBackButtonClick: handler });
    const backButton = header.getElement()?.querySelector('button');

    backButton?.click();

    expect(handlerCalled).toBe(true);
  });

  it('removes root element from DOM and removes event listeners on destroy', () => {
    const handler = vi.fn();
    const header = createHeader({ onBackButtonClick: handler });
    const root = header.getElement();

    if (root === null) {
      throw new Error('PopoverHeader root element was not created');
    }

    document.body.appendChild(root);

    const backButton = root.querySelector('button');

    // Verify handler works before destroy
    backButton?.click();
    expect(handler).toHaveBeenCalledTimes(1);

    header.destroy();

    // Verify root element is removed from DOM
    expect(document.body.contains(root)).toBe(false);

    // Verify event listeners are removed by clicking again (handler should not be called again)
    backButton?.click();
    expect(handler).toHaveBeenCalledTimes(1); // Still 1, not 2
  });
});
