/**
 * KeyIcon — renders a keyboard key as an inline SVG glyph.
 *
 * Visually matches the compact Mac-style shortcut display:
 *   ⌘⌃L   ⌘D   ⌘⇧P   Del
 *
 * No borders, no boxes — just the Unicode symbol rendered as SVG <text>,
 * so each key is a proper vector element while looking identical to plain text.
 *
 * Usage:
 *   <KeyIcon>⌘</KeyIcon>
 *   <KeyIcon>Tab</KeyIcon>
 *   <ShortcutKeys keys={['⌘', 'B']} />
 */

const KEY_LABEL_MAP: Record<string, string> = {
  '⌘': '⌘',
  '⇧': '⇧',
  '⌥': '⌥',
  '⌃': '⌃',
  '⌫': '⌫',
  '⏎': '⏎',
  '⎋': '⎋',
  '␡': '⌦',
  '↑': '↑',
  '↓': '↓',
  '←': '←',
  '→': '→',
  '↵': '↵',
  '⇥': '⇥',
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
  enter: '↵',
  backspace: '⌫',
  escape: '⎋',
  esc: '⎋',
  delete: '⌦',
  del: 'Del',
  tab: '⇥',
  ins: 'Ins',
  win: '⊞',
};

function resolveLabel(key: string): string {
  const trimmed = key.trim();

  return KEY_LABEL_MAP[trimmed.toLowerCase()] ?? KEY_LABEL_MAP[trimmed] ?? trimmed;
}

interface KeyIconProps extends React.SVGProps<SVGSVGElement> {
  children: string;
  title?: string;
}

/**
 * Renders a single key as an inline SVG glyph — no border, no box.
 */
export const KeyIcon: React.FC<KeyIconProps> = ({ children, className, style, ...rest }) => {
  const label = resolveLabel(children);
  const isSymbol = label.length === 1;
  const fontSize = isSymbol ? 13 : 11;
  const charWidth = isSymbol ? 13 : 7.5;
  const w = Math.ceil(label.length * charWidth);
  const h = 16;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
      aria-hidden="true"
      className={className}
      {...rest}
    >
      <text
        x={w / 2}
        y={h / 2 + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"
        fontSize={fontSize}
        fontWeight={400}
        fill="currentColor"
      >
        {label}
      </text>
    </svg>
  );
};

interface ShortcutKeysProps {
  keys: string[];
  className?: string;
}

/**
 * Renders a full shortcut combination as tightly grouped SVG glyph icons.
 * No separators between keys — matches ⌘⌃L style.
 */
export const ShortcutKeys: React.FC<ShortcutKeysProps> = ({ keys, className }) => {
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1 }}
      className={className}
    >
      {keys.map((key, i) => (
        <KeyIcon key={i}>{key}</KeyIcon>
      ))}
    </span>
  );
};
