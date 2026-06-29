import { describe, it, expect, vi } from 'vitest';

import { applyLinkConfig } from '../../../../src/components/utils/apply-link-config';

const makeRoot = (html: string): HTMLElement => {
  const root = document.createElement('div');

  root.innerHTML = html;

  return root;
};

describe('applyLinkConfig', () => {
  it('forces the default target and rel on anchors when neither is configured', () => {
    const root = makeRoot('<a href="https://example.com/">link</a>');

    applyLinkConfig(root, {});

    const anchor = root.querySelector('a');

    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('nofollow');
  });

  it('applies the configured target and rel, overriding existing attributes', () => {
    const root = makeRoot('<a href="https://example.com/" target="_self" rel="noopener">link</a>');

    applyLinkConfig(root, { target: '_top', rel: 'noreferrer' });

    const anchor = root.querySelector('a');

    expect(anchor?.getAttribute('target')).toBe('_top');
    expect(anchor?.getAttribute('rel')).toBe('noreferrer');
  });

  it('runs transformHref against the existing href and writes back the result', () => {
    const root = makeRoot('<a href="https://kb.internal/page">link</a>');
    const transformHref = vi.fn((href: string) => `https://public.example/?u=${encodeURIComponent(href)}`);

    applyLinkConfig(root, { transformHref });

    const anchor = root.querySelector('a');

    expect(transformHref).toHaveBeenCalledWith('https://kb.internal/page');
    expect(anchor?.getAttribute('href')).toBe('https://public.example/?u=https%3A%2F%2Fkb.internal%2Fpage');
  });

  it('does not call transformHref for anchors without an href but still applies target/rel', () => {
    const root = makeRoot('<a>no href anchor</a>');
    const transformHref = vi.fn((href: string) => href);

    applyLinkConfig(root, { transformHref });

    const anchor = root.querySelector('a');

    expect(transformHref).not.toHaveBeenCalled();
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('nofollow');
  });

  it('processes every anchor, including nested ones', () => {
    const root = makeRoot('<p><a href="https://a.test/">a</a></p><blockquote><a href="https://b.test/">b</a></blockquote>');
    const transformHref = vi.fn((href: string) => `${href}#x`);

    applyLinkConfig(root, { transformHref });

    const anchors = Array.from(root.querySelectorAll('a'));

    expect(anchors).toHaveLength(2);
    expect(anchors[0].getAttribute('href')).toBe('https://a.test/#x');
    expect(anchors[1].getAttribute('href')).toBe('https://b.test/#x');
    expect(anchors.every((a) => a.getAttribute('target') === '_blank')).toBe(true);
  });

  it('is a no-op when there are no anchors', () => {
    const root = makeRoot('<p>plain paragraph</p>');

    expect(() => applyLinkConfig(root, { target: '_self' })).not.toThrow();
  });
});
