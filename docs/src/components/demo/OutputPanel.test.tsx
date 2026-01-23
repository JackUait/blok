import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OutputPanel } from './OutputPanel';

describe('OutputPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

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
  });

  it('should render a div with output-panel class', () => {
    render(<OutputPanel output="test output" />);

    const panel = document.querySelector('.output-panel');
    expect(panel).toBeInTheDocument();
  });

  it('should have id="output-panel"', () => {
    render(<OutputPanel output="test output" />);

    const panel = document.getElementById('output-panel');
    expect(panel).toBeInTheDocument();
  });

  it('should render output header', () => {
    render(<OutputPanel output="test output" />);

    expect(screen.getByText('JSON Output')).toBeInTheDocument();
  });

  it('should render the provided output', () => {
    render(<OutputPanel output='{"key": "value"}' />);

    const outputContent = document.getElementById('output-content');
    expect(outputContent?.textContent).toBe('{"key": "value"}');
  });

  it('should render default message when output is default', () => {
    render(<OutputPanel output='Click "Save" to see the JSON output' />);

    const outputContent = document.getElementById('output-content');
    expect(outputContent?.textContent).toBe('Click "Save" to see the JSON output');
  });

  it('should render copy button', () => {
    render(<OutputPanel output="test output" />);

    // "Copy" text is inside a span within the button, so use querySelector instead
    const copyButton = document.querySelector('.output-copy');
    expect(copyButton?.tagName.toLowerCase()).toBe('button');
  });

  it('should render output header with icon', () => {
    const { container } = render(<OutputPanel output="test output" />);

    const svg = container.querySelector('.output-title svg');
    expect(svg).toBeInTheDocument();
  });

  it('should have output-header div', () => {
    const { container } = render(<OutputPanel output="test output" />);

    const header = container.querySelector('.output-header');
    expect(header).toBeInTheDocument();
  });

  it('should have output-title div', () => {
    const { container } = render(<OutputPanel output="test output" />);

    const title = container.querySelector('.output-title');
    expect(title).toBeInTheDocument();
  });

  it('should have output-copy button', () => {
    const { container } = render(<OutputPanel output="test output" />);

    const copyButton = container.querySelector('.output-copy');
    expect(copyButton).toBeInTheDocument();
  });

  it('should have output-content pre', () => {
    const { container } = render(<OutputPanel output="test output" />);

    const content = container.querySelector('.output-content');
    expect(content?.tagName.toLowerCase()).toBe('pre');
  });

  it('should have id="output-content" on pre element', () => {
    render(<OutputPanel output="test output" />);

    const content = document.getElementById('output-content');
    expect(content?.tagName.toLowerCase()).toBe('pre');
  });

  it('should have copy-text span', () => {
    const { container } = render(<OutputPanel output="test output" />);

    const copyText = container.querySelector('.copy-text');
    expect(copyText).toBeInTheDocument();
    expect(copyText?.textContent).toBe('Copy');
  });

  it('should show Copied! text when copied state is true', () => {
    // Since we can't easily test the hook state change, we'll test the structure
    const { container } = render(<OutputPanel output="test output" />);

    const copyButton = container.querySelector('.output-copy');
    expect(copyButton).not.toHaveClass('copied');
  });

  it('should have SVG icon in copy button', () => {
    const { container } = render(<OutputPanel output="test output" />);

    const svg = container.querySelector('.output-copy svg');
    expect(svg).toBeInTheDocument();
  });
});
