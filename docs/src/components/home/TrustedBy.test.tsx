import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TrustedBy } from './TrustedBy';
import { I18nProvider } from '../../contexts/I18nContext';

const renderTrustedBy = () =>
  render(
    <I18nProvider>
      <MemoryRouter>
        <TrustedBy />
      </MemoryRouter>
    </I18nProvider>
  );

describe('TrustedBy', () => {
  afterEach(() => {
    localStorage.removeItem('blok-docs-locale');
  });

  it('should render a labelled section', () => {
    renderTrustedBy();
    expect(screen.getByTestId('trusted-section')).toBeInTheDocument();
  });

  it('should render the "Companies that trust us" heading', () => {
    renderTrustedBy();
    expect(
      screen.getByRole('heading', { name: /Companies that trust us/i })
    ).toBeInTheDocument();
  });

  it('should feature the Dodo Brands logo', () => {
    renderTrustedBy();
    const card = screen.getByTestId('trusted-featured');
    expect(within(card).getByRole('img', { name: /Dodo Brands/i })).toBeInTheDocument();
  });

  it('should render the proof statistics', () => {
    renderTrustedBy();
    const stats = screen.getByTestId('trusted-stats');
    // Two quantified proof points back the trust claim.
    expect(within(stats).getAllByRole('listitem')).toHaveLength(2);
  });

  it('should expose each stat value as accessible text', () => {
    // The odometer splits the number into per-digit rolling strips, so the full
    // value must stay readable as a single accessible string for screen readers.
    renderTrustedBy();
    const stats = screen.getByTestId('trusted-stats');
    expect(within(stats).getByText('20+')).toBeInTheDocument();
    expect(within(stats).getByText('1,800+')).toBeInTheDocument();
  });

  it('should render Russian strings when locale is ru', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    renderTrustedBy();
    expect(
      screen.getByRole('heading', { name: /Компании, которые нам доверяют/i })
    ).toBeInTheDocument();
  });
});
