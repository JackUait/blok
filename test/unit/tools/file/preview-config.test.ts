import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { API, BlockAPI } from '../../../../types';
import type { FileConfig } from '../../../../types/tools/file';

const modal = vi.hoisted(() => ({ openFilePreview: vi.fn(() => () => undefined) }));

vi.mock('../../../../src/tools/file/preview-modal', () => modal);

import { FileTool } from '../../../../src/tools/file';

const api = {
  styles: { block: 'blok-block' },
  i18n: { t: (key: string) => key, has: () => false },
  blocks: { getBlockIndex: vi.fn(() => 0), insert: vi.fn() },
} as unknown as API;

const block = { id: 'b1', name: 'file', holder: document.createElement('div'), dispatchChange: vi.fn() } as unknown as BlockAPI;

const openPreview = (config: FileConfig): void => {
  const tool = new FileTool({
    data: { url: 'https://cdn.example.com/doc.pdf', fileName: 'doc.pdf', mimeType: 'application/pdf' },
    config,
    api,
    block,
    readOnly: false,
  });
  tool.render().querySelector<HTMLElement>('[data-role="file-card"]')?.click();
};

describe('FileTool hands its preview config to the preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes the fetch hook and the pdf.js assets url', () => {
    const fetchPreview = vi.fn(() => Promise.resolve(new Blob()));

    openPreview({ fetchPreview, pdfAssetsUrl: 'https://cdn.example.com/pdfjs/' });

    expect(modal.openFilePreview).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://cdn.example.com/doc.pdf',
      fetchPreview,
      pdfAssetsUrl: 'https://cdn.example.com/pdfjs/',
    }));
  });

  it('passes the Blok server preview endpoint', () => {
    const previewEndpoint = { url: 'https://blok.example.com/file-bytes' };

    openPreview({ previewEndpoint });

    expect(modal.openFilePreview).toHaveBeenCalledWith(expect.objectContaining({ previewEndpoint }));
  });
});
