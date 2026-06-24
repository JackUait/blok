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
    expect(within(stats).getByText('25+')).toBeInTheDocument();
    expect(within(stats).getByText('1,800+')).toBeInTheDocument();
  });

  it('should offer the contact tile beside the company card, not inside it', () => {
    renderTrustedBy();
    const featured = screen.getByTestId('trusted-featured');
    const contact = screen.getByTestId('trusted-contact');
    expect(featured).not.toContainElement(contact);
  });

  it('should let companies reach the team on Telegram', () => {
    renderTrustedBy();
    const contact = screen.getByTestId('trusted-contact');
    const telegram = within(contact).getByRole('link', { name: /telegram/i });
    expect(telegram).toHaveAttribute('href', 'https://t.me/jackuait');
    // External destination — must open safely in a new tab.
    expect(telegram).toHaveAttribute('target', '_blank');
    expect(telegram).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('should let companies reach the team by email', () => {
    renderTrustedBy();
    const contact = screen.getByTestId('trusted-contact');
    const email = within(contact).getByRole('link', { name: /email/i });
    expect(email).toHaveAttribute('href', expect.stringMatching(/^mailto:jackuait@gmail\.com/));
  });

  it('should resolve every contact string (no raw i18n keys leak through)', () => {
    // The channel labels happen to contain "telegram"/"email", so a missing
    // translation would still satisfy the role queries above — guard explicitly
    // that no unresolved `home.trusted.*` key is rendered.
    renderTrustedBy();
    const contact = screen.getByTestId('trusted-contact');
    expect(contact.textContent).not.toMatch(/home\.trusted/);
  });

  it('should tell companies the team helps set up and adapt the editor', () => {
    renderTrustedBy();
    const contactTile = screen.getByTestId('trusted-contact');
    expect(within(contactTile).getByText(/help you set (it|blok) up/i)).toBeInTheDocument();
  });

  it('should render Russian strings when locale is ru', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    renderTrustedBy();
    expect(
      screen.getByRole('heading', { name: /Компании, которые нам доверяют/i })
    ).toBeInTheDocument();
  });
});
