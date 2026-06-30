import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { I18nProvider } from '../../contexts/I18nContext';
import { FrameworkProvider } from '../../contexts/FrameworkContext';
import { FrameworkToggle } from '../common/FrameworkToggle';
import { EditorAccessNote } from './EditorAccessNote';

vi.mock('../common/CodeBlock', () => ({
  CodeBlock: ({ code }: { code: string }) => (
    <pre data-blok-testid="code">{code}</pre>
  ),
}));

const Providers = ({ children }: { children: ReactNode }) => (
  <I18nProvider>
    <FrameworkProvider>{children}</FrameworkProvider>
  </I18nProvider>
);

describe('EditorAccessNote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('shows the vanilla access snippet by default', () => {
    render(
      <Providers>
        <EditorAccessNote />
      </Providers>,
    );

    const note = screen.getByTestId('editor-access-note');
    expect(within(note).getByTestId('code')).toHaveTextContent('new Blok(');
  });

  it('swaps the snippet when the framework changes', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <FrameworkToggle />
        <EditorAccessNote />
      </Providers>,
    );

    await user.click(screen.getByRole('button', { name: /Vue/i }));

    const note = screen.getByTestId('editor-access-note');
    expect(within(note).getByTestId('code')).toHaveTextContent('editor.value');
  });
});
