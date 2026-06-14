export interface CssMapping {
  editorjs: string;
  blok: string;
}

export interface CompatibilityRow {
  /** Editor.js block / tool name */
  tool: string;
  /** i18n key for the migration status label */
  statusKey: string;
}

/**
 * Editor.js block/tool → migration status. Grounded in the runtime transform
 * (src/components/utils/data-model-transform.ts) and the codemod
 * (codemod/migrate-editorjs-to-blok.js). Status labels resolve via i18n.
 */
export const VERSION_COMPATIBILITY: CompatibilityRow[] = [
  { tool: "paragraph", statusKey: "migration.compatStatusDropIn" },
  { tool: "header", statusKey: "migration.compatStatusDropIn" },
  { tool: "list", statusKey: "migration.compatStatusRuntime" },
  { tool: "checklist", statusKey: "migration.compatStatusRuntime" },
  { tool: "image, simple-image", statusKey: "migration.compatStatusRuntimeCodemod" },
  { tool: "linkTool", statusKey: "migration.compatStatusRuntimeCodemod" },
  { tool: "delimiter", statusKey: "migration.compatStatusCodemod" },
  { tool: "quote", statusKey: "migration.compatStatusRuntimeCodemod" },
  { tool: "code", statusKey: "migration.compatStatusDropIn" },
  { tool: "table", statusKey: "migration.compatStatusRuntimeCodemod" },
  { tool: "embed", statusKey: "migration.compatStatusDropIn" },
  { tool: "raw", statusKey: "migration.compatStatusRuntimeCodemod" },
  { tool: "warning", statusKey: "migration.compatStatusRuntimeCodemod" },
  { tool: "attaches", statusKey: "migration.compatStatusRuntimeCodemod" },
  { tool: "marker, inlineCode", statusKey: "migration.compatStatusNotBundled" },
  { tool: "personality, button, audio, …", statusKey: "migration.compatStatusNotBundled" },
];

export const CSS_MAPPINGS: CssMapping[] = [
  { editorjs: ".codex-editor", blok: "[data-blok-editor]" },
  { editorjs: ".ce-block", blok: "[data-blok-element]" },
  { editorjs: ".ce-block--selected", blok: '[data-blok-selected="true"]' },
  { editorjs: ".ce-toolbar", blok: "[data-blok-toolbar]" },
  { editorjs: ".ce-inline-toolbar", blok: "[data-blok-inline-toolbar]" },
  { editorjs: ".ce-settings-button", blok: "[data-blok-settings-btn]" },
  { editorjs: ".ce-popover", blok: "[data-blok-popover]" },
  { editorjs: "data-placeholder", blok: "data-blok-placeholder" },
];
