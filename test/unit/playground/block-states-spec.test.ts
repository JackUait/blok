import { describe, test, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
      expect(html).toContain('blok-audio-error-state');
    });
  });

  describe('gallery preview tools', () => {
    test('mountStatePreview registers the embed tool', () => {
      expect(mountTools).toContain('embed: Embed');
    });

    test('mountStatePreview registers the bookmark tool', () => {
      expect(mountTools).toContain('bookmark: { class: Bookmark');
    });
  });
});
