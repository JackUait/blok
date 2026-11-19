import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRecentLinks,
  recordRecentLink,
  updateRecentLinkMeta
} from '../../../../src/components/inline-tools/link-history';

const STORAGE_KEY = 'blok-recent-links';

describe('link history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem(STORAGE_KEY);
  });

  it('is empty when nothing was recorded', () => {
    expect(getRecentLinks()).toEqual([]);
  });

  it('keeps only the three newest links, newest first', () => {
    recordRecentLink('https://a.com');
    recordRecentLink('https://b.com');
    recordRecentLink('https://c.com');
    recordRecentLink('https://d.com');
    recordRecentLink('https://e.com');

    expect(getRecentLinks().map((entry) => entry.url)).toEqual([
      'https://e.com',
      'https://d.com',
      'https://c.com',
    ]);
  });

  it('reads no more than three links from storage an older version wrote', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['a', 'b', 'c', 'd'].map((name) => ({ url: `https://${name}.com` }))));

    expect(getRecentLinks().map((entry) => entry.url)).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
  });

  it('moves a re-added link to the top without duplicating it', () => {
    recordRecentLink('https://a.com');
    recordRecentLink('https://b.com');
    recordRecentLink('https://a.com');

    expect(getRecentLinks().map((entry) => entry.url)).toEqual(['https://a.com', 'https://b.com']);
  });

  it('keeps a known title when the same link is added again', () => {
    recordRecentLink('https://a.com');
    updateRecentLinkMeta('https://a.com', { title: 'A site' });
    recordRecentLink('https://b.com');
    recordRecentLink('https://a.com');

    expect(getRecentLinks()[0]).toEqual({ url: 'https://a.com', title: 'A site', checked: true });
  });

  it('stores the title for a recorded link', () => {
    recordRecentLink('https://a.com');
    updateRecentLinkMeta('https://a.com', { title: 'A site' });

    expect(getRecentLinks()).toEqual([
      { url: 'https://a.com', title: 'A site', checked: true },
    ]);
  });

  it('remembers that a link was looked up, even when the page had nothing to give', () => {
    recordRecentLink('https://a.com');
    updateRecentLinkMeta('https://a.com', {});

    expect(getRecentLinks()).toEqual([{ url: 'https://a.com', checked: true }]);
  });

  it('keeps the looked-up mark when the same link is added again', () => {
    recordRecentLink('https://a.com');
    updateRecentLinkMeta('https://a.com', { title: 'A' });
    recordRecentLink('https://a.com/');

    expect(getRecentLinks()).toEqual([{ url: 'https://a.com/', title: 'A', checked: true }]);
  });

  it('ignores metadata for a link that already left the history', () => {
    recordRecentLink('https://a.com');
    recordRecentLink('https://b.com');
    recordRecentLink('https://c.com');
    recordRecentLink('https://d.com');
    recordRecentLink('https://e.com');
    updateRecentLinkMeta('https://a.com', { title: 'A site' });

    expect(getRecentLinks().map((entry) => entry.url)).not.toContain('https://a.com');
  });

  it('drops a blank title instead of storing it', () => {
    recordRecentLink('https://a.com');
    updateRecentLinkMeta('https://a.com', { title: '   ' });

    expect(getRecentLinks()).toEqual([{ url: 'https://a.com', checked: true }]);
  });

  it('treats www, http(s) and a trailing slash as the same link, keeping what it knew', () => {
    recordRecentLink('https://youtube.com');
    updateRecentLinkMeta('https://youtube.com', { title: 'YouTube' });
    recordRecentLink('https://b.com');
    recordRecentLink('http://www.youtube.com/');

    expect(getRecentLinks()).toEqual([
      { url: 'http://www.youtube.com/', title: 'YouTube', checked: true },
      { url: 'https://b.com' },
    ]);
  });

  it('keeps links apart when only their path, query or hash differs', () => {
    recordRecentLink('https://a.com/docs');
    recordRecentLink('https://a.com/docs?tab=2');
    recordRecentLink('https://a.com/docs#intro');

    expect(getRecentLinks()).toHaveLength(3);
  });

  it('drops a site icon stored by an older version', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { url: 'https://a.com', title: 'A', favicon: 'https://a.com/icon.png' },
    ]));

    expect(getRecentLinks()).toEqual([{ url: 'https://a.com', title: 'A' }]);
  });

  it('shows duplicates already in storage once, newest first', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { url: 'https://www.youtube.com/', title: 'YouTube' },
      { url: 'https://youtube.com' },
    ]));

    expect(getRecentLinks()).toEqual([{ url: 'https://www.youtube.com/', title: 'YouTube' }]);
  });

  it.each([
    ['- YouTube', 'YouTube'],
    ['Docs | ', 'Docs'],
    ['· Blok — ', 'Blok'],
    ['Q&A: tips - part 2', 'Q&A: tips - part 2'],
  ])('trims separator debris from the title %j', (raw, clean) => {
    recordRecentLink('https://a.com');
    updateRecentLinkMeta('https://a.com', { title: raw });

    expect(getRecentLinks()[0].title).toBe(clean);
  });

  it('cleans a title stored before the cleanup existed, and drops one that is only separators', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { url: 'https://a.com', title: '- YouTube' },
      { url: 'https://b.com', title: ' | ' },
    ]));

    expect(getRecentLinks()).toEqual([
      { url: 'https://a.com', title: 'YouTube' },
      { url: 'https://b.com' },
    ]);
  });

  it('reads corrupt storage as an empty history', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');

    expect(getRecentLinks()).toEqual([]);
  });

  it('skips malformed entries', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { url: 'https://a.com', title: 'A' },
      { title: 'no url' },
      { url: 42 },
      { url: 'https://b.com', title: 7 },
    ]));

    expect(getRecentLinks()).toEqual([{ url: 'https://a.com', title: 'A' }, { url: 'https://b.com' }]);
  });

  it('does not throw when storage refuses writes', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => recordRecentLink('https://a.com')).not.toThrow();
    expect(() => updateRecentLinkMeta('https://a.com', { title: 'A' })).not.toThrow();
  });
});
