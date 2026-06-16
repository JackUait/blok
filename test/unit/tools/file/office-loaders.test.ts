import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const openSpy = vi.fn();
const RECOMMENDED_ZIP_LIMITS = { maxFiles: 1 };

vi.mock('@aiden0z/pptx-renderer', () => ({
  PptxViewer: { open: openSpy },
  RECOMMENDED_ZIP_LIMITS,
}));

import { loadPptxRenderer } from '../../../../src/tools/file/office-loaders';

describe('loadPptxRenderer', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('opens the deck scaled to fit the container width (so slides are not clipped)', async () => {
    const { open } = await loadPptxRenderer();
    const buf = new ArrayBuffer(8);
    const container = document.createElement('div');

    await open(buf, container);

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [passedBuf, passedContainer, options] = openSpy.mock.calls[0];
    expect(passedBuf).toBe(buf);
    expect(passedContainer).toBe(container);
    // 'contain' makes the renderer size each slide wrapper to the scaled slide
    // height and track container resizes — without it slides render at their
    // intrinsic 960×720 and get clipped by the modal's scroll container.
    expect(options).toMatchObject({ fitMode: 'contain', zipLimits: RECOMMENDED_ZIP_LIMITS, pdfjs: false });
  });
});
