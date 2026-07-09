import { describe, it, expect, vi } from 'vitest';

import {
  applyResolvedLinkAttributes,
  resolveLinkAttributes,
} from '../../../../src/components/utils/resolve-link-attributes';

const makeAnchor = (href: string, text = ''): HTMLAnchorElement => {
  const anchor = document.createElement('a');

  anchor.setAttribute('href', href);
  anchor.textContent = text;

  return anchor;
};

describe('resolveLinkAttributes', () => {
  it('defaults target/rel and leaves the href untouched with an empty config', () => {
    const resolved = resolveLinkAttributes('https://cross.example/', makeAnchor('https://cross.example/'), {});

    expect(resolved).toEqual({
      href: 'https://cross.example/',
      target: '_blank',
      rel: 'nofollow',
      attributes: {},
    });
  });

  it('applies transformHref when no transform is present', () => {
    const resolved = resolveLinkAttributes('https://a.test/', makeAnchor('https://a.test/'), {
      transformHref: (href) => `${href}#x`,
    });

    expect(resolved.href).toBe('https://a.test/#x');
  });

  it('forces _self for same-page links, decided from the original href', () => {
    const resolved = resolveLinkAttributes('#results', makeAnchor('#results'), {
      target: '_blank',
      transformHref: (href) => `https://proxy.example/?u=${encodeURIComponent(href)}`,
    });

    expect(resolved.target).toBe('_self');
    expect(resolved.href).toBe('https://proxy.example/?u=%23results');
  });

  it('gives the transform the original href and anchor text', () => {
    const transform = vi.fn(() => ({}));
    const anchor = makeAnchor('https://a.test/', 'label');

    resolveLinkAttributes('https://a.test/', anchor, { transform });

    expect(transform).toHaveBeenCalledWith({ href: 'https://a.test/', text: 'label', element: anchor });
  });

  it('supersedes transformHref with transform', () => {
    const transformHref = vi.fn((href: string) => `${href}?shorthand`);
    const resolved = resolveLinkAttributes('https://a.test/', makeAnchor('https://a.test/'), {
      transformHref,
      transform: () => ({ href: 'https://via-transform.example/' }),
    });

    expect(transformHref).not.toHaveBeenCalled();
    expect(resolved.href).toBe('https://via-transform.example/');
  });

  it('falls back to defaults for fields the transform omits, and passes attributes through', () => {
    const resolved = resolveLinkAttributes('https://cross.example/', makeAnchor('https://cross.example/'), {
      target: '_top',
      rel: 'noreferrer',
      transform: () => ({ attributes: { 'data-x': '1' } }),
    });

    expect(resolved).toEqual({
      href: 'https://cross.example/',
      target: '_top',
      rel: 'noreferrer',
      attributes: { 'data-x': '1' },
    });
  });

  it('treats a void transform return as "keep all defaults"', () => {
    const resolved = resolveLinkAttributes('https://cross.example/', makeAnchor('https://cross.example/'), {
      transform: () => undefined,
    });

    expect(resolved).toEqual({
      href: 'https://cross.example/',
      target: '_blank',
      rel: 'nofollow',
      attributes: {},
    });
  });
});

describe('applyResolvedLinkAttributes', () => {
  it('writes href/target/rel and extra attributes onto the anchor', () => {
    const anchor = makeAnchor('https://old.example/');

    applyResolvedLinkAttributes(anchor, {
      href: 'https://new.example/',
      target: '_self',
      rel: 'noopener',
      attributes: { class: 'x', title: 't' },
    });

    expect(anchor.getAttribute('href')).toBe('https://new.example/');
    expect(anchor.getAttribute('target')).toBe('_self');
    expect(anchor.getAttribute('rel')).toBe('noopener');
    expect(anchor.getAttribute('class')).toBe('x');
    expect(anchor.getAttribute('title')).toBe('t');
  });

  it('keeps the managed href/target/rel authoritative over same-named attributes', () => {
    const anchor = makeAnchor('https://old.example/');

    applyResolvedLinkAttributes(anchor, {
      href: 'https://managed.example/',
      target: '_self',
      rel: 'noopener',
      attributes: { href: 'https://evil.example/', target: '_blank', rel: 'x' },
    });

    expect(anchor.getAttribute('href')).toBe('https://managed.example/');
    expect(anchor.getAttribute('target')).toBe('_self');
    expect(anchor.getAttribute('rel')).toBe('noopener');
  });
});
