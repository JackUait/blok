import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { WhyBlok } from './WhyBlok';
import { I18nProvider } from '../../contexts/I18nContext';

const renderTable = () =>
  render(
    <I18nProvider>
      <WhyBlok />
    </I18nProvider>
  );

describe('WhyBlok', () => {
  afterEach(() => {
    localStorage.removeItem('blok-docs-locale');
  });

  it('renders the section', () => {
    renderTable();
    expect(screen.getByTestId('why-blok-section')).toBeInTheDocument();
  });

  it('renders a heading', () => {
    renderTable();
    expect(screen.getByRole('heading', { name: /why blok/i })).toBeInTheDocument();
  });

  it('renders a comparison table', () => {
    renderTable();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('lists Blok alongside the alternatives as column headers', () => {
    renderTable();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Blok')).toBeInTheDocument();
    expect(within(table).getByText('Editor.js')).toBeInTheDocument();
    expect(within(table).getByText('TipTap')).toBeInTheDocument();
    expect(within(table).getByText('Lexical')).toBeInTheDocument();
  });

  it('includes the headline differentiators as rows', () => {
    renderTable();
    const table = screen.getByRole('table');
    expect(within(table).getByText(/everything is a block/i)).toBeInTheDocument();
    expect(within(table).getByText(/slash/i)).toBeInTheDocument();
    // "Typed JSON" is Blok's output-format value.
    expect(within(table).getByText(/typed json/i)).toBeInTheDocument();
  });

  it('renders a fairness disclaimer', () => {
    renderTable();
    expect(screen.getByText(/out-of-the-box defaults/i)).toBeInTheDocument();
  });

  it('renders Russian copy when locale is ru', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    renderTable();
    expect(screen.getByTestId('why-blok-section')).toBeInTheDocument();
    // Competitor names stay literal across locales.
    expect(screen.getByText('Editor.js')).toBeInTheDocument();
  });
});
