import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PopoverHeader } from '../../../../src/components/utils/popover/components/popover-header';
import Listeners from '../../../../src/components/utils/listeners';

const { iconMarkup } = vi.hoisted(() => ({
  iconMarkup: '<svg data-blok-testid="chevron"></svg>',
}));

vi.mock('../../../../src/components/icons', () => ({
  IconChevronLeft: iconMarkup,
}));

const innerTextPolyfill = vi.hoisted(() => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');

  const apply = (): void => {
    if (originalDescriptor !== undefined) {
      return;
    }

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

  const restore = (): void => {
    if (originalDescriptor !== undefined) {
      Object.defineProperty(HTMLElement.prototype, 'innerText', originalDescriptor);

      return;
    }

    delete (HTMLElement.prototype as { innerText?: string }).innerText;
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
    const handler = vi.fn();
    const header = createHeader({ onBackButtonClick: handler });
    const backButton = header.getElement()?.querySelector('button');

    backButton?.dispatchEvent(new Event('click', { bubbles: true }));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('removes root element from DOM and destroys listeners on destroy', () => {
    const destroySpy = vi.spyOn(Listeners.prototype, 'destroy');
    const header = createHeader();
    const root = header.getElement();

    if (root === null) {
      throw new Error('PopoverHeader root element was not created');
    }

    document.body.appendChild(root);

    header.destroy();

    expect(document.body.contains(root)).toBe(false);
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });
});
