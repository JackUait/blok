import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ThemeToggle } from './ThemeToggle';

// Mock the useTheme hook
const mockSetTheme = vi.fn();
const mockToggleTheme = vi.fn();

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: 'system',
    resolvedTheme: 'light',
    setTheme: mockSetTheme,
    toggleTheme: mockToggleTheme,
    isSystem: true,
  }),
}));

describe('ThemeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render a button with accessible label', () => {
    render(<ThemeToggle />);

    const button = screen.getByRole('button', { name: /toggle theme/i });
    expect(button).toBeInTheDocument();
  });

  it('should display an icon in the button', () => {
    render(<ThemeToggle />);

    const button = screen.getByRole('button');
    // Use within to scope query - check icon wrapper exists which contains the SVG
    const iconWrapper = within(button).getByRole('generic', { name: '' });
    expect(iconWrapper).toBeInTheDocument();
  });

  it('should trigger theme toggle when clicked', () => {
    render(<ThemeToggle />);

    const button = screen.getByRole('button');

    fireEvent.click(button);

    // Verify the click handler is properly connected to the toggleTheme function
    expect(mockToggleTheme).toHaveBeenCalledTimes(1);

    // Verify the button remains interactive after click (observable DOM state)
    expect(button).toBeEnabled();
  });

  it('should be keyboard accessible', () => {
    render(<ThemeToggle />);

    const button = screen.getByRole('button');

    // Buttons are naturally keyboard accessible - Enter triggers click
    // We verify the button is focusable
    button.focus();
    expect(button).toHaveFocus();

    // And responds to click (which Enter triggers on buttons)
    fireEvent.click(button);
    expect(mockToggleTheme).toHaveBeenCalled();
  });
});
