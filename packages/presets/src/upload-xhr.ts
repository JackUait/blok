export interface XhrRequest {
  method: 'POST' | 'PUT';
  url: string;
  body: FormData | File | Blob;
  headers?: Record<string, string>;
  onProgress?: (percent: number) => void;
}

export interface XhrResult {
  status: number;
  text: string;
}

/**
 * XHR rather than fetch: fetch cannot report upload progress without request
 * streams, which are not available in Safari. Every preset that shows a progress
 * bar goes through here.
 */
export function uploadWithProgress(request: XhrRequest): Promise<XhrResult> {
  return new Promise<XhrResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open(request.method, request.url);

    for (const [name, value] of Object.entries(request.headers ?? {})) {
      xhr.setRequestHeader(name, value);
    }

    if (request.onProgress) {
      xhr.upload.onprogress = (event): void => {
        if (!event.lengthComputable || event.total === 0) {
          return;
        }

        request.onProgress?.(Math.round((event.loaded / event.total) * 100));
      };
    }

    xhr.onload = (): void => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = (): void => reject(new Error('Upload failed: network error'));

    xhr.send(request.body);
  });
}
