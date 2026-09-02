import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadWithProgress } from '../../../../src/components/utils/upload-xhr';

class FakeXhr {
  public static instances: FakeXhr[] = [];
  public upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  public status = 0;
  public responseText = '';
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public readonly headers: Record<string, string> = {};
  public method = '';
  public url = '';

  public constructor() {
    FakeXhr.instances.push(this);
  }

  public open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  public setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  public send(): void {}
}

describe('uploadWithProgress', () => {
  beforeEach(() => {
    FakeXhr.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resolves with the status and body once the request loads', async () => {
    const pending = uploadWithProgress({ method: 'POST', url: '/upload', body: new FormData() });
    const xhr = FakeXhr.instances[0];

    xhr.status = 200;
    xhr.responseText = '{"url":"https://cdn/x.png"}';
    xhr.onload?.();

    await expect(pending).resolves.toEqual({ status: 200, text: '{"url":"https://cdn/x.png"}' });
  });

  it('reports progress as a whole percentage', async () => {
    const onProgress = vi.fn();
    const pending = uploadWithProgress({ method: 'POST', url: '/upload', body: new FormData(), onProgress });
    const xhr = FakeXhr.instances[0];

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 200 } as ProgressEvent);
    expect(onProgress).toHaveBeenCalledWith(13);

    xhr.status = 200;
    xhr.onload?.();
    await pending;
  });

  it('ignores progress events that carry no total', async () => {
    const onProgress = vi.fn();
    const pending = uploadWithProgress({ method: 'POST', url: '/upload', body: new FormData(), onProgress });
    const xhr = FakeXhr.instances[0];

    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 25, total: 0 } as ProgressEvent);
    expect(onProgress).not.toHaveBeenCalled();

    xhr.status = 200;
    xhr.onload?.();
    await pending;
  });

  it('rejects when the transport fails', async () => {
    const pending = uploadWithProgress({ method: 'POST', url: '/upload', body: new FormData() });

    FakeXhr.instances[0].onerror?.();

    await expect(pending).rejects.toThrow(/network/i);
  });
});
