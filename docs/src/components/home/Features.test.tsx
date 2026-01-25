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

  it('should render all 9 feature cards', () => {
    const { container } = render(<Features />);

    const featureCards = container.querySelectorAll('[data-feature-card]');
    expect(featureCards.length).toBe(9);
  });

  it('should render Clean JSON Output feature', () => {
    render(<Features />);

    expect(screen.getByText('Clean JSON Output')).toBeInTheDocument();
    expect(screen.getByText('typed JSON blocks')).toBeInTheDocument();
  });

  it('should render Toolbox & Slash Commands feature', () => {
    render(<Features />);

    expect(screen.getByText('Toolbox & Slash Commands')).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('to open the block menu'))
    ).toBeInTheDocument();
  });

  it('should render Inline Toolbar feature', () => {
    render(<Features />);

    expect(screen.getByText('Inline Toolbar')).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('Select text to format'))
    ).toBeInTheDocument();
  });

  it('should render Drag & Drop feature', () => {
    render(<Features />);

    expect(screen.getByText('Drag & Drop')).toBeInTheDocument();
    expect(screen.getByText('drag handles')).toBeInTheDocument();
  });

  it('should render Custom Block Tools feature', () => {
    render(<Features />);

    expect(screen.getByText('Custom Block Tools')).toBeInTheDocument();
    expect(screen.getByText('custom blocks')).toBeInTheDocument();
  });

  it('should render Read-Only Mode feature', () => {
    render(<Features />);

    expect(screen.getByText('Read-Only Mode')).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('Toggle read-only mode'))
    ).toBeInTheDocument();
  });

  it('should render Undo & Redo feature', () => {
    render(<Features />);

    expect(screen.getByText('Undo & Redo')).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('Full history support'))
    ).toBeInTheDocument();
  });

  it('should render 68 Languages feature', () => {
    render(<Features />);

    expect(screen.getByText('68 Languages')).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('RTL support'))
    ).toBeInTheDocument();
  });

  it('should render Smart Paste feature', () => {
    render(<Features />);

    expect(screen.getByText('Smart Paste')).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('sanitized and converted'))
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
    expect(icons.length).toBe(9);
  });

  it('should have feature-title elements', () => {
    const { container } = render(<Features />);

    const titles = container.querySelectorAll('.feature-title');
    expect(titles.length).toBe(9);
  });

  it('should have feature-description elements', () => {
    const { container } = render(<Features />);

    const descriptions = container.querySelectorAll('.feature-description');
    expect(descriptions.length).toBe(9);
  });

  it('should apply animation-order CSS custom property to cards', () => {
    const { container } = render(<Features />);

    const cards = container.querySelectorAll('[data-feature-card]');
    cards.forEach((card, index) => {
      expect((card as HTMLElement).style.getPropertyValue('--animation-order')).toBe(String(index));
    });
  });

  it('should render decorative background elements', () => {
    const { container } = render(<Features />);

    expect(container.querySelector('.features-bg')).toBeInTheDocument();
    expect(container.querySelector('.features-blob-1')).toBeInTheDocument();
    expect(container.querySelector('.features-blob-2')).toBeInTheDocument();
    expect(container.querySelector('.features-grid-pattern')).toBeInTheDocument();
  });

  it('should render card glow and shine effects', () => {
    const { container } = render(<Features />);

    const glowEffects = container.querySelectorAll('.feature-card-glow');
    const shineEffects = container.querySelectorAll('.feature-card-shine');

    expect(glowEffects.length).toBe(9);
    expect(shineEffects.length).toBe(9);
  });

  it('should render feature-icon-inner elements', () => {
    const { container } = render(<Features />);

    const iconInners = container.querySelectorAll('.feature-icon-inner');
    expect(iconInners.length).toBe(9);
  });

  it('should apply accent color variant classes to cards', () => {
    const { container } = render(<Features />);

    const expectedAccents = ['coral', 'orange', 'pink', 'mauve', 'green', 'cyan', 'yellow', 'red', 'purple'];
    expectedAccents.forEach((accent) => {
      expect(container.querySelector(`.feature-card--${accent}`)).toBeInTheDocument();
    });
  });
});
