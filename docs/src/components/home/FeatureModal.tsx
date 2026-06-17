import { useEffect, useRef } from "react";
import { CodeBlock } from "../common/CodeBlock";
import { useI18n } from "../../contexts/I18nContext";

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

  if (!feature) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-foreground/40 p-4 backdrop-blur-sm sm:p-6"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="feature-modal-title"
    >
      <div
        ref={modalRef}
        className="relative my-auto w-full max-w-lg rounded-2xl border border-border bg-card shadow-card-hover"
      >
        <div className="p-6 sm:p-8">
          <button
            ref={closeButtonRef}
            className="absolute right-4 top-4 inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onClose}
            aria-label={t('home.featureModal.close')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M18 6L6 18M6 6l12 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <div className="flex items-center gap-4 pr-10">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              {feature.icon}
            </div>
            <h2
              id="feature-modal-title"
              className="text-2xl font-extrabold tracking-tight"
            >
              {feature.title}
            </h2>
          </div>

          <div className="mt-6 space-y-6">
            <p className="text-base leading-relaxed text-muted-foreground">
              {feature.details.summary}
            </p>

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-primary">
                {t('home.featureModal.keyBenefits')}
              </h3>
              <ul className="mt-3 space-y-2">
                {feature.details.benefits.map((benefit) => (
                  <li
                    key={benefit}
                    className="flex items-start gap-2.5 text-sm leading-relaxed text-foreground"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="mt-0.5 shrink-0 text-primary"
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
              <div>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-primary">
                  {t('home.featureModal.example')}
                </h3>
                <CodeBlock
                  code={feature.details.codeExample}
                  language="typescript"
                />
              </div>
            )}

            {feature.details.apiLink && (
              <a
                href={feature.details.apiLink}
                className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline"
              >
                {t('home.featureModal.viewApiDocs')}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
