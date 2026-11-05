import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Embed, type EmbedData } from '../../../../src/tools/link/embed';
import { GENERIC_IFRAME_SANDBOX } from '../../../../src/shared/embed-frame';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { BlokConfig } from '../../../../types/configs/blok-config';

type LinkPaste = NonNullable<BlokConfig['linkPaste']>;

const ROOT = join(__dirname, '../../../..');

const t = (key: string, params?: Record<string, string | number>): string =>
  params === undefined ? key : `${key} ${JSON.stringify(params)}`;

const mount = (
  data: Partial<EmbedData>,
  linkPaste: LinkPaste = { allowGenericEmbed: true },
  readOnly = false
): { tool: Embed; root: HTMLElement } => {
  const options = {
    api: {
      i18n: { t, has: () => false, getLocale: () => 'en' },
      blocks: { delete: (): void => undefined, getBlockIndex: (): number => 0 },
      config: { linkPaste },
      events: { on: (): void => undefined, off: (): void => undefined },
    } as unknown as API,
    block: { id: 'embed-block', dispatchChange: (): void => undefined } as never,
    config: {},
    readOnly,
    data,
  } as BlockToolConstructorOptions<EmbedData>;
  const tool = new Embed(options);
  const root = tool.render();

  document.body.appendChild(root);

  return { tool, root };
};

const generic = (source: string, extra: Partial<EmbedData> = {}): Partial<EmbedData> =>
  ({ service: '', source, embed: source, kind: 'iframe', ...extra });

const load = (root: HTMLElement): HTMLIFrameElement => {
  root.querySelector<HTMLButtonElement>('button[data-role="embed-load"]')?.click();
  const frame = root.querySelector('iframe');

  if (!(frame instanceof HTMLIFrameElement)) {
    throw new Error('no frame after load');
  }

  return frame;
};

const attributeValues = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('*')).flatMap((el) => Array.from(el.attributes).map((attr) => attr.value));

const geometry = (root: HTMLElement): string => {
  const figure = root.querySelector<HTMLElement>('[data-role="embed-figure"]');
  const aspect = root.querySelector<HTMLElement>('[data-role="embed-aspect"]');
  const frame = root.querySelector<HTMLElement>('iframe');

  return JSON.stringify([figure?.getAttribute('style'), aspect?.getAttribute('style'), frame?.getAttribute('style')]);
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('a generic frame cannot drive Blok through postMessage', () => {
  it('registers no window message listener while a generic embed mounts, loads and toggles', () => {
    const added: string[] = [];
    const original = window.addEventListener.bind(window);

    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, ...rest: unknown[]) => {
      added.push(type);

      return (original as (...args: unknown[]) => void)(type, ...rest);
    });

    const { tool, root } = mount(generic('https://evil.example/page'));

    load(root);
    tool.setReadOnly(true);
    tool.setReadOnly(false);

    expect(added).not.toContain('message');
  });

  it('ignores resize-shaped messages whose source is the generic frame', () => {
    const { root } = mount(generic('https://evil.example/page'));
    const frame = load(root);
    const before = geometry(root);
    const payloads: unknown[] = [
      { type: 'resize', height: 999999, width: 999999 },
      JSON.stringify({ event: 'resize', height: 999999 }),
      { 'twttr.embed': { jsonrpc: '2.0', method: 'twttr.private.resize', params: [{ height: 999999, width: 999999 }] } },
      999999,
      { method: 'setHeight', value: 999999 },
      { context: 'iframe.resize', height: 999999, src: 'https://evil.example/page' },
    ];

    for (const data of payloads) {
      window.dispatchEvent(new MessageEvent('message', { data, origin: 'null', source: frame.contentWindow }));
    }

    expect(geometry(root)).toBe(before);
    expect(frame.getAttribute('sandbox')).toBe(GENERIC_IFRAME_SANDBOX);
  });

  it('has no window/iframe message listener anywhere in src or the adapter packages', () => {
    const roots = ['src', 'packages/react/src', 'packages/vue/src', 'packages/angular/src', 'packages/presets/src'];
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);

        const skipped = name === 'node_modules' || name === 'dist';

        if (statSync(path).isDirectory() && !skipped) {
          walk(path);
        } else if (!statSync(path).isDirectory() && /\.(ts|tsx|vue|js|mjs)$/.test(name) && !/\.(test|spec)\./.test(name)) {
          files.push(path);
        }
      }
    };

    for (const dir of roots) {
      walk(join(ROOT, dir));
    }

    const pattern = /addEventListener\(\s*['"`]message['"`]|\.onmessage\s*=|postMessage\(|attachEvent\(/;
    const hits = files.filter((file) => pattern.test(readFileSync(file, 'utf8'))).map((file) => relative(ROOT, file)).sort();

    // Each is a channel a cross-origin frame cannot reach: BroadcastChannel
    // (same origin only), a private MessageChannel, a WebSocket, an EventSource.
    expect(hits).toEqual([
      'src/components/modules/collaboration/operation-store.ts',
      'src/components/modules/collaboration/provider.ts',
      'src/components/modules/tabSync/platform.ts',
      'src/playground/remote-page-host.ts',
      'src/tools/file/zip/inflate.ts',
    ]);
  });
});

