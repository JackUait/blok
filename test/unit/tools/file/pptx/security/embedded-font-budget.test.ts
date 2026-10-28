import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../helpers/domShims';
import type { PresentationData } from '../../../../../../src/tools/file/pptx/model/Presentation';
import { useEmbeddedFonts } from '../../../../../../src/tools/file/pptx/renderer/EmbeddedFontLoader';

const { decompressMtxMock } = vi.hoisted(() => ({ decompressMtxMock: vi.fn() }));

vi.mock('../../../../../../src/tools/file/pptx/fonts/mtx', () => ({ decompressMtx: decompressMtxMock }));

const SLIDES = 10;

function eot(): Uint8Array {
  const payload = new Uint8Array([1, 2, 3]);
  const bytes = new Uint8Array(96 + payload.byteLength);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, bytes.byteLength, true);
  view.setUint32(4, payload.byteLength, true);
  view.setUint32(8, 0x00010000, true);
  view.setUint16(34, 0x504c, true);
  bytes.set(payload, 96);

  return bytes;
}

/** Many embeddedFont entries that all point at the same font file. */
function deck(entries: number): { presentation: PresentationData; families: Set<string> } {
  const data = eot();
  const embeddedFonts = Array.from({ length: entries }, (_, index) => ({
    family: `Face ${index}`,
    renderFamily: `__embedded_${index}`,
    data,
    weight: '400',
    style: 'normal',
  }));
  const presentation = { embeddedFonts } as unknown as PresentationData;

  return { presentation, families: new Set(embeddedFonts.map((face) => face.renderFamily)) };
}

function installFontMocks(): { add: ReturnType<typeof vi.fn> } {
  const fontSet = { add: vi.fn(), delete: vi.fn() };

  class MockFontFace {
    constructor(readonly family: string) {}

    load = async (): Promise<this> => this;
  }
  vi.stubGlobal('FontFace', MockFontFace);
  Object.defineProperty(document, 'fonts', { configurable: true, value: fontSet });

  return fontSet;
}

describe('a pptx that embeds one heavy font under many names', () => {
  let clock = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    decompressMtxMock.mockReset();
    clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('spends the font time budget once for the whole deck, not once per slide', () => {
    installFontMocks();
    decompressMtxMock.mockImplementation(() => {
      clock += 300;

      return new Uint8Array([0, 1, 0, 0]);
    });
    const { presentation, families } = deck(40);

    Array.from({ length: SLIDES }, () => useEmbeddedFonts(presentation, families));

    expect(decompressMtxMock).toHaveBeenCalledTimes(1);
  });

  it('tries at most the face limit across the whole deck, not per slide', () => {
    installFontMocks();
    decompressMtxMock.mockReturnValue(new Uint8Array(17 * 1024 * 1024));
    const { presentation, families } = deck(40);

    Array.from({ length: SLIDES }, () => useEmbeddedFonts(presentation, families));

    expect(decompressMtxMock).toHaveBeenCalledTimes(16);
  });

  it('still loads the fonts of a normal deck on every slide and after slides are closed', async () => {
    const fonts = installFontMocks();
    decompressMtxMock.mockImplementation(() => {
      clock += 20;

      return new Uint8Array([0, 1, 0, 0]);
    });
    const { presentation, families } = deck(2);

    for (let round = 0; round < 20; round++) {
      const use = useEmbeddedFonts(presentation, families);

      await use.ready;
      use.dispose();
      await Promise.resolve();
    }

    expect(fonts.add).toHaveBeenCalledTimes(40);
  });
});
