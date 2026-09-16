// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { blocksToPlainText, blocksToPlainTextWithReport } from '../../../src/view/blocks-to-plain-text';

import type { OutputBlockData, OutputData } from '../../../types';

/**
 * Convenience: wrap blocks into an OutputData envelope.
 * @param blocks - blocks for the document
 */
const doc = (blocks: OutputBlockData[]): OutputData => ({ blocks });

describe('blocksToPlainTextWithReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the same text the bare reader returns', () => {
    const document = doc([
      { type: 'header', data: { text: 'Title', level: 1 } },
      { type: 'paragraph', data: { text: 'Body' } },
    ]);

    expect(blocksToPlainTextWithReport(document).text).toBe(blocksToPlainText(document));
  });

  /**
   * The whole reason this exists: a document of tools the reader does not know
   * reads as `''`, exactly like an empty one, and the caller could not tell
   * those apart.
   */
  it('names a tool it does not recognise instead of silently reading nothing', () => {
    const report = blocksToPlainTextWithReport(doc([
      { type: 'org-chart', data: { people: ['Ada'] } },
    ]));

    expect(report.text).toBe('');
    expect(report.warnings).toEqual([
      {
        construct: 'org-chart',
        action: 'dropped',
        detail: '`org-chart` is not a block type this reader knows, so none of its own text was read',
      },
    ]);
  });

  /**
   * A divider genuinely has no text. Reporting it would drown the one signal
   * the caller came for.
   */
  it('says nothing about built-in blocks that carry no text by design', () => {
    const report = blocksToPlainTextWithReport(doc([
      { type: 'divider', data: {} },
      { type: 'spacer', data: { height: 24 } },
      { type: 'callout', data: { emoji: '💡' } },
      { type: 'column_list', data: {} },
      { type: 'database', data: { schema: [], views: [], activeViewId: 'v' } },
    ]));

    expect(report.text).toBe('');
    expect(report.warnings).toEqual([]);
  });

  it('reports nothing for a document that is merely empty', () => {
    expect(blocksToPlainTextWithReport(doc([]))).toEqual({ text: '', warnings: [] });
  });

  it('reports one warning per unreadable block, in document order', () => {
    const report = blocksToPlainTextWithReport(doc([
      { type: 'org-chart', data: {} },
      { type: 'paragraph', data: { text: 'Between' } },
      { type: 'gantt', data: {} },
    ]));

    expect(report.text).toBe('Between');
    expect(report.warnings.map((warning) => warning.construct)).toEqual(['org-chart', 'gantt']);
  });

  /** A caller that supplied a renderer for the tool did not lose anything. */
  it('stays quiet about an unknown tool the caller renders itself', () => {
    const report = blocksToPlainTextWithReport(
      doc([{ type: 'org-chart', data: { title: 'Team' } }]),
      { renderers: { 'org-chart': (data) => `<p>${String(data.title)}</p>` } }
    );

    expect(report.text).toBe('Team');
    expect(report.warnings).toEqual([]);
  });
});
