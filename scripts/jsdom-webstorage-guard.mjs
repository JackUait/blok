/**
 * Shared guard that lets jsdom's Web Storage through on Node 26+.
 *
 * Node 26 enables Web Storage by default, and its built-in `localStorage`
 * global shadows the one jsdom installs (vitest's `populateGlobal` does not
 * overwrite globals that already exist on `globalThis`). `--localstorage-file`
 * is never provided, so Node's own accessor returns `undefined` and every
 * `localStorage.*` call in a jsdom test throws "Cannot read properties of
 * undefined" — frequently surfacing as an unrelated-looking teardown error,
 * because construction already failed earlier. Disabling Node's implementation
 * lets jsdom's through. jsdom 29 does NOT remove the need for this.
 *
 * The flag goes through NODE_OPTIONS rather than `poolOptions.*.execArgv`: the
 * threads pool runs workers via worker_threads, which rejects execArgv entries
 * that affect the process, so the flag was silently dropped there. Mutating the
 * env at config-module evaluation time (i.e. before the pool spawns a single
 * worker) covers every pool, plus direct `vitest` and IDE runs — which a
 * `NODE_OPTIONS=` prefix on a package.json `test` script would miss.
 *
 * IMPORTANT — call this at the top level of a vitest config, above
 * `export default`. Calling it from inside a plugin hook or a `defineConfig`
 * callback runs it after workers have already been spawned, which is too late.
 *
 * The `allowedNodeEnvironmentFlags` check is load-bearing: Node 20 rejects the
 * flag outright ("--no-experimental-webstorage is not allowed in NODE_OPTIONS")
 * and every worker dies at startup. Node 20 also has no built-in Web Storage,
 * so it does not need the flag. The predicate is exact: false on Node 20,
 * true on 22/24/26; the flag is a harmless no-op on 22/24 and required on 26.
 */
export const WEBSTORAGE_OFF = '--no-experimental-webstorage';

/**
 * Appends `--no-experimental-webstorage` to `process.env.NODE_OPTIONS` when the
 * running Node accepts it and it is not already present.
 *
 * @returns {boolean} `true` if NODE_OPTIONS was mutated by this call.
 */
export function enableJsdomWebStorageGuard() {
  if (!process.allowedNodeEnvironmentFlags.has(WEBSTORAGE_OFF)) {
    return false;
  }

  if ((process.env.NODE_OPTIONS ?? '').includes(WEBSTORAGE_OFF)) {
    return false;
  }

  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} ${WEBSTORAGE_OFF}`.trim();

  return true;
}
