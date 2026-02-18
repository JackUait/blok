import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nProvider } from '../../contexts/I18nContext';
import { LanguageSelector } from './LanguageSelector';

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider>{children}</I18nProvider>
);

describe('LanguageSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
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
    
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('Русский')).toBeInTheDocument();
  });

  it('should change locale when an option is selected', () => {
    render(<LanguageSelector />, { wrapper });
    
    // Open dropdown
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);
    
    // Select Russian
    const russianOption = screen.getByRole('option', { name: /Русский/i });
    fireEvent.click(russianOption);
    
    // Verify locale changed
    expect(localStorage.getItem('blok-docs-locale')).toBe('ru');
  });

  it('should close dropdown when escape key is pressed', () => {
    render(<LanguageSelector />, { wrapper });
    
    // Open dropdown
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);
    
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    
    // Press Escape
    fireEvent.keyDown(document, { key: 'Escape' });
    
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
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
    
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    
    // Click outside
    fireEvent.mouseDown(screen.getByTestId('outside'));
    
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('should mark current locale as selected', () => {
    render(<LanguageSelector />, { wrapper });
    
    // Open dropdown
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);
    
    const englishOption = screen.getByRole('option', { name: /English/i });
    expect(englishOption).toHaveAttribute('aria-selected', 'true');
  });
});
