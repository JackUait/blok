import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Logo } from './Logo';

describe('Logo', () => {
  it('should render an SVG element', () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should use the default size of 32 when no size is provided', () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('width')).toBe('32');
    expect(svg.getAttribute('height')).toBe('32');
  });

  it('should use the provided size prop', () => {
    const { container } = render(<Logo size={48} />);
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('width')).toBe('48');
    expect(svg.getAttribute('height')).toBe('48');
  });

  it('should use the provided className', () => {
    const { container } = render(<Logo className="custom-class" />);
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('class')).toContain('custom-class');
  });

  it('should have a viewBox attribute', () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('viewBox')).toBe('0 0 128 128');
  });

  it('should have fill set to none', () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('fill')).toBe('none');
  });

  it('should contain a defs element with linearGradient', () => {
    const { container } = render(<Logo />);
    const defs = container.querySelector('defs');
    const gradient = container.querySelector('linearGradient');
    expect(defs).toBeInTheDocument();
    expect(gradient).toBeInTheDocument();
  });

  it('should contain a main rect element', () => {
    const { container } = render(<Logo />);
    const rects = container.querySelectorAll('rect');
    // The first rect is the background
    expect(rects.length).toBeGreaterThan(0);
  });

  it('should contain a path for the checkmark', () => {
    const { container } = render(<Logo />);
    const paths = container.querySelectorAll('path');
    // One path for the document content, one for the checkmark
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });
});
