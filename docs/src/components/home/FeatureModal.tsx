import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useDragControls,
  type PanInfo,
  type Variants,
} from "framer-motion";
import { CodeBlock } from "../common/CodeBlock";
import { useI18n } from "../../contexts/I18nContext";

// Backdrop fades; the card springs up and scales in, Airbnb-style.
const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  // Fade in step with the sheet's slide-down so they leave together.
  exit: { opacity: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

// Desktop (sm+): a centred card that scales + springs into place.
const cardVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 16 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 30, mass: 0.9 },
  },
  exit: { opacity: 0, scale: 0.97, y: 8, transition: { duration: 0.15, ease: "easeIn" } },
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
  onClose: () => void;
}

export const FeatureModal: React.FC<FeatureModalProps> = ({
  feature,
  onClose,
}) => {
  const { t } = useI18n();
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dragControls = useDragControls();
  // Release velocity of a drag-dismiss, handed to the exit spring as `custom`.
  const exitVelocity = useRef(0);
  // True while a finger is held on the sheet's drag surface — drives handle feedback.
  const [isGrabbing, setIsGrabbing] = useState(false);

  // Below sm the panel becomes a draggable bottom-sheet; sm+ stays a centred card.
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
    // from scrolling the overlay to reveal the button while the sheet is still
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
          className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/50 backdrop-blur-sm sm:items-center sm:p-6"
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
            className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-2xl sm:my-auto sm:max-h-[90vh] sm:rounded-2xl"
            variants={isSheet ? sheetVariants : cardVariants}
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

              {/* Header — close on the left, title centered (Airbnb dialog chrome).
                  On mobile the drawer dismisses by drag/backdrop, so the X is hidden. */}
              <div className="relative flex h-14 items-center justify-center px-4 sm:h-16 sm:px-14">
              <button
                ref={closeButtonRef}
                className="absolute left-3.5 hidden size-8 cursor-pointer items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
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
              <h2
                id="feature-modal-title"
                className="truncate text-[15px] font-semibold tracking-tight"
              >
                {feature.title}
              </h2>
              </div>
            </div>

            {/* Body — scrolls independently between the fixed header and footer. */}
            <div className="flex-1 space-y-7 overflow-y-auto px-6 py-5 sm:px-8">
              <p className="text-[15px] leading-relaxed text-muted-foreground">
                {feature.details.summary}
              </p>

              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {t('home.featureModal.keyBenefits')}
                </h3>
                <ul className="mt-3.5 space-y-3">
                  {feature.details.benefits.map((benefit) => (
                    <li
                      key={benefit}
                      className="flex items-start gap-3 text-sm leading-relaxed text-foreground"
                    >
                      <span
                        className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                        aria-hidden="true"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
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

            {/* Footer — sticky CTA, Airbnb's filled primary action. */}
            {feature.details.apiLink && (
              <div className="flex shrink-0 justify-stretch px-6 py-4 sm:justify-end sm:px-8">
                <a
                  href={feature.details.apiLink}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto sm:py-2.5"
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
