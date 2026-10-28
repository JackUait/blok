import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderAsync } from 'docx-preview';
import { parseZip, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer';
import JSZipShim from '../../../../../src/tools/file/zip/jszip-shim';

import { DOCX_OPTIONS, OFFICE_CASES, listLikePptxRenderer, normalize, withRecordedBlobs } from './office-normalize';

// The libraries import `jszip` themselves, which a yarn resolution points at the shim.
// Golden output was captured with the real jszip 3.10.2 and must not change.
const bytesOf = (rel: string): Uint8Array<ArrayBuffer> => new Uint8Array(readFileSync(resolve(__dirname, rel)));

describe('office libraries read zips the same through jszip or the shim', () => {
  it.each(['docx-preview', '@aiden0z/pptx-renderer'])('%s resolves jszip to the shim package', (library) => {
    const fromRoot = createRequire(resolve(__dirname, '../../../../../package.json'));
    const fromLibrary = createRequire(fromRoot.resolve(library));

    // Ends-with: Stryker's sandbox links node_modules back to the repo.
    expect(fromLibrary.resolve('jszip')).toMatch(/\/shims\/jszip\/index\.ts$/);
  });

  it('docx-preview renders the deflated docx to the golden HTML', async () => {
    const container = document.createElement('div');

    await renderAsync(bytesOf(OFFICE_CASES.docx), container, undefined, DOCX_OPTIONS);
    await expect(container.innerHTML).toMatchFileSnapshot('./fixtures/golden/docx-preview-render.html');
  });

  it.each([
    ['pptx', OFFICE_CASES.pptx],
    ['xlsx', OFFICE_CASES.xlsx],
  ])('pptx-renderer parseZip lists the %s like the golden', async (kind, rel) => {
    const files = await parseZip(bytesOf(rel).buffer, RECOMMENDED_ZIP_LIMITS);

    await expect(`${JSON.stringify(normalize(files), null, 1)}\n`).toMatchFileSnapshot(`./fixtures/golden/pptx-parse-${kind}.json`);
  });

  it.each([
    ['pptx', OFFICE_CASES.pptx],
    ['xlsx', OFFICE_CASES.xlsx],
  ])('the shim lists the %s like the golden', async (kind, rel) => {
    const listed = await listLikePptxRenderer(await JSZipShim.loadAsync(bytesOf(rel)));

    await expect(`${JSON.stringify(listed, null, 1)}\n`).toMatchFileSnapshot(`./fixtures/golden/zip-listing-${kind}.json`);
  });

  // Media goldens were captured by bundling each library with the real jszip 3.10.2.
  it('docx-preview loads an embedded image as a blob like jszip did', async () => {
    const rendered = await withRecordedBlobs(async () => {
      const container = document.createElement('div');

      await renderAsync(bytesOf(OFFICE_CASES.docxImage).buffer, container, undefined, DOCX_OPTIONS);

      return container.innerHTML;
    });

    expect(rendered.html).toContain('src="blob:#0"');
    await expect(`${JSON.stringify(rendered, null, 1)}\n`).toMatchFileSnapshot('./fixtures/golden/docx-preview-render-image.json');
  });

  it('pptx-renderer parseZip reads a slide picture like jszip did', async () => {
    const files = await parseZip(bytesOf(OFFICE_CASES.pptxImage).buffer, RECOMMENDED_ZIP_LIMITS);

    expect(files.media.size).toBe(1);
    await expect(`${JSON.stringify(normalize(files), null, 1)}\n`).toMatchFileSnapshot('./fixtures/golden/pptx-parse-pptx-image.json');
  });
});
