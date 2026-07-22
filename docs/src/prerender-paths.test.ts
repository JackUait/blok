import { describe, it, expect } from 'vitest';
import { PRERENDER_PATHS, STATIC_PATHS } from './prerender-paths';
import { MODULE_ORDER } from './components/api/api-nav';
import { TOOL_SECTIONS } from './components/tools/tools-data';

describe('PRERENDER_PATHS', () => {
  it('covers every static route', () => {
    for (const path of STATIC_PATHS) {
      expect(PRERENDER_PATHS).toContain(path);
    }
    expect(STATIC_PATHS).toEqual([
      '/',
      '/demo',
      '/docs',
      '/tools',
      '/migration',
      '/migration/reference',
      '/changelog',
      '/404',
    ]);
  });

  it('covers every API module id', () => {
    for (const moduleId of MODULE_ORDER) {
      expect(PRERENDER_PATHS).toContain(`/docs/${moduleId}`);
    }
  });

  it('covers every tool id', () => {
    for (const tool of TOOL_SECTIONS) {
      expect(PRERENDER_PATHS).toContain(`/docs/${tool.id}`);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(PRERENDER_PATHS).size).toBe(PRERENDER_PATHS.length);
  });

  it('emits absolute, non-trailing-slash paths only', () => {
    for (const path of PRERENDER_PATHS) {
      expect(path.startsWith('/')).toBe(true);
      expect(path === '/' || !path.endsWith('/')).toBe(true);
    }
  });

  it('contains nothing beyond the statics, the modules and the tools', () => {
    const toolIds = new Set(TOOL_SECTIONS.map((tool) => tool.id));
    const expected = new Set<string>([
      ...STATIC_PATHS,
      ...MODULE_ORDER.map((id) => `/docs/${id}`),
      ...[...toolIds].map((id) => `/docs/${id}`),
    ]);
    expect(new Set(PRERENDER_PATHS)).toEqual(expected);
  });
});
