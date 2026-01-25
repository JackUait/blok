import React from 'react';

type WaveVariant = 'soft' | 'layered' | 'zigzag' | 'curved' | 'asymmetric';
type WavePosition = 'top' | 'bottom';

interface WaveDividerProps {
  /** Visual style of the wave */
  variant?: WaveVariant;
  /** Background color (the color the wave reveals) */
  fillColor?: string;
  /** Height of the wave in pixels */
  height?: number;
  /** Whether to flip the wave vertically */
  flip?: boolean;
  /** Position - affects z-index stacking */
  position?: WavePosition;
  /** Additional CSS class */
  className?: string;
}

const WAVE_PATHS: Record<WaveVariant, string> = {
  soft: 'M0,80 C160,160 320,0 480,80 C640,160 800,0 960,80 C1120,160 1280,0 1280,80 L1280,160 L0,160 Z',
  layered: 'M0,96 C213,144 427,48 640,96 C853,144 1067,48 1280,96 L1280,160 L0,160 Z',
  zigzag: 'M0,80 L160,128 L320,80 L480,128 L640,80 L800,128 L960,80 L1120,128 L1280,80 L1280,160 L0,160 Z',
  curved: 'M0,128 Q160,64 320,96 T640,96 T960,96 T1280,128 L1280,160 L0,160 Z',
  asymmetric: 'M0,96 C160,48 320,128 480,80 C640,32 800,112 960,64 C1120,16 1200,96 1280,80 L1280,160 L0,160 Z',
};

// Second layer paths for more depth
const WAVE_PATHS_LAYER2: Partial<Record<WaveVariant, string>> = {
  layered: 'M0,112 C160,80 320,144 480,112 C640,80 800,144 960,112 C1120,80 1200,144 1280,112 L1280,160 L0,160 Z',
  soft: 'M0,100 C200,160 360,40 560,100 C760,160 920,40 1120,100 C1200,130 1240,80 1280,100 L1280,160 L0,160 Z',
};

export const WaveDivider: React.FC<WaveDividerProps> = ({
  variant = 'soft',
  fillColor = 'var(--color-surface)',
  height = 80,
  flip = false,
  position = 'bottom',
  className = '',
}) => {
  const path = WAVE_PATHS[variant];
  const layer2Path = WAVE_PATHS_LAYER2[variant];
  const hasSecondLayer = Boolean(layer2Path);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    width: '100%',
    height: `${height}px`,
    overflow: 'hidden',
    lineHeight: 0,
    zIndex: 1,
    pointerEvents: 'none',
    ...(position === 'bottom' ? { bottom: -1 } : { top: -1 }),
    ...(flip ? { transform: 'rotate(180deg)' } : {}),
  };

  return (
    <div
      className={`wave-divider wave-divider--${variant} ${className}`}
      style={style}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 1280 160"
        preserveAspectRatio="none"
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
        }}
      >
        {/* Second layer (behind, more transparent) */}
        {hasSecondLayer && (
          <path
            d={layer2Path}
            fill={fillColor}
            opacity="0.5"
            className="wave-path wave-path--layer2"
          />
        )}
        {/* Main wave layer */}
        <path
          d={path}
          fill={fillColor}
          className="wave-path wave-path--main"
        />
      </svg>
    </div>
  );
};
