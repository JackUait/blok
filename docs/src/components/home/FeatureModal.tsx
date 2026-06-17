import { useEffect, useRef } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { CodeBlock } from "../common/CodeBlock";
import { useI18n } from "../../contexts/I18nContext";

// Backdrop fades; the card springs up and scales in, Airbnb-style.
const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

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
    | "blue";
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

  useEffect(() => {
    if (!feature) return;

    // Focus the close button when modal opens
    closeButtonRef.current?.focus();

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

  return (
    <AnimatePresence>
      {feature && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-foreground/50 p-4 backdrop-blur-sm sm:p-6"
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
            className="relative my-auto flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Header — close on the left, title centered (Airbnb dialog chrome). */}
            <div className="relative flex h-16 shrink-0 items-center justify-center border-b border-border px-14">
              <button
                ref={closeButtonRef}
                className="absolute left-3.5 inline-flex size-8 cursor-pointer items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

            {/* Body — scrolls independently between the fixed header and footer. */}
            <div className="flex-1 space-y-7 overflow-y-auto px-6 py-7 sm:px-8">
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
              <div className="flex shrink-0 justify-end border-t border-border px-6 py-4 sm:px-8">
                <a
                  href={feature.details.apiLink}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
