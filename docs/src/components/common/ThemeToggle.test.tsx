import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    // The button should contain an SVG (system icon when theme is 'system')
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('should call toggleTheme when clicked', () => {
    render(<ThemeToggle />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(mockToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('should be keyboard accessible', () => {
    render(<ThemeToggle />);

    const button = screen.getByRole('button');
    
    // Buttons are naturally keyboard accessible - Enter triggers click
    // We verify the button is focusable
    button.focus();
    expect(document.activeElement).toBe(button);
    
    // And responds to click (which Enter triggers on buttons)
    fireEvent.click(button);
    expect(mockToggleTheme).toHaveBeenCalled();
  });
});
