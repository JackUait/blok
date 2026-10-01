import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { OWN_LANGUAGE_LOGOS } from '../../../../src/tools/code/language-logos-own';
import { LANGUAGE_LOGOS } from '../../../../src/tools/code/language-logos';
import { LANGUAGES } from '../../../../src/tools/code/constants';
import { languageBadge } from '../../../../src/tools/code/language-picker';

const ALL = { ...LANGUAGE_LOGOS, ...OWN_LANGUAGE_LOGOS };

/** Where an `<ellipse>` (stroke and rotation included) leaves the 24×24 box, or null when it fits. */
const ellipseOverflow = (id: string, attributes: string): string | null => {
  const attr = (name: string): number => Number(new RegExp(`(?:^| )${name}="([^"]+)"`).exec(attributes)?.[1] ?? 0);
  const angle = (Number(/rotate\((-?[\d.]+)/.exec(attributes)?.[1] ?? 0) * Math.PI) / 180;
  const half = attr('stroke-width') / 2;
  const [rx, ry, cx, cy] = [attr('rx'), attr('ry'), attr('cx'), attr('cy')];
  const dx = Math.hypot(rx * Math.cos(angle), ry * Math.sin(angle)) + half;
  const dy = Math.hypot(rx * Math.sin(angle), ry * Math.cos(angle)) + half;

  return cx - dx < 0 || cx + dx > 24 || cy - dy < 0 || cy + dy > 24
    ? `${id}: ellipse at ${cx},${cy} spans x ${(cx - dx).toFixed(2)}..${(cx + dx).toFixed(2)}`
    : null;
};

describe('Blok-drawn language logos', () => {
  it('covers every language that has no vendored logo, so no row falls back to a monogram', () => {
    const missing = LANGUAGES
      .map((lang) => lang.id)
      .filter((id) => id !== 'plain text' && ALL[id] === undefined);

    expect(missing).toStrictEqual([]);
  });

  it('never overlaps the vendored set', () => {
    expect(Object.keys(OWN_LANGUAGE_LOGOS).filter((id) => id in LANGUAGE_LOGOS)).toStrictEqual([]);
  });

  it('is original artwork, not copied from Simple Icons', () => {
    const source = readFileSync(resolve(__dirname, '../../../../src/tools/code/language-logos-own.ts'), 'utf8');

    expect(source).not.toMatch(/simple-?icons/i);
  });

  it('renders an own logo as an SVG, not a monogram', () => {
    for (const id of Object.keys(OWN_LANGUAGE_LOGOS)) {
      const badge = languageBadge(id, { theme: 'light', logos: ALL });

      expect(badge.querySelector('svg'), id).not.toBeNull();
      expect(badge.querySelector('[data-monogram]'), id).toBeNull();
    }
  });

  it('gives every badge its own mask id, so cut-outs never bleed between rows', () => {
    const ids = ['rust', 'rust', 'php'].map((id) =>
      languageBadge(id, { theme: 'light', logos: ALL }).querySelector('mask')?.getAttribute('id'));

    expect(new Set(ids).size).toBe(3);
  });

  it('blinks the shell cursor only on its row\'s hover or focus, and only when motion is welcome', () => {
    const cursor = languageBadge('shell', { theme: 'light', logos: ALL }).querySelector('[data-blok-code-logo-cursor]');
    const classes = cursor?.getAttribute('class') ?? '';

    expect(classes).toContain('motion-safe:in-[[data-blok-popover-item]:hover]:animate-[blok-code-logo-blink_1s_steps(1)_infinite]');
    expect(classes).toContain('motion-safe:in-[[data-blok-focused=true]]:animate-[blok-code-logo-blink_1s_steps(1)_infinite]');
    expect(classes).not.toMatch(/(^| )animate-/);

    const keyframes = readFileSync(resolve(__dirname, '../../../../src/styles/keyframes.css'), 'utf8');

    expect(keyframes).toContain('@keyframes blok-code-logo-blink');
  });

  it('keeps every ellipse, stroke and rotation included, inside the 24×24 box', () => {
    const outside = Object.entries(OWN_LANGUAGE_LOGOS).flatMap(([id, logo]) =>
      Array.from(`${logo.body}${logo.over ?? ''}`.matchAll(/<ellipse ([^>]*)\/>/g), (match) => ellipseOverflow(id, match[1]))
        .filter((problem): problem is string => problem !== null));

    expect(outside).toStrictEqual([]);
  });
});
