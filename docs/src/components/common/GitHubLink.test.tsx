import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GitHubLink } from './GitHubLink';
import { I18nProvider } from '../../contexts/I18nContext';

const renderLink = () =>
  render(
    <I18nProvider>
      <GitHubLink />
    </I18nProvider>
  );

describe('GitHubLink', () => {
  it('renders an external link to the repository', () => {
    renderLink();

    const link = screen.getByRole('link', { name: 'GitHub' });
    expect(link).toHaveAttribute('href', 'https://github.com/JackUait/blok');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
