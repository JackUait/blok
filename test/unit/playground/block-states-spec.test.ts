import { describe, test, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

/**
 * The block-states gallery spec (BLOCK_STATES_RAW) lives inline in index.html.
 * These tests assert the link-paste tools (bookmark, embed) are represented
 * there with every state reachable from saved data.
 */
describe('playground block states spec (index.html)', () => {
  let html: string;
  let rawSpec: string;
  let mountTools: string;

  beforeAll(() => {
    html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');

    const specStart = html.indexOf('const BLOCK_STATES_RAW = [');
    const specEnd = html.indexOf('const BLOCK_STATES_SPEC');

    expect(specStart).toBeGreaterThan(-1);
    expect(specEnd).toBeGreaterThan(specStart);
    rawSpec = html.slice(specStart, specEnd);

    const mountStart = html.indexOf('function mountStatePreview');

    expect(mountStart).toBeGreaterThan(-1);
    mountTools = html.slice(mountStart, html.indexOf('blockStatesInstances.push', mountStart));
  });

  const sectionFor = (tool: string): string => {
    const start = rawSpec.indexOf(`tool: '${tool}'`);

    expect(start, `BLOCK_STATES_RAW entry for '${tool}'`).toBeGreaterThan(-1);

    const nextTool = rawSpec.indexOf("tool: '", start + 1);

    return nextTool === -1 ? rawSpec.slice(start) : rawSpec.slice(start, nextTool);
  };

  describe('bookmark entry', () => {
    test('has a bookmark tab', () => {
      expect(rawSpec).toContain("tool: 'bookmark'");
    });

    test.each([
      'Empty',
      'Full card',
      'No image',
      'Title only',
      'URL only',
    ])('covers the "%s" state', (label) => {
      expect(sectionFor('bookmark')).toContain(`label: '${label}'`);
    });

    test('full card state carries complete metadata', () => {
      const section = sectionFor('bookmark');

      for (const field of ['title:', 'description:', 'image:', 'favicon:', 'domain:']) {
        expect(section).toContain(field);
      }
    });

    test('all bookmark states use the bookmark block type', () => {
      expect(sectionFor('bookmark')).toContain("type: 'bookmark'");
    });
  });

  describe('embed entry', () => {
    test('has an embed tab', () => {
      expect(rawSpec).toContain("tool: 'embed'");
    });

    test.each([
      'Empty',
      'YouTube',
      'Resized (60%)',
      'Left aligned',
      'With caption',
      'Twitter (script)',
    ])('covers the "%s" state', (label) => {
      expect(sectionFor('embed')).toContain(`label: '${label}'`);
    });

    test('iframe states reference a registry-shaped embed url', () => {
      expect(sectionFor('embed')).toContain('https://www.youtube.com/embed/');
    });

    test('script state uses the script kind', () => {
      expect(sectionFor('embed')).toContain("kind: 'script'");
    });

    test.each([
      ['Typing · YouTube (video)', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'],
      ['Typing · Spotify (audio)', 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'],
      ['Typing · GIPHY (image)', 'https://giphy.com/gifs/cat-JIX9t2j0ZTN9S'],
      ['Typing · Instagram (social)', 'https://www.instagram.com/p/C1a2B3c4D5e/'],
      ['Typing · Google Docs (document)', 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit'],
      ['Typing · Airtable (table)', 'https://airtable.com/shrAbCdEfGh123456'],
      ['Typing · Typeform (form)', 'https://form.typeform.com/to/abc123'],
      ['Typing · CodePen (code)', 'https://codepen.io/team/codepen/pen/PNaGbb'],
      ['Typing · Figma (design)', 'https://www.figma.com/file/abc123XYZ/Design-system'],
      ['Typing · Flourish (chart)', 'https://public.flourish.studio/visualisation/1234567/'],
      ['Typing · OpenStreetMap (map)', 'https://www.openstreetmap.org/#map=13/51.5072/-0.1276'],
      ['Typing · Calendly (calendar)', 'https://calendly.com/acme/intro-call'],
      ['Typing · Unknown site (generic)', 'https://dashboards.example.com/q3'],
      ['Typing · Not embeddable', 'https://example.com/page'],
      ['Rejected link', 'https://example.com/rejected'],
    ])('covers the "%s" empty state with a typed draft', (label, url) => {
      const section = sectionFor('embed');
      const start = section.indexOf(`label: '${label}'`);

      expect(start, `state '${label}'`).toBeGreaterThan(-1);
      expect(section.slice(start, section.indexOf('\n', start))).toContain(`url: '${url}'`);
    });

    test('the rejected state submits its draft', () => {
      const section = sectionFor('embed');
      const start = section.indexOf("label: 'Rejected link'");

      expect(section.slice(start, section.indexOf('\n', start))).toContain('submit: true');
    });

    test('the generic draft runs with generic embeds allowed', () => {
      const section = sectionFor('embed');
      const start = section.indexOf("label: 'Typing · Unknown site (generic)'");

      expect(section.slice(start, section.indexOf('\n', start))).toContain('linkPaste: { allowGenericEmbed: true }');
    });

    test.each([
      ['Read-only empty', 'readOnly: true'],
      ['Narrow (window hidden)', 'width: 320'],
      ['Link card (not embeddable)', "source: 'https://example.com/"],
      ['Tampered data (inert)', "service: 'youtube'"],
      ['Generic iframe (opted in)', 'linkPaste: { allowGenericEmbed: true }'],
      ['Allowed origin iframe', 'linkPaste: { allowedEmbedOrigins: ['],
    ])('covers the "%s" state', (label, marker) => {
      const section = sectionFor('embed');
      const start = section.indexOf(`label: '${label}'`);

      expect(start, `state '${label}'`).toBeGreaterThan(-1);
      expect(section.slice(start, section.indexOf('] },', start))).toContain(marker);
    });

    test('mountStateSegment honours drafts, read-only, editor config and width', () => {
      expect(mountTools).toContain('readOnly');
      expect(mountTools).toContain('editorConfig');
      expect(mountTools).toContain('style.maxWidth');
      expect(html).toContain('[data-role="embed-url-input"]');
    });
  });

  describe('file entry', () => {
    test('has a file tab', () => {
      expect(rawSpec).toContain("tool: 'file'");
    });

    test('covers the "Long title" state', () => {
      expect(sectionFor('file')).toContain("label: 'Long title'");
    });

    test('long-title state carries a filename long enough to truncate', () => {
      const section = sectionFor('file');
      const match = /id: 'fl-long'[\s\S]*?fileName: '([^']+)'/.exec(section);

      expect(match, "fl-long fileName").not.toBeNull();
      expect(match?.[1].length ?? 0).toBeGreaterThan(60);
    });
  });

  describe('video entry', () => {
    test('has a video tab', () => {
      expect(rawSpec).toContain("tool: 'video'");
    });

    test.each([
      'Loaded',
      'With caption',
      'Small',
      'Left aligned',
      'Upload failed',
    ])('covers the "%s" state', (label) => {
      expect(sectionFor('video')).toContain(`label: '${label}'`);
    });
  });

  describe('audio entry', () => {
    test('has an audio tab', () => {
      expect(rawSpec).toContain("tool: 'audio'");
    });

    test('covers the "Google Drive error" state', () => {
      expect(sectionFor('audio')).toContain("label: 'Google Drive error'");
    });

    test('the Google Drive error demo is force-rendered after mount', () => {
      expect(html).toContain('[data-blok-id="au-drive-error"] [data-blok-tool="audio"]');
      expect(html).toContain('renderAudioErrorState({');
    });
  });

  describe('restricted-source empty states are live tools', () => {
    test.each([
      ['image', 'im-empty-upload', 'upload'],
      ['image', 'im-empty-link', 'url'],
      ['video', 'vd-empty-upload', 'upload'],
      ['video', 'vd-empty-link', 'url'],
      ['audio', 'au-empty-upload', 'upload'],
      ['audio', 'au-empty-link', 'url'],
      ['file', 'fl-empty-upload', 'upload'],
      ['file', 'fl-empty-link', 'url'],
    ])('%s state %s declares a per-state sources override', (tool, blockId, mode) => {
      const section = sectionFor(tool);
      const stateStart = section.indexOf(`'${blockId}'`);

      expect(stateStart, `state block id '${blockId}'`).toBeGreaterThan(-1);

      const lineStart = section.lastIndexOf('{ label:', stateStart);
      const state = section.slice(lineStart, stateStart);

      expect(state).toContain(`toolConfig: { ${tool}: { sources: '${mode}' } }`);
    });

    test('the static empty-state swap hack is gone (tiles are functional)', () => {
      expect(html).not.toContain('swapEmptyState');
      expect(html).not.toContain('onUrl: noop');
      expect(html).not.toContain('onFile: noop');
    });

    test('mountStatePreview applies per-segment toolConfig overrides', () => {
      expect(html).toContain('function mountStatePreview({ container, segments })');
      expect(html).toContain('toolConfig');
    });
  });

  describe('page entry', () => {
    test('has a page tab', () => {
      expect(rawSpec).toContain("tool: 'page'");
    });

    test.each([
      'Page',
      'Emoji icon',
      'Image icon',
      'Long title',
      'Untitled',
      'Loading',
      'Missing',
      'No access',
    ])('covers the "%s" state', (label) => {
      expect(sectionFor('page')).toContain(`label: '${label}'`);
    });

    test('all page states use the page block type', () => {
      expect(sectionFor('page')).toContain("type: 'page'");
    });

    test('every page state has its own fixture in the resolve map', () => {
      const section = sectionFor('page');
      const ids = [...section.matchAll(/pageId: '([^']+)'/g)].map((match) => match[1]);
      const mapStart = html.indexOf('const PAGE_STATE_INFO = {');

      expect(ids.length).toBeGreaterThanOrEqual(8);
      expect(mapStart).toBeGreaterThan(-1);

      const map = html.slice(mapStart, html.indexOf('};', mapStart));

      for (const id of ids.filter((pageId) => pageId !== 'pg-state-loading')) {
        expect(map, `PAGE_STATE_INFO entry for '${id}'`).toContain(`'${id}':`);
      }
    });

    test('the missing state resolves to null and the no-access state is denied', () => {
      const map = html.slice(html.indexOf('const PAGE_STATE_INFO = {'));

      expect(map).toMatch(/'pg-state-missing': null/);
      expect(map).toMatch(/'pg-state-denied': \{ access: 'none' \}/);
    });
  });

  describe('tabs entry', () => {
    test.each([
      'Three tabs',
      'With icons',
      'Empty tab',
      'Single tab',
      'Untitled tab',
      'Long titles',
      'Overflowing strip',
      'Rich content',
      'Tabs inside a tab',
      'Inside columns',
      'Read-only',
      'Right-to-left',
    ])('covers the "%s" state', (label) => {
      expect(sectionFor('tabs')).toContain(`label: '${label}'`);
    });

    test('the read-only state renders without the editing chrome', () => {
      expect(sectionFor('tabs')).toMatch(/label: 'Read-only', readOnly: true/);
    });

    test('the right-to-left state sets the editor direction', () => {
      expect(sectionFor('tabs')).toMatch(/label: 'Right-to-left', editorConfig: \{ i18n: \{ direction: 'rtl' \} \}/);
    });

    test('the overflowing strip is narrow enough to scroll', () => {
      expect(sectionFor('tabs')).toMatch(/label: 'Overflowing strip', width: \d+/);
    });
  });

  describe('gallery preview tools', () => {
    test('mountStatePreview registers the embed tool', () => {
      expect(mountTools).toContain('embed: Embed');
    });

    test('mountStatePreview registers the bookmark tool', () => {
      expect(mountTools).toContain('bookmark: { class: Bookmark');
    });

    test('mountStatePreview registers the page tool with a resolve fixture', () => {
      expect(mountTools).toContain('page: {');
      expect(mountTools).toContain('class: Page');
      expect(mountTools).toContain('resolve: (id) => PAGE_STATE_INFO[id]');
    });
  });

  describe('flattenStates', () => {
    const loadFlatten = (): ((tool: string, label: string, states: unknown[]) => { wide?: boolean; segments: Array<Record<string, unknown>> }) => {
      const start = html.indexOf('const WIDE_STATE_TOOLS');
      const end = html.indexOf('const BLOCK_STATES_RAW');

      expect(start, 'WIDE_STATE_TOOLS precedes flattenStates').toBeGreaterThan(-1);

      return runInNewContext(`${html.slice(start, end)}; flattenStates`) as ReturnType<typeof loadFlatten>;
    };

    test('gives every state its own labelled segment without a header block', () => {
      const flatten = loadFlatten();
      const result = flatten('paragraph', 'Paragraph', [
        { label: 'Empty', blocks: [ { id: 'a', type: 'paragraph', data: { text: '' } } ] },
        { label: 'Wide', width: 320, blocks: [ { id: 'b', type: 'paragraph', data: { text: 'x' } } ] },
      ]);

      expect(result.segments.map((s) => s.label)).toEqual([ 'Empty', 'Wide' ]);
      expect(result.segments.map((s) => (s.blocks as Array<{ id: string }>).map((b) => b.id))).toEqual([ [ 'a' ], [ 'b' ] ]);
      expect(result.segments[1].width).toBe(320);
      expect(result.wide).toBe(false);
    });

    test.each([ 'table', 'column_list', 'tabs', 'database', 'code', 'image', 'video', 'embed' ])('lays %s states across the whole row', (tool) => {
      expect(loadFlatten()('paragraph', 'p', []).wide).toBe(false);
      expect(loadFlatten()(tool, tool, []).wide).toBe(true);
    });
  });

  describe('callout entry', () => {
    test('every callout state carries its text as a child block, the only body the tool renders', () => {
      const section = sectionFor('callout');
      const callouts = section.match(/type: 'callout'[^\n]*/g) ?? [];

      expect(callouts).toHaveLength(5);
      callouts.forEach((line) => {
        expect(line).toMatch(/content: \['c-[a-z]+-p'\]/);
        expect(line).not.toContain('text:');
      });
    });
  });
});
