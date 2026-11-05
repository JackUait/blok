/**
 * Hostile SAVED embed data reaching the editor's embed tool. Every case states
 * the safe outcome; a failing case is an open attack.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Embed, type EmbedData } from '../../../../src/tools/link/embed';
import { GENERIC_IFRAME_SANDBOX, PLAYER_IFRAME_SANDBOX } from '../../../../src/shared/embed-frame';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { BlokConfig } from '../../../../types/configs/blok-config';

type LinkPaste = NonNullable<BlokConfig['linkPaste']>;

const t = (key: string, params?: Record<string, string | number>): string =>
  params === undefined ? key : `${key} ${JSON.stringify(params)}`;

const mount = (
  data: unknown,
  linkPaste: LinkPaste | 'none' = { allowGenericEmbed: true },
  readOnly = false
): { tool: Embed; root: HTMLElement } => {
  const options = {
    api: {
      i18n: { t, has: () => false, getLocale: () => 'en' },
      blocks: { delete: (): void => undefined, getBlockIndex: (): number => 0 },
      config: linkPaste === 'none' ? {} : { linkPaste },
      events: { on: (): void => undefined, off: (): void => undefined },
      tools: { getBlockTools: () => [] },
    } as unknown as API,
    block: { id: 'embed-block', dispatchChange: (): void => undefined } as never,
    config: {},
    readOnly,
    data,
  } as unknown as BlockToolConstructorOptions<EmbedData>;
  const tool = new Embed(options);

  return { tool, root: tool.render() };
};

const EVIL = 'https://evil.attacker.test/phish';
const YT_WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const YT_EMBED = 'https://www.youtube.com/embed/dQw4w9WgXcQ';

const frames = (root: HTMLElement): HTMLIFrameElement[] => Array.from(root.querySelectorAll('iframe'));
const scripts = (root: HTMLElement): HTMLScriptElement[] => Array.from(root.querySelectorAll('script'));
const loadButton = (root: HTMLElement): HTMLButtonElement | null =>
  root.querySelector<HTMLButtonElement>('button[data-role="embed-load"]');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('registry service claimed for an attacker origin', () => {
  it('youtube service + attacker source + attacker embed: no frame, no card, even with generic on', () => {
    const { root } = mount({ service: 'youtube', source: EVIL, embed: EVIL, kind: 'iframe' });

    expect(frames(root)).toHaveLength(0);
    expect(root.querySelector('[data-blok-testid="embed-link-card"]')).toBeNull();
    expect(root.innerHTML).not.toContain('evil.attacker.test');
  });

  it('youtube service + real youtube source + attacker embed: frames the derived youtube URL only', () => {
    const { root } = mount({ service: 'youtube', source: YT_WATCH, embed: EVIL, kind: 'iframe' }, 'none');
    const frame = frames(root)[0];

    expect(frame?.getAttribute('src')?.startsWith(YT_EMBED)).toBe(true);
    expect(root.innerHTML).not.toContain('evil.attacker.test');
  });

  it('youtube service + youtube source with attacker userinfo/host tricks never frames the attacker host', () => {
    for (const source of [
      'https://www.youtube.com@evil.attacker.test/watch?v=dQw4w9WgXcQ',
      'https://evil.attacker.test/?u=https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://evil.attacker.test/www.youtube.com/watch?v=dQw4w9WgXcQ',
    ]) {
      const { root } = mount({ service: 'youtube', source, embed: EVIL }, { allowGenericEmbed: true });
      const player = frames(root).filter((f) => f.getAttribute('sandbox') === PLAYER_IFRAME_SANDBOX);

      for (const frame of player) {
        expect(new URL(frame.src).hostname).toMatch(/(^|\.)youtube(-nocookie)?\.com$/);
      }
      expect(player.every((f) => !f.src.includes('evil.attacker.test'))).toBe(true);
    }
  });

  it('a saved kind:"script" on youtube does not load a widget script', () => {
    const { root } = mount({ service: 'youtube', source: YT_WATCH, embed: YT_EMBED, kind: 'script' }, 'none');

    expect(scripts(root)).toHaveLength(0);
  });

  it('a generic block with kind:"script" and service twitter-like label never loads a script', () => {
    const { root } = mount({ service: '', source: EVIL, embed: EVIL, kind: 'script' });

    expect(scripts(root)).toHaveLength(0);
  });
});

describe('hostile service keys', () => {
  const HOSTILE_SERVICES: unknown[] = [
    'evil', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf',
    ['youtube'], 5, null, { toString: 'youtube' }, true,
  ];

  it.each(HOSTILE_SERVICES.map((s) => [JSON.stringify(s), s]))(
    'service %s with attacker source never gets the player sandbox or an ungated frame',
    (_label, service) => {
      for (const linkPaste of ['none' as const, { allowGenericEmbed: true }, { allowGenericEmbed: true, genericEmbedClickToLoad: true }]) {
        const { root } = mount({ service, source: EVIL, embed: YT_EMBED }, linkPaste);

        // Before any click no frame exists at all.
        expect(frames(root)).toHaveLength(0);

        loadButton(root)?.click();

        for (const frame of frames(root)) {
          expect(frame.getAttribute('sandbox')).toBe(GENERIC_IFRAME_SANDBOX);
          expect(frame.hasAttribute('allow')).toBe(false);
          expect(frame.getAttribute('src')).toBe(EVIL);
        }
        if (linkPaste === 'none') {
          expect(frames(root)).toHaveLength(0);
        }
      }
    }
  );

  it.each(HOSTILE_SERVICES.map((s) => [JSON.stringify(s), s]))(
    'service %s: render and save do not throw',
    (_label, service) => {
      const { tool } = mount({ service, source: EVIL, embed: EVIL });

      expect(() => tool.save()).not.toThrow();
    }
  );
});

describe('non-string URL fields (collab peer / blocks.insert JSON)', () => {
  const HOSTILE_VALUES: unknown[] = [123, { href: EVIL }, [EVIL], null, true];

  it.each(HOSTILE_VALUES.map((v) => [JSON.stringify(v), v]))('source %s does not throw on render', (_label, source) => {
    expect(() => mount({ service: '', source, embed: EVIL })).not.toThrow();
  });

  it.each(HOSTILE_VALUES.map((v) => [JSON.stringify(v), v]))('source %s does not throw on save', (_label, source) => {
    // Render first may throw; isolate save on a tool whose render was skipped.
    const options = {
      api: {
        i18n: { t, has: () => false, getLocale: () => 'en' },
        config: { linkPaste: { allowGenericEmbed: true } },
      } as unknown as API,
      block: { id: 'b', dispatchChange: (): void => undefined } as never,
      config: {},
      readOnly: true,
      data: { service: '', source, embed: EVIL },
    } as unknown as BlockToolConstructorOptions<EmbedData>;

    expect(() => new Embed(options).save()).not.toThrow();
  });

  it.each(HOSTILE_VALUES.map((v) => [JSON.stringify(v), v]))('registry service with source %s does not throw', (_label, source) => {
    expect(() => mount({ service: 'twitter', source, embed: EVIL })).not.toThrow();
  });

  it('embed as object/array never reaches a frame src', () => {
    for (const embed of [{ toString: EVIL }, [EVIL], 7]) {
      const { root } = mount({ service: '', source: 'https://ok.example.test/a', embed });

      loadButton(root)?.click();
      expect(frames(root).map((f) => f.getAttribute('src'))).toEqual(['https://ok.example.test/a']);
    }
  });
});

describe('generic block without the host opt-in', () => {
  it.each([
    ['no linkPaste', 'none' as const],
    ['allowGenericEmbed false', { allowGenericEmbed: false }],
    ['allowGenericEmbed "true" string', { allowGenericEmbed: 'true' as unknown as boolean }],
    ['only click-to-load off', { genericEmbedClickToLoad: false }],
  ])('%s: link card, never a frame', (_label, linkPaste) => {
    const { root } = mount({ service: '', source: EVIL, embed: EVIL, kind: 'iframe' }, linkPaste);

    expect(frames(root)).toHaveLength(0);
    expect(loadButton(root)).toBeNull();
    expect(root.querySelector('[data-blok-testid="embed-link-card"] a')?.getAttribute('href')).toBe(EVIL);
  });
});

describe('saved flags cannot skip click-to-load or spoof the host label', () => {
  it('no saved field lifts the click gate', () => {
    const { root } = mount({
      service: '',
      source: EVIL,
      embed: EVIL,
      genericLoaded: true,
      loaded: true,
      clickToLoad: false,
      genericEmbedClickToLoad: false,
      linkPaste: { genericEmbedClickToLoad: false },
    });

    expect(frames(root)).toHaveLength(0);
    expect(loadButton(root)).not.toBeNull();
  });

  it('the gate and the label name the framed host, not the embed field, caption or service', () => {
    const { root } = mount({
      service: 'www.youtube.com',
      source: 'https://www.youtube.com.evil.attacker.test/x',
      embed: YT_EMBED,
      caption: 'www.youtube.com',
      captionVisible: true,
    });

    expect(root.querySelector('[data-role="embed-load-host"]')?.textContent).toBe('www.youtube.com.evil.attacker.test');
    loadButton(root)?.click();
    // Uncommitted WIP in the tree removes the host line; when present it must name the real host.
    const line = root.querySelector('[data-role="embed-host"]');

    expect(line === null || line.textContent === 'www.youtube.com.evil.attacker.test').toBe(true);
    expect(frames(root)[0]?.getAttribute('title')).toBe('toolNames.embed: www.youtube.com.evil.attacker.test');
  });

  it('userinfo in the source does not show as the host', () => {
    const { root } = mount({ service: '', source: 'https://www.youtube.com:pw@evil.attacker.test/x', embed: YT_EMBED });

    expect(root.querySelector('[data-role="embed-load-host"]')?.textContent).toBe('evil.attacker.test');
  });
});

describe('caption / size / alignment fields', () => {
  const HTML = '<img src=x onerror="window.__pwn=1"><iframe src="https://evil.attacker.test"></iframe>';

  it('caption with HTML stays text', () => {
    const { root } = mount({ service: 'youtube', source: YT_WATCH, embed: YT_EMBED, caption: HTML, captionVisible: true }, 'none');

    expect(root.querySelector('img')).toBeNull();
    expect(frames(root)).toHaveLength(1);
    expect(root.querySelector('[data-role="embed-caption"]')?.textContent).toBe(HTML);
  });

  it('alignment with HTML or prototype keys injects no markup', () => {
    for (const alignment of [HTML, '__proto__', 'toString', 'constructor']) {
      const { root } = mount({ service: 'youtube', source: YT_WATCH, embed: YT_EMBED, alignment }, 'none');

      expect(root.querySelector('img')).toBeNull();
      expect(frames(root)).toHaveLength(1);
      expect(root.querySelector('[onerror]')).toBeNull();
    }
  });

  it('widthPercent / width / height with CSS payloads do not reach the style', () => {
    const { root } = mount({
      service: 'youtube',
      source: YT_WATCH,
      embed: YT_EMBED,
      widthPercent: '100%; background-image: url(https://evil.attacker.test/t)' as unknown as number,
      width: '1; position: fixed' as unknown as number,
      height: '1) ; background: url(https://evil.attacker.test/u' as unknown as number,
    }, 'none');
    const figure = root.querySelector<HTMLElement>('[data-role="embed-figure"]');

    expect(root.innerHTML).not.toContain('evil.attacker.test');
    expect(figure?.style.position).toBe('relative');
  });

  it('huge widthPercent stays capped by max-width 100%', () => {
    const { root } = mount({ service: 'youtube', source: YT_WATCH, embed: YT_EMBED, widthPercent: 1e9 }, 'none');
    const figure = root.querySelector<HTMLElement>('[data-role="embed-figure"]');

    expect(figure?.style.maxWidth).toBe('100%');
  });

});
