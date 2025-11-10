import { createEditorWithTextBlocks } from '../../support/utils/createEditorWithTextBlocks';
import { EDITOR_SELECTOR } from '../../support/constants';

describe('inputs [data-empty] mark', () => {
  it('should be added to inputs of editor on initialization', () => {
    createEditorWithTextBlocks([
      'First', // not empty block
      '', // empty block
    ]);

    cy.get(EDITOR_SELECTOR)
      .find('.ce-paragraph')
      .first()
      .should('have.attr', 'data-empty', 'false');

    cy.get(EDITOR_SELECTOR)
      .find('.ce-paragraph')
      .last()
      .should('have.attr', 'data-empty', 'true');
  });

  it('should be added as "false" to the input on typing', () => {
    createEditorWithTextBlocks([
      'First', // not empty block
      '', // empty block
    ]);

    cy.get(EDITOR_SELECTOR)
      .find('.ce-paragraph')
      .last()
      .type('Some text');

    cy.get(EDITOR_SELECTOR)
      .find('.ce-paragraph')
      .last()
      .should('have.attr', 'data-empty', 'false');
  });

  it('should be added as "true" to the input on chars removal', () => {
    createEditorWithTextBlocks([
      '', // empty block
      'Some text', // not empty block
    ]);

    cy.get(EDITOR_SELECTOR)
      .find('.ce-paragraph')
      .last()
      .type('{selectall}{backspace}');

    cy.get(EDITOR_SELECTOR)
      .find('.ce-paragraph')
      .last()
      .should('have.attr', 'data-empty', 'true');
  });

  it('should be added to the new block inputs', () => {
    createEditorWithTextBlocks([
      'First', // not empty block
      '', // empty block
    ]);

    cy.get(EDITOR_SELECTOR)
      .find('.ce-paragraph')
      .last()
      .type('{enter}');

    cy.get(EDITOR_SELECTOR)
      .find('.ce-paragraph')
      .last()
      .should('have.attr', 'data-empty', 'true');
  });
});
