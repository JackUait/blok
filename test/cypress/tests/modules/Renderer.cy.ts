import ToolMock, { type MockToolData } from '../../fixtures/tools/ToolMock';
import type EditorJS from '../../../../types/index';
import type { BlockToolConstructorOptions } from '../../../../types';

describe('Renderer module', () => {
  it('should not cause onChange firing during initial rendering', () => {
    const config = {
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'some text',
            },
          },
          {
            type: 'paragraph',
            data: {
              text: 'some other text',
            },
          },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      onChange: () => {},
    };

    cy.createEditor(config)
      .as('editorInstance');

    cy.spy(config, 'onChange').as('onChange');

    cy.get('@onChange').should('not.be.called');
  });

  it('should show Stub block if block tool is not registered', () => {
    cy.createEditor({
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'some text',
            },
          },
          {
            type: 'non-existing tool',
            data: {},
          },
          {
            type: 'paragraph',
            data: {
              text: 'some other text',
            },
          },
        ],
      },
    })
      .as('editorInstance');

    cy.get('[data-cy=editorjs]')
      .find('.ce-block')
      .should('have.length', 3);

    cy.get('[data-cy=editorjs]')
      .find('.ce-block')
      .each(($el, index) => {
        /**
         * Check that the second block is stub
         */
        if (index === 1) {
          cy.wrap($el)
            .find('.ce-stub')
            .should('have.length', 1);

          /**
           * Tool title displayed
           */
          cy.wrap($el)
            .find('.ce-stub__title')
            .should('have.text', 'non-existing tool');
        }
      });
  });

  it('should show Stub block if block tool throws error during construction', () => {
    /**
     * Mock of tool that triggers error during construction
     */
    class ToolWithError extends ToolMock {
      /**
       * @param options - tool options
       */
      constructor(options: BlockToolConstructorOptions<MockToolData>) {
        super(options);
        throw new Error('Tool error');
      }
    }

    cy.createEditor({
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'some text',
            },
          },
          {
            type: 'failedTool',
            data: {},
          },
          {
            type: 'paragraph',
            data: {
              text: 'some other text',
            },
          },
        ],
      },
      tools: {
        failedTool: ToolWithError,
      },
    })
      .as('editorInstance');

    cy.get('[data-cy=editorjs]')
      .find('.ce-block')
      .should('have.length', 3);

    cy.get('[data-cy=editorjs]')
      .find('.ce-block')
      .each(($el, index) => {
        /**
         * Check that the second block is stub
         */
        if (index === 1) {
          cy.wrap($el)
            .find('.ce-stub')
            .should('have.length', 1);

          /**
           * Tool title displayed
           */
          cy.wrap($el)
            .find('.ce-stub__title')
            .should('have.text', 'failedTool');
        }
      });
  });

  it('should insert default empty block when [] passed as data.blocks', () => {
    cy.createEditor({
      data: {
        blocks: [],
      },
    })
      .as('editorInstance');

    cy.get('[data-cy=editorjs]')
      .find('.ce-block')
      .should('have.length', 1);
  });

  it('should insert default empty block when [] passed via blocks.render() API', () => {
    cy.createEditor({})
      .as('editorInstance');

    cy.get<EditorJS>('@editorInstance')
      .then((editor) => {
        return editor.blocks.render({
          blocks: [],
        });
      });

    cy.get('[data-cy=editorjs]')
      .find('.ce-block')
      .should('have.length', 1);
  });
});
