import * as _ from '../../../src/components/utils';
import { EDITOR_INTERFACE_SELECTOR } from '../../../src/components/constants';

describe('Blocks selection', () => {
  beforeEach(() => {
    cy.createEditor({}).as('editorInstance');
  });

  afterEach(function () {
    if (this.editorInstance != null) {
      this.editorInstance.destroy();
    }
  });

  it('should remove block selection on click', () => {
    cy.get(EDITOR_INTERFACE_SELECTOR)
      .find('div.ce-block')
      .click()
      .type('First block{enter}');

    cy.get(EDITOR_INTERFACE_SELECTOR)
      .find('div.ce-block')
      .next()
      .type('Second block')
      .type('{movetostart}')
      .trigger('keydown', {
        shiftKey: true,
        keyCode: _.keyCodes.UP,
      });

    cy.get(EDITOR_INTERFACE_SELECTOR)
      .click()
      .find('div.ce-block')
      .should('not.have.class', '.ce-block--selected');
  });
});
