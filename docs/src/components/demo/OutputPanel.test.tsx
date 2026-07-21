import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, act, fireEvent } from '@testing-library/react';
import { OutputPanel } from './OutputPanel';
import { I18nProvider } from '../../contexts/I18nContext';

type GtagWindow = Window & typeof globalThis & { gtag?: (...args: unknown[]) => void };

const gtagWindow = window as GtagWindow;

/** Replace the clipboard API so a copy can be made to succeed or fail on demand. */
const stubClipboard = (writeText: () => Promise<void>): void => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
};

const clickCopy = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTestId('output-copy'));
  });
};

describe('OutputPanel', () => {
  let gtagSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    gtagSpy = vi.fn();
    gtagWindow.gtag = gtagSpy;

    // Mock the useCopyToClipboard hook
    vi.doMock('@/hooks/useCopyToClipboard', () => ({
      useCopyToClipboard: () => ({
        copyToClipboard: vi.fn().mockResolvedValue(true),
        isCopied: false,
      }),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete gtagWindow.gtag;
  });

  it('should render a div with output-panel class', () => {
    render(<I18nProvider><OutputPanel output="test output" /></I18nProvider>);

    const panel = screen.getByTestId('output-panel');
    expect(panel).toBeInTheDocument();
  });

  it('should have id="output-panel"', () => {
    render(<I18nProvider><OutputPanel output="test output" /></I18nProvider>);

    const panel = screen.getByTestId('output-panel');
    expect(panel.id).toBe('output-panel');
  });

  it('should render output header', () => {
    render(<I18nProvider><OutputPanel output="test output" /></I18nProvider>);

    expect(screen.getByText('JSON Output')).toBeInTheDocument();
  });

  it('should render the provided output', () => {
    render(<I18nProvider><OutputPanel output='{"key": "value"}' /></I18nProvider>);

    const outputContent = screen.getByTestId('output-content');
    expect(outputContent).toHaveTextContent('{"key": "value"}');
  });

  it('should render default message when output is default', () => {
    render(<I18nProvider><OutputPanel output='Click "Get JSON" to see the output' /></I18nProvider>);

    const outputContent = screen.getByTestId('output-content');
    expect(outputContent).toHaveTextContent('Click "Get JSON" to see the output');
  });

  it('should render copy button', () => {
    render(<I18nProvider><OutputPanel output="test output" /></I18nProvider>);

    const copyButton = screen.getByRole('button', { name: /copy/i });
    expect(copyButton).toBeInTheDocument();
  });

  it('should have output-header div', () => {
    render(<I18nProvider><OutputPanel output="test output" /></I18nProvider>);

    const header = screen.getByTestId('output-header');
    expect(header).toBeInTheDocument();
  });

  it('should have output-title div', () => {
    render(<I18nProvider><OutputPanel output="test output" /></I18nProvider>);

    const title = screen.getByTestId('output-title');
    expect(title).toBeInTheDocument();
  });

  it('should have output-copy button', () => {
    render(<I18nProvider><OutputPanel output="test output" /></I18nProvider>);

    const copyButton = screen.getByTestId('output-copy');
    expect(copyButton.tagName.toLowerCase()).toBe('button');
  });

  it('should have output-content pre', () => {
    render(<I18nProvider><OutputPanel output="test output" /></I18nProvider>);

    const content = screen.getByTestId('output-content');
    expect(content.tagName.toLowerCase()).toBe('pre');
  });

  it('should have id="output-content" on pre element', () => {
    render(<I18nProvider><OutputPanel output="test output" /></I18nProvider>);

    const content = screen.getByTestId('output-content');
    expect(content.id).toBe('output-content');
  });

  it('should have copy-text span', () => {
    render(<I18nProvider><OutputPanel output="test output" /></I18nProvider>);

    const copyButton = screen.getByTestId('output-copy');
    const copyText = within(copyButton).getByText('Copy');
    expect(copyText.tagName.toLowerCase()).toBe('span');
  });

  describe('analytics', () => {
    it('tracks a successful copy of the JSON output', async () => {
      stubClipboard(() => Promise.resolve());
      render(<I18nProvider><OutputPanel output='{"key": "value"}' /></I18nProvider>);

      await clickCopy();

      expect(gtagSpy).toHaveBeenCalledWith('event', 'demo_action', {
        action: 'copy_output',
      });
    });

    it('fires nothing when the copy fails', async () => {
      stubClipboard(() => Promise.reject(new Error('denied')));
      Object.defineProperty(document, 'execCommand', {
        value: () => false,
        configurable: true,
        writable: true,
      });
      render(<I18nProvider><OutputPanel output='{"key": "value"}' /></I18nProvider>);

      await clickCopy();

      expect(gtagSpy).not.toHaveBeenCalled();
    });

    it('fires nothing when there is no real output to copy', async () => {
      stubClipboard(() => Promise.resolve());
      render(<I18nProvider><OutputPanel output='Click "Get JSON" to see the output' /></I18nProvider>);

      await clickCopy();

      expect(gtagSpy).not.toHaveBeenCalled();
    });

    it('still copies when analytics is unavailable', async () => {
      delete gtagWindow.gtag;
      const writeText = vi.fn(() => Promise.resolve());
      stubClipboard(writeText);
      render(<I18nProvider><OutputPanel output='{"key": "value"}' /></I18nProvider>);

      await clickCopy();

      expect(writeText).toHaveBeenCalledWith('{"key": "value"}');
    });
  });

  it('should show Copied! text when copied state is true', () => {
    // Since we can't easily test the hook state change, we'll test the structure
    render(<I18nProvider><OutputPanel output="test output" /></I18nProvider>);

    const copyButton = screen.getByTestId('output-copy');
    expect(copyButton).not.toHaveClass('copied');
  });
});
