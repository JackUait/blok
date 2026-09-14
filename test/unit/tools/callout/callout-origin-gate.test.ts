import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { CalloutData, CalloutConfig } from '../../../../src/tools/callout/types';
import { CalloutTool } from '../../../../src/tools/callout';

vi.mock('../../../../src/components/utils/emoji/emoji-data', () => ({
  loadEmojiData: vi.fn().mockResolvedValue([]),
  searchEmojis: vi.fn().mockReturnValue([]),
  groupEmojisByCategory: vi.fn().mockReturnValue(new Map()),
  CURATED_CALLOUT_EMOJIS: [],
}));

/**
 * Callout stores its content in child blocks, so it seeds a first paragraph when
 * it has none. That seed is only correct for a genuine creation: on a restore
 * (undo/redo replay, a remote collaborative update, paste, or an off-tree probe)
 * the real children's add events land AFTER rendered(), so getChildren() is
 * transiently empty and seeding mints a phantom child that is written back into
 * the shared document. Gate mirrors src/tools/column/index.ts.
 *
 * `load` is the exception, because it is the ONE re-materialisation that carries
 * its own declaration: the renderer composes the block with the `contentIds` the
 * stored document names. A load whose contentIds are non-empty is the transient
 * case and must not seed. A load whose contentIds are EMPTY is a document that
 * genuinely declares a bodyless callout — a hand-authored `{ type: 'callout' }`,
 * which is the shape the docs and every host example use — and without a seed it
 * renders an inert panel with nothing to click into or type in.
 */
describe('callout seeds only for a genuine creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const seedProbe = (): { insertInsideParent: ReturnType<typeof vi.fn>; api: API } => {
    const insertInsideParent = vi.fn().mockReturnValue({ id: 'p', holder: document.createElement('div') });
    const api = {
      styles: { block: 'ce-block', inlineToolbar: '', inlineToolButton: '', inlineToolButtonActive: '', settingsButton: '', settingsButtonActive: '', selected: '' },
      i18n: { t: (k: string) => k, has: vi.fn().mockReturnValue(false), getLocale: vi.fn().mockReturnValue('en'), getEnglishTranslation: vi.fn().mockReturnValue('') },
      events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
      blocks: {
        insertInsideParent,
        convert: vi.fn(),
        getBlockIndex: vi.fn().mockReturnValue(3),
        getChildren: vi.fn().mockReturnValue([]),
        update: vi.fn(),
        delete: vi.fn(),
      },
      caret: { setToBlock: vi.fn(), isAtStart: vi.fn().mockReturnValue(false) },
      toolbar: { toggleBlockSettings: vi.fn() },
    } as unknown as API;

    return { insertInsideParent, api };
  };

  const createOptions = (
    api: API,
    origin: BlockToolConstructorOptions<CalloutData, CalloutConfig>['origin'],
    data: Partial<CalloutData> = {},
    contentIds: readonly string[] = ['declared-child']
  ): BlockToolConstructorOptions<CalloutData, CalloutConfig> => ({
    data: { emoji: '💡', textColor: null, backgroundColor: null, ...data },
    config: {},
    api,
    readOnly: false,
    block: { id: 'callout-block-id', contentIds } as never,
    origin,
  });

  it.each(['load', 'replay', 'paste', 'probe'] as const)(
    'does NOT seed a child when re-materialised with origin «%s»',
    (origin) => {
      const { insertInsideParent, api } = seedProbe();
      const tool = new CalloutTool(createOptions(api, origin));

      tool.render();
      tool.rendered();

      expect(insertInsideParent).not.toHaveBeenCalled();
    }
  );

  it('seeds a body paragraph for a stored document that declares no children', () => {
    const { insertInsideParent, api } = seedProbe();
    const tool = new CalloutTool(createOptions(api, 'load', {}, []));

    tool.render();
    tool.rendered();

    expect(insertInsideParent).toHaveBeenCalledTimes(1);
  });

  /** The document is being read, not authored — the seed must not steal the caret. */
  it('does not move the caret when the seed comes from a load', () => {
    const { api } = seedProbe();
    const tool = new CalloutTool(createOptions(api, 'load', {}, []));

    tool.render();
    tool.rendered();

    expect(api.caret.setToBlock).not.toHaveBeenCalled();
  });

  it.each(['replay', 'paste', 'probe'] as const)(
    'still does NOT seed with origin «%s» even when nothing is declared',
    (origin) => {
      const { insertInsideParent, api } = seedProbe();
      const tool = new CalloutTool(createOptions(api, origin, {}, []));

      tool.render();
      tool.rendered();

      expect(insertInsideParent).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, 'user', 'api', 'convert'] as const)(
    'seeds exactly one child when created with origin «%s»',
    (origin) => {
      const { insertInsideParent, api } = seedProbe();
      const tool = new CalloutTool(createOptions(api, origin));

      tool.render();
      tool.rendered();

      expect(insertInsideParent).toHaveBeenCalledTimes(1);
    }
  );

  it('still carries the converted text into the seeded child on a convert', () => {
    const { insertInsideParent, api } = seedProbe();
    const tool = new CalloutTool(
      createOptions(api, 'convert', { __importedText: 'Convert me to callout' })
    );

    tool.render();
    tool.rendered();

    expect(insertInsideParent).toHaveBeenCalledWith(
      'callout-block-id',
      expect.any(Number),
      { text: 'Convert me to callout' }
    );
  });
});
