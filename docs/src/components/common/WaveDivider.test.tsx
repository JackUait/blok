import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WaveDivider } from './WaveDivider';

describe('WaveDivider', () => {
  it('renders with default props', () => {
    render(<WaveDivider />);

    const waveElement = screen.getByTestId('wave-divider-soft');
    expect(waveElement).toBeInTheDocument();
    expect(waveElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('applies the correct variant class and testid', () => {
    render(<WaveDivider variant="layered" />);

    const waveElement = screen.getByTestId('wave-divider-layered');
    expect(waveElement).toBeInTheDocument();
  });

  it('renders SVG with path elements', () => {
    render(<WaveDivider />);

    const svg = screen.getByTestId('wave-divider-svg');
    expect(svg).toBeInTheDocument();

    const mainPath = screen.getByTestId('wave-path-main-soft');
    expect(mainPath).toBeInTheDocument();
  });

  it('renders second layer for layered variant', () => {
    render(<WaveDivider variant="layered" />);

    const layer2Path = screen.getByTestId('wave-path-layer2-layered');
    expect(layer2Path).toBeInTheDocument();
  });

  it('does not render second layer for zigzag variant', () => {
    render(<WaveDivider variant="zigzag" />);

    const layer2Path = screen.queryByTestId('wave-path-layer2-zigzag');
    expect(layer2Path).not.toBeInTheDocument();
  });

  it('applies custom height', () => {
    render(<WaveDivider height={120} />);

    const waveElement = screen.getByTestId('wave-divider-soft');
    expect(waveElement).toHaveStyle({ height: '120px' });
  });

  it('positions at bottom by default', () => {
    render(<WaveDivider />);

    const waveElement = screen.getByTestId('wave-divider-soft');
    expect(waveElement).toHaveStyle({ bottom: '-1px' });
  });

  it('positions at top when specified', () => {
    render(<WaveDivider position="top" />);

    const waveElement = screen.getByTestId('wave-divider-soft');
    expect(waveElement).toHaveStyle({ top: '-1px' });
  });

  it('applies flip transform when flip is true', () => {
    render(<WaveDivider flip />);

    const waveElement = screen.getByTestId('wave-divider-soft');
    expect(waveElement).toHaveStyle({ transform: 'rotate(180deg)' });
  });

  it('applies custom className', () => {
    render(<WaveDivider className="my-custom-wave" />);

    const waveElement = screen.getByTestId('wave-divider-soft');
    expect(waveElement).toHaveClass('my-custom-wave');
  });

  it('renders all wave variants without error', () => {
    const variants = ['soft', 'layered', 'zigzag', 'curved', 'asymmetric'] as const;

    variants.forEach((variant) => {
      const { unmount } = render(<WaveDivider variant={variant} />);
      expect(screen.getByTestId(`wave-divider-${variant}`)).toBeInTheDocument();
      unmount();
    });
  });

  it('sets fill color on path elements', () => {
    render(<WaveDivider fillColor="#ff0000" />);

    const mainPath = screen.getByTestId('wave-path-main-soft');
    expect(mainPath).toHaveAttribute('fill', '#ff0000');
  });
});
