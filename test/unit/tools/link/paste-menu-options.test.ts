import { describe, it, expect } from 'vitest';
import { buildPasteMenuOptions } from '../../../../src/tools/link/paste-menu/options';
import { buildLivePasteMenuOptions } from '../../../../src/tools/link/paste-menu/controller';

const types = (url: string, hasSelection = false): string[] =>
  buildPasteMenuOptions(url, { hasSelection }).map((option) => option.type);

describe('buildPasteMenuOptions', () => {
  it('offers plain, bookmark and mention for a generic http URL', () => {
    const result = types('https://example.com/article');

    expect(result).toContain('plain');
    expect(result).toContain('bookmark');
    expect(result).toContain('mention');
  });

  it('does not offer embed for a generic URL', () => {
    expect(types('https://example.com/article')).not.toContain('embed');
  });

  it('offers embed for a known provider URL', () => {
    expect(types('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toContain('embed');
  });

  it('lists embed before bookmark when both apply', () => {
    const result = types('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(result.indexOf('embed')).toBeLessThan(result.indexOf('bookmark'));
  });

  it('offers only the plain option when text is selected (Notion just hyperlinks)', () => {
    expect(types('https://example.com/article', true)).toEqual(['plain']);
  });

  it('offers only the plain option for a non-http string', () => {
    expect(types('not a url')).toEqual(['plain']);
  });
});

const typesWith = (url: string, allowGenericEmbed: boolean): string[] =>
  buildPasteMenuOptions(url, { hasSelection: false, allowGenericEmbed }).map((o) => o.type);

describe('buildPasteMenuOptions — generic embed flag', () => {
  it('offers embed for an unmatched URL when allowGenericEmbed is true', () => {
    const result = typesWith('https://example.com/article', true);

    expect(result).toContain('embed');
    expect(result).toContain('bookmark');
    expect(result.indexOf('embed')).toBeLessThan(result.indexOf('bookmark'));
  });

  it('still hides embed for an unmatched URL when the flag is false', () => {
    expect(typesWith('https://example.com/article', false)).not.toContain('embed');
  });

  it('does not offer embed for a non-http string even when the flag is true', () => {
    expect(typesWith('not a url', true)).toEqual(['plain']);
  });
});

const typesOwnHosts = (url: string, ownHosts: string[], allowGenericEmbed = false): string[] =>
  buildPasteMenuOptions(url, { hasSelection: false, ownHosts, allowGenericEmbed }).map((o) => o.type);

describe('buildPasteMenuOptions — own host', () => {
  it('does not offer bookmark for a link to the editor host', () => {
    expect(typesOwnHosts('https://app.example.com/doc/1', ['app.example.com'])).not.toContain('bookmark');
  });

  it('ignores the port and letter case when matching the host', () => {
    expect(typesOwnHosts('http://APP.example.com:8080/doc', ['app.example.com'])).not.toContain('bookmark');
  });

  it('does not offer bookmark for a link to a host alias', () => {
    expect(typesOwnHosts('https://example.com/doc', ['app.example.com', 'example.com'])).not.toContain('bookmark');
  });

  it('matches a wildcard alias on any subdomain but not the bare domain', () => {
    expect(typesOwnHosts('https://a.b.example.com/doc', ['*.example.com'])).not.toContain('bookmark');
    expect(typesOwnHosts('https://example.com/doc', ['*.example.com'])).toContain('bookmark');
  });

  it('still offers bookmark for a link to another host', () => {
    expect(typesOwnHosts('https://other.com/doc', ['app.example.com'])).toContain('bookmark');
  });

  it('does not match a host that only ends with the own host name', () => {
    expect(typesOwnHosts('https://evilexample.com/doc', ['example.com'])).toContain('bookmark');
  });

  it('keeps embed for an own-host link when embeds apply', () => {
    expect(typesOwnHosts('https://app.example.com/doc', ['app.example.com'], true)).toEqual(['embed', 'mention', 'plain']);
  });
});

describe('page links', () => {
  const live = (url: string, pageId?: string): string[] =>
    buildLivePasteMenuOptions(url, { hasSelection: false, ownHosts: ['example.com'], ...(pageId ? { pageId } : {}) })
      .map((option) => option.type);

  it('offers a mention first, then the plain link, for a link to a page', () => {
    expect(live('https://example.com/editor/page/p1', 'p1')).toEqual(['mention', 'plain']);
  });

  it('offers no mention for a link that is not a page', () => {
    expect(live('https://elsewhere.org/article')).not.toContain('mention');
  });

  it('offers only the plain link when the page link is pasted over a selection', () => {
    expect(buildLivePasteMenuOptions('https://example.com/editor/page/p1', { hasSelection: true, pageId: 'p1' })
      .map((option) => option.type)).toEqual(['plain']);
  });
});
