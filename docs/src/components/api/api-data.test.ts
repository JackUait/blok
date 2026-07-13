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
