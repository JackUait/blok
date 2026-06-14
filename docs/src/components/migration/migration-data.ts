export interface ChangeItem {
  icon: string;
  title: string;
  removed: string;
  added: string;
}

export interface CodemodOption {
  flag: string;
  description: string;
}

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

export const CHANGE_ITEMS: ChangeItem[] = [
  {
    icon: "1",
    title: "Imports",
    removed: "import EditorJS from '@editorjs/editorjs';",
    added: "import { Blok } from '@jackuait/blok';",
  },
  {
    icon: "2",
    title: "Tool Imports",
    removed: "import Header from '@editorjs/header';",
    added: "import { Header } from '@jackuait/blok/tools';",
  },
  {
    icon: "3",
    title: "Types",
    removed: "import type { EditorConfig } from '@editorjs/editorjs';",
    added: "import type { BlokConfig } from '@jackuait/blok';",
  },
  {
    icon: "4",
    title: "CSS Selectors",
    removed: ".ce-block",
    added: "[data-blok-element]",
  },
  {
    icon: "5",
    title: "Default Holder",
    removed: '<div id="editorjs"></div>',
    added: '<div id="blok"></div>',
  },
  {
    icon: "6",
    title: "Data Attributes",
    removed: "data-id",
    added: "data-blok-id",
  },
  {
    icon: "7",
    title: "Inline Tool render()",
    removed: "render() { /* returns an HTMLElement button */ }",
    added: "render() { return { icon, name, onActivate, isActive }; }",
  },
  {
    icon: "8",
    title: "Block Tools (unchanged)",
    removed: "// no change needed",
    added: "// render/save/validate + statics read by the same keys",
  },
];

export const CODEMOD_OPTIONS: CodemodOption[] = [
  { flag: "--dry-run", description: "Preview changes without modifying files" },
  {
    flag: "--verbose",
    description: "Show detailed output for each file processed",
  },
  {
    flag: "--use-library-i18n",
    description: "Use Blok's built-in translations (68 languages)",
  },
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
