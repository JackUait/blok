import { describe, it, expect } from 'vitest';
import { API_SECTIONS, ApiSection } from './api-data';

describe('API_SECTIONS', () => {
  it('should have all defined sections', () => {
    const expectedSectionIds = [
      'quick-start',
      'core',
      'config',
      'blocks-api',
      'block-api',
      'caret-api',
      'events-api',
      'saver-api',
      'selection-api',
      'styles-api',
      'toolbar-api',
      'inline-toolbar-api',
      'notifier-api',
      'sanitizer-api',
      'tooltip-api',
      'readonly-api',
      'i18n-api',
      'ui-api',
      'listeners-api',
      'tools-api',
      'output-data',
      'block-data',
    ];

    const actualIds = API_SECTIONS.map((s) => s.id);
    expect(actualIds).toEqual(expectedSectionIds);
  });

  it('should have all methods with examples', () => {
    API_SECTIONS.forEach((section) => {
      // Skip quick-start and config sections as they have custom rendering
      if (section.id === 'quick-start' || section.id === 'config') {
        return;
      }

      section.methods?.forEach((method) => {
        expect(method.example).toBeDefined();
        expect(method.example?.trim().length).toBeGreaterThan(0);
      });
    });
  });

  it('should have meaningful examples for methods', () => {
    const meaningfulExamples = {
      'save()': 'await',
      'render(data)': 'await',
      'focus(atEnd?)': 'editor.focus',
      'clear()': 'editor.clear',
      'destroy()': 'editor.destroy',
      'blocks.delete(blockId)': 'await editor.blocks.delete',
      'blocks.insert(type, data?)': 'await editor.blocks.insert',
      'blocks.move(blockId, toIndex)': 'await editor.blocks.move',
      'blocks.update(blockId, data)': 'await editor.blocks.update',
      'caret.setToBlock(blockIndex, position?)': 'await editor.caret.setToBlock',
      'caret.setToNextBlock()': 'await editor.caret.setToNextBlock',
      'caret.setToPreviousBlock()': 'await editor.caret.setToPreviousBlock',
      'on(event, callback)': 'editor.on',
      'off(event, callback)': 'editor.off',
      'emit(event, data)': 'editor.emit',
      'saver.save()': 'await editor.saver.save',
      'selection.findParentTag(tagName, class?)': 'editor.selection.findParentTag',
      'selection.expandToTag(element)': 'editor.selection.expandToTag',
      'styles.toggle(style)': 'await editor.styles.toggle',
      'toolbar.close()': 'editor.toolbar.close',
      'toolbar.open()': 'editor.toolbar.open',
      'tools.available': 'editor.tools.available',
    };

    API_SECTIONS.forEach((section) => {
      section.methods?.forEach((method) => {
        if (Object.prototype.hasOwnProperty.call(meaningfulExamples, method.name)) {
          const expectedContent = meaningfulExamples[method.name as keyof typeof meaningfulExamples];
          expect(method.example).toContain(expectedContent);
        }
      });
    });
  });

  it('should have proper data structure for all sections', () => {
    API_SECTIONS.forEach((section) => {
      // Required fields
      expect(section.id).toBeDefined();
      expect(section.title).toBeDefined();

      // At least one of methods, properties, or table should exist
      const hasContent = Boolean(
        (section.methods && section.methods.length > 0) ||
          (section.properties && section.properties.length > 0) ||
          (section.table && section.table.length > 0) ||
          section.customType
      );

      expect(hasContent).toBe(true);
    });
  });

  describe('Blocks API', () => {
    it('should have all Blocks API methods documented', () => {
      const blocksSection = API_SECTIONS.find((s) => s.id === 'blocks-api');
      expect(blocksSection).toBeDefined();

      const methodNames = blocksSection!.methods!.map((m) => m.name);

      // All methods from Blocks interface should be documented
      const expectedMethods = [
        'blocks.clear()',
        'blocks.render(data)',
        'blocks.renderFromHTML(data)',
        'blocks.delete(index?)',
        'blocks.move(toIndex, fromIndex?)',
        'blocks.getBlockByIndex(index)',
        'blocks.getById(id)',
        'blocks.getCurrentBlockIndex()',
        'blocks.getBlockIndex(blockId)',
        'blocks.getBlockByElement(element)',
        'blocks.getChildren(parentId)',
        'blocks.getBlocksCount()',
        'blocks.insert(type?, data?, config?, index?, needToFocus?, replace?, id?)',
        'blocks.insertMany(blocks, index?)',
        'blocks.composeBlockData(toolName)',
        'blocks.update(id, data?, tunes?)',
        'blocks.convert(id, newType, dataOverrides?)',
        'blocks.splitBlock(currentBlockId, currentBlockData, newBlockType, newBlockData, insertIndex)',
      ];

      expectedMethods.forEach((method) => {
        expect(methodNames).toContain(method);
      });
    });

    it('should have examples for all Blocks API methods', () => {
      const blocksSection = API_SECTIONS.find((s) => s.id === 'blocks-api');
      expect(blocksSection).toBeDefined();

      blocksSection!.methods!.forEach((method) => {
        expect(method.example).toBeDefined();
        expect(method.example!.trim().length).toBeGreaterThan(0);
        // Should demonstrate actual usage
        expect(method.example).toMatch(/editor\.blocks\./);
      });
    });
  });

  describe('Caret API', () => {
    it('should have all Caret API methods documented', () => {
      const caretSection = API_SECTIONS.find((s) => s.id === 'caret-api');
      expect(caretSection).toBeDefined();

      const methodNames = caretSection!.methods!.map((m) => m.name);

      const expectedMethods = [
        'caret.setToFirstBlock(position?, offset?)',
        'caret.setToLastBlock(position?, offset?)',
        'caret.setToPreviousBlock(position?, offset?)',
        'caret.setToNextBlock(position?, offset?)',
        'caret.setToBlock(blockOrIdOrIndex, position?, offset?)',
        'caret.focus(atEnd?)',
        'caret.updateLastCaretAfterPosition()',
      ];

      expectedMethods.forEach((method) => {
        expect(methodNames).toContain(method);
      });
    });

    it('should have examples for all Caret API methods', () => {
      const caretSection = API_SECTIONS.find((s) => s.id === 'caret-api');
      expect(caretSection).toBeDefined();

      caretSection!.methods!.forEach((method) => {
        expect(method.example).toBeDefined();
        expect(method.example!.trim().length).toBeGreaterThan(0);
        expect(method.example).toMatch(/editor\.caret\./);
      });
    });
  });

  describe('Selection API', () => {
    it('should have all Selection API methods documented', () => {
      const selectionSection = API_SECTIONS.find((s) => s.id === 'selection-api');
      expect(selectionSection).toBeDefined();

      const methodNames = selectionSection!.methods!.map((m) => m.name);

      const expectedMethods = [
        'selection.findParentTag(tagName, className?)',
        'selection.expandToTag(node)',
        'selection.setFakeBackground()',
        'selection.removeFakeBackground()',
        'selection.clearFakeBackground()',
        'selection.save()',
        'selection.restore()',
      ];

      expectedMethods.forEach((method) => {
        expect(methodNames).toContain(method);
      });
    });

    it('should have examples for all Selection API methods', () => {
      const selectionSection = API_SECTIONS.find((s) => s.id === 'selection-api');
      expect(selectionSection).toBeDefined();

      selectionSection!.methods!.forEach((method) => {
        expect(method.example).toBeDefined();
        expect(method.example!.trim().length).toBeGreaterThan(0);
        expect(method.example).toMatch(/editor\.selection\./);
      });
    });
  });

  describe('Toolbar API', () => {
    it('should have all Toolbar API methods documented', () => {
      const toolbarSection = API_SECTIONS.find((s) => s.id === 'toolbar-api');
      expect(toolbarSection).toBeDefined();

      const methodNames = toolbarSection!.methods!.map((m) => m.name);

      const expectedMethods = [
        'toolbar.close(options?)',
        'toolbar.open()',
        'toolbar.toggleBlockSettings(openingState?)',
        'toolbar.toggleToolbox(openingState?)',
      ];

      expectedMethods.forEach((method) => {
        expect(methodNames).toContain(method);
      });
    });
  });

  describe('InlineToolbar API', () => {
    it('should have InlineToolbar API section', () => {
      const section = API_SECTIONS.find((s) => s.id === 'inline-toolbar-api');
      expect(section).toBeDefined();
      expect(section!.methods).toBeDefined();
      expect(section!.methods!.length).toBeGreaterThan(0);
    });
  });

  describe('Notifier API', () => {
    it('should have Notifier API section', () => {
      const section = API_SECTIONS.find((s) => s.id === 'notifier-api');
      expect(section).toBeDefined();
      expect(section!.methods).toBeDefined();
    });
  });

  describe('Sanitizer API', () => {
    it('should have Sanitizer API section', () => {
      const section = API_SECTIONS.find((s) => s.id === 'sanitizer-api');
      expect(section).toBeDefined();
      expect(section!.methods).toBeDefined();
    });
  });

  describe('Tooltip API', () => {
    it('should have Tooltip API section', () => {
      const section = API_SECTIONS.find((s) => s.id === 'tooltip-api');
      expect(section).toBeDefined();
      expect(section!.methods).toBeDefined();
    });
  });

  describe('ReadOnly API', () => {
    it('should have ReadOnly API section', () => {
      const section = API_SECTIONS.find((s) => s.id === 'readonly-api');
      expect(section).toBeDefined();
      expect(section!.methods).toBeDefined();
    });
  });

  describe('I18n API', () => {
    it('should have I18n API section', () => {
      const section = API_SECTIONS.find((s) => s.id === 'i18n-api');
      expect(section).toBeDefined();
      expect(section!.methods).toBeDefined();
    });
  });

  describe('UI API', () => {
    it('should have UI API section', () => {
      const section = API_SECTIONS.find((s) => s.id === 'ui-api');
      expect(section).toBeDefined();
      expect(section!.properties).toBeDefined();
    });
  });

  describe('Listeners API', () => {
    it('should have Listeners API section', () => {
      const section = API_SECTIONS.find((s) => s.id === 'listeners-api');
      expect(section).toBeDefined();
      expect(section!.methods).toBeDefined();
    });
  });

  describe('BlockAPI', () => {
    it('should have BlockAPI section', () => {
      const section = API_SECTIONS.find((s) => s.id === 'block-api');
      expect(section).toBeDefined();
      expect(section!.methods || section!.properties).toBeDefined();
    });
  });
});
