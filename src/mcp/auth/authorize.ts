import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { McpConfigError } from '../config';

export type AuthorizeHook = (principal: string, documentId: string, write: boolean) => Promise<boolean>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const importFile = async (path: string): Promise<unknown> => {
  const loaded: unknown = await import(/* @vite-ignore */ path);

  return loaded;
};

/**
 * An http(s) spec is a webhook; anything else is a module path resolved against cwd.
 */
export const loadAuthorizeHook = async (
  spec: string,
  deps: { fetchImpl?: typeof fetch; importModule?: (path: string) => Promise<unknown>; cwd?: string } = {},
): Promise<AuthorizeHook> => {
  if (/^https?:\/\//.test(spec)) {
    const fetchImpl = deps.fetchImpl ?? fetch;

    // Fail closed: any answer but an explicit { allowed: true } denies.
    return async (principal, documentId, write) => {
      try {
        const response = await fetchImpl(spec, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ principal, documentId, write }),
        });

        if (response.status !== 200) {
          return false;
        }
        const body: unknown = JSON.parse(await response.text());

        return isRecord(body) && body.allowed === true;
      } catch {
        return false;
      }
    };
  }
  const url = pathToFileURL(resolve(deps.cwd ?? process.cwd(), spec)).href;
  const loaded = await (deps.importModule ?? importFile)(url);
  const hook = isRecord(loaded) ? loaded.default : undefined;

  if (typeof hook !== 'function') {
    throw new McpConfigError(`--authorize ${spec} must default-export (principal, documentId, write) => Promise<boolean>`);
  }

  return async (principal, documentId, write) => {
    const allowed: unknown = await Reflect.apply(hook, undefined, [principal, documentId, write]);

    return allowed === true;
  };
};
