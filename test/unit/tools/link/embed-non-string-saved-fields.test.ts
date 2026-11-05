/**
 * Saved embed JSON comes from collab peers, imports, the API and agents, so
 * `source`, `embed` and `service` may hold any JSON value. The block must
 * render and save without throwing, and never frame anything it would not
 * frame for a plain string.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Embed, type EmbedData } from '../../../../src/tools/link/embed';
import { GENERIC_IFRAME_SANDBOX } from '../../../../src/shared/embed-frame';
import type { API, BlockToolConstructorOptions } from '../../../../types';

const t = (key: string, params?: Record<string, string | number>): string =>
  params === undefined ? key : `${key} ${JSON.stringify(params)}`;

const makeTool = (data: unknown, allowGenericEmbed = true): Embed => new Embed({
  api: {
    i18n: { t, has: () => false, getLocale: () => 'en' },
    blocks: { delete: (): void => undefined, getBlockIndex: (): number => 0 },
    config: { linkPaste: { allowGenericEmbed } },
    events: { on: (): void => undefined, off: (): void => undefined },
    tools: { getBlockTools: () => [] },
  } as unknown as API,
  block: { id: 'embed-block', dispatchChange: (): void => undefined } as never,
  config: {},
  readOnly: false,
  data,
} as unknown as BlockToolConstructorOptions<EmbedData>);

const SITE = 'https://site.example.test/page';
const NON_STRINGS: unknown[] = [123, { href: SITE }, [SITE], null, true];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('embed with non-string saved fields', () => {
  it.each(NON_STRINGS.map((v) => [JSON.stringify(v), v]))('source %s renders and saves an empty url', (_label, source) => {
    const tool = makeTool({ service: '', source, embed: SITE });

    expect(() => tool.render()).not.toThrow();
    expect(tool.save().source).toBe('');
  });

  it.each(NON_STRINGS.map((v) => [JSON.stringify(v), v]))('registry service with source %s renders and saves', (_label, source) => {
    const tool = makeTool({ service: 'twitter', source, embed: SITE });

    expect(() => tool.render()).not.toThrow();
    expect(() => tool.save()).not.toThrow();
  });

  it.each(NON_STRINGS.map((v) => [JSON.stringify(v), v]))('embed %s saves as a string', (_label, embed) => {
    const tool = makeTool({ service: 'youtube', source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', embed });

    tool.render();
    expect(typeof tool.save().embed).toBe('string');
  });

  it.each([
    ['an object with toString', { toString: 'youtube' }],
    ['an array', ['youtube']],
    ['a number', 5],
    ['null', null],
  ])('service as %s is a generic embed and saves an empty service', (_label, service) => {
    const tool = makeTool({ service, source: SITE });
    const root = tool.render();

    expect(tool.save().service).toBe('');
    root.querySelector<HTMLButtonElement>('button[data-role="embed-load"]')?.click();
    expect(Array.from(root.querySelectorAll('iframe')).map((f) => f.getAttribute('sandbox'))).toEqual([GENERIC_IFRAME_SANDBOX]);
  });

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'service %s is not read from the object prototype',
    (service) => {
      const tool = makeTool({ service, source: SITE });
      const root = tool.render();

      root.querySelector<HTMLButtonElement>('button[data-role="embed-load"]')?.click();
      expect(Array.from(root.querySelectorAll('iframe')).map((f) => f.getAttribute('sandbox'))).toEqual([GENERIC_IFRAME_SANDBOX]);
      expect(() => tool.save()).not.toThrow();
    }
  );
});
