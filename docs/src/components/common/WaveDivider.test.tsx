import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WaveDivider } from './WaveDivider';

describe('WaveDivider', () => {
  it('renders with default props', () => {
    render(<WaveDivider />);
    
    const waveElement = document.querySelector('.wave-divider');
    expect(waveElement).toBeTruthy();
    expect(waveElement?.getAttribute('aria-hidden')).toBe('true');
  });

  it('applies the correct variant class', () => {
    const { container } = render(<WaveDivider variant="layered" />);
    
    const waveElement = container.querySelector('.wave-divider--layered');
    expect(waveElement).toBeTruthy();
  });

  it('renders SVG with path elements', () => {
    const { container } = render(<WaveDivider />);
    
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    
    const mainPath = container.querySelector('.wave-path--main');
    expect(mainPath).toBeTruthy();
  });

  it('renders second layer for layered variant', () => {
    const { container } = render(<WaveDivider variant="layered" />);
    
    const layer2Path = container.querySelector('.wave-path--layer2');
    expect(layer2Path).toBeTruthy();
  });

  it('does not render second layer for zigzag variant', () => {
    const { container } = render(<WaveDivider variant="zigzag" />);
    
    const layer2Path = container.querySelector('.wave-path--layer2');
    expect(layer2Path).toBeFalsy();
  });

  it('applies custom height', () => {
    const { container } = render(<WaveDivider height={120} />);
    
    const waveElement = container.querySelector('.wave-divider') as HTMLElement;
    expect(waveElement?.style.height).toBe('120px');
  });

  it('positions at bottom by default', () => {
    const { container } = render(<WaveDivider />);
    
    const waveElement = container.querySelector('.wave-divider') as HTMLElement;
    expect(waveElement?.style.bottom).toBe('-1px');
  });

  it('positions at top when specified', () => {
    const { container } = render(<WaveDivider position="top" />);
    
    const waveElement = container.querySelector('.wave-divider') as HTMLElement;
    expect(waveElement?.style.top).toBe('-1px');
  });

  it('applies flip transform when flip is true', () => {
    const { container } = render(<WaveDivider flip />);
    
    const waveElement = container.querySelector('.wave-divider') as HTMLElement;
    expect(waveElement?.style.transform).toBe('rotate(180deg)');
  });

  it('applies custom className', () => {
    const { container } = render(<WaveDivider className="my-custom-wave" />);
    
    const waveElement = container.querySelector('.my-custom-wave');
    expect(waveElement).toBeTruthy();
  });

  it('renders all wave variants without error', () => {
    const variants = ['soft', 'layered', 'zigzag', 'curved', 'asymmetric'] as const;
    
    variants.forEach((variant) => {
      const { container, unmount } = render(<WaveDivider variant={variant} />);
      expect(container.querySelector(`.wave-divider--${variant}`)).toBeTruthy();
      unmount();
    });
  });

  it('sets fill color on path elements', () => {
    const { container } = render(<WaveDivider fillColor="#ff0000" />);
    
    const mainPath = container.querySelector('.wave-path--main') as SVGPathElement;
    expect(mainPath?.getAttribute('fill')).toBe('#ff0000');
  });
});
