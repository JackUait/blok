import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import I18n from '../../../../src/components/i18n';
import defaultDictionary from '../../../../src/components/i18n/locales/en/messages.json';
import type { I18nDictionary } from '../../../../types/configs';

const createDictionary = (): I18nDictionary => ({
  ui: {
    toolbar: {
      toolbox: {
        'Click to add below': 'Cliquez pour ajouter ci-dessous',
        'Option-click to add above': 'Option-clic pour ajouter ci-dessus',
      },
    },
  },
  tools: {
    link: {
      'Add a link': 'Ajouter un lien',
    },
  },
});

const alternativeDictionary: I18nDictionary = {
  tools: {
    link: {
      'Add a link': 'Lien secondaire',
    },
  },
};

describe('I18n', () => {
  beforeEach(() => {
    I18n.setDictionary(defaultDictionary as I18nDictionary);
  });

  afterEach(() => {
    I18n.setDictionary(defaultDictionary as I18nDictionary);
  });

  it('translates internal namespaces via ui()', () => {
    const dictionary = createDictionary();

    I18n.setDictionary(dictionary);

    expect(I18n.ui('ui.toolbar.toolbox', 'Click to add below')).toBe('Cliquez pour ajouter ci-dessous');
  });

  it('translates external namespaces via t()', () => {
    const dictionary = createDictionary();

    I18n.setDictionary(dictionary);

    expect(I18n.t('tools.link', 'Add a link')).toBe('Ajouter un lien');
  });

  it('returns the original key when namespace is missing', () => {
    const dictionary = createDictionary();

    I18n.setDictionary(dictionary);

    expect(I18n.t('missing.namespace', 'Fallback text')).toBe('Fallback text');
  });

  it('returns the original key when translation is missing inside namespace', () => {
    const dictionary = createDictionary();

    I18n.setDictionary(dictionary);

    expect(I18n.t('tools.link', 'Missing label')).toBe('Missing label');
  });

  it('allows overriding dictionary via setDictionary()', () => {
    const firstDictionary = createDictionary();

    I18n.setDictionary(firstDictionary);
    expect(I18n.t('tools.link', 'Add a link')).toBe('Ajouter un lien');

    I18n.setDictionary(alternativeDictionary);
    expect(I18n.t('tools.link', 'Add a link')).toBe('Lien secondaire');
  });
});
