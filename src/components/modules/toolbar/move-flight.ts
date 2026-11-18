import { DATA_ATTR } from '../../constants/data-attributes';
import { prefersReducedMotion } from '../../utils/spring';

const TEXT_FADE_MS = 220;
const FOLD_MS = 240;
const SETTLE_MS = 380;
const CLOSE_MS = 140;

export interface MoveFlightOptions {
  /** The wire that carries the bead. */
  wire: { send: (mark?: Element | null) => Promise<boolean> };
  /** The holders of the blocks being moved, outermost only. */
  holders: HTMLElement[];
  /** The picker's root, read when it closes. */
  picker: () => HTMLElement | null;
  reducedMotion?: () => boolean;
}

export interface MoveFlight {
  /**
   * Plays the move: the text fades as the bead leaves, the blocks fold away
   * when it arrives, then the picker fades out.
   * @param mark - the picked row's icon
   * @returns false when the move was called off on the way
   */
  fly: (mark?: Element | null) => Promise<boolean>;
  /** Puts the blocks' inline styles back. Call it before the real move, and on a cancel. */
  restore: () => void;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

export const createMoveFlight = (options: MoveFlightOptions): MoveFlight => {
  const reduced = options.reducedMotion ?? prefersReducedMotion;
  const state = { restored: false };
  const contents = options.holders
    .map((holder) => holder.querySelector<HTMLElement>(`[${DATA_ATTR.elementContent}]`))
    .filter((content): content is HTMLElement => content !== null);
  const saved = new Map<HTMLElement, string | null>();

  const restore = (): void => {
    state.restored = true;
    saved.forEach((style, element) => {
      if (style === null) {
        element.removeAttribute('style');
      } else {
        element.setAttribute('style', style);
      }
    });
    saved.clear();
  };

  const fold = (holder: HTMLElement): void => {
    const style = holder.style;

    style.height = `${holder.getBoundingClientRect().height}px`;
    style.overflow = 'hidden';
    // The start height must be laid out before the transition is set.
    holder.getBoundingClientRect();
    style.transition = `height ${FOLD_MS}ms cubic-bezier(.2,.8,.2,1), margin ${FOLD_MS}ms, padding ${FOLD_MS}ms, opacity ${FOLD_MS * 0.6}ms`;
    style.height = '0px';
    style.opacity = '0';
    style.marginTop = '0px';
    style.marginBottom = '0px';
    style.paddingTop = '0px';
    style.paddingBottom = '0px';
  };

  const fly = async (mark?: Element | null): Promise<boolean> => {
    if (reduced()) {
      return options.wire.send(mark);
    }

    [...options.holders, ...contents].forEach((element) => saved.set(element, element.getAttribute('style')));
    contents.forEach((content) => {
      Object.assign(content.style, { transition: `opacity ${TEXT_FADE_MS}ms`, opacity: '0' });
    });

    const arrived = await options.wire.send(mark);

    if (!arrived || state.restored) {
      restore();

      return false;
    }
    options.holders.forEach(fold);
    await wait(SETTLE_MS);
    if (state.restored) {
      return false;
    }
    options.picker()?.animate?.([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.98)' }], {
      duration: CLOSE_MS,
      fill: 'forwards',
    });
    await wait(CLOSE_MS);

    return !state.restored;
  };

  return { fly, restore };
};
