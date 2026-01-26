import { useEffect, useRef } from "react";
import { CodeBlock } from "../common/CodeBlock";

export interface FeatureDetail {
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
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
      className="feature-modal-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="feature-modal-title"
    >
      <div
        ref={modalRef}
        className={`feature-modal feature-modal--${feature.accent}`}
      >
        <button
          ref={closeButtonRef}
          className="feature-modal-close"
          onClick={onClose}
          aria-label="Close modal"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M18 6L6 18M6 6l12 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <div className="feature-modal-header">
          <div className="feature-modal-icon">
            <div className="feature-modal-icon-inner">{feature.icon}</div>
          </div>
          <h2 id="feature-modal-title" className="feature-modal-title">
            {feature.title}
          </h2>
        </div>

        <div className="feature-modal-content">
          <p className="feature-modal-summary">{feature.details.summary}</p>

          <div className="feature-modal-benefits">
            <h3>Key Benefits</h3>
            <ul>
              {feature.details.benefits.map((benefit, index) => (
                <li key={index}>{benefit}</li>
              ))}
            </ul>
          </div>

          {feature.details.codeExample && (
            <div className="feature-modal-code">
              <h3>Example</h3>
              <CodeBlock
                code={feature.details.codeExample}
                language="typescript"
              />
            </div>
          )}

          {feature.details.apiLink && (
            <a href={feature.details.apiLink} className="feature-modal-link">
              View API Documentation →
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
