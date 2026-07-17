/**
 * Live tool-config functions: the reason a consumer should never have to freeze
 * callback identities (`useState(() => ...)`) or recreate the editor to get
 * fresh closures into tool configs.
 *
 * Core snapshots each tool's config when a block instance is constructed
 * (`ToolClass.settings` builds a merged copy), so a function passed in `tools`
 * at editor construction would otherwise be pinned forever — consumers worked
 * around it by freezing identities and smuggling live values through external
 * stores. Instead, `useBlok` hands core STABLE wrapper functions that delegate
 * to whatever closure the LATEST render passed at the same config path. New
 * render → new closure → the wrapper calls it; the editor is never recreated.
 */

type AnyFunction = (...args: unknown[]) => unknown;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const proto: unknown = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
};

/** Walk `root` down `path`, returning undefined the moment the shape diverges. */
const resolveAtPath = (root: unknown, path: readonly (string | number)[]): unknown =>
  path.reduce<unknown>((node, key) => {
    if (Array.isArray(node)) {
      return typeof key === 'number' ? node[key] : undefined;
    }

    if (isPlainObject(node)) {
      return node[key];
    }

    return undefined;
  }, root);

/**
 * Return a copy of `tools` where every function inside a tool's `config` is
 * replaced by a stable wrapper that calls the function found at the same path
 * in `getLatestTools()` (falling back to the construction-time original when
 * the latest config no longer carries one). Tool classes and non-function
 * values pass through untouched; the consumer's objects are never mutated.
 */
export const bindLiveToolConfigFunctions = (tools: unknown, getLatestTools: () => unknown): unknown => {
  if (!isPlainObject(tools)) {
    return tools;
  }

  const result: Record<string, unknown> = {};

  for (const [name, entry] of Object.entries(tools)) {
    if (!isPlainObject(entry) || !isPlainObject(entry.config)) {
      result[name] = entry;

      continue;
    }

    const seen = new WeakSet();

    const wrapNode = (node: unknown, path: readonly (string | number)[]): unknown => {
      if (typeof node === 'function') {
        const original = node as AnyFunction;

        return function liveConfigFunction(this: unknown, ...args: unknown[]): unknown {
          const latestTools = getLatestTools();
          const latestEntry = isPlainObject(latestTools) ? latestTools[name] : undefined;
          const latestConfig = isPlainObject(latestEntry) ? latestEntry.config : undefined;
          const latest = resolveAtPath(latestConfig, path);
          const target = typeof latest === 'function' ? (latest as AnyFunction) : original;

          // Preserve the call-site `this` (config functions may be invoked as
          // methods of their config object).
          return Reflect.apply(target, this, args);
        };
      }

      if (Array.isArray(node)) {
        if (seen.has(node)) {
          return node;
        }
        seen.add(node);

        return node.map((item, index) => wrapNode(item, [...path, index]));
      }

      if (isPlainObject(node)) {
        if (seen.has(node)) {
          return node;
        }
        seen.add(node);

        const wrapped: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(node)) {
          wrapped[key] = wrapNode(value, [...path, key]);
        }

        return wrapped;
      }

      return node;
    };

    result[name] = { ...entry, config: wrapNode(entry.config, []) };
  }

  return result;
};
