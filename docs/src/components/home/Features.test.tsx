import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Features } from './Features';

describe('Features', () => {
  it('should render a section element with id="features"', () => {
    render(<Features />);

    const section = screen.getByRole('region', { name: /features/i });
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

  it('should render all 9 feature cards as buttons', () => {
    render(<Features />);

    const featureCards = screen.getAllByRole('button', { name: /learn more about/i });
    expect(featureCards).toHaveLength(9);
  });

  it('should render Clean JSON Output feature', () => {
    render(<Features />);

    expect(screen.getByText('Clean JSON Output')).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('typed JSON blocks'))).toBeInTheDocument();
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
    expect(screen.getByText((content) => content.includes('drag handles'))).toBeInTheDocument();
  });

  it('should render Custom Block Tools feature', () => {
    render(<Features />);

    const button = screen.getByRole('button', { name: 'Learn more about Custom Block Tools' });
    const withinButton = within(button);
    expect(withinButton.getByText('Custom Block Tools')).toBeInTheDocument();
    expect(withinButton.getByText((content) => content.includes('custom blocks'))).toBeInTheDocument();
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

  it('should render feature cards with accessible labels', () => {
    render(<Features />);

    const expectedTitles = [
      'Clean JSON Output',
      'Toolbox & Slash Commands',
      'Inline Toolbar',
      'Drag & Drop',
      'Custom Block Tools',
      'Read-Only Mode',
      'Undo & Redo',
      '68 Languages',
      'Smart Paste',
    ];

    expectedTitles.forEach((title) => {
      expect(screen.getByRole('button', { name: `Learn more about ${title}` })).toBeInTheDocument();
    });
  });
});
