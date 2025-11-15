import { afterEach, describe, expect, it, vi } from 'vitest';

type DictionaryMock = Record<string, unknown>;
type NamespaceTree = Record<string, string | Record<string, string | Record<string, string | Record<string, string>>>>;

const modulePath = '../../../../src/components/i18n/namespace-internal';
const dictionaryPath = '../../../../src/components/i18n/locales/en/messages.json';

const loadNamespaces = async (dictionary?: DictionaryMock): Promise<NamespaceTree> => {
  vi.resetModules();

  if (!dictionary) {
    const moduleExports = await import(modulePath);

    return moduleExports.I18nInternalNS as NamespaceTree;
  }

  vi.doMock(dictionaryPath, () => ({
    default: dictionary,
  }));

  try {
    const moduleExports = await import(modulePath);

    return moduleExports.I18nInternalNS as NamespaceTree;
  } finally {
    vi.doUnmock(dictionaryPath);
  }
};

describe('namespace-internal', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('flattens last-level sections to namespace paths', async () => {
    const namespaces = await loadNamespaces({
      ui: {
        toolbar: {
          toolbox: {
            Add: '',
            Remove: '',
          },
        },
      },
    });

    expect(((namespaces.ui as Record<string, unknown>).toolbar as Record<string, unknown>).toolbox).toBe('ui.toolbar.toolbox');
  });

  it('retains nested objects for intermediate sections', async () => {
    const namespaces = await loadNamespaces({
      ui: {
        toolbar: {
          actions: {
            Add: '',
          },
          nested: {
            converter: {
              'Convert to': '',
            },
          },
        },
      },
    });

    const ui = namespaces.ui as Record<string, unknown>;

    expect(typeof ui.toolbar).toBe('object');
    expect(((ui.toolbar as Record<string, unknown>).nested as Record<string, unknown>).converter).toBe('ui.toolbar.nested.converter');
  });

  it('keeps primitive values untouched when section is not an object', async () => {
    const namespaces = await loadNamespaces({
      plain: 'value',
    });

    expect(namespaces.plain).toBe('value');
  });

  it('generates namespaces for the default dictionary', async () => {
    const namespaces = await loadNamespaces();

    expect(((namespaces.ui as Record<string, unknown>).blockTunes as Record<string, unknown>).toggler).toBe('ui.blockTunes.toggler');
    expect(namespaces.toolNames).toBe('toolNames');
  });
});
