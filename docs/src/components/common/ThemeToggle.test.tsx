import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ThemeToggle } from './ThemeToggle';

const { mockToggleTheme } = vi.hoisted(() => ({
  mockToggleTheme: vi.fn(),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: vi.fn(() => ({
    theme: 'light' as const,
    resolvedTheme: 'light' as const,
    setTheme: vi.fn(),
    toggleTheme: mockToggleTheme,
  })),
}));

// Import after mock
import { useTheme } from '@/hooks/useTheme';

describe('ThemeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('basic rendering', () => {
    it('should render a button with accessible label', () => {
      render(<ThemeToggle />);

      const button = screen.getByRole('button', { name: /toggle theme/i });
      expect(button).toBeInTheDocument();
    });

    it('should display an icon in the button', () => {
      render(<ThemeToggle />);

      const button = screen.getByRole('button');
      const iconWrapper = within(button).getByRole('generic', { name: '' });
      expect(iconWrapper).toBeInTheDocument();
    });

    it('should be keyboard accessible', () => {
      render(<ThemeToggle />);

      const button = screen.getByRole('button');
      button.focus();
      expect(button).toHaveFocus();

      fireEvent.click(button);
      expect(mockToggleTheme).toHaveBeenCalled();
    });
  });

  describe('theme change interaction', () => {
    it('should trigger theme toggle when clicked', () => {
      render(<ThemeToggle />);

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(mockToggleTheme).toHaveBeenCalledTimes(1);
      expect(button).toBeEnabled();
    });
  });

  describe('icon display based on theme', () => {
    it('should show sun icon when theme is light', () => {
      vi.mocked(useTheme).mockReturnValue({
        theme: 'light' as const,
        resolvedTheme: 'light' as const,
        setTheme: vi.fn(),
        toggleTheme: vi.fn(),
      });

      render(<ThemeToggle />);

      const button = screen.getByRole('button', { name: /light theme/i });
      expect(button).toBeInTheDocument();

      // Check for sun icon via its title attribute
      expect(button).toHaveAttribute('title', 'Light theme');
    });

    it('should show moon icon when theme is dark', () => {
      vi.mocked(useTheme).mockReturnValue({
        theme: 'dark' as const,
        resolvedTheme: 'dark' as const,
        setTheme: vi.fn(),
        toggleTheme: vi.fn(),
      });

      render(<ThemeToggle />);

      const button = screen.getByRole('button', { name: /dark theme/i });
      expect(button).toBeInTheDocument();

      expect(button).toHaveAttribute('title', 'Dark theme');
    });
  });
});
