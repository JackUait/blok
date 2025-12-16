import { afterEach, describe, expect, it, vi } from 'vitest';

type DictionaryMock = Record<string, string>;
type FlatNamespaceMap = Record<string, string>;

const modulePath = '../../../../src/components/i18n/namespace-internal';
const dictionaryPath = '../../../../src/components/i18n/locales/en/messages.json';

const loadNamespaces = async (dictionary?: DictionaryMock): Promise<FlatNamespaceMap> => {
  vi.resetModules();

  if (!dictionary) {
    const moduleExports = await import(modulePath);

    return moduleExports.I18nInternalNS as FlatNamespaceMap;
  }

  vi.doMock(dictionaryPath, () => ({
    default: dictionary,
  }));

  try {
    const moduleExports = await import(modulePath);

    return moduleExports.I18nInternalNS as FlatNamespaceMap;
  } finally {
    vi.doUnmock(dictionaryPath);
  }
};

describe('namespace-internal', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('maps each flat key to itself', async () => {
    const namespaces = await loadNamespaces({
      'ui.toolbar.toolbox.Add': '',
      'ui.toolbar.toolbox.Remove': '',
    });

    expect(namespaces['ui.toolbar.toolbox.Add']).toBe('ui.toolbar.toolbox.Add');
    expect(namespaces['ui.toolbar.toolbox.Remove']).toBe('ui.toolbar.toolbox.Remove');
  });

  it('includes all keys from the dictionary', async () => {
    const namespaces = await loadNamespaces({
      'ui.toolbar.actions.Add': '',
      'ui.toolbar.nested.converter.Convert to': '',
      'toolNames.Text': '',
    });

    expect(Object.keys(namespaces)).toHaveLength(3);
    expect(namespaces).toHaveProperty('ui.toolbar.actions.Add');
    expect(namespaces).toHaveProperty('ui.toolbar.nested.converter.Convert to');
    expect(namespaces).toHaveProperty('toolNames.Text');
  });

  it('provides type-safe access to all translation keys', async () => {
    const namespaces = await loadNamespaces({
      'ui.popover.Search': '',
      'toolNames.Bold': '',
    });

    // Each key maps to itself for use with I18n.ui() and I18n.t()
    expect(namespaces['ui.popover.Search']).toBe('ui.popover.Search');
    expect(namespaces['toolNames.Bold']).toBe('toolNames.Bold');
  });

  it('generates namespaces for the default dictionary', async () => {
    const namespaces = await loadNamespaces();

    // Verify some keys from the default dictionary exist and map to themselves
    expect(namespaces['ui.blockTunes.toggler.dragToMove']).toBe('ui.blockTunes.toggler.dragToMove');
    expect(namespaces['toolNames.text']).toBe('toolNames.text');
    expect(namespaces['ui.popover.search']).toBe('ui.popover.search');
  });
});
