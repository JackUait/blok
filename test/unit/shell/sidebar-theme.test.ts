import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createPageFrame } from '../../../src/shell/sidebar';

const css = readFileSync(resolve(__dirname, '../../../src/shell/sidebar.css'), 'utf8');

const darkMedia = css.match(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?\n\}/)?.[0] ?? '';
const forcedDark = css.match(/\[data-blok-theme="dark"\] \[data-blok-sidebar\] \{[\s\S]*?\n\}/)?.[0] ?? '';
const systemCanvas = css.match(/:root:not\(\[data-blok-theme="light"\]\) \[data-blok-sidebar-canvas\] \{[\s\S]*?\n  \}/)?.[0] ?? '';
const forcedCanvas = css.match(/\[data-blok-theme="dark"\] \[data-blok-sidebar-canvas\] \{[\s\S]*?\n\}/)?.[0] ?? '';

describe('sidebar theme', () => {
  it('keeps the shell in flex layout beside the page', () => {
    const frame = createPageFrame({
      pages: [],
      activeId: '',
      onOpen: () => undefined,
      onCreate: () => undefined,
    });
    expect(frame.element.getAttribute('data-blok-interface')).toBe('shell');
    expect(frame.element.children[0]).toHaveAttribute('data-blok-sidebar');
    expect(frame.element.children[1]).toBe(frame.canvas);
    expect(frame.element.querySelector('[data-blok-sidebar-edge] [role="separator"]')).not.toBeNull();
  });

  it('paints an opaque 1px edge and changes only its color on hover', () => {
    const edge = css.match(/\[data-blok-sidebar-edge\] \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(edge).toContain('position: absolute');
    expect(edge).toContain('inset-inline-end: 0');
    expect(edge).toContain('width: 1px');
    expect(edge).toContain('background: var(--blok-sidebar-edge-color)');
    expect(edge).not.toContain('--blok-popover-border');
    const sidebar = css.match(/\[data-blok-sidebar\] \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(sidebar).not.toContain('border-inline-end');
    const hover = css.match(/\[data-blok-sidebar-edge\]:has\(\[data-blok-sidebar-resize\]:hover\)[\s\S]*?\n\}/)?.[0] ?? '';
    expect(hover).toContain('background: var(--blok-sidebar-edge-hover-color)');
    expect(hover).not.toContain('width');
    expect(hover).not.toContain('border');
    expect(hover).not.toContain('inset');
    expect(hover).not.toContain('transform');
    expect(css).not.toMatch(/\[data-blok-sidebar\]:has\(\[data-blok-sidebar-resize\]/);
    expect(css).not.toContain('data-blok-sidebar-grip');
  });

  it('keeps the page, sidebar, and edge distinct at rest in dark mode', () => {
    const canvas = css.match(/\[data-blok-sidebar-canvas\] \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(canvas).toContain('background: var(--blok-bg-primary, #fff)');
    expect(canvas).not.toContain('--blok-popover-bg');
    for (const darkCanvas of [systemCanvas, forcedCanvas]) {
      expect(darkCanvas).toContain('background: #161616');
    }
    for (const dark of [darkMedia, forcedDark]) {
      expect(dark).toContain('background: #1b1b1b');
      expect(dark).toContain('--blok-sidebar-edge-color: #222222');
      expect(dark).toContain('--blok-sidebar-edge-hover-color: #2e2e2e');
      expect(dark).not.toContain('--blok-bg-light');
    }
  });
});
