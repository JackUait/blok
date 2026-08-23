import { request as requestHttp } from 'node:http';
import { request as requestHttps } from 'node:https';

export interface HttpRequestOptions {
  body?: string | Uint8Array;
  headers?: Record<string, string | string[]>;
  parseJson?: boolean;
  timeoutMs?: number;
}

export interface HttpResponse {
  bytes: Buffer;
  headers: Record<string, string>;
  rawHeaders: Record<string, string[]>;
  json?: unknown;
  status: number;
  text: string;
}

export function sendRequest(
  method: string,
  url: URL,
  options: HttpRequestOptions = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? requestHttps : requestHttp;
    let deadline: NodeJS.Timeout | undefined;
    const clearDeadline = (): void => {
      if (deadline !== undefined) {
        clearTimeout(deadline);
        deadline = undefined;
      }
    };
    const request = transport(url, { method, headers: options.headers }, (response) => {
      const chunks: Buffer[] = [];

      response.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.once('error', (error) => {
        clearDeadline();
        reject(error);
      });
      response.on('end', () => {
        clearDeadline();
        const bytes = Buffer.concat(chunks);
        const text = bytes.toString('utf8');
        const rawHeaders: Record<string, string[]> = {};

        for (let index = 0; index < response.rawHeaders.length; index += 2) {
          const name = response.rawHeaders[index].toLowerCase();
          const value = response.rawHeaders[index + 1] ?? '';

          (rawHeaders[name] ??= []).push(value);
        }

        const headers = Object.fromEntries(
          Object.entries(rawHeaders).map(([name, values]) => [name, values.join(', ')]),
        );

        try {
          resolve({
            status: response.statusCode ?? 0,
            headers,
            rawHeaders,
            bytes,
            text,
            json: options.parseJson === true ? JSON.parse(text) as unknown : undefined,
          });
        } catch (error) {
          reject(error);
        }
      });
    });

    request.once('error', (error) => {
      clearDeadline();
      reject(error);
    });

    if (options.timeoutMs !== undefined) {
      deadline = setTimeout(() => {
        request.destroy(new Error(`HTTP request timed out after ${options.timeoutMs} ms`));
      }, options.timeoutMs);
    }

    if (options.body !== undefined) {
      request.write(options.body);
    }

    request.end();
  });
}
