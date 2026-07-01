import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../../contexts/I18nContext';

// Regression test for the /demo page crash caused by a stale dist/ build:
// dynamic import of /dist/react.mjs resolved successfully but the bundle
// predated the BlokEditor export, so React threw an uncaught
// "Element type is invalid" error instead of showing the editor's own
// "Failed to load" UI. assertEditorModulesComplete() should catch this
// before it ever reaches render.
describe('EditorWrapper against a stale /dist bundle', () => {
  afterEach(() => {
    vi.doUnmock('/dist/react.mjs');
  });

  it('shows "Failed to load editor" instead of crashing when the react bundle lacks BlokEditor', async () => {
    vi.doMock('/dist/react.mjs', () => ({
      BlokContent: () => null,
      useBlok: () => ({}),
      // BlokEditor intentionally absent, simulating a build from before it existed
    }));

    const { EditorWrapper } = await import('./EditorWrapper');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <I18nProvider>
        <EditorWrapper />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Failed to load editor')).toBeInTheDocument();
    });
    expect(screen.getByText(/BlokEditor/)).toBeInTheDocument();

    consoleSpy.mockRestore();
  });
});
