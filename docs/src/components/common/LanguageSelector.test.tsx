import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Locale } from '../../i18n';
import { I18nProvider } from '../../contexts/I18nContext';
import { LanguageSelector } from './LanguageSelector';

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <I18nProvider>{children}</I18nProvider>
  </MemoryRouter>
);

/** The locale lives in the URL, so a test picks a tree by rendering at a path. */
const renderAt = (path: string, locale: Locale) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider locale={locale}>
        <LanguageSelector />
      </I18nProvider>
    </MemoryRouter>,
  );

const openMenu = () => fireEvent.click(screen.getByRole('button', { expanded: false }));

type GtagWindow = Window & typeof globalThis & { gtag?: (...args: unknown[]) => void };

const gtagWindow = window as GtagWindow;

describe('LanguageSelector', () => {
  let gtagSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    gtagSpy = vi.fn();
    gtagWindow.gtag = gtagSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete gtagWindow.gtag;
  });

  it('should render language selector trigger', () => {
    render(<LanguageSelector />, { wrapper });

    const trigger = screen.getByRole('button', { expanded: false });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-label', 'Language: English');
  });

  it('should open dropdown when trigger is clicked', () => {
    render(<LanguageSelector />, { wrapper });
    
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);
    
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('Русский')).toBeInTheDocument();
  });

  it('should change locale when an option is selected', () => {
    render(<LanguageSelector />, { wrapper });
    
    // Open dropdown
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);
    
    // Select Russian
    const russianOption = screen.getByRole('menuitem', { name: /Русский/i });
    fireEvent.click(russianOption);
    
    // Verify locale changed
    expect(localStorage.getItem('blok-docs-locale')).toBe('ru');
  });

  it('should close dropdown when escape key is pressed', () => {
    render(<LanguageSelector />, { wrapper });
    
    // Open dropdown
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);
    
    expect(screen.getByRole('menu')).toBeInTheDocument();
    
    // Press Escape
    fireEvent.keyDown(document, { key: 'Escape' });
    
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('should close dropdown when clicking outside', () => {
    render(
      <div>
        <div data-blok-testid="outside">Outside</div>
        <LanguageSelector />
      </div>,
      { wrapper }
    );
    
    // Open dropdown
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);
    
    expect(screen.getByRole('menu')).toBeInTheDocument();
    
    // Click outside
    fireEvent.mouseDown(screen.getByTestId('outside'));
    
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('should mark current locale as current', () => {
    render(<LanguageSelector />, { wrapper });

    openMenu();

    expect(screen.getByRole('menuitem', { name: /English/i })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  describe('as crawlable links', () => {
    it('points each option at the same page in that locale', () => {
      renderAt('/docs/table', 'en');
      openMenu();

      expect(screen.getByRole('menuitem', { name: /English/i })).toHaveAttribute(
        'href',
        '/docs/table',
      );
      expect(screen.getByRole('menuitem', { name: /Русский/i })).toHaveAttribute(
        'href',
        '/ru/docs/table',
      );
    });

    it('points back out of the Russian tree from a Russian page', () => {
      renderAt('/ru/docs/table', 'ru');
      openMenu();

      expect(screen.getByRole('menuitem', { name: /English/i })).toHaveAttribute(
        'href',
        '/docs/table',
      );
    });

    it('declares the language of each target so the link is an hreflang signal', () => {
      renderAt('/', 'en');
      openMenu();

      expect(screen.getByRole('menuitem', { name: /Русский/i })).toHaveAttribute('hreflang', 'ru');
      expect(screen.getByRole('menuitem', { name: /Русский/i })).toHaveAttribute('href', '/ru');
    });
  });

  describe('analytics', () => {
    it('should track the newly selected locale', () => {
      render(<LanguageSelector />, { wrapper });

      fireEvent.click(screen.getByRole('button', { expanded: false }));
      fireEvent.click(screen.getByRole('menuitem', { name: /Русский/i }));

      expect(gtagSpy).toHaveBeenCalledWith('event', 'select_language', {
        locale: 'ru',
      });
    });

    it('should not track when the already active locale is re-selected', () => {
      render(<LanguageSelector />, { wrapper });

      fireEvent.click(screen.getByRole('button', { expanded: false }));
      fireEvent.click(screen.getByRole('menuitem', { name: /English/i }));

      expect(gtagSpy).not.toHaveBeenCalled();
    });
  });
});
