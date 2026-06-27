import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useDragControls,
  useReducedMotion,
  type PanInfo,
  type Variants,
} from "framer-motion";
import { CodeBlock } from "../common/CodeBlock";
import { useI18n } from "../../contexts/I18nContext";

// Backdrop fades; the panel slides in from its edge.
const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  // Fade in step with the panel's slide-away so they leave together.
  exit: { opacity: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

// Desktop (sm+): a right-anchored slide-over drawer. The panel carries the
// clicked tile's own diorama, so it reads as that tile unfolding to full height
// rather than a generic centred dialog dropped on top of the page.
const drawerVariants: Variants = {
  hidden: { x: "100%" },
  visible: {
    x: 0,
    transition: { type: "spring", stiffness: 320, damping: 36, mass: 0.9 },
  },
  exit: { x: "100%", transition: { duration: 0.22, ease: "easeIn" } },
};

// Mobile: a bottom-sheet that rises from the bottom edge and slides back down.
const sheetVariants: Variants = {
  hidden: { y: "100%" },
  visible: {
    y: 0,
    transition: { type: "spring", stiffness: 360, damping: 38, mass: 0.9 },
  },
  // Falls away off-screen, carrying the flick's release velocity so a drag-dismiss
  // continues the gesture instead of restarting at a fixed speed. A tapped close
  // (velocity 0) just springs gently shut.
  exit: (velocity: number = 0) => ({
    y: "100%",
    transition: { type: "spring", stiffness: 420, damping: 44, velocity, restDelta: 2 },
  }),
};

export interface FeatureDetail {
  icon: React.ReactNode;
  title: string;
  description: string;
  learnMore: string;
  /** Pillars that define Blok render larger than supporting capabilities. */
  tier?: "primary" | "secondary";
  accent:
    | "coral"
    | "orange"
    | "pink"
    | "mauve"
    | "green"
    | "cyan"
    | "yellow"
    | "red"
    | "purple"
    | "blue"
    | "media";
  details: {
    summary: string;
    benefits: string[];
    codeExample?: string;
    apiLink?: string;
  };
}

interface FeatureModalProps {
  feature: FeatureDetail | null;
  /** The clicked tile's own live diorama, carried in as the panel's hero. */
  visual?: React.ReactNode;
  onClose: () => void;
}

export const FeatureModal: React.FC<FeatureModalProps> = ({
  feature,
  visual,
  onClose,
}) => {
  const { t } = useI18n();
  const modalRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dragControls = useDragControls();
  const reduce = useReducedMotion();
  // Release velocity of a drag-dismiss, handed to the exit spring as `custom`.
  const exitVelocity = useRef(0);
  // True while a finger is held on the sheet's drag surface — drives handle feedback.
  const [isGrabbing, setIsGrabbing] = useState(false);

  // Below sm the panel becomes a draggable bottom-sheet; sm+ becomes a right drawer.
  const [isSheet, setIsSheet] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 639px)").matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsSheet(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!feature) return;

    // A fresh open starts from rest — only a drag-dismiss sets a release velocity.
    exitVelocity.current = 0;

    // Focus the close button when modal opens. preventScroll stops the browser
    // from scrolling the overlay to reveal the button while the panel is still
    // transformed off-screen — that scroll was the visible jump on open.
    closeButtonRef.current?.focus({ preventScroll: true });

    // Handle escape key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    // Prevent body scroll
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [feature, onClose]);

  // Handle click outside modal
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Track the cursor over the hero so its border lights brand-pink where the
  // glow blob reaches the edge — the same --mx/--my trick the bento tiles use.
  const trackGlow = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduce || e.pointerType !== "mouse") return;
    const el = heroRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${(((e.clientX - r.left) / r.width) * 100).toFixed(2)}%`);
    el.style.setProperty("--my", `${(((e.clientY - r.top) / r.height) * 100).toFixed(2)}%`);
  };

  // Flick or drag the sheet far enough down and it dismisses, handing the
  // release velocity to the exit spring so it accelerates the rest of the way.
  // Otherwise framer springs it back to rest.
  const handleDragEnd = (_e: PointerEvent, info: PanInfo) => {
    setIsGrabbing(false);
    if (info.offset.y > 120 || info.velocity.y > 650) {
      exitVelocity.current = Math.max(info.velocity.y, 0);
      onClose();
    }
  };

  return (
    <AnimatePresence custom={exitVelocity.current}>
      {feature && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/50 backdrop-blur-sm sm:items-stretch sm:justify-end"
          onClick={handleBackdropClick}
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          role="dialog"
          aria-modal="true"
          aria-labelledby="feature-modal-title"
        >
          <motion.div
            ref={modalRef}
            className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-2xl sm:h-full sm:max-h-none sm:w-[28rem] sm:max-w-[92vw] sm:rounded-3xl sm:rounded-r-none"
            variants={isSheet ? sheetVariants : drawerVariants}
            custom={exitVelocity.current}
            initial="hidden"
            animate="visible"
            exit="exit"
            drag={isSheet ? "y" : false}
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 1 }}
            onDragEnd={handleDragEnd}
          >
            {/* Grabber + header form the drag surface so the scrollable body keeps
                its own touch scrolling. sm+ hides the grabber and disables drag. */}
            <div
              onPointerDown={(e) => {
                if (!isSheet) return;
                setIsGrabbing(true);
                dragControls.start(e);
              }}
              onPointerUp={() => setIsGrabbing(false)}
              onPointerCancel={() => setIsGrabbing(false)}
              className="shrink-0 touch-none sm:touch-auto"
            >
              <div
                data-blok-testid="sheet-grabber"
                aria-hidden="true"
                className="flex justify-center pb-1 pt-3 sm:hidden"
              >
                {/* Held-state feedback: the handle darkens and stretches while a finger
                    is down, and eases back when released. */}
                <span
                  className={`h-1.5 rounded-full transition-all duration-200 ${
                    isGrabbing ? "w-12 bg-foreground/40" : "w-10 bg-foreground/15"
                  }`}
                />
              </div>

              {/* Header — title leads, close sits at the trailing edge (drawer chrome).
                  On mobile the sheet dismisses by drag/backdrop too. */}
              <div className="relative flex h-14 items-center justify-between gap-3 px-5 sm:h-16 sm:px-7">
                <h2
                  id="feature-modal-title"
                  className="min-w-0 truncate text-[17px] font-bold tracking-tight"
                >
                  {feature.title}
                </h2>
                <button
                  ref={closeButtonRef}
                  className="-mr-1 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={onClose}
                  aria-label={t('home.featureModal.close')}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M18 6L6 18M6 6l12 12"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* Body — scrolls independently between the fixed header and footer. */}
            <div className="flex-1 space-y-7 overflow-y-auto px-5 pb-6 pt-1 sm:px-7">
              {/* Hero — the clicked tile's own diorama. A bento-tile group so the
                  resting diorama shows by default and the tile's animation plays on
                  hover, exactly as in the grid; the border lights under the cursor. */}
              {visual && (
                <div
                  ref={heroRef}
                  onPointerMove={trackGlow}
                  aria-hidden="true"
                  className="bento-tile group relative h-72 overflow-hidden rounded-2xl border border-border/60 bg-card p-4"
                >
                  <span className="bento-spot" aria-hidden="true" />
                  <div className="relative z-10 flex h-full w-full items-center">
                    {visual}
                  </div>
                </div>
              )}

              <p className="text-[15px] leading-relaxed text-muted-foreground">
                {feature.details.summary}
              </p>

              <div>
                <h3 className="text-[13px] font-semibold tracking-tight text-muted-foreground">
                  {t('home.featureModal.keyBenefits')}
                </h3>
                {/* Refined spec rows — a thin divided list led by a small primary
                    tick, not the generic pill-checklist look. */}
                <ul className="mt-3 divide-y divide-border/50">
                  {feature.details.benefits.map((benefit) => (
                    <li
                      key={benefit}
                      className="flex items-start gap-3 py-2.5 text-[15px] leading-relaxed text-foreground"
                    >
                      <svg
                        className="mt-1 size-3.5 shrink-0 text-primary"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {benefit}
                    </li>
                  ))}
                </ul>
              </div>

              {feature.details.codeExample && (
                <CodeBlock
                  code={feature.details.codeExample}
                  language="typescript"
                />
              )}
            </div>

            {/* Footer — sticky CTA into the relevant docs. */}
            {feature.details.apiLink && (
              <div className="shrink-0 border-t border-border/60 px-5 py-4 sm:px-7">
                <a
                  href={feature.details.apiLink}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {t('home.featureModal.viewApiDocs')}
                </a>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
