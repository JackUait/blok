import { useCallback, useRef, useState } from 'react';

interface TiltState {
  rotateX: number;
  rotateY: number;
  scale: number;
  glareX: number;
  glareY: number;
}

interface Use3DTiltOptions {
  maxTilt?: number;
  scale?: number;
  transitionSpeed?: number;
}

interface Use3DTiltReturn {
  ref: React.RefCallback<HTMLDivElement>;
  style: React.CSSProperties;
  glareStyle: React.CSSProperties;
  isHovered: boolean;
  onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

/**
 * Custom hook for 3D tilt effect on hover
 * Creates a perspective-based rotation that follows the mouse cursor
 */
export const use3DTilt = (options: Use3DTiltOptions = {}): Use3DTiltReturn => {
  const { maxTilt = 15, scale = 1.05, transitionSpeed = 400 } = options;

  const elementRef = useRef<HTMLDivElement | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isSettled, setIsSettled] = useState(false); // Track if entry transition is complete
  const [tilt, setTilt] = useState<TiltState>({
    rotateX: 0,
    rotateY: 0,
    scale: 1,
    glareX: 50,
    glareY: 50,
  });
  const frameId = useRef<number | null>(null);
  const settleTimeoutId = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ref = useCallback((node: HTMLDivElement | null) => {
    elementRef.current = node;
  }, []);

  const updateTilt = useCallback(
    (clientX: number, clientY: number) => {
      const element = elementRef.current;

      if (element === null) return;

      const rect = element.getBoundingClientRect();

      // Calculate mouse position relative to element center (-1 to 1)
      const rawX = (clientX - rect.left) / rect.width;
      const rawY = (clientY - rect.top) / rect.height;

      // Clamp values to prevent extreme tilts when cursor is at/beyond edges
      const x = Math.max(0, Math.min(1, rawX));
      const y = Math.max(0, Math.min(1, rawY));

      // Apply easing function to smooth out edges - reduces sensitivity near boundaries
      // Uses a cubic ease that's linear in center, soft at edges
      const ease = (t: number): number => {
        const centered = (t - 0.5) * 2; // -1 to 1
        const eased = centered * (1 - Math.abs(centered) * 0.3); // Soften extremes

        return eased * 0.5 + 0.5; // Back to 0 to 1
      };

      const easedX = ease(x);
      const easedY = ease(y);

      // Convert to rotation angles (inverted for natural feel)
      const rotateY = (easedX - 0.5) * maxTilt * 2;
      const rotateX = (0.5 - easedY) * maxTilt * 2;

      // Calculate glare position (use raw clamped values for more direct feel)
      const glareX = x * 100;
      const glareY = y * 100;

      setTilt({
        rotateX,
        rotateY,
        scale,
        glareX,
        glareY,
      });
    },
    [maxTilt, scale]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (frameId.current !== null) {
        cancelAnimationFrame(frameId.current);
      }
      frameId.current = requestAnimationFrame(() => {
        updateTilt(e.clientX, e.clientY);
      });
    },
    [updateTilt]
  );

  const onMouseEnter = useCallback(() => {
    setIsHovered(true);
    setIsSettled(false);
    // Allow a longer transition period for smooth entry before switching to instant tracking
    if (settleTimeoutId.current !== null) {
      clearTimeout(settleTimeoutId.current);
    }
    settleTimeoutId.current = setTimeout(() => {
      setIsSettled(true);
    }, 350);
  }, []);

  const onMouseLeave = useCallback(() => {
    setIsHovered(false);
    setIsSettled(false);
    if (frameId.current !== null) {
      cancelAnimationFrame(frameId.current);
    }
    if (settleTimeoutId.current !== null) {
      clearTimeout(settleTimeoutId.current);
    }
    setTilt({
      rotateX: 0,
      rotateY: 0,
      scale: 1,
      glareX: 50,
      glareY: 50,
    });
  }, []);

  // Determine transition based on state - use early returns for clarity
  const getTransition = (): string => {
    // Smooth exit back to center
    if (!isHovered) {
      return `transform ${transitionSpeed}ms cubic-bezier(0.33, 1, 0.68, 1)`;
    }
    // Gentle entry with longer duration
    if (isHovered && !isSettled) {
      return 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1)';
    }
    return 'none';
  };

  const transition = getTransition();

  const style: React.CSSProperties = {
    transform: isHovered
      ? `perspective(1000px) rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg) scale3d(${tilt.scale}, ${tilt.scale}, ${tilt.scale})`
      : 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)',
    transition,
    transformStyle: 'preserve-3d',
    willChange: 'transform',
  };

  const glareStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 'inherit',
    background: isHovered
      ? `radial-gradient(
          circle at ${tilt.glareX}% ${tilt.glareY}%,
          rgba(255, 255, 255, 0.25) 0%,
          rgba(255, 255, 255, 0.1) 30%,
          rgba(255, 255, 255, 0) 60%
        )`
      : 'none',
    pointerEvents: 'none',
    opacity: isHovered ? 1 : 0,
    transition: `opacity ${transitionSpeed}ms ease-out`,
  };

  return {
    ref,
    style,
    glareStyle,
    isHovered,
    onMouseMove,
    onMouseEnter,
    onMouseLeave,
  };
};
