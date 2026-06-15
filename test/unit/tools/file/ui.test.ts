import { describe, it, expect, vi } from 'vitest';
import { renderFileCard, renderCaptionRow } from '../../../../src/tools/file/ui';

describe('renderFileCard', () => {
  it('renders a separate download anchor pointing at the url with the download attribute', () => {
    const card = renderFileCard({ url: 'https://cdn/doc.pdf', fileName: 'doc.pdf', size: 2048 });
    const download = card.querySelector<HTMLAnchorElement>('a.blok-file-download[data-action="download"]');
    expect(download).not.toBeNull();
    expect(download?.getAttribute('href')).toBe('https://cdn/doc.pdf');
    expect(download?.getAttribute('download')).toBe('doc.pdf');
  });

  it('renders the card body as a download anchor when no onPreview is given', () => {
    const card = renderFileCard({ url: 'https://cdn/doc.pdf', fileName: 'doc.pdf', size: 2048 });
    const body = card.querySelector('[data-role="file-card"]');
    expect(body?.tagName).toBe('A');
    expect(body?.getAttribute('data-action')).toBe('download');
  });

  it('renders the card body as a preview button when onPreview is given', () => {
    const onPreview = vi.fn();
    const card = renderFileCard({ url: 'https://cdn/doc.pdf', fileName: 'doc.pdf', size: 2048 }, onPreview);
    const body = card.querySelector('[data-role="file-card"]');
    expect(body?.tagName).toBe('BUTTON');
    expect(body?.getAttribute('data-action')).toBe('preview');
  });

  it('invokes the preview callback when the preview body is clicked', () => {
    let opened = false;
    const onPreview = (): void => {
      opened = true;
    };
    const card = renderFileCard({ url: 'https://cdn/doc.pdf', fileName: 'doc.pdf', size: 2048 }, onPreview);
    const body = card.querySelector<HTMLButtonElement>('[data-role="file-card"]');
    if (!body) throw new Error('body missing');
    body.click();
    expect(opened).toBe(true);
  });

  it('keeps the separate download link present when onPreview is given', () => {
    const onPreview = vi.fn();
    const card = renderFileCard({ url: 'https://cdn/doc.pdf', fileName: 'doc.pdf', size: 2048 }, onPreview);
    const download = card.querySelector<HTMLAnchorElement>('a.blok-file-download[data-action="download"]');
    expect(download).not.toBeNull();
    expect(download?.getAttribute('href')).toBe('https://cdn/doc.pdf');
  });

  it('has no nested anchors inside any anchor', () => {
    const card = renderFileCard({ url: 'https://cdn/doc.pdf', fileName: 'doc.pdf', size: 2048 });
    const anchors = card.querySelectorAll('a');
    anchors.forEach((anchor) => {
      expect(anchor.querySelector('a')).toBeNull();
    });
  });

  it('shows the filename and human-readable size', () => {
    const card = renderFileCard({ url: 'https://cdn/doc.pdf', fileName: 'doc.pdf', size: 2048 });
    expect(card.querySelector('[data-role="file-name"]')?.textContent).toBe('doc.pdf');
    expect(card.querySelector('[data-role="file-size"]')?.textContent).toBe('2 KB');
  });

  it('falls back to the url as the name when fileName is absent', () => {
    const card = renderFileCard({ url: 'https://cdn/report' });
    expect(card.querySelector('[data-role="file-name"]')?.textContent).toBe('https://cdn/report');
  });

  it('omits the size element when size is undefined', () => {
    const card = renderFileCard({ url: 'https://cdn/doc.pdf', fileName: 'doc.pdf' });
    expect(card.querySelector('[data-role="file-size"]')).toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ])('neutralizes non-http(s) scheme %s so it is not clickable', (url) => {
    const card = renderFileCard({ url, fileName: 'x' });
    const download = card.querySelector<HTMLAnchorElement>('a.blok-file-download[data-action="download"]');
    expect(download?.hasAttribute('href')).toBe(false);
  });

  it('neutralizes non-http(s) scheme on the body anchor too', () => {
    const card = renderFileCard({ url: 'javascript:alert(1)', fileName: 'x' });
    const body = card.querySelector<HTMLAnchorElement>('[data-role="file-card"]');
    expect(body?.tagName).toBe('A');
    expect(body?.hasAttribute('href')).toBe(false);
  });

  it('preserves http and https schemes on the download href', () => {
    expect(
      renderFileCard({ url: 'http://cdn/doc.pdf' })
        .querySelector('a.blok-file-download[data-action="download"]')
        ?.getAttribute('href'),
    ).toBe('http://cdn/doc.pdf');
  });
});

describe('renderCaptionRow', () => {
  it('renders an editable caption when not read-only', () => {
    const row = renderCaptionRow({ value: 'hi', placeholder: 'Caption…', readOnly: false, onChange: vi.fn() });
    const caption = row.querySelector('[data-role="file-caption"]');
    expect(caption?.getAttribute('contenteditable')).toBe('true');
    expect(caption?.textContent).toBe('hi');
  });

  it('renders a non-editable caption when read-only', () => {
    const row = renderCaptionRow({ value: 'hi', placeholder: 'Caption…', readOnly: true, onChange: vi.fn() });
    expect(row.querySelector('[data-role="file-caption"]')?.getAttribute('contenteditable')).toBe('false');
  });

  it('calls onChange with the new text on blur', () => {
    const onChange = vi.fn();
    const row = renderCaptionRow({ value: '', placeholder: 'Caption…', readOnly: false, onChange });
    const caption = row.querySelector<HTMLElement>('[data-role="file-caption"]');
    if (!caption) throw new Error('caption missing');
    caption.textContent = 'new caption';
    caption.dispatchEvent(new Event('blur'));
    expect(onChange).toHaveBeenCalledWith('new caption');
  });
});
