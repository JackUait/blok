import { selectionChangeDebounceTimeout } from '../../../../src/components/constants';
import Header from '@editorjs/header';
import type { ConversionConfig, ToolboxConfig } from '../../../../types';
import type { MenuConfig } from '../../../../types/tools';
import { ToolWithoutConversionExport } from '../../fixtures/tools/ToolWithoutConversionExport';
import { EDITOR_SELECTOR } from '../../support/constants';

describe('BlockTunes', () => {
  describe('Keyboard only', () => {
    it('should not delete the currently selected block when Enter pressed on a search input (or any block tune)', () => {
      const ENTER_KEY_CODE = 13;

      cy.createEditor({
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Some text',
              },
            },
          ],
        },
      });

      cy.get(EDITOR_SELECTOR)
        .find('.ce-paragraph')
        .click()
        .type('{cmd}/')
        .wait(selectionChangeDebounceTimeout)
        .keydown(ENTER_KEY_CODE);

      /**
       * Block should have same text
       */
      cy.get('[data-cy="block-wrapper"')
        .should('have.text', 'Some text');
    });

    it('should not unselect currently selected block when Enter pressed on a block tune', () => {
      const ENTER_KEY_CODE = 13;

      cy.createEditor({
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Some text',
              },
            },
          ],
        },
      });

      cy.get(EDITOR_SELECTOR)
        .find('.ce-paragraph')
        .click()
        .type('{cmd}/')
        .wait(selectionChangeDebounceTimeout)
        .keydown(ENTER_KEY_CODE);

      /**
       * Block should not be selected
       */
      cy.get('[data-cy="block-wrapper"')
        .first()
        .should('have.class', 'ce-block--selected');
    });
  });

  describe('Convert to', () => {
    it('should display Convert to inside Block Tunes', () => {
      cy.createEditor({
        tools: {
          header: Header,
        },
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Some text',
              },
            },
          ],
        },
      });

      /** Open block tunes menu */
      cy.get(EDITOR_SELECTOR)
        .get('.cdx-block')
        .click();

      cy.get(EDITOR_SELECTOR)
        .get('.ce-toolbar__settings-btn')
        .click();

      /** Check "Convert to" option is present  */
      cy.get(EDITOR_SELECTOR)
        .get('.ce-popover-item')
        .contains('Convert to')
        .should('exist');

      /** Click "Convert to" option*/
      cy.get(EDITOR_SELECTOR)
        .get('.ce-popover-item')
        .contains('Convert to')
        .click();

      /** Check connected popover with the "Heading" option is present */
      cy.get(EDITOR_SELECTOR)
        .get('.ce-popover--nested [data-item-name=header]')
        .should('exist');
    });

    it('should not display Convert to inside Block Tunes if there is nothing to convert to', () => {
      /** Editor instance with single default tool */
      cy.createEditor({
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Some text',
              },
            },
          ],
        },
      });

      /** Open block tunes menu */
      cy.get(EDITOR_SELECTOR)
        .get('.cdx-block')
        .click();

      cy.get(EDITOR_SELECTOR)
        .get('.ce-toolbar__settings-btn')
        .click();

      /** Check "Convert to" option is not present  */
      cy.get(EDITOR_SELECTOR)
        .get('.ce-popover-item')
        .contains('Convert to')
        .should('not.exist');
    });

    it('should not display the ConvertTo control if block has no conversionConfig.export specified', () => {
      cy.createEditor({
        tools: {
          testTool: ToolWithoutConversionExport,
        },
        data: {
          blocks: [
            {
              type: 'testTool',
              data: {
                text: 'Some text',
              },
            },
          ],
        },
      }).as('editorInstance');

      cy.get('@editorInstance')
        .get(EDITOR_SELECTOR)
        .find('.ce-block')
        .click();

      cy.get('@editorInstance')
        .get(EDITOR_SELECTOR)
        .find('.ce-toolbar__settings-btn')
        .click();

      cy.get('@editorInstance')
        .get(EDITOR_SELECTOR)
        .find('.ce-popover-item[data-item-name=convert-to]')
        .should('not.exist');
    });

    it('should not display tool with the same data in "Convert to" menu', () => {
      /**
       * Tool with several toolbox entries configured
       */
      class TestTool {
        /**
         * Tool is convertable
         */
        public static get conversionConfig(): ConversionConfig {
          return {
            import: 'text',
            export: 'text',
          };
        }

        /**
         * TestTool contains several toolbox options
         */
        public static get toolbox(): ToolboxConfig {
          return [
            {
              title: 'Title 1',
              icon: 'Icon1',
              data: {
                level: 1,
              },
            },
            {
              title: 'Title 2',
              icon: 'Icon2',
              data: {
                level: 2,
              },
            },
          ];
        }

        /**
         * Tool can render itself
         */
        public render(): HTMLDivElement {
          const div = document.createElement('div');

          div.innerText = 'Some text';

          return div;
        }

        /**
         * Tool can save it's data
         */
        public save(): { text: string; level: number } {
          return {
            text: 'Some text',
            level: 1,
          };
        }
      }

      /** Editor instance with TestTool installed and one block of TestTool type */
      cy.createEditor({
        tools: {
          testTool: TestTool,
        },
        data: {
          blocks: [
            {
              type: 'testTool',
              data: {
                text: 'Some text',
                level: 1,
              },
            },
          ],
        },
      });

      /** Open block tunes menu */
      cy.get(EDITOR_SELECTOR)
        .get('.ce-block')
        .click();

      cy.get(EDITOR_SELECTOR)
        .get('.ce-toolbar__settings-btn')
        .click();

      /** Open "Convert to" menu  */
      cy.get(EDITOR_SELECTOR)
        .get('.ce-popover-item')
        .contains('Convert to')
        .click();

      /** Check TestTool option with SAME data is NOT present */
      cy.get(EDITOR_SELECTOR)
        .get('.ce-popover--nested [data-item-name=testTool]')
        .contains('Title 1')
        .should('not.exist');

      /** Check TestTool option with DIFFERENT data IS present */
      cy.get(EDITOR_SELECTOR)
        .get('.ce-popover--nested [data-item-name=testTool]')
        .contains('Title 2')
        .should('exist');
    });

    it('should convert block to another type and set caret to the new block', () => {
      cy.createEditor({
        tools: {
          header: Header,
        },
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Some text',
              },
            },
          ],
        },
      });

      /** Open block tunes menu */
      cy.get(EDITOR_SELECTOR)
        .get('.cdx-block')
        .click();

      cy.get(EDITOR_SELECTOR)
        .get('.ce-toolbar__settings-btn')
        .click();

      /** Click "Convert to" option*/
      cy.get(EDITOR_SELECTOR)
        .get('.ce-popover-item')
        .contains('Convert to')
        .click();

      /** Click "Heading" option */
      cy.get(EDITOR_SELECTOR)
        .get('.ce-popover--nested [data-item-name=header]')
        .click();

      /** Check the block was converted to the second option */
      cy.get(EDITOR_SELECTOR)
        .get('.ce-header')
        .should('have.text', 'Some text');

      /** Check that caret set to the end of the new block */
      cy.window()
        .then((window) => {
          const selection = window.getSelection();
          const range = selection?.getRangeAt(0);

          if (!range) {
            throw new Error('Range is undefined');
          }

          cy.get(EDITOR_SELECTOR)
            .find('.ce-header')
            .should(($block) => {
              expect($block[0].contains(range.startContainer)).to.be.true;
            });
        });
    });
  });

  describe('Tunes order', () => {
    it('should display block specific tunes before common tunes', () => {
      /**
       * Tool with several toolbox entries configured
       */
      class TestTool {
        /**
         * TestTool contains several toolbox options
         */
        public static get toolbox(): ToolboxConfig {
          return [
            {
              title: 'Title 1',
              icon: 'Icon1',
              data: {
                level: 1,
              },
            },
          ];
        }

        /**
         * Tool can render itself
         */
        public render(): HTMLDivElement {
          const div = document.createElement('div');

          div.innerText = 'Some text';

          return div;
        }

        /**
         *
         */
        public renderSettings(): MenuConfig {
          return {
            icon: 'Icon',
            title: 'Tune',
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            onActivate: () => {},
          };
        }

        /**
         * Tool can save it's data
         */
        public save(): { text: string; level: number } {
          return {
            text: 'Some text',
            level: 1,
          };
        }
      }

      /** Editor instance with TestTool installed and one block of TestTool type */
      cy.createEditor({
        tools: {
          testTool: TestTool,
        },
        data: {
          blocks: [
            {
              type: 'testTool',
              data: {
                text: 'Some text',
                level: 1,
              },
            },
          ],
        },
      });

      /** Open block tunes menu */
      cy.get(EDITOR_SELECTOR)
        .get('.ce-block')
        .click();

      cy.get(EDITOR_SELECTOR)
        .get('.ce-toolbar__settings-btn')
        .click();

      /** Check there are more than 1 tune */
      cy.get(EDITOR_SELECTOR)
        .get('.ce-popover-item')
        .should('have.length.above', 1);

      /** Check the first tune is tool specific tune */
      cy.get(EDITOR_SELECTOR)
        .get('.ce-popover-item:first-child')
        .contains('Tune')
        .should('exist');
    });
  });
});
