import { useEffect } from "react";
import { cn } from "@/lib/utils";

interface ToastProps {
  message: string;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  duration?: number;
}

export const Toast: React.FC<ToastProps> = ({
  message,
  visible,
  onVisibleChange,
  duration = 2500,
}) => {
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => {
        onVisibleChange(false);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [visible, duration, onVisibleChange]);

  if (!visible) return null;

  return (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-card",
        visible && "visible",
      )}
      role="status"
      aria-live="polite"
      data-blok-testid="toast"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-5 shrink-0 text-primary"
        data-blok-testid="toast-icon"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span>{message}</span>
    </div>
  );
};
