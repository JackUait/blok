/**
 * True while Stryker's instrumented copy of `src/` is loaded.
 *
 * Instrumentation rewrites source TEXT — `setAttribute('role', 'button')`
 * becomes a `stryMutAct_9fa48(...)` ternary — so a law that greps src finds
 * nothing and fails its own self-check. It also adds an env probe that throws
 * when `process` carries no `env`, which breaks cases that stub the global.
 * Both are artifacts of measuring, not defects, so those cases stand down for
 * the mutation run only.
 *
 * Call this inside describe/it rather than at module scope: the flag is only
 * set once an instrumented module has been imported.
 */
export const isInstrumented = (): boolean => '__stryker__' in globalThis;
