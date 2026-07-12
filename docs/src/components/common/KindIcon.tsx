import { memo } from 'react';
import type { SearchResultKind } from '@/types/search';

interface KindIconProps {
  kind: SearchResultKind;
  size?: number;
}

/**
 * A distinct glyph per result kind so users can scan a results list by type
 * (every method shares a shape, every option shares another) before reading a
 * single word. Pairs with the textual kind label for unambiguous meaning.
 */
export const KindIcon: React.FC<KindIconProps> = memo(({ kind, size = 15 }) => {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (kind) {
    // Parentheses — a callable.
    case 'method':
      return (
        <svg {...common}>
          <path d="M8 4C5 7 5 17 8 20" />
          <path d="M16 4c3 3 3 13 0 16" />
        </svg>
      );
    // Sliders — a tunable setting.
    case 'option':
      return (
        <svg {...common}>
          <path d="M4 8h10" />
          <path d="M4 16h6" />
          <circle cx="17" cy="8" r="2.5" />
          <circle cx="13" cy="16" r="2.5" />
        </svg>
      );
    // Tag — a named value.
    case 'property':
      return (
        <svg {...common}>
          <path d="M4 4h7l9 9-7 7-9-9V4z" />
          <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    // Hash — a documentation section.
    case 'section':
      return (
        <svg {...common}>
          <path d="M9 4L7 20" />
          <path d="M17 4l-2 16" />
          <path d="M5 9h15" />
          <path d="M4 15h15" />
        </svg>
      );
    // Document — a whole page.
    case 'page':
    default:
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
      );
  }
});

KindIcon.displayName = 'KindIcon';
