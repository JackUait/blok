import type { FileConfig } from '../../../../types/tools/file';
import { safeHttpHref } from '../url';
import type { PdfSource } from './pdf-preview';

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
 * then the url itself. Nothing for any other url, so neither the hook nor
 * pdf.js ever sees one.
 */
export async function* resolvePdfSources(
  url: string,
  hook: FetchPreview,
  signal: AbortSignal,
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
}
