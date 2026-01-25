import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Logo } from './Logo';

describe('Logo', () => {
  it('should render an img element', () => {
    const { container } = render(<Logo />);
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
  });

  it('should use the default size of 32 when no size is provided', () => {
    const { container } = render(<Logo />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('width')).toBe('32');
    expect(img.getAttribute('height')).toBe('32');
  });

  it('should use the provided size prop', () => {
    const { container } = render(<Logo size={48} />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('width')).toBe('48');
    expect(img.getAttribute('height')).toBe('48');
  });

  it('should use the provided className', () => {
    const { container } = render(<Logo className="custom-class" />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('class')).toContain('custom-class');
  });

  it('should have proper alt text for accessibility', () => {
    const { container } = render(<Logo />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('alt')).toBe('Blok');
  });

  it('should use the mascot image source', () => {
    const { container } = render(<Logo />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/mascot.png');
  });
});
