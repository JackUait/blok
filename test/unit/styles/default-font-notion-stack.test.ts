import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ISOLATION_PATH = resolve(__dirname, '../../../src/styles/isolation.css');
const PLAYGROUND_PATH = resolve(__dirname, '../../../index.html');

// Notion's computed font-family on a database cell, header and title.
const NOTION_STACK =
  'ui-sans-serif, -apple-system, "system-ui", "Segoe UI Variable Display", "Segoe UI", Helvetica, ' +
  '"Apple Color Emoji", "Noto Sans Arabic", "Noto Sans Hebrew", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"';

describe('default sans font', () => {
  it('defaults --blok-font-sans to Notion\'s font stack', () => {
    const css = readFileSync(ISOLATION_PATH, 'utf-8');
    const match = /--blok-font-sans:\s*([^;]+);/.exec(css);

    expect(match?.[1].trim()).toBe(NOTION_STACK);
  });

  it('shows the same stack on the playground body', () => {
    const html = readFileSync(PLAYGROUND_PATH, 'utf-8');
    const body = /<body[^>]*style="([^"]*)"/.exec(html.replace(/&quot;/g, '\''));
    const family = /font-family:\s*([^;]+);/.exec(body?.[1] ?? '');

    expect(family?.[1].trim()).toBe(NOTION_STACK.replace(/"/g, '\''));
  });

  // The card is body-mounted, so without its own rule it takes the host page's font (Times on a bare page).
  it('gives the body-mounted link hover card the Blok sans font', () => {
    const css = readFileSync(ISOLATION_PATH, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = /\[data-blok-interface=link-hover-card\][^{]*\{([^}]*)\}/.exec(css);

    expect(rule?.[1]).toMatch(/font-family:\s*var\(--blok-font-family, var\(--blok-font-sans\)\)/);
  });
});
