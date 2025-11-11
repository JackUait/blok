import { EDITOR_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

describe('Slash keydown', () => {
  describe('pressed in empty block', () => {
    it('should add "/" in a block and open Toolbox', () => {
      cy.createEditor({
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: '',
              },
            },
          ],
        },
      });

      cy.get(EDITOR_INTERFACE_SELECTOR)
        .find('.ce-paragraph')
        .click()
        .type('/');

      /**
       * Block content should contain slash
       */
      cy.get(EDITOR_INTERFACE_SELECTOR)
        .find('.ce-paragraph')
        .invoke('text')
        .should('eq', '/');

      cy.get('[data-cy="toolbox"] .ce-popover__container')
        .should('be.visible');
    });

    [
      'ctrl',
      'cmd',
    ].forEach((key) => {
      it(`should not open Toolbox if Slash pressed with ${key}`, () => {
        cy.createEditor({
          data: {
            blocks: [
              {
                type: 'paragraph',
                data: {
                  text: '',
                },
              },
            ],
          },
        });

        cy.get(EDITOR_INTERFACE_SELECTOR)
          .find('.ce-paragraph')
          .click()
          .type(`{${key}}/`);

        cy.get('[data-cy="toolbox"] .ce-popover__container')
          .should('not.be.visible');
      });
    });
  });

  describe('pressed in non-empty block', () => {
    it('should not open Toolbox and just add the / char', () => {
      cy.createEditor({
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Hello',
              },
            },
          ],
        },
      });

      cy.get(EDITOR_INTERFACE_SELECTOR)
        .find('.ce-paragraph')
        .click()
        .type('/');

      cy.get('[data-cy="toolbox"] .ce-popover__container')
        .should('not.be.visible');

      /**
       * Block content should contain slash
       */
      cy.get(EDITOR_INTERFACE_SELECTOR)
        .find('.ce-paragraph')
        .invoke('text')
        .should('eq', 'Hello/');
    });
  });

  describe('pressed outside editor', () => {
    it('should not modify any text outside editor when text block is selected', () => {
      cy.createEditor({
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: '',
              },
            },
          ],
        },
      });

      cy.document().then((doc) => {
        const title = doc.querySelector('h1');

        if (title) {
          title.setAttribute('data-cy', 'page-title');
        }
      });

      // Step 1
      // Click on the plus button and select the text option
      cy.get(EDITOR_INTERFACE_SELECTOR)
        .find('.ce-paragraph')
        .click();
      cy.get(EDITOR_INTERFACE_SELECTOR)
        .find('.ce-toolbar__plus')
        .click({ force: true });
      cy.get('[data-cy="toolbox"] .ce-popover__container')
        .contains('Text')
        .click();

      // Step 2
      // Select the 'Editor.js test page' text
      cy.get('[data-cy=page-title]')
        .invoke('attr', 'contenteditable', 'true')
        .click()
        .type('{selectall}')
        .invoke('removeAttr', 'contenteditable');

      // Step 3
      // Press the Slash key
      cy.get('[data-cy=page-title]')
        .trigger('keydown', { key: '/',
          code: 'Slash',
          which: 191 });

      cy.get('[data-cy=page-title]').should('have.text', 'Editor.js test page');
    });
  });
});

describe('CMD+Slash keydown', () => {
  it('should open Block Tunes', () => {
    cy.createEditor({
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: '',
            },
          },
        ],
      },
    });

    cy.get(EDITOR_INTERFACE_SELECTOR)
      .find('.ce-paragraph')
      .click()
      .type('{cmd}/');

    cy.get('[data-cy="block-tunes"] .ce-popover__container')
      .should('be.visible');
  });
});
