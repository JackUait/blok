import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { CalloutData, CalloutConfig } from '../../../../src/tools/callout/types';
import type { CalloutTool } from '../../../../src/tools/callout';
import type { ProcessedEmoji } from '../../../../src/components/utils/emoji/emoji-data';
import { LANDINGS, chooseLanding } from '../../../../src/tools/callout/emoji-landing';

vi.mock('../../../../src/components/utils/emoji/emoji-data', () => {
  const fixture = [
    { native: '😀', skins: ['😀'], id: 'grinning', name: 'Grinning Face', keywords: ['happy'], category: 'people' },
    { native: '✅', skins: ['✅'], id: 'check', name: 'Check Mark', keywords: ['done'], category: 'people' },
  ] as ProcessedEmoji[];

  return {
    loadEmojiGrid: vi.fn().mockResolvedValue(fixture),
    loadEmojiData: vi.fn().mockResolvedValue(fixture),
    searchEmojis: vi.fn().mockReturnValue([]),
    groupEmojisByCategory: vi.fn((emojis: ProcessedEmoji[]) => new Map([['people', emojis]])),
    CURATED_CALLOUT_EMOJIS: [],
  };
});

vi.mock('../../../../src/components/utils/emoji/emoji-locale', () => ({
  loadEmojiLocale: vi.fn().mockResolvedValue(null),
  getTranslatedName: vi.fn().mockReturnValue(null),
}));

/** jsdom has no Web Animations; each fake finishes when the test says so. */
interface FakeAnimation {
  finished: Promise<FakeAnimation>;
  cancel: () => void;
  finish: () => void;
  cancelled: boolean;
}

const animations: FakeAnimation[] = [];

function fakeAnimate(): FakeAnimation {
  let resolve: (value: FakeAnimation) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const animation: FakeAnimation = {
    finished: new Promise<FakeAnimation>((ok, fail) => {
      resolve = ok;
      reject = fail;
    }),
    cancelled: false,
    cancel: () => {
      animation.cancelled = true;
      reject(new DOMException('cancelled', 'AbortError'));
    },
    finish: () => resolve(animation),
  };

  animation.finished.catch(() => undefined);
  animations.push(animation);

  return animation;
}

const createMockAPI = (): API => ({
  styles: { block: 'ce-block', inlineToolbar: '', inlineToolButton: '', inlineToolButtonActive: '', settingsButton: '', settingsButtonActive: '', selected: '' },
  i18n: { t: (k: string) => k, has: vi.fn().mockReturnValue(false), getLocale: vi.fn().mockReturnValue('en'), getEnglishTranslation: vi.fn().mockReturnValue('') },
  events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  blocks: {
    insertInsideParent: vi.fn().mockReturnValue({ id: 'child-id', holder: document.createElement('div') }),
    convert: vi.fn(),
    getBlockIndex: vi.fn().mockReturnValue(0),
    getChildren: vi.fn().mockReturnValue([]),
    update: vi.fn(),
    delete: vi.fn(),
  },
  caret: { setToBlock: vi.fn(), isAtStart: vi.fn().mockReturnValue(false) },
  toolbar: { toggleBlockSettings: vi.fn() },
} as unknown as API);

const createOptions = (api: API, emoji: string): BlockToolConstructorOptions<CalloutData, CalloutConfig> => ({
  data: { emoji, textColor: null, backgroundColor: null },
  config: {},
  api,
  readOnly: false,
  block: { id: `callout-${emoji}` } as never,
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}

const overlays = (): HTMLElement[] => Array.from(document.body.querySelectorAll<HTMLElement>('[data-blok-emoji-landing]'));

/** jsdom's selector engine misses astral-plane characters in attribute values, so match by reading them. */
function pick(native: string): void {
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[data-blok-emoji-picker] [data-emoji-native]'))
    .find(node => node.getAttribute('data-emoji-native') === native && node.closest('[data-emoji-section="recent"]') === null);

  if (button === undefined) {
    throw new Error(`emoji ${native} not in the picker`);
  }

  button.click();
}

async function renderCallout(emoji = '💡'): Promise<{ tool: CalloutTool; button: HTMLButtonElement; face: HTMLElement }> {
  const { CalloutTool: Tool } = await import('../../../../src/tools/callout');
  const tool = new Tool(createOptions(createMockAPI(), emoji));
  const wrapper = tool.render();

  document.body.appendChild(wrapper);

  const button = wrapper.querySelector<HTMLButtonElement>('[data-blok-testid="callout-emoji-btn"]');
  const face = button?.firstElementChild;

  if (button === null || !(face instanceof HTMLElement)) {
    throw new Error('callout emoji button not rendered');
  }

  return { tool, button, face };
}

async function open(button: HTMLButtonElement): Promise<void> {
  button.click();
  await flush();
}

const stubReducedMotion = (reduce: boolean): void => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({ matches: reduce && query.includes('reduce') })),
  });
};

