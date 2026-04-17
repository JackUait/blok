/**
 * Wildcard declaration for Prism.js language component modules.
 * These are side-effect-only modules that register grammars on the global Prism instance.
 * They have no meaningful exports and no upstream type declarations.
 */
declare module 'prismjs/components/*' {
  const value: unknown;
  export default value;
}
