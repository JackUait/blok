import type { ToolConstructable } from '../../../types/tools';

/**
 * Brand on a built-in tool class: names its BUILT_IN_RUNTIME_PARTS entry.
 * Core reads it instead of importing the classes (registry-snapshot.ts, api/agent-services.ts).
 * An import of a tool class there puts that tool's code back into `import { Blok }`.
 * Define it as a static getter: getters are not enumerable, so copying a class's statics does not copy it.
 * Tools spell the key as a literal, `static get 'blok.runtimePartsOwner'()`: esbuild keeps a class whose
 * computed key is an imported binding, and with it every tool in the chunk.
 */
export const RUNTIME_PARTS_OWNER = 'blok.runtimePartsOwner';

/**
 * Own property only: an alias of the class has it, a subclass does not.
 * @param toolClass - registered tool class
 */
export const runtimePartsOwnerOf = (toolClass: ToolConstructable): string | undefined => {
  if (!Object.hasOwn(toolClass, RUNTIME_PARTS_OWNER)) {
    return undefined;
  }
  const owner: unknown = Reflect.get(toolClass, RUNTIME_PARTS_OWNER);

  return typeof owner === 'string' ? owner : undefined;
};
