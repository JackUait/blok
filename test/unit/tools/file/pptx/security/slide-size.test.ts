import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../helpers/domShims';
import { buildDeck } from '../helpers/buildDeck';
import { editZip } from '../../docx/build-docx';
import { parseZip } from '../../../../../../src/tools/file/pptx/parser/ZipParser';
import { buildPresentation } from '../../../../../../src/tools/file/pptx/model/Presentation';

/** buildDeck with the slide size swapped for `size`. */
const deckOfSize = async (size: string): Promise<ArrayBuffer> => await editZip(await buildDeck([{ text: 'Sized' }]), {
  'ppt/presentation.xml': (presentation) => presentation.replace('<p:sldSz cx="9144000" cy="6858000"/>', size),
});

describe('a pptx whose slide size is zero or negative', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it.each([
    ['zero', '<p:sldSz cx="0" cy="0"/>'],
    ['negative', '<p:sldSz cx="-9144000" cy="-6858000"/>'],
  ])('falls back to the default 10 × 7.5 in slide for a %s size', async (_label, size) => {
    const presentation = buildPresentation(await parseZip(await deckOfSize(size)));

    expect(presentation.width).toBe(960);
    expect(presentation.height).toBe(720);
  });
});
