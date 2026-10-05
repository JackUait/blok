import { describe, expect, it } from 'vitest';
import { DOCUMENTED_TOOL_ROUTE_PATHS, TOOLS_SIDEBAR_SECTIONS } from '../components/tools/tools-data';
import { getRouteMetadata } from './route-metadata';
import { ruBuiltInTools } from './route-metadata.ru';

// Search copy must match what the code and the page actually say.
// Russian is read through the /ru path, the same lookup the /ru pages use.
const LOCALE_PREFIXES = ['', '/ru'] as const;

describe('saved-format field names in route metadata', () => {
  // Saver writes `parent`/`content` (src/components/modules/saver.ts, OutputBlockData
  // in types/data-formats/output-data.d.ts). `parentId`/`contentIds` are the live
  // block and useBlocks names, not the saved JSON.
  for (const prefix of LOCALE_PREFIXES) {
    for (const id of ['concepts', 'output-data', 'block-data']) {
      it(`${prefix || '/en'} /docs/${id} does not call the saved fields parentId/contentIds`, () => {
        const description = getRouteMetadata(`${prefix}/docs/${id}`)?.description ?? '';

        expect(description).not.toMatch(/parentId|contentIds/);
      });
    }

    for (const id of ['output-data', 'block-data']) {
      it(`${prefix || '/en'} /docs/${id} names the saved fields parent and content`, () => {
        const description = getRouteMetadata(`${prefix}/docs/${id}`)?.description ?? '';

        expect(description).toMatch(/\bparent\b/);
        expect(description).toMatch(/\bcontent\b/);
      });
    }
  }
});

describe('concepts description and inline markup', () => {
  // Text fields save inline HTML (paragraph save() returns innerHTML; underline wraps in <u>).
  it('does not claim the document holds no HTML', () => {
    expect(getRouteMetadata('/docs/concepts')?.description).not.toMatch(/no HTML/i);
    expect(getRouteMetadata('/ru/docs/concepts')?.description).not.toMatch(/нет HTML/i);
  });

  it('says inline text may carry markup', () => {
    expect(getRouteMetadata('/docs/concepts')?.description).toMatch(/inline/i);
    expect(getRouteMetadata('/ru/docs/concepts')?.description).toMatch(/разметк/i);
  });
});

describe('tool count on /docs', () => {
  const total = DOCUMENTED_TOOL_ROUTE_PATHS.length;

  it('matches the sidebar', () => {
    const sidebarTotal = TOOLS_SIDEBAR_SECTIONS.reduce((sum, section) => sum + section.links.length, 0);

    expect(total).toBe(sidebarTotal);
  });

  it('states the documented tool count in both locales', () => {
    expect(getRouteMetadata('/docs')?.description).toContain(`${total} built-in`);
    expect(getRouteMetadata('/ru/docs')?.description).toContain(ruBuiltInTools(total));
  });

  it('agrees the Russian noun with the number', () => {
    expect(ruBuiltInTools(21)).toBe('21 встроенный блочный и строчный инструмент');
    expect(ruBuiltInTools(32)).toBe('32 встроенных блочных и строчных инструмента');
    expect(ruBuiltInTools(25)).toBe('25 встроенных блочных и строчных инструментов');
  });
});

describe('/migration names only what the page guides', () => {
  for (const prefix of LOCALE_PREFIXES) {
    it(`${prefix || '/en'} /migration names Editor.js and no other editor`, () => {
      const meta = getRouteMetadata(`${prefix}/migration`);

      expect(meta?.title).toContain('Editor.js');
      expect(meta?.description).toContain('Editor.js');
      expect(`${meta?.title} ${meta?.description}`).not.toMatch(/TipTap|Quill/i);
    });
  }
});

describe('/docs/blok-editor covers every adapter', () => {
  for (const prefix of LOCALE_PREFIXES) {
    it(`${prefix || '/en'} title, h1 and description name React, Vue and Angular`, () => {
      const meta = getRouteMetadata(`${prefix}/docs/blok-editor`);

      for (const framework of ['React', 'Vue', 'Angular']) {
        expect(meta?.title).toContain(framework);
        expect(meta?.h1).toContain(framework);
        expect(meta?.description).toContain(framework);
      }
    });
  }

  it('does not name React-only props or a ref API in the description', () => {
    for (const prefix of LOCALE_PREFIXES) {
      expect(getRouteMetadata(`${prefix}/docs/blok-editor`)?.description).not.toMatch(/onChange|onSave|\bref\b/);
    }
  });
});
