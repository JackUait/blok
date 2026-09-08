import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Icons from '../../../src/components/icons';

const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');

const section = (start: string, end: string): string => {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);

  if (from < 0 || to < 0) {
    throw new Error(`Missing playground section: ${start}`);
  }

  return html.slice(from, to);
};

const svgOf = (markup: string): SVGSVGElement => {
  const svg = new DOMParser().parseFromString(markup, 'text/html').querySelector('svg');

  if (svg === null) {
    throw new Error('Missing SVG');
  }

  return svg;
};

describe('playground canonical icons', () => {
  let page: Document;

  beforeEach(() => {
    vi.clearAllMocks();
    page = new DOMParser().parseFromString(html, 'text/html');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the canonical close inside the existing 15-pixel control slot', () => {
    runInNewContext(section("document.getElementById('pg-version')", 'const state ='), {
      document: page, Icons, pkg: { version: 'test' },
    });

    expect(page.querySelector('#settings-close svg')?.outerHTML).toBe(svgOf(Icons.IconCross).outerHTML);
    expect(page.querySelector('#settings-close')?.getAttribute('aria-label')).toBe('Close settings panel');
    const css = section('#settings-close svg {', '}');

    expect(css).toMatch(/width:\s*15px/);
    expect(css).toMatch(/height:\s*15px/);
  });

  it.each([
    ['light', '--pg-select-caret', '#717171'],
    ['dark', '--pg-select-caret-dark', '#a8a8a8'],
  ])('uses canonical down-chevron geometry for the %s select caret', (_theme, variable, color) => {
    runInNewContext(section("document.getElementById('pg-version')", 'const state ='), {
      document: page, Icons, pkg: { version: 'test' },
    });

    const image = page.documentElement.style.getPropertyValue(variable);

    expect(image).toMatch(/^url\("data:image\/svg\+xml,/);
    const markup = decodeURIComponent(image.slice('url("data:image/svg+xml,'.length, -2));

    expect(svgOf(markup).outerHTML).toBe(svgOf(Icons.IconChevronDown.replaceAll('currentColor', color)).outerHTML);
    expect(section('.settings-select {', '}')).toMatch(/background-size:\s*10px 10px/);
    expect(section('.settings-select {', '}')).toContain('var(--pg-select-caret)');
    expect(section('.dark-mode .settings-select {', '}')).toContain('var(--pg-select-caret-dark)');
  });

  it('renders the selected locale with the canonical check at 12 pixels', () => {
    const localeList = page.createElement('ul');
    const localeEmpty = page.createElement('div');

    runInNewContext(`${section('const renderLocaleOptions =', 'const LOCALE_MENU_GAP')} renderLocaleOptions();`, {
      document: page,
      Icons,
      LOCALES: [{ code: 'en', name: 'English' }, { code: 'fr', name: 'French' }],
      state: { locale: 'en' },
      localeList,
      localeEmpty,
    });

    expect(localeList.querySelector('[aria-selected="true"] svg')?.outerHTML).toBe(svgOf(Icons.IconCheck).outerHTML);
    expect(localeList.querySelector('[aria-selected="true"]')?.getAttribute('data-code')).toBe('en');
    const css = section('.lang-option__check svg {', '}');

    expect(css).toMatch(/width:\s*12px/);
    expect(css).toMatch(/height:\s*12px/);
  });

  it('renders the toggle tool using the canonical disclosure chevron', () => {
    runInNewContext(section('const TOOL_DEFS =', 'for (const tool of TOOL_DEFS)'), { document: page, Icons });

    const toggle = page.querySelector('#toggle-tool-toggle')?.closest('label');

    expect(toggle?.querySelector('svg')?.outerHTML).toBe(svgOf(Icons.IconChevronRight).outerHTML);
    expect(toggle?.textContent).toContain('Toggle');
  });

  it.each([
    ['upload', Icons.IconUploadFailed],
    ['broken', Icons.IconImageBroken],
  ])('renders the %s error demo with the same icon as the real image tool', (variant, icon) => {
    const root = page.createElement('div');

    runInNewContext(`${section('function renderImageErrorDemo(', 'function initBlockStatesGallery(')}
      renderImageErrorDemo(root, { variant, title: 'Image unavailable', message: 'Try again' });`, {
      document: page, Icons, root, variant,
    });

    expect(root.querySelector('svg')?.outerHTML).toBe(svgOf(icon).outerHTML);
    expect(root.getAttribute('data-state')).toBe('error');
    expect(root.querySelector('[data-variant]')?.getAttribute('data-variant')).toBe(variant);
    expect(root.querySelector('[data-action="retry"]')?.textContent).toBe('Retry');
  });

  it('keeps reset as one clockwise refresh arc in the house grid, not a repeat glyph', () => {
    const svg = page.querySelector('#reset-content svg');
    const paths = Array.from(svg?.querySelectorAll('path') ?? []);

    expect(svg?.getAttribute('viewBox')).toBe('0 0 20 20');
    expect(svg?.getAttribute('width')).toBe('13');
    expect(svg?.getAttribute('height')).toBe('13');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(paths).toHaveLength(2);
    expect(paths[0].getAttribute('d')).toMatch(/a6\.5 6\.5 0 1 1/);
    for (const path of paths) {
      expect(path.getAttribute('stroke')).toBe('currentColor');
      expect(path.getAttribute('stroke-width')).toBe('1.25');
      expect(path.getAttribute('stroke-linecap')).toBe('round');
      expect(path.getAttribute('stroke-linejoin')).toBe('round');
    }
  });
});
