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

/** Embedded font entries; by default they all point at the same font file. */
function deck(entries: number, sharedFile = true): { presentation: PresentationData; families: Set<string> } {
  const shared = eot();
  const embeddedFonts = Array.from({ length: entries }, (_, index) => ({
    family: `Face ${index}`,
    renderFamily: `__embedded_${index}`,
    data: sharedFile ? shared : eot(),
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
    Reflect.deleteProperty(document, 'fonts');
  });

  it('decodes a face that does not fit the total size budget only once', () => {
    const fonts = installFontMocks();
    decompressMtxMock.mockReturnValue(new Uint8Array(12 * 1024 * 1024));
    const { presentation, families } = deck(4, false);

    Array.from({ length: SLIDES }, () => useEmbeddedFonts(presentation, families));

    // 12 MB faces against a 32 MB total: two load, two are refused once each.
    expect(decompressMtxMock).toHaveBeenCalledTimes(4);
    expect(fonts.add).toHaveBeenCalledTimes(2);
  });

  it('decodes a heavy font file once, however many names point at it', () => {
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
    const { presentation, families } = deck(40, false);

    Array.from({ length: SLIDES }, () => useEmbeddedFonts(presentation, families));

    expect(decompressMtxMock).toHaveBeenCalledTimes(16);
  });

  it('still loads a light font on a later slide after a heavy one ran out of time', () => {
    const fonts = installFontMocks();
    decompressMtxMock
      .mockImplementationOnce(() => {
        clock += 300;

        return new Uint8Array([0, 1, 0, 0]);
      })
      .mockImplementation(() => {
        clock += 20;

        return new Uint8Array([0, 1, 0, 0]);
      });
    const { presentation, families } = deck(2, false);

    useEmbeddedFonts(presentation, families);
    useEmbeddedFonts(presentation, families);

    expect(fonts.add).toHaveBeenCalledTimes(1);
  });

  it('stops decoding once the deck has spent its whole time budget, however the faces are spread', () => {
    installFontMocks();
    decompressMtxMock.mockImplementation(() => {
      clock += 3000;

      return new Uint8Array([0, 1, 0, 0]);
    });
    const { presentation, families } = deck(16, false);

    Array.from({ length: 16 }, () => useEmbeddedFonts(presentation, families));

    // 3 s per decode against a 5 s deck budget: the decode that crosses it is the last.
    expect(decompressMtxMock).toHaveBeenCalledTimes(2);
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
