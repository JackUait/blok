import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { BlokView, useBlokView } from '../src';
import type { OutputData } from '@bloklabs/core';

const paragraphDoc = (text: string): OutputData => ({
  blocks: [{ type: 'paragraph', data: { text } }],
});

describe('BlokView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders semantic HTML synchronously inside a single wrapper div', () => {
    const { container } = render(
      <BlokView
        data={{
          blocks: [
            { type: 'header', data: { text: 'Title', level: 2 } },
            { type: 'paragraph', data: { text: 'Body <b>bold</b>' } },
          ],
        }}
      />
    );

    // Synchronous: no act/waitFor — content is present immediately.
    const wrapper = container.firstElementChild;

    expect(wrapper).toBeInstanceOf(HTMLDivElement);
    expect(wrapper?.children).toHaveLength(2);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Title');
    expect(container.querySelector('p b')).toHaveTextContent('bold');
  });

  it('applies className to the wrapper', () => {
    const { container } = render(<BlokView data={paragraphDoc('x')} className="rich-text" />);

    expect(container.firstElementChild).toHaveClass('rich-text');
  });

  it('sanitizes malicious inline content', () => {
    const { container } = render(
      <BlokView data={paragraphDoc('safe<img src=x onerror="window.pwned=true"><script>window.pwned=true</script>')} />
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('p')).toHaveTextContent('safe');
    expect(Reflect.get(window, 'pwned')).toBeUndefined();
  });

  it('supports custom renderers', () => {
    const { container } = render(
      <BlokView
        data={{ blocks: [{ type: 'shout', data: { text: 'loud' } }] }}
        renderers={{ shout: (data, ctx) => `<aside>${ctx.sanitizeInline(String(data.text))}</aside>` }}
      />
    );

    expect(container.querySelector('aside')).toHaveTextContent('loud');
  });

  it('updates when data changes', () => {
    const { container, rerender } = render(<BlokView data={paragraphDoc('before')} />);

    expect(container.querySelector('p')).toHaveTextContent('before');

    rerender(<BlokView data={paragraphDoc('after')} />);

    expect(container.querySelector('p')).toHaveTextContent('after');
  });

  it('renders a checklist checkbox as a real checkbox input', () => {
    render(
      <BlokView
        data={{
          blocks: [
            { type: 'list', data: { style: 'checklist', text: 'Done thing', checked: true } },
          ],
        }}
      />
    );

    const checkbox = screen.getByRole('checkbox');

    expect(checkbox).toBeInstanceOf(HTMLInputElement);
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
  });

  it('renders a color-carrying mark with the style converted to a React style object', () => {
    const { container } = render(
      <BlokView data={paragraphDoc('<mark style="color: rgb(255, 0, 0);">red</mark>')} />
    );

    const mark = container.querySelector('mark');

    expect(mark).not.toBeNull();
    expect(mark?.style.color).toBe('rgb(255, 0, 0)');
  });

  it('forwards toolAttributes so blocks carry the data-blok-tool styling hook', () => {
    const { container } = render(<BlokView data={paragraphDoc('Hi')} toolAttributes />);

    expect(container.querySelector('p')?.getAttribute('data-blok-tool')).toBe('paragraph');
  });

  it('forwards blockIds so blocks carry data-blok-id deep-link anchors', () => {
    const { container } = render(
      <BlokView data={{ blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Hi' } }] }} blockIds />
    );

    expect(container.querySelector('p')?.getAttribute('data-blok-id')).toBe('p1');
  });

  it('forwards transformUrl so media/link URLs are rewritten', () => {
    const { container } = render(
      <BlokView
        data={{ blocks: [{ type: 'image', data: { url: '/pic.png', alt: 'x' } }] }}
        transformUrl={(url) => `https://cdn.test${url}`}
      />
    );

    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/pic.png');
  });

  it('forwards id and arbitrary div attributes onto the wrapper', () => {
    const { container } = render(
      <BlokView data={paragraphDoc('x')} id="doc" data-testid="reader" aria-label="Article body" />
    );

    const wrapper = container.firstElementChild;

    expect(wrapper?.getAttribute('id')).toBe('doc');
    expect(wrapper?.getAttribute('data-testid')).toBe('reader');
    expect(wrapper?.getAttribute('aria-label')).toBe('Article body');
  });
});

describe('useBlokView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns unwrapped content usable inside a <label>', () => {
    const Label = (): React.ReactNode => {
      const content = useBlokView(paragraphDoc('Accept the terms'));

      return <label data-testid="the-label">{content}</label>;
    };

    render(<Label />);

    const label = screen.getByTestId('the-label');

    // No wrapper div: the block element is the label's direct child.
    expect(label.querySelector('div')).toBeNull();
    expect(label.firstElementChild?.tagName).toBe('P');
    expect(label).toHaveTextContent('Accept the terms');
  });

  it('memoizes: same data reference yields the same node across re-renders', () => {
    const data = paragraphDoc('stable');
    const results: React.ReactNode[] = [];

    const Probe = ({ tick }: { tick: number }): React.ReactNode => {
      const content = useBlokView(data);

      results.push(content);

      return <div data-tick={tick}>{content}</div>;
    };

    const { rerender } = render(<Probe tick={1} />);

    rerender(<Probe tick={2} />);

    expect(results).toHaveLength(2);
    expect(Object.is(results[0], results[1])).toBe(true);
  });

  it('recomputes when data changes', () => {
    const results: React.ReactNode[] = [];

    const Probe = ({ text }: { text: string }): React.ReactNode => {
      const content = useBlokView(paragraphDoc(text));

      results.push(content);

      return <span>{content}</span>;
    };

    const { rerender, container } = render(<Probe text="one" />);

    rerender(<Probe text="two" />);

    expect(container.querySelector('p')).toHaveTextContent('two');
    expect(Object.is(results[0], results[1])).toBe(false);
  });

  it('forwards toolAttributes / blockIds / transformUrl options', () => {
    const Probe = (): React.ReactNode => {
      const content = useBlokView(
        { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Hi' } }] },
        { toolAttributes: true, blockIds: true }
      );

      return <div data-testid="probe">{content}</div>;
    };

    render(<Probe />);

    const p = screen.getByTestId('probe').querySelector('p');

    expect(p?.getAttribute('data-blok-tool')).toBe('paragraph');
    expect(p?.getAttribute('data-blok-id')).toBe('p1');
  });
});
