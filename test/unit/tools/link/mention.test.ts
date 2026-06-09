import { describe, it, expect } from 'vitest';
import {
  buildMentionElement,
  MENTION_CLASS,
  MENTION_FAVICON_CLASS,
  MENTION_LABEL_CLASS,
  MENTION_SANITIZE_CONFIG,
} from '../../../../src/tools/link/mention/mention';

describe('buildMentionElement', () => {
  it('returns an anchor with the mention class, href, target and rel', () => {
    const el = buildMentionElement({ url: 'https://example.com/path', title: 'Example' });

    expect(el.tagName).toBe('A');
    expect(el.classList.contains(MENTION_CLASS)).toBe(true);
    expect(el.getAttribute('href')).toBe('https://example.com/path');
    expect(el.getAttribute('target')).toBe('_blank');
    expect(el.getAttribute('rel')).toContain('nofollow');
  });

  it('prepends a favicon img when favicon is provided', () => {
    const el = buildMentionElement({
      url: 'https://example.com',
      title: 'Example',
      favicon: 'https://example.com/favicon.ico',
    });

    const img = el.querySelector('img.' + MENTION_FAVICON_CLASS);

    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toMatch(/favicon\.ico$/);
  });

  it('renders no img when no favicon is provided', () => {
    const el = buildMentionElement({ url: 'https://example.com', title: 'Example' });

    expect(el.querySelector('img')).toBeNull();
  });

  it('uses the title for the label text when provided', () => {
    const el = buildMentionElement({ url: 'https://example.com', title: 'My Title' });

    const label = el.querySelector('span.' + MENTION_LABEL_CLASS);

    expect(label?.textContent).toBe('My Title');
  });

  it('falls back to the hostname for the label when title is missing', () => {
    const el = buildMentionElement({ url: 'https://example.com/x/y' });

    const label = el.querySelector('span.' + MENTION_LABEL_CLASS);

    expect(label?.textContent).toBe('example.com');
  });

  it('neutralizes HTML in the title (no injected img, literal text)', () => {
    const malicious = '<img src=x onerror=alert(1)>';
    const el = buildMentionElement({ url: 'https://example.com', title: malicious });

    const label = el.querySelector('span.' + MENTION_LABEL_CLASS);

    expect(el.querySelector('img')).toBeNull();
    expect(label?.querySelector('img')).toBeNull();
    expect(label?.textContent).toBe(malicious);
  });
});

describe('MENTION_SANITIZE_CONFIG', () => {
  it('allows the anchor with its attributes', () => {
    expect(MENTION_SANITIZE_CONFIG.a).toEqual({
      href: true,
      class: true,
      target: true,
      rel: true,
    });
  });

  it('allows the favicon img with its attributes', () => {
    expect(MENTION_SANITIZE_CONFIG.img).toEqual({
      src: true,
      class: true,
      alt: true,
    });
  });

  it('allows the label span class', () => {
    expect(MENTION_SANITIZE_CONFIG.span).toEqual({
      class: true,
    });
  });
});
