import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useDragControls,
  useReducedMotion,
  type PanInfo,
  type Variants,
} from "framer-motion";
import { useI18n } from "../../contexts/I18nContext";
import { Typo } from "../common/Typo";

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

// The body's contents settle in after the panel arrives: each block lifts and
// fades on a heavy custom curve, staggered top to bottom, so the drawer reads as
// composed rather than pasted in all at once.
const SETTLE = [0.32, 0.72, 0, 1] as const;
const bodyVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.12 } },
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: SETTLE } },
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

  // Reduced-motion users get the panel and its contents instantly, no settle.
  const bodyMotion = reduce
    ? {}
    : { variants: bodyVariants, initial: "hidden" as const, animate: "visible" as const };
  const itemMotion = reduce ? {} : { variants: itemVariants };

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
            className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.75rem] border border-border/70 bg-card shadow-[0_-12px_60px_-20px_rgba(17,12,10,0.22)] sm:h-full sm:max-h-none sm:w-[28rem] sm:max-w-[92vw] sm:rounded-[1.75rem] sm:rounded-r-none sm:shadow-[-24px_0_80px_-28px_rgba(17,12,10,0.26)]"
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
                  <Typo>{feature.title}</Typo>
                </h2>
                <button
                  ref={closeButtonRef}
                  className="-mr-1 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground ring-1 ring-transparent transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-secondary hover:text-foreground hover:ring-border/60 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

            {/* Body — scrolls independently between the fixed header and footer.
                Its blocks settle in staggered once the panel arrives. */}
            <motion.div
              className="flex-1 space-y-7 overflow-y-auto px-5 pb-6 pt-1 sm:px-7"
              {...bodyMotion}
            >
              {/* Hero — the clicked tile's own diorama, set in a machined tray:
                  an outer shell holds the inner plate on concentric radii, like a
                  glass plate in an aluminium frame. The inner plate is the bento
                  tile, so the resting diorama shows by default and animates on
                  hover, with the border lighting under the cursor. */}
              {visual && (
                <motion.div
                  {...itemMotion}
                  aria-hidden="true"
                  className="rounded-[1.65rem] bg-secondary/50 p-1.5 ring-1 ring-black/[0.04] dark:ring-white/[0.06]"
                >
                  <div
                    ref={heroRef}
                    onPointerMove={trackGlow}
                    // Most dioramas sit inside the plate padding, but three need
                    // special treatment: the Clean JSON (coral) viz flips to a full
                    // editor canvas whose back face is the tallest of them all, so
                    // it gets extra height; the Embeds (blue) viz is a full-bleed
                    // marquee, so it drops the padding and runs the river edge to
                    // edge instead of leaving an empty frame; and the slash menu
                    // (pink) is shown as the SAME clipped teaser it is in the bento
                    // cell, so its plate is sized to that 108px window (h-[8.75rem] =
                    // the menu window + p-4) and the menu overflows the bottom,
                    // clipped flush — matching the main-page and mobile renders.
                    className={`bento-tile group relative ${feature.accent === "coral" ? "h-[21rem]" : feature.accent === "pink" ? "h-[8.75rem]" : "h-[17rem]"} overflow-hidden rounded-[calc(1.65rem-0.375rem)] border border-border/60 bg-card ${feature.accent === "blue" ? "p-0" : "p-4"} shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]`}
                  >
                    {/* The slash menu (pink) is a floating card with a padding ring
                        the raw glow blob would bleed through; it relies on its own
                        brand edge-light instead, so this hero skips the blob. */}
                    {feature.accent !== "pink" && (
                      <span className="bento-spot" aria-hidden="true" />
                    )}
                    <div className="relative z-10 flex h-full w-full items-center">
                      {visual}
                    </div>
                  </div>
                </motion.div>
              )}

              <motion.p
                {...itemMotion}
                className="text-[15px] leading-relaxed text-muted-foreground"
              >
                <Typo>{feature.details.summary}</Typo>
              </motion.p>

              <motion.div {...itemMotion}>
                <h3 className="text-[13px] font-semibold tracking-tight text-muted-foreground">
                  <Typo>{t('home.featureModal.keyBenefits')}</Typo>
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
                      <Typo>{benefit}</Typo>
                    </li>
                  ))}
                </ul>
              </motion.div>

            </motion.div>

            {/* Footer — sticky CTA into the relevant docs. A full pill with the
                arrow nested in its own island that drifts on hover; the whole
                button presses in on tap. */}
            {feature.details.apiLink && (
              <div className="shrink-0 border-t border-border/60 px-5 py-4 sm:px-7">
                <a
                  href={feature.details.apiLink}
                  className="group relative inline-flex w-full items-center justify-center rounded-full bg-primary py-3.5 pl-6 pr-14 text-sm font-semibold text-primary-foreground shadow-[0_10px_28px_-10px_rgba(225,75,110,0.55)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:shadow-[0_14px_34px_-10px_rgba(225,75,110,0.65)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Typo>{t('home.featureModal.viewApiDocs')}</Typo>
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 right-1.5 my-auto flex size-9 items-center justify-center rounded-full bg-white/15 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:scale-105"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M5 12h13M13 6l6 6-6 6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </a>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
