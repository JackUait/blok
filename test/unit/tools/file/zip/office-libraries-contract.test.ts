import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderAsync } from 'docx-preview';
import { parseZip, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer';
import JSZip from 'jszip';

import { DOCX_OPTIONS, OFFICE_CASES, listLikePptxRenderer, normalize } from './office-normalize';

// The libraries import `jszip` themselves: today the real one, after the swap the
// shim. Golden output was captured with jszip 3.10.2 and must not change.
const bytesOf = (rel: string): Uint8Array<ArrayBuffer> => new Uint8Array(readFileSync(resolve(__dirname, rel)));

describe('office libraries read zips the same through jszip or the shim', () => {
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
  ])('the jszip import lists the %s like the golden', async (kind, rel) => {
    const listed = await listLikePptxRenderer(await JSZip.loadAsync(bytesOf(rel)));

    await expect(`${JSON.stringify(listed, null, 1)}\n`).toMatchFileSnapshot(`./fixtures/golden/zip-listing-${kind}.json`);
  });
});
