/**
 * The setter half of a static accessor that stands in for a static field.
 *
 * A static field compiles to `Tool.x = value` after the class, which consumer
 * bundlers keep as a side effect, and with it every tool in the chunk. An
 * accessor keeps the class body pure. This setter makes `Sub.x = value` (how
 * TypeScript emits a subclass field) define an own data property, as a field
 * would; without it, the assignment throws on a getter-only accessor.
 */
export const overrideStatic = (target: abstract new (...args: never[]) => unknown, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
};
