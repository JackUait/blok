import { motion, useReducedMotion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Tags this primitive can render as — kept small so motion typing stays honest. */
type RevealTag = 'div' | 'section' | 'nav' | 'header';

const MOTION_TAGS = {
  div: motion.div,
  section: motion.section,
  nav: motion.nav,
  header: motion.header,
} as const;

interface SectionRevealProps {
  children: ReactNode;
  /** Underlying element. Defaults to a div. */
  as?: RevealTag;
  /** Vertical travel in px as the block settles into place. */
  y?: number;
  /** Soften arrival with a brief blur-to-sharp focus pull. */
  blur?: boolean;
  /** Hold the reveal back so it trails an earlier one, in seconds. */
  delay?: number;
  /** rootMargin-style offset that decides how early the reveal fires. */
  viewportMargin?: string;
  className?: string;
  /** Forwarded to the rendered element (id, aria-*, data-blok-testid, …). */
  [prop: `data-${string}`]: string | undefined;
  'aria-label'?: string;
  id?: string;
}

/**
 * Wraps a home-page section so it fades, lifts, and focus-pulls into view as it
 * scrolls past — a soft, consistent handoff from one section to the next rather
 * than an abrupt cut. Honors `prefers-reduced-motion` by rendering statically.
 *
 * The timing vocabulary (gentle ease, ~0.6s) is shared across every section so
 * the page reads as one orchestrated scroll, not a pile of independent reveals.
 */
export const SectionReveal: React.FC<SectionRevealProps> = ({
  children,
  as = 'div',
  y = 24,
  blur = true,
  delay = 0,
  viewportMargin = '-80px',
  className,
  ...rest
}) => {
  const reduceMotion = useReducedMotion();
  const Comp = MOTION_TAGS[as] as typeof motion.div;

  if (reduceMotion) {
    return (
      <Comp className={cn(className)} {...rest}>
        {children}
      </Comp>
    );
  }

  const variants: Variants = {
    hidden: {
      opacity: 0,
      y,
      filter: blur ? 'blur(8px)' : 'blur(0px)',
    },
    show: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      // A long, decelerating ease (out-quint) lets the section glide to rest —
      // present enough to notice, quiet enough to never call attention to itself.
      transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1], delay },
    },
  };

  return (
    <Comp
      className={cn(className)}
      variants={variants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: viewportMargin }}
      {...rest}
    >
      {children}
    </Comp>
  );
};
