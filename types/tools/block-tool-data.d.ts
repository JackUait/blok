/**
 * Object returned by Tool's {@link BlockTool#save} method
 * Specified by Tool developer, so leave it as object
 */
export type BlockToolData<T extends object = Record<string, unknown>> = T;
