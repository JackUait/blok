import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FeatureModal, type FeatureDetail } from './FeatureModal';
import { I18nProvider } from '../../contexts/I18nContext';

const mockFeature: FeatureDetail = {
  icon: <span>icon</span>,
  title: 'Clean JSON Output',
  description: 'Content is structured as typed JSON blocks, not raw HTML.',
  learnMore: 'Learn more about Clean JSON Output',
  accent: 'coral',
  details: {
    summary: 'Output is clean JSON, not HTML.',
    benefits: ['Easy to parse', 'Framework agnostic', 'Version control friendly'],
    codeExample: 'const data = await editor.save();',
    apiLink: '/docs#core-save',
  },
};

const visualNode = <div data-blok-testid="mock-viz">live diorama</div>;

const renderModal = (
  feature: FeatureDetail | null = mockFeature,
  onClose = vi.fn(),
  visual: React.ReactNode = visualNode,
) =>
  render(
    <I18nProvider>
      <FeatureModal feature={feature} visual={visual} onClose={onClose} />
    </I18nProvider>
  );

describe('FeatureModal', () => {
  afterEach(() => {
    localStorage.removeItem('blok-docs-locale');
  });

  it('should render nothing when feature is null', () => {
    const { container } = renderModal(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('should render the dialog when feature is provided', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should render the feature title', () => {
    renderModal();
    expect(screen.getByText('Clean JSON Output')).toBeInTheDocument();
  });

  it('should render the feature summary', () => {
    renderModal();
    expect(screen.getByText('Output is clean JSON, not HTML.')).toBeInTheDocument();
  });

  it('should render the tile visual as the panel hero', () => {
    renderModal();
    // The clicked tile's own live diorama is carried into the panel so it stays
    // on-brand instead of dropping the user onto a plain dialog.
    expect(screen.getByTestId('mock-viz')).toBeInTheDocument();
  });

  it('gives the Clean JSON hero a taller plate so its editor preview fits', () => {
    // The coral viz flips to a full editor canvas whose back face is the tallest
    // diorama; at the default hero height it overflowed and the trailing line
    // clipped. Coral gets a taller plate; the others keep the compact one.
    const { container } = renderModal({ ...mockFeature, accent: 'coral' });
    const plate = container.querySelector('.bento-tile');
    expect(plate?.className).toContain('h-[21rem]');
  });

  it('keeps the compact hero plate for non-coral features', () => {
    const { container } = renderModal({ ...mockFeature, accent: 'cyan' });
    const plate = container.querySelector('.bento-tile');
    expect(plate?.className).toContain('h-[17rem]');
    expect(plate?.className).not.toContain('h-[21rem]');
  });

  it('runs the Embeds river edge to edge (no plate padding)', () => {
    // The embeds viz is a full-bleed marquee; padding would leave an empty frame
    // around it. Blue gets p-0 so the river fills the plate to its rounded edges.
    const { container } = renderModal({ ...mockFeature, accent: 'blue' });
    const plate = container.querySelector('.bento-tile');
    expect(plate?.className).toContain('p-0');
    expect(plate?.className).not.toContain('p-4');
  });

  it('keeps plate padding for non-embeds features', () => {
    const { container } = renderModal({ ...mockFeature, accent: 'cyan' });
    const plate = container.querySelector('.bento-tile');
    expect(plate?.className).toContain('p-4');
    expect(plate?.className).not.toContain('p-0');
  });

  it('should render the benefits heading in sentence case', () => {
    renderModal();
    expect(screen.getByText('Key benefits')).toBeInTheDocument();
  });

  it('should render each benefit', () => {
    renderModal();
    expect(screen.getByText('Easy to parse')).toBeInTheDocument();
    expect(screen.getByText('Framework agnostic')).toBeInTheDocument();
    expect(screen.getByText('Version control friendly')).toBeInTheDocument();
  });

  it('should not render a code snippet even when codeExample is present', () => {
    // The drawer leads with the live diorama; the code dump was redundant.
    renderModal();
    expect(
      screen.queryByText((content) => content.includes('editor.save()'))
    ).not.toBeInTheDocument();
  });

  it('should render the docs link when apiLink is provided', () => {
    renderModal();
    // The arrow is a nested, aria-hidden icon, so the accessible name is just
    // the label.
    const link = screen.getByRole('link', { name: 'View documentation' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/docs#core-save');
  });

  it('should render the close button with accessible aria-label', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Close modal' })).toBeInTheDocument();
  });

  it('should call onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    renderModal(mockFeature, onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('should call onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    renderModal(mockFeature, onClose);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('should NOT call onClose when clicking inside panel content', () => {
    const onClose = vi.fn();
    renderModal(mockFeature, onClose);
    fireEvent.click(screen.getByText('Output is clean JSON, not HTML.'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('should have aria-modal="true" on the dialog', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('should focus the close button without scrolling the page on open', () => {
    // The panel mounts transformed off-screen; an unscoped focus() would scroll
    // the overlay to reveal the button, causing a visible jump on open.
    const focusSpy = vi.spyOn(HTMLButtonElement.prototype, 'focus');
    renderModal();
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    focusSpy.mockRestore();
  });

  it('should render a drag handle for the mobile bottom-sheet drawer', () => {
    renderModal();
    const grabber = screen.getByTestId('sheet-grabber');
    expect(grabber).toBeInTheDocument();
    // Purely decorative affordance — must not be announced to screen readers.
    expect(grabber).toHaveAttribute('aria-hidden', 'true');
  });

  it('should render Russian strings when locale is ru', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    render(
      <I18nProvider>
        <FeatureModal feature={mockFeature} visual={visualNode} onClose={vi.fn()} />
      </I18nProvider>
    );
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();
  });
});
