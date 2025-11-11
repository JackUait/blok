/**
 * This file is processed and
 * loaded automatically before the test files.
 *
 * This is a great place to put global configuration and
 * behavior that modifies Cypress.
 */

import '@cypress/code-coverage/support';
import installLogsCollector from 'cypress-terminal-report/src/installLogsCollector';
import 'cypress-plugin-tab';

installLogsCollector();

/**
 * File with the helpful commands
 */
import './commands';

/**
 * Test constants
 */
export { EDITOR_INTERFACE_SELECTOR } from '../../../src/components/constants';

/**
 * File with custom assertions
 */
import './e2e';

import chaiSubset from 'chai-subset';

/**
 * "containSubset" object properties matcher
 */
// eslint-disable-next-line no-undef
chai.use(chaiSubset);

/**
 * Before-each hook for the cypress tests
 */
beforeEach((): void => {
  cy.visit('test/cypress/fixtures/test.html');
});
