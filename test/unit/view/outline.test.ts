import { describe, expect, it } from 'vitest';

// Both must be reachable from the `./view` entry — consumers building a table
// of contents otherwise hand-roll DOMParser stripHtml (drops ids, needs a DOM).
import { htmlTextContent, outlineFromOutputData } from '../../../src/view';

import type { OutputData } from '../../../types';

describe('htmlTextContent (view entry export)', () => {
  it('strips inline markup and decodes entities without a DOM', () => {
    expect(htmlTextContent('<b>Intro</b> &amp; more')).toBe('Intro & more');
  });
});

describe('outlineFromOutputData', () => {
  it('extracts headings in reading order with id, level and plain text', () => {
    const data: OutputData = {
      blocks: [
        { id: 'h1', type: 'header', data: { text: 'Getting Started', level: 1 } },
        { id: 'p1', type: 'paragraph', data: { text: 'Body copy' } },
        { id: 'h2', type: 'header', data: { text: 'Install', level: 2 } },
        { id: 'h3', type: 'header', data: { text: 'Usage', level: 2 } },
      ],
    };

    expect(outlineFromOutputData(data)).toEqual([
      { id: 'h1', level: 1, text: 'Getting Started' },
      { id: 'h2', level: 2, text: 'Install' },
      { id: 'h3', level: 2, text: 'Usage' },
    ]);
  });

  it('reduces heading inline HTML to plain text (entity-decoded, tags stripped)', () => {
    const data: OutputData = {
      blocks: [
        { id: 'h1', type: 'header', data: { text: '<b>Tips</b> &amp; Tricks', level: 2 } },
      ],
    };

    expect(outlineFromOutputData(data)).toEqual([
      { id: 'h1', level: 2, text: 'Tips & Tricks' },
    ]);
  });

  it('skips headings whose text is empty or whitespace-only', () => {
    const data: OutputData = {
      blocks: [
        { id: 'h1', type: 'header', data: { text: '   ', level: 1 } },
        { id: 'h2', type: 'header', data: { text: 'Real', level: 2 } },
      ],
    };

    expect(outlineFromOutputData(data)).toEqual([
      { id: 'h2', level: 2, text: 'Real' },
    ]);
  });

  it('walks nested headings (e.g. inside a column) in reading order', () => {
    const data: OutputData = {
      blocks: [
        { id: 'top', type: 'header', data: { text: 'Top', level: 1 } },
        { id: 'col', type: 'column', data: {}, content: ['nested'] },
        { id: 'nested', type: 'header', data: { text: 'Nested', level: 3 }, parent: 'col' },
      ],
    };

    expect(outlineFromOutputData(data)).toEqual([
      { id: 'top', level: 1, text: 'Top' },
      { id: 'nested', level: 3, text: 'Nested' },
    ]);
  });

  it('is null-tolerant: nullish and heading-less documents yield an empty outline', () => {
    expect(outlineFromOutputData(null)).toEqual([]);
    expect(outlineFromOutputData(undefined)).toEqual([]);
    expect(outlineFromOutputData({ blocks: [{ id: 'p', type: 'paragraph', data: { text: 'x' } }] })).toEqual([]);
  });
});
