// Must stay free of vitest: Playwright specs load this harness, and vitest
// throws under Playwright's require(). test/unit/vitest.setup.ts plugs in
// vitest's onTestFinished.

type Cleanup = () => Promise<void>;

let registrar: ((cleanup: Cleanup) => void) | undefined;

export function setTestCleanupRegistrar(register: (cleanup: Cleanup) => void): void {
  registrar = register;
}

/** Runs `cleanup` when the current test finishes. Throws outside a running test. */
export function registerTestCleanup(cleanup: Cleanup): void {
  registrar?.(cleanup);
}
