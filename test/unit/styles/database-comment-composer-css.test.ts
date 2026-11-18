/**
 * The comment composer's buttons (notion-motion.md Round 62 §2). jsdom has no CSS, so this reads the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const ruleBody = (selector: string): string =>
  Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .filter((match) => (match[1] ?? '').split(',').map((part) => part.trim()).includes(selector))
    .map((match) => match[2] ?? '')
    .join(';');

const BUTTONS = ['attach', 'mention', 'send'];

describe('comment composer buttons', () => {
  it('are 24 square, radius 6, and their hover tint fades over 0.1s', () => {
    for (const name of BUTTONS) {
      const body = ruleBody(`[data-blok-database-comment-${name}]`);

      expect(body).toContain('width: 24px');
      expect(body).toContain('height: 24px');
      expect(body).toContain('border-radius: var(--blok-radius-control)');
      expect(body).toContain('transition: background-color 0.1s ease-in-out');
    }
  });

  it('draw a 20px icon in the secondary ink', () => {
    for (const name of BUTTONS) {
      const body = ruleBody(`[data-blok-database-comment-${name}] svg`);

      expect(body).toContain('width: 20px');
      expect(body).toContain('height: 20px');
    }
  });

  it('sit 30 apart', () => {
    expect(ruleBody('[data-blok-database-comment-attach] + [data-blok-database-comment-mention]')).toContain('margin-inline-start: var(--blok-space-0-5)');
    expect(ruleBody('[data-blok-database-comment-mention] + [data-blok-database-comment-send]')).toContain('margin-inline-start: var(--blok-space-0-5)');
  });

  it('Send is faded at 0.4 while empty and blue once there is text', () => {
    expect(ruleBody('[data-blok-database-comment-send]:disabled')).toContain('opacity: 0.4');
    expect(ruleBody('[data-blok-database-comment-send]:not(:disabled)')).toContain('color: var(--blok-database-comment-send-on)');
    expect(css).toMatch(/--blok-database-comment-send-on:\s*rgb\(39, 131, 222\)/);
  });

  // Round 62 §2 corrects R61: the feed composer's buttons are hidden at rest and on hover, and show at once with focus.
  it('the feed composer shows its buttons only while it has focus', () => {
    for (const name of BUTTONS) {
      expect(ruleBody(`[data-blok-database-feed-comments] [data-blok-database-comment-composer]:not(:has(:focus-visible)) > [data-blok-database-comment-${name}]`))
        .toContain('display: none');
    }
  });

  // Round 62 §2 (Notion feed composer, card at 539 as Round 61 §6): input 560 at rest and 470 focused,
  // Attach at card + 562, Mention + 592, Send + 622, so Send ends 46 from the card's right.
  it('the feed composer places its buttons as Notion does: 30 apart, Send 46 from the card edge', () => {
    const feed = '[data-blok-database-feed-comments] [data-blok-database-comment-composer]';

    expect(ruleBody(feed)).toContain('gap: 5.5px');
    expect(ruleBody(feed)).toContain('margin-inline-end: calc(var(--blok-space-6) + var(--blok-space-1-5))');
    expect(ruleBody(`${feed} > [data-blok-database-comment-input]`)).toContain('margin-inline-end: 2.5px');
    expect(ruleBody(feed)).toContain('--_blok-feed-tool-nudge: 0.5px');
    for (const name of BUTTONS) {
      expect(ruleBody(`${feed} > [data-blok-database-comment-${name}]`)).toContain('margin-inline-start: var(--_blok-feed-tool-nudge)');
    }
  });
});
