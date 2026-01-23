import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Features } from './Features';

describe('Features', () => {
  it('should render a section element with id="features"', () => {
    render(<Features />);

    const section = document.getElementById('features');
    expect(section).toBeInTheDocument();
  });

  it('should render the section header', () => {
    render(<Features />);

    expect(screen.getByText('Why Blok')).toBeInTheDocument();
    // The title is split by <br /> tags
    expect(screen.getByText((content) => content.includes('Built for developers'))).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('designed for users'))).toBeInTheDocument();
  });

  it('should render the section description', () => {
    render(<Features />);

    expect(
      screen.getByText('Everything you need to create powerful editing experiences in your applications.')
    ).toBeInTheDocument();
  });

  it('should render all 6 feature cards', () => {
    const { container } = render(<Features />);

    const featureCards = container.querySelectorAll('[data-feature-card]');
    expect(featureCards.length).toBe(6);
  });

  it('should render Block Architecture feature', () => {
    render(<Features />);

    expect(screen.getByText('Block Architecture')).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('JSON data, not raw HTML'))
    ).toBeInTheDocument();
  });

  it('should render Slash Commands feature', () => {
    render(<Features />);

    expect(screen.getByText('Slash Commands')).toBeInTheDocument();
    expect(
      screen.getByText('Built-in, customizable slash menu for quick formatting and inserting media.')
    ).toBeInTheDocument();
  });

  it('should render Headless & Stylable feature', () => {
    render(<Features />);

    expect(screen.getByText('Headless & Stylable')).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('Blok gives you the logic'))
    ).toBeInTheDocument();
  });

  it('should render Drag & Drop feature', () => {
    render(<Features />);

    expect(screen.getByText('Drag & Drop')).toBeInTheDocument();
    expect(screen.getByText('Native support for rearranging blocks with intuitive drag handles.')).toBeInTheDocument();
  });

  it('should render Extensible Plugin System feature', () => {
    render(<Features />);

    expect(screen.getByText('Extensible Plugin System')).toBeInTheDocument();
    expect(
      screen.getByText('Create custom blocks for Kanbans, Embeds, Code Blocks, and more.')
    ).toBeInTheDocument();
  });

  it('should render 68 Languages feature', () => {
    render(<Features />);

    expect(screen.getByText('68 Languages')).toBeInTheDocument();
    expect(
      screen.getByText('Lazy-loaded locale support with only English bundled by default (~3KB).')
    ).toBeInTheDocument();
  });

  it('should have features-grid div', () => {
    const { container } = render(<Features />);

    const grid = container.querySelector('.features-grid');
    expect(grid).toBeInTheDocument();
  });

  it('should have feature-icon divs for each card', () => {
    const { container } = render(<Features />);

    const icons = container.querySelectorAll('.feature-icon');
    expect(icons.length).toBe(6);
  });

  it('should have feature-title elements', () => {
    const { container } = render(<Features />);

    const titles = container.querySelectorAll('.feature-title');
    expect(titles.length).toBe(6);
  });

  it('should have feature-description elements', () => {
    const { container } = render(<Features />);

    const descriptions = container.querySelectorAll('.feature-description');
    expect(descriptions.length).toBe(6);
  });

  it('should apply animation-delay styles to cards', () => {
    const { container } = render(<Features />);

    const cards = container.querySelectorAll('[data-feature-card]');
    cards.forEach((card, index) => {
      expect(card).toHaveStyle({ animationDelay: `${index * 0.05}s` });
    });
  });
});