describe('chooseLanding', () => {
  it('offers the nine landings the design kept', () => {
    expect(LANDINGS).toEqual(['launch', 'swap', 'stamp', 'comet', 'portal', 'bubble', 'slingshot', 'beam', 'confetti']);
  });

  it('never plays the same landing twice in a row', () => {
    for (const previous of LANDINGS) {
      for (const roll of [0, 0.3, 0.5, 0.99]) {
        expect(chooseLanding(previous, () => roll)).not.toBe(previous);
      }
    }
  });

  it('can reach every landing', () => {
    const seen = new Set(Array.from({ length: 9 }, (_, index) => chooseLanding(null, () => index / 9)));

    expect(seen).toEqual(new Set(LANDINGS));
  });
});

describe('CalloutTool icon landing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    animations.length = 0;
    localStorage.clear();
    stubReducedMotion(false);
    Element.prototype.animate = vi.fn(fakeAnimate) as unknown as Element['animate'];
  });

  afterEach(async () => {
    await flush();
    document.body.innerHTML = '';
    localStorage.clear();
    Reflect.deleteProperty(Element.prototype, 'animate');
    vi.restoreAllMocks();
  });

  it('lands a picked emoji with one of the nine landings and stores it at once', async () => {
    const { tool, button, face } = await renderCallout();

    await open(button);
    pick('😀');

    expect(overlays()).toHaveLength(1);
    expect(LANDINGS).toContain(overlays()[0].getAttribute('data-blok-emoji-landing'));
    expect(face.textContent).toBe('😀');
    expect(tool.save().emoji).toBe('😀');
  });

  it('picks a different landing than the last one', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { button } = await renderCallout();

    await open(button);
    pick('😀');
    const first = overlays()[0]?.getAttribute('data-blok-emoji-landing');

    await open(button);
    pick('✅');
    const second = overlays()[0]?.getAttribute('data-blok-emoji-landing');

    expect(first).toBe('launch');
    expect(second).toBe('swap');
  });

  it('cuts a running landing short when the icon is picked again', async () => {
    const { button, face } = await renderCallout();

    await open(button);
    pick('😀');
    await open(button);
    pick('✅');

    expect(overlays()).toHaveLength(1);
    expect(face.textContent).toBe('✅');
  });

  it.each(LANDINGS.map((landing, index) => [landing, index] as const))('cleans up %s and shows the icon when it ends', async (landing, index) => {
    vi.spyOn(Math, 'random').mockReturnValue((index + 0.5) / LANDINGS.length);
    const { button, face } = await renderCallout();

    await open(button);
    pick('😀');

    expect(overlays()[0]?.getAttribute('data-blok-emoji-landing')).toBe(landing);

    // Real waits: Beam re-forms on an 820ms timer.
    for (let round = 0; round < 20 && overlays().length > 0; round++) {
      animations.forEach(animation => animation.finish());
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    expect(overlays()).toHaveLength(0);
    expect(face.style.visibility).toBe('');
    expect(face.textContent).toBe('😀');
  });

  it('removes a running landing when the callout is destroyed', async () => {
    const { tool, button } = await renderCallout();

    await open(button);
    pick('😀');
    tool.destroy();

    expect(overlays()).toHaveLength(0);
  });

  it('swaps the icon with no landing when motion is reduced', async () => {
    stubReducedMotion(true);
    const { button, face } = await renderCallout();

    await open(button);
    pick('😀');

    expect(overlays()).toHaveLength(0);
    expect(face.textContent).toBe('😀');
    expect(face.style.visibility).toBe('');
  });
});