describe('the generic sandbox never changes on a live frame', () => {
  it('keeps sandbox/allow/src/referrerpolicy/credentialless fixed through every in-place edit path', async () => {
    const { tool, root } = mount(generic('https://evil.example/page'));
    const frame = load(root);
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));

    observer.observe(frame, { attributes: true });

    tool.setReadOnly(true);
    tool.setReadOnly(false);
    for (const action of ['align-left', 'align-right', 'align-center', 'caption-toggle', 'caption-toggle']) {
      root.querySelector<HTMLElement>(`[data-action="${action}"]`)?.click();
    }
    await Promise.resolve();
    records.push(...observer.takeRecords());
    observer.disconnect();

    expect(root.querySelector('iframe')).toBe(frame);
    expect(records.map((r) => r.attributeName)).toEqual([]);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-popups');
    expect(frame.hasAttribute('allow')).toBe(false);
    expect(frame.hasAttribute('allowfullscreen')).toBe(false);
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.hasAttribute('credentialless')).toBe(true);
    expect(frame.getAttribute('loading')).toBe('lazy');
  });

  it('has no in-place setData, so a remote/collab update re-renders through the same buildIframe', () => {
    expect('setData' in Embed.prototype).toBe(false);
    expect('merge' in Embed.prototype).toBe(false);
  });

  it('ignores saved keys that try to widen the frame', () => {
    const { root } = mount({
      ...generic('https://evil.example/page'),
      sandbox: 'allow-same-origin allow-top-navigation',
      allow: 'camera; microphone',
    });
    const frame = load(root);

    expect(frame.getAttribute('sandbox')).toBe(GENERIC_IFRAME_SANDBOX);
    expect(frame.hasAttribute('allow')).toBe(false);
  });
});

describe('prototype keys as service never pick a registry sandbox', () => {
  for (const service of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    it(`service "${service}" renders no frame`, () => {
      const { root } = mount({ service, source: 'https://evil.example/page', embed: 'https://evil.example/page', kind: 'iframe' });

      root.querySelector<HTMLButtonElement>('button[data-role="embed-load"]')?.click();

      const frame = root.querySelector('iframe');

      expect(frame === null || frame.getAttribute('sandbox') === GENERIC_IFRAME_SANDBOX).toBe(true);
      expect(attributeValues(root).some((v) => v.includes('allow-same-origin'))).toBe(false);
    });
  }
});

describe('saved width/height set the frame size', () => {
  it('caps the figure at the column width whatever widthPercent says', () => {
    const { root } = mount(generic('https://evil.example/page', { widthPercent: 5000 }));
    const figure = root.querySelector<HTMLElement>('[data-role="embed-figure"]');

    expect(figure?.style.maxWidth).toBe('100%');
  });
});

describe('click-to-load in the editable editor', () => {
  it('puts no URL of the site in the DOM and makes no fetch before the click', () => {
    const fetchSpy = vi.fn();

    vi.stubGlobal('fetch', fetchSpy);

    const { root } = mount(generic('https://evil.example/page'));

    expect(root.querySelector('iframe')).toBeNull();
    expect(root.querySelector('img, link, script, video, audio, source, object, embed')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    // Only a passive href on Blok's own "open original" link. It makes no request by itself.
    const carriers = Array.from(root.querySelectorAll('*'))
      .flatMap((el) => Array.from(el.attributes).filter((a) => a.value.includes('evil.example')).map((a) => `${el.tagName}[${a.name}] ${el.getAttribute('data-action') ?? el.getAttribute('data-role') ?? ''}`));

    expect(carriers).toEqual(['A[href] open-original']);
    vi.unstubAllGlobals();
  });
});

describe('the host shown is the host framed', () => {
  const tricky = [
    'https://youtube.com@evil.example/x',
    'https://EVIL.example./x',
    'https://evil.example:8443/x',
    'https://xn--80ak6aa92e.com/x',
    'https://аррӏе.com/x',
    'https://evil.example\\@youtube.com/x',
    'https://evil.example%2f@youtube.com/x',
    'https://evil.example/https://youtube.com',
  ];

  for (const source of tricky) {
    it(`gate host matches the frame host for ${source}`, () => {
      const { root } = mount(generic(source));
      const gateHost = root.querySelector('[data-role="embed-load-host"]')?.textContent ?? null;

      root.querySelector<HTMLButtonElement>('button[data-role="embed-load"]')?.click();

      const src = root.querySelector('iframe')?.getAttribute('src') ?? null;

      if (src === null) {
        expect(gateHost).toBeNull();

        return;
      }

      // Userinfo never names the host: for `a%2f@youtube.com` the frame truly loads youtube.com.
      expect(gateHost).toBe(new URL(src).host);
    });
  }
});

describe('click-to-load does not stop a saved block from pinging any host', () => {
  it('a saved bookmark favicon loads from any host, with no opt-in', async () => {
    const { Bookmark } = await import('../../../../src/tools/link/bookmark');
    const tool = new Bookmark({
      api: { i18n: { t: (key: string) => key, has: () => false } } as unknown as API,
      block: { dispatchChange: (): void => undefined } as never,
      config: { endpoint: 'https://api.test/unfurl' },
      readOnly: true,
      data: { url: 'https://news.example/a', title: 't', favicon: 'https://tracker.evil.example/p.png?reader=1' },
    });
    const root = tool.render();

    expect(root.querySelector('img[data-role="bookmark-favicon"]')?.getAttribute('src'))
      .toBe('https://tracker.evil.example/p.png?reader=1');
  });
});
