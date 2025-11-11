import Header from '@editorjs/header';
import type { InlineTool, InlineToolConstructorOptions, MenuConfig, ToolConstructable } from '../../../../types/tools';
import { createEditorWithTextBlocks } from '../../support/utils/createEditorWithTextBlocks';
import { EDITOR_INTERFACE_SELECTOR } from '../../../../src/components/constants';

describe('Inline Toolbar', () => {
  describe('Separators', () => {
    it('should have a separator after the first item if it has children', () => {
      cy.createEditor({
        tools: {
          header: {
            class: Header as unknown as ToolConstructable,
          },
        },
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'First block text',
              },
            },
          ],
        },
      });

      /** Open Inline Toolbar */
      cy.get(EDITOR_INTERFACE_SELECTOR)
        .find('.ce-paragraph')
        .selectText('block');

      /** Check that first item (which is convert-to and has children) has a separator after it */
      cy.get(EDITOR_INTERFACE_SELECTOR)
        .get('[data-cy=inline-toolbar] .ce-popover__items')
        .children()
        .first()
        .should('have.attr', 'data-item-name', 'convert-to');

      cy.get(EDITOR_INTERFACE_SELECTOR)
        .get('[data-cy=inline-toolbar] .ce-popover__items')
        .children()
        .eq(1)
        .should('have.class', 'ce-popover-item-separator');
    });

    it('should have separators from both sides of item if it is in the middle and has children', () => {
      cy.createEditor({
        tools: {
          header: {
            class: Header as unknown as ToolConstructable,
            inlineToolbar: ['bold', 'testTool', 'link'],

          },
          testTool: {
            class: class TestTool {
              public static isInline = true;
              // eslint-disable-next-line jsdoc/require-jsdoc
              constructor(_config: InlineToolConstructorOptions) {
                // Constructor required by InlineToolConstructable
              }
              // eslint-disable-next-line jsdoc/require-jsdoc
              public render(): MenuConfig {
                return {
                  icon: 'n',
                  title: 'Test Tool',
                  name: 'test-tool',
                  children: {
                    items: [
                      {
                        icon: 'm',
                        title: 'Test Tool Item',
                        // eslint-disable-next-line  @typescript-eslint/no-empty-function
                        onActivate: () => {},
                      },
                    ],
                  },
                };
              }
            } as unknown as ToolConstructable,
          },
        },
        data: {
          blocks: [
            {
              type: 'header',
              data: {
                text: 'First block text',
              },
            },
          ],
        },
      });

      /** Open Inline Toolbar */
      cy.get(EDITOR_INTERFACE_SELECTOR)
        .find('.ce-header')
        .selectText('block');

      /** Check that item with children is surrounded by separators */
      cy.get(EDITOR_INTERFACE_SELECTOR)
        .get('[data-cy=inline-toolbar] .ce-popover__items')
        .children()
        .eq(3)
        .should('have.class', 'ce-popover-item-separator');

      cy.get(EDITOR_INTERFACE_SELECTOR)
        .get('[data-cy=inline-toolbar] .ce-popover__items')
        .children()
        .eq(4)
        .should('have.attr', 'data-item-name', 'test-tool');

      cy.get(EDITOR_INTERFACE_SELECTOR)
        .get('[data-cy=inline-toolbar] .ce-popover__items')
        .children()
        .eq(5)
        .should('have.class', 'ce-popover-item-separator');
    });

    it('should have separator before the item with children if it is the last of all items', () => {
      cy.createEditor({
        tools: {
          header: {
            class: Header as unknown as ToolConstructable,
            inlineToolbar: ['bold', 'testTool'],

          },
          testTool: {
            class: class TestTool {
              public static isInline = true;
              // eslint-disable-next-line jsdoc/require-jsdoc
              constructor(_config: InlineToolConstructorOptions) {
                // Constructor required by InlineToolConstructable
              }
              // eslint-disable-next-line jsdoc/require-jsdoc
              public render(): MenuConfig {
                return {
                  icon: 'n',
                  title: 'Test Tool',
                  name: 'test-tool',
                  children: {
                    items: [
                      {
                        icon: 'm',
                        title: 'Test Tool Item',
                        // eslint-disable-next-line  @typescript-eslint/no-empty-function
                        onActivate: () => {},
                      },
                    ],
                  },
                };
              }
            } as unknown as ToolConstructable,
          },
        },
        data: {
          blocks: [
            {
              type: 'header',
              data: {
                text: 'First block text',
              },
            },
          ],
        },
      });

      /** Open Inline Toolbar */
      cy.get(EDITOR_INTERFACE_SELECTOR)
        .find('.ce-header')
        .selectText('block');

      /** Check that item with children is surrounded by separators */
      cy.get(EDITOR_INTERFACE_SELECTOR)
        .get('[data-cy=inline-toolbar] .ce-popover__items')
        .children()
        .eq(3)
        .should('have.class', 'ce-popover-item-separator');

      cy.get(EDITOR_INTERFACE_SELECTOR)
        .get('[data-cy=inline-toolbar] .ce-popover__items')
        .children()
        .eq(4)
        .should('have.attr', 'data-item-name', 'test-tool');
    });
  });

  describe('Shortcuts', () => {
    it('should work in read-only mode', () => {
      const toolSurround = cy.stub().as('toolSurround');

      /* eslint-disable jsdoc/require-jsdoc */
      class Marker implements InlineTool {
        public static isInline = true;
        public static shortcut = 'CMD+SHIFT+M';
        public static isReadOnlySupported = true;
        public render(): MenuConfig {
          return {
            icon: 'm',
            title: 'Marker',
            onActivate: () => {
              toolSurround();
            },
          };
        }
      }
      /* eslint-enable jsdoc/require-jsdoc */

      createEditorWithTextBlocks([
        'some text',
      ], {
        tools: {
          marker: Marker,
        },
        readOnly: true,
      });

      cy.get(EDITOR_INTERFACE_SELECTOR)
        .find('.ce-paragraph')
        .selectText('text');

      cy.wait(300);

      cy.document().then((doc) => {
        doc.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'M',
          code: 'KeyM',
          keyCode: 77,
          which: 77,
          metaKey: true,
          shiftKey: true,
        }));
      });

      cy.get('@toolSurround').should('have.been.called');
    });
  });
});

