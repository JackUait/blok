import { describe, it, expect, vi, beforeEach } from 'vitest';

const docx = vi.hoisted(() => ({ release: vi.fn(), renderDocxInto: vi.fn() }));

vi.mock('../../../../src/tools/file/docx', () => ({ renderDocxInto: docx.renderDocxInto }));

import { loadDocxRenderer, loadZipReader } from '../../../../src/tools/file/office-loaders';

describe('office loaders mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('docx', () => {
    it('renders with the in-house renderer and hands back its release function', async () => {
      docx.renderDocxInto.mockResolvedValue(docx.release);
      const render = await loadDocxRenderer();
      const buf = new ArrayBuffer(8);
      const container = document.createElement('div');

      const release = await render(buf, container);

      expect(docx.renderDocxInto).toHaveBeenCalledTimes(1);
      expect(docx.renderDocxInto).toHaveBeenCalledWith(buf, container);
      expect(release).toBe(docx.release);
    });
  });

  describe('zip reader', () => {
    it('hands back the in-house reader', async () => {
      const read = await loadZipReader();

      expect(read).toBe((await import('../../../../src/tools/file/zip/read-zip')).readZip);
    });
  });

});
