import type { FileConfig } from '../../../../types/tools/file';
import { safeHttpHref } from '../url';
import type { PdfSource } from './pdf-preview';
import { createServerRangeSource } from './pdf-server-transport';

type FetchPreview = FileConfig['fetchPreview'];

/**
 * A copy: pdf.js takes over the buffer it is given, and the host may still
 * hold this one. Duck-typed, since a host value may come from another realm.
 */
async function bytesOf(got: Blob | ArrayBuffer | Response): Promise<Uint8Array> {
  if ('ok' in got && !got.ok) {
    throw new Error(`fetchPreview answered ${got.status}`);
  }
  if ('arrayBuffer' in got) {
    return new Uint8Array(await got.arrayBuffer());
  }

  return new Uint8Array(got.slice(0));
}

/**
 * Where an http(s) PDF's bytes may come from, best first: the host's hook,
 * the url itself, then the Blok server. Nothing for any other url, so no
 * hook, pdf.js or server ever sees one. Throws PdfUnreadableError when the
 * server says the file is no PDF.
 */
export async function* resolvePdfSources(
  url: string,
  hook: FetchPreview,
  signal: AbortSignal,
  endpoint?: FileConfig['previewEndpoint'],
): AsyncGenerator<PdfSource> {
  const href = safeHttpHref(url);
  if (href === null) {
    return;
  }
  if (hook !== undefined) {
    const data = await hook(href, { signal }).then(bytesOf).catch(() => null);
    if (signal.aborted) {
      return;
    }
    if (data !== null) {
      yield { kind: 'data', data };
    }
  }
  if (signal.aborted) {
    return;
  }
  yield { kind: 'url', url: href };
  if (endpoint === undefined || signal.aborted) {
    return;
  }
  const served = await createServerRangeSource(endpoint.url, href, endpoint.headers, signal);
  if (served !== null && !signal.aborted) {
    yield served;
  }
}
