import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Logo } from './Logo';

describe('Logo', () => {
  it('should render an img element', () => {
    render(<Logo />);
    const img = screen.getByRole('img');
    expect(img).toBeInTheDocument();
  });

  it('should use the default size of 32 when no size is provided', () => {
    render(<Logo />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('width', '32');
    expect(img).toHaveAttribute('height', '32');
  });

  it('should use the provided size prop', () => {
    render(<Logo size={48} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('width', '48');
    expect(img).toHaveAttribute('height', '48');
  });

  it('should have the testid attribute for identification', () => {
    render(<Logo />);
    const img = screen.getByTestId('logo');
    expect(img).toBeInTheDocument();
  });

  it('should have proper alt text for accessibility', () => {
    render(<Logo />);
    const img = screen.getByRole('img', { name: 'Blok' });
    expect(img).toBeInTheDocument();
  });

  it('should use the mascot image source', () => {
    render(<Logo />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', '/mascot.png');
  });
});
