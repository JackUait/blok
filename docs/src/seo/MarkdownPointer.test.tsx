import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownPointer } from './MarkdownPointer';
import { SITE_URL } from './route-metadata';

describe('MarkdownPointer', () => {
  it('names the absolute address of the current page mirror', () => {
    const { container } = render(<MarkdownPointer pathname="/docs/table" />);

    expect(container.textContent).toContain(`${SITE_URL}/docs/table.md`);
  });

  // The sentence exists for the "human pastes this URL into ChatGPT" flow, where
  // the assistant reads the served HTML. A sighted or screen-reader visitor has
  // no use for it, so it is hidden from both.
  it('is hidden from sighted visitors and from assistive technology alike', () => {
    const { container } = render(<MarkdownPointer pathname="/" />);
    const pointer = container.firstElementChild;

    expect(pointer?.getAttribute('aria-hidden')).toBe('true');
    expect(pointer?.className).toContain('sr-only');
  });

  it('follows the locale tree', () => {
    const { container } = render(<MarkdownPointer pathname="/ru/demo" />);

    expect(container.textContent).toContain(`${SITE_URL}/ru/demo.md`);
  });
});
