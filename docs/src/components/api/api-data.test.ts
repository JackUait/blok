import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { API_SECTIONS } from "./api-data";

/** Repo root — docs/src/components/api → up four levels. */
const BLOK_ROOT = resolve(__dirname, "..", "..", "..", "..");
const readSource = (rel: string): string =>
  readFileSync(join(BLOK_ROOT, rel), "utf8");

describe("API_SECTIONS", () => {
  it("should have all defined sections", () => {
    const expectedSectionIds = [
      "quick-start",
      "tutorial",
      "concepts",
      "custom-block-tool",
      "core",
      "config",
      "blocks-api",
      "block-api",
      "caret-api",
      "events-api",
      "history-api",
      "saver-api",
      "selection-api",
      "styles-api",
      "toolbar-api",
      "inline-toolbar-api",
      "notifier-api",
      "sanitizer-api",
      "tooltip-api",
      "readonly-api",
      "i18n-api",
      "ui-api",
      "listeners-api",
      "tools-api",
      "output-data",
      "block-data",
      "blok-editor",
      "use-blocks",
    ];

    const actualIds = API_SECTIONS.map((s) => s.id);
    expect(actualIds).toEqual(expectedSectionIds);
  });

  it("should have all methods with examples", () => {
    API_SECTIONS.forEach((section) => {
      // Skip quick-start and config sections as they have custom rendering
      if (section.id === "quick-start" || section.id === "config") {
        return;
      }

      section.methods?.forEach((method) => {
        expect(method.example).toBeDefined();
        expect(method.example?.trim().length).toBeGreaterThan(0);
      });
    });
  });

  it("should have meaningful examples for methods", () => {
    const meaningfulExamples = {
      "save()": "await",
      "render(data)": "await",
      "focus(atEnd?)": "editor.focus",
      "clear()": "editor.clear",
      "destroy()": "editor.destroy",
      "blocks.delete(blockId)": "await editor.blocks.delete",
      "blocks.insert(type, data?)": "await editor.blocks.insert",
      "blocks.move(blockId, toIndex)": "await editor.blocks.move",
      "blocks.update(blockId, data)": "await editor.blocks.update",
      "caret.setToBlock(blockIndex, position?)":
        "await editor.caret.setToBlock",
      "caret.setToNextBlock()": "await editor.caret.setToNextBlock",
      "caret.setToPreviousBlock()": "await editor.caret.setToPreviousBlock",
      "on(event, callback)": "editor.on",
      "off(event, callback)": "editor.off",
      "emit(event, data)": "editor.emit",
      "saver.save()": "await editor.saver.save",
      "selection.findParentTag(tagName, class?)":
        "editor.selection.findParentTag",
      "selection.expandToTag(element)": "editor.selection.expandToTag",
      "styles.toggle(style)": "await editor.styles.toggle",
      "toolbar.close()": "editor.toolbar.close",
      "toolbar.open()": "editor.toolbar.open",
      "tools.available": "editor.tools.available",
    };

    API_SECTIONS.forEach((section) => {
      // The adapter surface reuses core method names (clear(), render(data))
      // but runs on the hook's api handle, not the editor instance — its
      // examples are asserted separately in the useBlocks describe below.
      if (section.id === "use-blocks") {
        return;
      }
      section.methods?.forEach((method) => {
        if (
          Object.prototype.hasOwnProperty.call(meaningfulExamples, method.name)
        ) {
          const expectedContent =
            meaningfulExamples[method.name as keyof typeof meaningfulExamples];
          expect(method.example).toContain(expectedContent);
        }
      });
    });
  });

  it("should have proper data structure for all sections", () => {
    API_SECTIONS.forEach((section) => {
      // Required fields
      expect(section.id).toBeDefined();
      expect(section.title).toBeDefined();

      // At least one of methods, properties, or table should exist
      const hasContent = Boolean(
        (section.methods && section.methods.length > 0) ||
        (section.properties && section.properties.length > 0) ||
        (section.table && section.table.length > 0) ||
        section.customType,
      );

      expect(hasContent).toBe(true);
    });
  });

  describe("Styles API", () => {
    it("documents the host customization CSS custom properties", () => {
      const stylesSection = API_SECTIONS.find((s) => s.id === "styles-api");
      expect(stylesSection).toBeDefined();

      // Public --blok-* hooks that let hosts customize layout and chrome
      // without targeting Blok internals via test IDs / data attributes.
      const example = stylesSection!.example ?? "";
      expect(example).toContain("--blok-content-max-width");
      expect(example).toContain("--blok-editor-gutter-start");
      expect(example).toContain("--blok-editor-gutter-end");
      expect(example).toContain("--blok-list-padding-start");
      expect(example).toContain("--blok-checklist-padding-start");
      expect(example).toContain("--blok-list-gap");
      expect(example).toContain("--blok-search-input-placeholder");
      expect(example).toContain("--blok-heading-1-font-size");
      expect(example).toContain("--blok-heading-font-weight");
      expect(example).toContain("--blok-heading-margin-top");
      expect(example).toContain("--blok-heading-margin-bottom");
      expect(example).toContain("--blok-embed-margin-top");
    });

    it("documents the zero-specificity theming, content-max-width authority, and readonly gutter facts", () => {
      const stylesSection = API_SECTIONS.find((s) => s.id === "styles-api");
      expect(stylesSection).toBeDefined();

      const description = stylesSection!.description ?? "";
      expect(description).toContain(":where()");
      expect(description).toContain("data-blok-readonly");
      expect(description.toLowerCase()).toContain("width='full'".toLowerCase());
      expect(description).toContain("style.contentAlign");
    });

    it("documents style.tokens as the primary theming method reaching body-mounted popovers", () => {
      const stylesSection = API_SECTIONS.find((s) => s.id === "styles-api");
      expect(stylesSection).toBeDefined();

      const description = stylesSection!.description ?? "";
      expect(description).toContain("style.tokens");

      const example = stylesSection!.example ?? "";
      expect(example).toContain("style: {");
      expect(example).toContain("tokens: {");
    });

    it("documents the gutter as an automatic default with an overridable token", () => {
      const stylesSection = API_SECTIONS.find((s) => s.id === "styles-api");
      expect(stylesSection).toBeDefined();

      const description = stylesSection!.description ?? "";
      expect(description).toContain("56px");
    });

    it("documents that style.tokens values are fixed across theme/read-only state and that gutter keys are ignored", () => {
      const stylesSection = API_SECTIONS.find((s) => s.id === "styles-api");
      expect(stylesSection).toBeDefined();

      const description = stylesSection!.description ?? "";
      expect(description).toContain("light and dark themes");
      expect(description).toContain("read-only state");
      expect(description).toContain("--blok-editor-gutter-*");
    });
  });

  describe("Blocks API", () => {
    it("should have all Blocks API methods documented", () => {
      const blocksSection = API_SECTIONS.find((s) => s.id === "blocks-api");
      expect(blocksSection).toBeDefined();

      const methodNames = blocksSection!.methods!.map((m) => m.name);

      // All methods from Blocks interface should be documented
      const expectedMethods = [
        "blocks.clear()",
        "blocks.render(data)",
        "blocks.renderFromHTML(data)",
        "blocks.delete(index?, setCaret?)",
        "blocks.move(toIndex, fromIndex?)",
        "blocks.getBlockByIndex(index)",
        "blocks.getById(id)",
        "blocks.getCurrentBlockIndex()",
        "blocks.getBlockIndex(blockId)",
        "blocks.getBlockByElement(element)",
        "blocks.getChildren(parentId)",
        "blocks.getBlocksCount()",
        "blocks.insert(type?, data?, config?, index?, needToFocus?, replace?, id?, tunes?)",
        "blocks.insertMany(blocks, index?)",
        "blocks.composeBlockData(toolName)",
        "blocks.update(id, data?, tunes?)",
        "blocks.convert(id, newType, dataOverrides?)",
        "blocks.splitBlock(currentBlockId, currentBlockData, newBlockType, newBlockData, insertIndex)",
      ];

      expectedMethods.forEach((method) => {
        expect(methodNames).toContain(method);
      });
    });

    it("should have examples for all Blocks API methods", () => {
      const blocksSection = API_SECTIONS.find((s) => s.id === "blocks-api");
      expect(blocksSection).toBeDefined();

      blocksSection!.methods!.forEach((method) => {
        expect(method.example).toBeDefined();
        expect(method.example!.trim().length).toBeGreaterThan(0);
        // Should demonstrate actual usage
        expect(method.example).toMatch(/editor\.blocks\./);
      });
    });
  });

  describe("Caret API", () => {
    it("should have all Caret API methods documented", () => {
      const caretSection = API_SECTIONS.find((s) => s.id === "caret-api");
      expect(caretSection).toBeDefined();

      const methodNames = caretSection!.methods!.map((m) => m.name);

      const expectedMethods = [
        "caret.setToFirstBlock(position?, offset?)",
        "caret.setToLastBlock(position?, offset?)",
        "caret.setToPreviousBlock(position?, offset?)",
        "caret.setToNextBlock(position?, offset?)",
        "caret.setToBlock(blockOrIdOrIndex, position?, offset?)",
        "caret.focus(atEnd?)",
        "caret.updateLastCaretAfterPosition()",
      ];

      expectedMethods.forEach((method) => {
        expect(methodNames).toContain(method);
      });
    });

    it("should have examples for all Caret API methods", () => {
      const caretSection = API_SECTIONS.find((s) => s.id === "caret-api");
      expect(caretSection).toBeDefined();

      caretSection!.methods!.forEach((method) => {
        expect(method.example).toBeDefined();
        expect(method.example!.trim().length).toBeGreaterThan(0);
        expect(method.example).toMatch(/editor\.caret\./);
      });
    });
  });

  describe("Selection API", () => {
    it("should have all Selection API methods documented", () => {
      const selectionSection = API_SECTIONS.find(
        (s) => s.id === "selection-api",
      );
      expect(selectionSection).toBeDefined();

      const methodNames = selectionSection!.methods!.map((m) => m.name);

      const expectedMethods = [
        "selection.findParentTag(tagName, className?)",
        "selection.expandToTag(node)",
        "selection.setFakeBackground()",
        "selection.removeFakeBackground()",
        "selection.clearFakeBackground()",
        "selection.save()",
        "selection.restore()",
      ];

      expectedMethods.forEach((method) => {
        expect(methodNames).toContain(method);
      });
    });

    it("should have examples for all Selection API methods", () => {
      const selectionSection = API_SECTIONS.find(
        (s) => s.id === "selection-api",
      );
      expect(selectionSection).toBeDefined();

      selectionSection!.methods!.forEach((method) => {
        expect(method.example).toBeDefined();
        expect(method.example!.trim().length).toBeGreaterThan(0);
        expect(method.example).toMatch(/editor\.selection\./);
      });
    });
  });

  describe("Toolbar API", () => {
    it("should have all Toolbar API methods documented", () => {
      const toolbarSection = API_SECTIONS.find((s) => s.id === "toolbar-api");
      expect(toolbarSection).toBeDefined();

      const methodNames = toolbarSection!.methods!.map((m) => m.name);

      const expectedMethods = [
        "toolbar.close(options?)",
        "toolbar.open()",
        "toolbar.toggleBlockSettings(openingState?, trigger?, options?)",
        "toolbar.toggleToolbox(openingState?)",
      ];

      expectedMethods.forEach((method) => {
        expect(methodNames).toContain(method);
      });
    });
  });

  describe("InlineToolbar API", () => {
    it("should have InlineToolbar API section", () => {
      const section = API_SECTIONS.find((s) => s.id === "inline-toolbar-api");
      expect(section).toBeDefined();
      expect(section!.methods).toBeDefined();
      expect(section!.methods!.length).toBeGreaterThan(0);
    });
  });

  describe("Notifier API", () => {
    it("should have Notifier API section", () => {
      const section = API_SECTIONS.find((s) => s.id === "notifier-api");
      expect(section).toBeDefined();
      expect(section!.methods).toBeDefined();
    });

    it("options.time is scoped to alert notifications, not 'all notification types'", () => {
      // src/components/utils/notifier/index.ts only auto-dismisses 'alert';
      // confirm/prompt ignore `time` and stay until resolved.
      const section = API_SECTIONS.find((s) => s.id === "notifier-api");
      const show = section?.methods?.find((m) => m.name === "notifier.show(options)");
      const timeParam = show?.params?.find((p) => p.name === "options.time");
      expect(timeParam).toBeDefined();
      expect(timeParam!.description).not.toContain("all notification types");
      expect(timeParam!.description.toLowerCase()).toContain("alert");
    });
  });

  describe("Sanitizer API", () => {
    it("should have Sanitizer API section", () => {
      const section = API_SECTIONS.find((s) => s.id === "sanitizer-api");
      expect(section).toBeDefined();
      expect(section!.methods).toBeDefined();
    });
  });

  describe("Tooltip API", () => {
    it("should have Tooltip API section", () => {
      const section = API_SECTIONS.find((s) => s.id === "tooltip-api");
      expect(section).toBeDefined();
      expect(section!.methods).toBeDefined();
    });
  });

  describe("ReadOnly API", () => {
    it("should have ReadOnly API section", () => {
      const section = API_SECTIONS.find((s) => s.id === "readonly-api");
      expect(section).toBeDefined();
      expect(section!.methods).toBeDefined();
    });

    it("readOnly.toggle carries no fabricated deprecation version", () => {
      // The @deprecated tag on readOnly.toggle (types/api/readonly.d.ts) has no
      // version, and 0.6.0 was never released — so no version may be claimed.
      const section = API_SECTIONS.find((s) => s.id === "readonly-api");
      const toggle = section?.methods?.find((m) => m.name === "readOnly.toggle(state?)");
      expect(toggle).toBeDefined();
      expect(toggle!.replacedBy).toBe("readOnly.set");
      expect(toggle!.deprecatedSince).toBeUndefined();
    });
  });

  describe("I18n API", () => {
    it("should have I18n API section", () => {
      const section = API_SECTIONS.find((s) => s.id === "i18n-api");
      expect(section).toBeDefined();
      expect(section!.methods).toBeDefined();
    });
  });

  describe("UI API", () => {
    it("should have UI API section", () => {
      const section = API_SECTIONS.find((s) => s.id === "ui-api");
      expect(section).toBeDefined();
      expect(section!.properties).toBeDefined();
    });
  });

  describe("Listeners API", () => {
    it("should have Listeners API section", () => {
      const section = API_SECTIONS.find((s) => s.id === "listeners-api");
      expect(section).toBeDefined();
      expect(section!.methods).toBeDefined();
    });
  });

  describe("History API", () => {
    it("should have all History API methods documented", () => {
      const historySection = API_SECTIONS.find((s) => s.id === "history-api");
      expect(historySection).toBeDefined();

      const methodNames = historySection!.methods!.map((m) => m.name);

      const expectedMethods = [
        "history.undo()",
        "history.redo()",
        "history.canUndo()",
        "history.canRedo()",
        "history.clear()",
      ];

      expectedMethods.forEach((method) => {
        expect(methodNames).toContain(method);
      });
    });

    it("should have examples for all History API methods", () => {
      const historySection = API_SECTIONS.find((s) => s.id === "history-api");
      expect(historySection).toBeDefined();

      historySection!.methods!.forEach((method) => {
        expect(method.example).toBeDefined();
        expect(method.example!.trim().length).toBeGreaterThan(0);
        expect(method.example).toMatch(/editor\.history\./);
      });
    });
  });

  describe("BlockAPI", () => {
    it("should have BlockAPI section", () => {
      const section = API_SECTIONS.find((s) => s.id === "block-api");
      expect(section).toBeDefined();
      expect(section!.methods || section!.properties).toBeDefined();
    });
  });

  describe("BlokEditor component (framework adapters)", () => {
    it("documents the key props as a table", () => {
      const section = API_SECTIONS.find((s) => s.id === "blok-editor");
      expect(section).toBeDefined();

      const options = section!.table!.map((row) => row.option);
      const expectedProps = [
        "tools",
        "data",
        "onSave",
        "onChange",
        "onReady",
        "deps",
        "readOnly",
        "theme",
        "width",
        "autofocus",
        "placeholder",
        "onBlocksRendered",
        "onBlockRendered",
      ];
      expectedProps.forEach((prop) => {
        expect(options).toContain(prop);
      });
    });

    it("deps row warns that tool-config functions do not belong in deps", () => {
      const section = API_SECTIONS.find((s) => s.id === "blok-editor");
      const depsRow = section!.table!.find((row) => row.option === "deps");
      expect(depsRow!.description).toMatch(/function/i);
    });

    it("has a usage example showing the controlled data + onSave pair", () => {
      const section = API_SECTIONS.find((s) => s.id === "blok-editor");
      expect(section!.example).toContain("<BlokEditor");
      expect(section!.example).toContain("onSave");
    });
  });

  describe("useBlocks (framework adapters)", () => {
    it("documents the block-tree API methods", () => {
      const section = API_SECTIONS.find((s) => s.id === "use-blocks");
      expect(section).toBeDefined();

      const methodNames = section!.methods!.map((m) => m.name);
      const expectedMethods = [
        "getById(id)",
        "getChildren(parentId)",
        "insert(spec?)",
        "insertMany(specs)",
        "insertTree(spec)",
        "insertMarkdown(markdown, options?)",
        "exportMarkdown()",
        "move(id, target)",
        "nest(id, parentId)",
        "unnest(id)",
        "remove(id)",
        "update(id, data?, tunes?)",
        "convert(id, newType, dataOverrides?, options?)",
        "transact(fn)",
        "transactWithoutCapture(fn)",
        "splitBlock(currentBlockId, currentBlockData, newBlockType, newBlockData, insertIndex)",
        "insertInsideParent(parentId, insertIndex, childData?)",
        "insertOutputData(blocks, options?)",
        "render(data)",
        "renderFromHTML(html)",
        "clear()",
        "getBlocksCount()",
        "getCurrentBlockIndex()",
        "getBlockByIndex(index)",
        "getBlockIndex(id)",
        "getBlockData(id)",
        "getBlockByElement(element)",
        "composeBlockData(toolName)",
        "isSyncingFromYjs()",
      ];
      expectedMethods.forEach((method) => {
        expect(methodNames).toContain(method);
      });
    });

    it("every useBlocks method example calls the hook's api handle", () => {
      const section = API_SECTIONS.find((s) => s.id === "use-blocks");
      section!.methods!.forEach((method) => {
        expect(method.example).toBeDefined();
        expect(method.example).toMatch(/blocks\./);
      });
    });
  });

  describe("high-traffic examples document expected output and failure handling", () => {
    // These 5 methods carry structured `errors` (so the failure modes are
    // covered there); the example itself should still show what success
    // looks like, and — where a call can fail in normal usage — show the
    // reader how to guard for it, not just the happy path.
    const findMethod = (sectionId: string, name: string) => {
      const section = API_SECTIONS.find((s) => s.id === sectionId);
      return section?.methods?.find((m) => m.name === name);
    };

    it("blocks.insert example shows the inserted block's id as output", () => {
      const method = findMethod(
        "blocks-api",
        "blocks.insert(type?, data?, config?, index?, needToFocus?, replace?, id?, tunes?)",
      );
      expect(method?.example).toMatch(/\/\/\s*→/);
    });

    it("blocks.update example shows a try/catch around the unknown-id failure mode", () => {
      const method = findMethod("blocks-api", "blocks.update(id, data?, tunes?)");
      expect(method?.example).toMatch(/try\s*{[\s\S]*catch/);
    });

    it("blocks.convert example shows a try/catch around the unsupported-conversion failure mode", () => {
      const method = findMethod("blocks-api", "blocks.convert(id, newType, dataOverrides?)");
      expect(method?.example).toMatch(/try\s*{[\s\S]*catch/);
    });

    it("notifier.show example shows expected output for the simple notification", () => {
      const method = findMethod("notifier-api", "notifier.show(options)");
      expect(method?.example).toMatch(/\/\/\s*→/);
    });

    it("caret.setToBlock example shows the boolean return value as output", () => {
      const method = findMethod(
        "caret-api",
        "caret.setToBlock(blockOrIdOrIndex, position?, offset?)",
      );
      expect(method?.example).toMatch(/\/\/\s*→/);
    });
  });

  describe("insertMany default index matches source", () => {
    // Root cause: docs described the pre-fix implementation. Source now defaults
    // the index to `blocks.length` (a true append past the flat tail), and
    // validateIndex throws only on `index < 0` — so the empty-editor default (0)
    // never errors. See src/components/modules/api/blocks.ts.
    const findInsertMany = () =>
      API_SECTIONS.find((s) => s.id === "blocks-api")?.methods?.find(
        (m) => m.name === "blocks.insertMany(blocks, index?)",
      );

    it("source still appends (default = blocks.length, throws only when < 0)", () => {
      const src = readSource("src/components/modules/api/blocks.ts");
      expect(src).toMatch(/index:\s*number\s*=\s*this\.Blok\.BlockManager\.blocks\.length/);
      expect(src).not.toMatch(/blocks\.length\s*-\s*1/);
      // validateIndex throws only for negatives — the append default (0 on an
      // empty editor) is always valid.
      expect(src).toMatch(/if\s*\(\s*index < 0\s*\)/);
    });

    it("docs describe an append, not 'before the last block', and claim no negative-default error", () => {
      const method = findInsertMany();
      expect(method).toBeDefined();
      const indexParam = method?.params?.find((p) => p.name === "index");
      expect(indexParam?.default).not.toBe("blocks.length - 1");
      expect(indexParam?.description).not.toMatch(/not an append/i);
      expect(method?.description).not.toMatch(/-1 \(an error\)/);
      expect(method?.description?.toLowerCase()).toMatch(/append|end of the document/);
      // The fabricated "the default index errors on an empty editor" claim must
      // be gone. Documenting a genuinely-passed negative index is still fine.
      const badError = method?.errors?.some((e) =>
        /empty editor|default/i.test(`${e.condition} ${e.message}`),
      );
      expect(badError ?? false).toBe(false);
    });
  });

  describe("notifier cancelHandler fires for prompt too", () => {
    // Root cause: docs claimed prompt() "never invokes" cancelHandler. Source
    // wires makeCancelHandler(cancelHandler, …) in BOTH confirm and prompt draw
    // paths. See src/components/utils/notifier/draw.ts.
    it("source wires cancelHandler in both confirm and prompt", () => {
      const src = readSource("src/components/utils/notifier/draw.ts");
      const wired = src.match(/makeCancelHandler\(\s*cancelHandler/g) ?? [];
      expect(wired.length).toBeGreaterThanOrEqual(2);
    });

    it("docs no longer claim prompt never invokes it", () => {
      const section = API_SECTIONS.find((s) => s.id === "notifier-api");
      const show = section?.methods?.find((m) => m.name === "notifier.show(options)");
      const cancelHandler = show?.params?.find((p) => p.name === "options.cancelHandler");
      expect(cancelHandler).toBeDefined();
      expect(cancelHandler!.description).not.toMatch(/never invokes/i);
      expect(cancelHandler!.description).not.toMatch(/confirm type only/i);
      expect(cancelHandler!.description.toLowerCase()).toContain("prompt");
    });
  });

  describe("block-data table covers every OutputBlockData field", () => {
    // Root cause: block-data was hand-authored and drifted from the real type.
    // Guard the WHOLE shape so future field additions can't silently go
    // undocumented. See types/data-formats/output-data.d.ts.
    it("every OutputBlockData field appears as a documented option", () => {
      const dts = readSource("types/data-formats/output-data.d.ts");
      // Skip the generic clause (<Type …, Data …>) up to the body's opening brace.
      const body = dts.match(/export interface OutputBlockData[\s\S]*?\{([\s\S]*?)\n\}/)?.[1] ?? "";
      const sourceFields = [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
      expect(sourceFields).toContain("lastEditedAt");
      expect(sourceFields).toContain("lastEditedBy");

      const table = API_SECTIONS.find((s) => s.id === "block-data")?.table ?? [];
      const documented = table.map((row) => row.option);
      for (const field of sourceFields) {
        expect(documented, `OutputBlockData.${field} is not documented in block-data table`).toContain(field);
      }
    });

    it("listItem example omits depth when it is 0 (source never serializes depth: 0)", () => {
      const listSave = readSource("src/tools/list/block-operations.ts");
      // depth is only written when effectiveDepth > 0, so a top-level item has no depth key.
      expect(listSave).toMatch(/effectiveDepth\s*>\s*0/);
      const example = API_SECTIONS.find((s) => s.id === "block-data")?.example ?? "";
      expect(example).not.toMatch(/"depth":\s*0/);
    });
  });
});

describe("docs accuracy against public type surface (root-cause guards)", () => {
  it("Blok Class properties table lists only real public members of the Blok class", () => {
    // Root cause: the properties table is hand-authored; every listed member must exist
    // on the public Blok class in types/index.d.ts, or a TS consumer copying `editor.<prop>`
    // gets "Property '<prop>' does not exist on type 'Blok'". Events are exposed via the
    // on/off/emit methods, not an `events` property.
    const dts = readSource("types/index.d.ts");
    const classBody = dts.match(/export class Blok \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const publicMembers = new Set(
      [...classBody.matchAll(/public\s+(?:readonly\s+)?(\w+)/g)].map((m) => m[1])
    );
    expect(publicMembers.size).toBeGreaterThan(0);
    const core = API_SECTIONS.find((s) => s.id === "core");
    for (const prop of core?.properties ?? []) {
      expect(
        publicMembers.has(prop.name),
        `Blok Class property "${prop.name}" is documented but is not a public member of the Blok class in types/index.d.ts`
      ).toBe(true);
    }
  });

  it("block.save() example only shows fields present on the public SavedData type", () => {
    // Root cause: block.save() is publicly typed Promise<void|SavedData>; the illustrated
    // object must not include fields absent from SavedData (types/data-formats/block-data.d.ts).
    // `tunes` exists at runtime but is not part of the public SavedData return type.
    const savedDataBody =
      readSource("types/data-formats/block-data.d.ts").match(
        /interface SavedData \{([\s\S]*?)\}/
      )?.[1] ?? "";
    const savedDataFields = new Set(
      [...savedDataBody.matchAll(/(\w+)\s*:/g)].map((m) => m[1])
    );
    expect(savedDataFields.has("id")).toBe(true);
    const saveMethod = API_SECTIONS.find((s) => s.id === "block-api")?.methods?.find(
      (m) => m.name === "block.save()"
    );
    const example = saveMethod?.example ?? "";
    if (!savedDataFields.has("tunes")) {
      expect(
        example,
        "block.save() example illustrates a `tunes` field, but the public SavedData return type has no tunes property"
      ).not.toContain("tunes");
    }
  });

  it("OutputData / OutputBlockData example ids match the real serialized block-id format", () => {
    // Root cause: these examples show what save() actually emits — 10-char nanoids per
    // BLOCK_ID_PATTERN, never a hand-written "block-" prefix.
    const patternSrc = readSource("src/components/utils/id-generator.ts").match(
      /BLOCK_ID_PATTERN\s*=\s*(\/[^;]+\/)/
    )?.[1];
    expect(patternSrc, "could not read BLOCK_ID_PATTERN from source").toBeTruthy();
    const blockIdPattern = new RegExp(patternSrc!.slice(1, -1));
    const sections = API_SECTIONS.filter(
      (s) => s.id === "output-data" || s.id === "block-data"
    );
    for (const s of sections) {
      const ids = [...(s.example ?? "").matchAll(/\bid"?\s*:\s*"([^"]+)"/g)].map(
        (m) => m[1]
      );
      expect(ids.length, `no example ids found in section "${s.id}"`).toBeGreaterThan(0);
      for (const id of ids) {
        expect(
          blockIdPattern.test(id),
          `Example block id "${id}" in section "${s.id}" does not match the real block-id format ${patternSrc}`
        ).toBe(true);
      }
    }
  });
});

describe("loose wire-shape input and OutputData utilities", () => {
  // Source of truth: types/data-formats/output-data.d.ts (LooseOutputData /
  // LooseOutputBlockData), src/shared/output-data.ts (equalsOutputData,
  // isEmptyOutputData, normalizeOutputBlocks), and the echo-safe
  // blocks.render() in src/components/modules/api/blocks.ts.
  const findSection = (id: string) => API_SECTIONS.find((s) => s.id === id);

  it("source still accepts the loose wire shape and normalizes it", () => {
    const dts = readSource("types/data-formats/output-data.d.ts");
    expect(dts).toContain("LooseOutputData");
    expect(dts).toContain("LooseOutputBlockData");
    const shared = readSource("src/shared/output-data.ts");
    expect(shared).toContain("export function equalsOutputData");
    expect(shared).toContain("export function isEmptyOutputData");
    expect(shared).toContain("export function normalizeOutputBlocks");
  });

  it("config `data` option documents the loose wire shape", () => {
    const row = findSection("config")?.table?.find((r) => r.option === "data");
    expect(row).toBeDefined();
    expect(row!.type).toContain("LooseOutputData");
    expect(row!.description).toMatch(/null/i);
  });

  it("blocks.render documents echo-safety and the loose input shape", () => {
    const method = findSection("blocks-api")?.methods?.find(
      (m) => m.name === "blocks.render(data)",
    );
    expect(method).toBeDefined();
    expect(method!.description).toMatch(/no-op/i);
    expect(method!.description).toMatch(/caret/i);
    expect(method!.description).toContain("LooseOutputData");
  });

  it("blocks.insertMany documents the loose block shape", () => {
    const method = findSection("blocks-api")?.methods?.find(
      (m) => m.name === "blocks.insertMany(blocks, index?)",
    );
    const blocksParam = method?.params?.find((p) => p.name === "blocks");
    expect(blocksParam).toBeDefined();
    expect(blocksParam!.type).toContain("LooseOutputBlockData");
  });

  it("core render(data) documents the loose input shape", () => {
    const method = findSection("core")?.methods?.find(
      (m) => m.name === "render(data)",
    );
    expect(method).toBeDefined();
    expect(method!.description).toContain("LooseOutputData");
  });

  it("core section documents the synchronous isRendered property", () => {
    const prop = findSection("core")?.properties?.find(
      (p) => p.name === "isRendered",
    );
    expect(prop).toBeDefined();
    expect(prop!.type).toBe("boolean");
    expect(prop!.description).toContain("data-blok-rendered");
  });

  it("output-data section documents equalsOutputData and isEmptyOutputData with examples", () => {
    const methods = findSection("output-data")?.methods ?? [];
    const names = methods.map((m) => m.name);
    expect(names).toContain("equalsOutputData(a, b)");
    expect(names).toContain("isEmptyOutputData(data)");
    for (const method of methods) {
      expect(method.example).toBeDefined();
      expect(method.example!).toContain("@bloklabs/core");
      expect(method.returnType).toBe("boolean");
    }
    const equals = methods.find((m) => m.name === "equalsOutputData(a, b)");
    // Equality ignores the volatile envelope fields — the load-bearing fact.
    expect(equals!.description).toMatch(/time/);
    expect(equals!.description).toMatch(/version/);
  });

  it("output-data section description mentions the loose input variant", () => {
    const section = findSection("output-data");
    expect(section?.description).toContain("LooseOutputData");
  });
});
