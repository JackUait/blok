export const CODEMOD_DRY_RUN_COMMAND =
  "npx -p @bloklabs/core migrate-from-editorjs ./src --dry-run";
export const CODEMOD_APPLY_COMMAND =
  "npx -p @bloklabs/core migrate-from-editorjs ./src";

export interface MigrationStep {
  /** Section anchor id, also used by the step rail scroll-spy. */
  id: "codemod" | "changes" | "css" | "tools" | "verify";
  /** i18n key for both the rail label and the section heading. */
  titleKey: string;
  /** i18n key for the section's one-line description. */
  descriptionKey: string;
}

export const MIGRATION_STEPS: MigrationStep[] = [
  { id: "codemod", titleKey: "migration.sectionCodemodTitle", descriptionKey: "migration.sectionCodemodDescription" },
  { id: "changes", titleKey: "migration.sectionChangesTitle", descriptionKey: "migration.sectionChangesDescription" },
  { id: "css", titleKey: "migration.sectionCssTitle", descriptionKey: "migration.sectionCssDescription" },
  { id: "tools", titleKey: "migration.sectionToolsTitle", descriptionKey: "migration.sectionToolsDescription" },
  { id: "verify", titleKey: "migration.sectionVerifyTitle", descriptionKey: "migration.sectionVerifyDescription" },
];

export interface DiffChange {
  /** i18n key for the short row label (e.g. "Imports"). */
  titleKey: string;
  removed: string;
  added: string;
}

/** Every rename the codemod performs, shown as one diff row each. */
export const DIFF_CHANGES: DiffChange[] = [
  {
    titleKey: "migration.changeImports",
    removed: "import EditorJS from '@editorjs/editorjs';",
    added: "import { Blok } from '@bloklabs/core';",
  },
  {
    titleKey: "migration.changeToolImports",
    removed: "import Header from '@editorjs/header';",
    added: "import { Header } from '@bloklabs/core/tools';",
  },
  {
    titleKey: "migration.changeTypes",
    removed: "import type { EditorConfig } from '@editorjs/editorjs';",
    added: "import type { BlokConfig } from '@bloklabs/core';",
  },
  {
    titleKey: "migration.changeCssSelectors",
    removed: ".ce-block",
    added: "[data-blok-element]",
  },
  {
    titleKey: "migration.changeDefaultHolder",
    removed: '<div id="editorjs"></div>',
    added: '<div id="blok"></div>',
  },
  {
    titleKey: "migration.changeDataAttributes",
    removed: "data-id",
    added: "data-blok-id",
  },
];

export interface CompatibilityGroup {
  id: "drop-in" | "auto" | "not-bundled";
  titleKey: string;
  hintKey: string;
  /** Editor.js tool names in this migration bucket. */
  tools: string[];
}

/**
 * Editor.js block/tool → migration status, grouped by outcome. Grounded in
 * the runtime transform (src/components/utils/data-model-transform.ts) and
 * the codemod (codemod/migrate-editorjs-to-blok.js).
 */
export const COMPATIBILITY_GROUPS: CompatibilityGroup[] = [
  {
    id: "drop-in",
    titleKey: "migration.compatGroupDropIn",
    hintKey: "migration.compatGroupDropInHint",
    // marker/inlineCode keep their <mark>/<code> inline markup, and audio ships as
    // a default block tool — all three are bundled and registered by default
    // (src/tools/index.ts), so saved data loads as-is with no conversion.
    tools: ["paragraph", "header", "code", "embed", "marker", "inlineCode", "audio"],
  },
  {
    id: "auto",
    titleKey: "migration.compatGroupAuto",
    hintKey: "migration.compatGroupAutoHint",
    tools: [
      "list",
      "checklist",
      "toggleList",
      "callout",
      "image",
      "simple-image",
      "linkTool",
      "delimiter",
      "quote",
      "table",
      "raw",
      "warning",
      "attaches",
    ],
  },
  {
    id: "not-bundled",
    titleKey: "migration.compatGroupNotBundled",
    hintKey: "migration.compatGroupNotBundledHint",
    tools: ["personality", "button"],
  },
];

export interface CssMapping {
  editorjs: string;
  blok: string;
}

export const CSS_MAPPINGS: CssMapping[] = [
  { editorjs: ".codex-editor", blok: "[data-blok-editor]" },
  { editorjs: ".ce-block", blok: "[data-blok-element]" },
  { editorjs: ".ce-block--selected", blok: '[data-blok-selected="true"]' },
  { editorjs: ".ce-toolbar", blok: "[data-blok-toolbar]" },
  { editorjs: ".ce-inline-toolbar", blok: '[data-blok-testid="inline-toolbar"]' },
  { editorjs: ".ce-toolbar__settings-btn", blok: "[data-blok-settings-toggler]" },
  { editorjs: ".ce-popover", blok: "[data-blok-popover]" },
  { editorjs: "data-placeholder", blok: "data-blok-placeholder" },
];

export interface MigrationWall {
  id: "flat" | "plugins" | "engine" | "framework";
  oldTitleKey: string;
  oldDescKey: string;
  newTitleKey: string;
  newDescKey: string;
}

/** The Editor.js ceilings this page names, each paired with how Blok clears it. */
export const MIGRATION_WALLS: MigrationWall[] = [
  { id: "flat", oldTitleKey: "migration.wallFlatOldTitle", oldDescKey: "migration.wallFlatOldDesc", newTitleKey: "migration.wallFlatNewTitle", newDescKey: "migration.wallFlatNewDesc" },
  { id: "plugins", oldTitleKey: "migration.wallPluginsOldTitle", oldDescKey: "migration.wallPluginsOldDesc", newTitleKey: "migration.wallPluginsNewTitle", newDescKey: "migration.wallPluginsNewDesc" },
  { id: "engine", oldTitleKey: "migration.wallEngineOldTitle", oldDescKey: "migration.wallEngineOldDesc", newTitleKey: "migration.wallEngineNewTitle", newDescKey: "migration.wallEngineNewDesc" },
  { id: "framework", oldTitleKey: "migration.wallFrameworkOldTitle", oldDescKey: "migration.wallFrameworkOldDesc", newTitleKey: "migration.wallFrameworkNewTitle", newDescKey: "migration.wallFrameworkNewDesc" },
];

/** Objection-killer checklist — each an i18n key for one reassurance line. */
export const MIGRATION_OBJECTIONS: string[] = [
  "migration.objectionContentLoads",
  "migration.objectionToolsPort",
  "migration.objectionInlineWrap",
  "migration.objectionWarnings",
];

/** The three-step "the move" sequence, i18n keys in order. */
export const MIGRATION_MOVE_STEPS: string[] = [
  "migration.moveStep1",
  "migration.moveStep2",
  "migration.moveStep3",
];

