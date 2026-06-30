import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TutorialContent } from './TutorialContent';
import { I18nProvider } from '../../contexts/I18nContext';

const renderTutorial = () =>
  render(
    <I18nProvider>
      <TutorialContent />
    </I18nProvider>,
  );

describe('TutorialContent', () => {
  it('walks through the numbered first-editor steps', () => {
    renderTutorial();
    expect(screen.getByText('Mount the editor')).toBeInTheDocument();
    expect(screen.getByText('Save it to JSON')).toBeInTheDocument();
    expect(screen.getByText('Load it back')).toBeInTheDocument();
    expect(screen.getByText('Add a tool')).toBeInTheDocument();
  });

  it('shows the save/render round-trip in code', () => {
    const { container } = renderTutorial();
    const code = container.textContent ?? '';
    expect(code).toContain('new Blok');
    expect(code).toContain('editor.save()');
    expect(code).toContain('editor.render(');
  });

  it('points onward to the custom-tool how-to and the concepts page', () => {
    renderTutorial();
    // \s tolerates the non-breaking spaces Typo glues after short words ("a"/"is").
    expect(
      screen.getByRole('link', { name: /Create\sa\scustom\sblock\stool/ }),
    ).toHaveAttribute('href', '#custom-block-tool');
    expect(
      screen.getByRole('link', { name: /Everything\sis\sa\sblock/ }),
    ).toHaveAttribute('href', '#concepts');
  });
});
