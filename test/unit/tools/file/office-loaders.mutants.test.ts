import { describe, it, expect, vi, beforeEach } from 'vitest';

const docx = vi.hoisted(() => ({ release: vi.fn(), renderDocxInto: vi.fn() }));
const pptx = vi.hoisted(() => ({
  open: vi.fn(async () => ({ viewer: true })),
  limits: { maxFiles: 7 },
}));

vi.mock('../../../../src/tools/file/docx', () => ({ renderDocxInto: docx.renderDocxInto }));
vi.mock('@aiden0z/pptx-renderer', () => ({
  PptxViewer: { open: pptx.open },
  RECOMMENDED_ZIP_LIMITS: pptx.limits,
}));

import { loadDocxRenderer, loadZip, loadPptxRenderer } from '../../../../src/tools/file/office-loaders';

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

  describe('jszip interop', () => {
    it('accepts the constructor on the module default', async () => {
      const ctor = function JSZip() { /* stand-in */ };

      vi.doMock('jszip', () => ({ default: ctor }));
      vi.resetModules();

      const { loadZip: fresh } = await import('../../../../src/tools/file/office-loaders');

      await expect(fresh()).resolves.toBe(ctor);

      vi.doUnmock('jszip');
      vi.resetModules();
    });

    it('accepts a real jszip module and hands back something constructible', async () => {
      const Zip = await loadZip();

      expect(typeof Zip).toBe('function');
      expect(new Zip()).toBeDefined();
    });
  });

  describe('pptx', () => {
    it('fits every slide to the container and passes the recommended zip limits', async () => {
      const { open } = await loadPptxRenderer();
      const buf = new ArrayBuffer(8);
      const container = document.createElement('div');

      await open(buf, container);

      expect(pptx.open).toHaveBeenCalledTimes(1);
      expect(pptx.open).toHaveBeenCalledWith(buf, container, {
        fitMode: 'contain',
        zipLimits: pptx.limits,
        pdfjs: false,
      });
    });
  });
});
