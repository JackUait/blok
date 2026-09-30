/**
 * The figure also holds the caption row, so figure-relative CSS would wrap the caption too.
 * The ring, dots, readout and alt pill are placed from this height instead.
 */
export function syncMediaHeight(figure: HTMLElement): void {
  const media = figure.querySelector<HTMLElement>('.blok-image-crop') ?? figure.querySelector<HTMLElement>('img');
  if (!media || media.offsetHeight <= 0) return;
  figure.style.setProperty('--blok-image-media-height', `${media.offsetHeight}px`);
}
