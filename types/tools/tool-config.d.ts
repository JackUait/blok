/**
 * Tool configuration object. Specified by Tool developer, so leave it as object
 */
export type ToolConfig<T extends object = Record<string, unknown>> = T;
