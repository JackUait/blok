import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadWithProgress } from '../../../../src/components/utils/upload-xhr';
import type { XhrRequest } from '../../../../src/components/utils/upload-xhr';

/**
 * Mutation-targeted coverage for `src/components/utils/upload-xhr.ts`.
 *
 * Every live mutant recorded for this file is killed here; no survivor is left,
 * so this block carries no equivalence proofs.
 */

class RecordingXhr {
  public static instances: RecordingXhr[] = [];

  public upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  public status = 0;
  public responseText = '';
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;

  public readonly opened: Array<[string, string]> = [];
  public readonly headers: Array<[string, string]> = [];
  public readonly sent: unknown[] = [];

  public constructor() {
    RecordingXhr.instances.push(this);
  }

  public open(method: string, url: string): void {
    this.opened.push([method, url]);
  }

  public setRequestHeader(name: string, value: string): void {
    this.headers.push([name, value]);
  }

  public send(body: unknown): void {
    this.sent.push(body);
  }
}

const latestXhr = (): RecordingXhr => {
  const xhr = RecordingXhr.instances.at(-1);

  if (xhr === undefined) {
    throw new Error('uploadWithProgress constructed no XMLHttpRequest');
  }

  return xhr;
};

const progressEvent = (init: ProgressEventInit): ProgressEvent => new ProgressEvent('progress', init);

const settle = async (pending: Promise<unknown>): Promise<void> => {
  const xhr = latestXhr();

  xhr.status = 204;
  xhr.onload?.();
  await pending;
};

describe('uploadWithProgress mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    RecordingXhr.instances = [];
    vi.stubGlobal('XMLHttpRequest', RecordingXhr);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens the transport with the requested method and url', async () => {
    const pending = uploadWithProgress({ method: 'PUT', url: '/assets/1', body: new FormData() });

    expect(latestXhr().opened).toEqual([['PUT', '/assets/1']]);

    await settle(pending);
  });

  it('forwards every provided header to the transport', async () => {
    const pending = uploadWithProgress({
      method: 'POST',
      url: '/upload',
      body: new FormData(),
      headers: { Authorization: 'Bearer t', 'X-Trace': 'abc' },
    });

    expect(latestXhr().headers).toEqual([['Authorization', 'Bearer t'], ['X-Trace', 'abc']]);

    await settle(pending);
  });

  it('sends the exact body it was given', async () => {
    const body = new Blob(['payload']);
    const pending = uploadWithProgress({ method: 'POST', url: '/upload', body });

    expect(latestXhr().sent).toEqual([body]);

    await settle(pending);
  });

  it('leaves the upload progress hook unset when no callback was supplied', async () => {
    const pending = uploadWithProgress({ method: 'POST', url: '/upload', body: new FormData() });

    expect(latestXhr().upload.onprogress).toBeNull();

    await settle(pending);
  });

  it('ignores a progress event that carries a total but is not length computable', async () => {
    const onProgress = vi.fn();
    const pending = uploadWithProgress({ method: 'POST', url: '/upload', body: new FormData(), onProgress });

    latestXhr().upload.onprogress?.(progressEvent({ lengthComputable: false, loaded: 50, total: 100 }));

    expect(onProgress).not.toHaveBeenCalled();

    await settle(pending);
  });

  it('ignores a length-computable progress event whose total is zero', async () => {
    const onProgress = vi.fn();
    const pending = uploadWithProgress({ method: 'POST', url: '/upload', body: new FormData(), onProgress });

    latestXhr().upload.onprogress?.(progressEvent({ lengthComputable: true, loaded: 0, total: 0 }));

    expect(onProgress).not.toHaveBeenCalled();

    await settle(pending);
  });

  it('tolerates a progress callback dropped after the upload started', async () => {
    const request: XhrRequest = {
      method: 'POST',
      url: '/upload',
      body: new FormData(),
      onProgress: vi.fn(),
    };
    const pending = uploadWithProgress(request);
    const xhr = latestXhr();

    request.onProgress = undefined;

    // Called directly, not through dispatchEvent, so a throw reaches the assertion.
    expect(() => {
      xhr.upload.onprogress?.(progressEvent({ lengthComputable: true, loaded: 1, total: 2 }));
    }).not.toThrow();

    await settle(pending);
  });
});
