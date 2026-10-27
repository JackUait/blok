// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import '../helpers/domShims';
import { backgroundFillPresentation } from '../fixtures/background-fill';
import { renderSlide } from '../../../../../../src/tools/file/pptx/renderer/SlideRenderer';

describe('background fill native regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('paints implicit white instead of exposing the underlying shape', async () => {
    const p = backgroundFillPresentation();
    const h = renderSlide(p, p.slides[0]);
    await h.ready;
    const shape = h.element.lastElementChild as HTMLElement;
    const solid = shape.querySelector('svg > path')?.getAttribute('fill');
    const surface = shape.querySelector<HTMLElement>('[data-pptx-shape-background]');
    expect(solid === '#FFFFFF' || surface?.style.backgroundColor === 'rgb(255, 255, 255)').toBe(
      true,
    );
    h.dispose();
  });
  it('keeps explicit local solid fill ahead of useBgFill, as PowerPoint does', async () => {
    const p = backgroundFillPresentation({ kind: 'solid', localFill: 'FF0000' });
    const h = renderSlide(p, p.slides[0]);
    await h.ready;
    expect(h.element.lastElementChild?.querySelector('svg > path')?.getAttribute('fill')).toBe(
      '#FF0000',
    );
    h.dispose();
  });
});
