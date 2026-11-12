import { describe, it, expect } from 'vitest';
import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

const playingRules = (): string[] =>
  css.split('}')
    .map(chunk => chunk.split('{'))
    .filter(([selector]) => selector.includes('audio') && selector.includes('[data-playing="true"]'))
    .map(([, body = '']) => body);

describe('audio while playing', () => {
  it('adds no shadow or glow to the cover', () => {
    const rules = playingRules();

    expect(rules.length).toBeGreaterThan(0);
    rules.forEach(body => {
      expect(body).not.toMatch(/box-shadow|filter\s*:/);
    });
  });

  it('drops the halo token the glow used', () => {
    expect(css).not.toMatch(/--blok-audio-halo/);
  });
});
