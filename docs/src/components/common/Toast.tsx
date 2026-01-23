import { useEffect } from 'react';

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
    <div className={`toast ${visible ? 'visible' : ''}`}>
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span>{message}</span>
    </div>
  );
};
