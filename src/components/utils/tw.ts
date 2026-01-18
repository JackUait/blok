/**
 * Minimal Tailwind class merger optimized for Blok's specific class usage patterns.
 * Handles conflicts between classes in the same category where later classes should override earlier ones.
 */

/**
 * Regex patterns for class categories where conflicts can occur.
 * Each pattern captures the "group" that defines conflict - classes in the same group override each other.
 */
const CLASS_PATTERNS: Array<{ pattern: RegExp; getGroup: (match: RegExpMatchArray) => string }> = [
  // Max-width: max-w-* classes conflict with each other
  { pattern: /^max-w-(.+)$/, getGroup: () => 'max-w' },

  // Width: w-* classes conflict with each other
  { pattern: /^w-(.+)$/, getGroup: () => 'w' },

  // Min-width: min-w-* classes conflict with each other
  { pattern: /^min-w-(.+)$/, getGroup: () => 'min-w' },

  // Height: h-* classes conflict with each other
  { pattern: /^h-(.+)$/, getGroup: () => 'h' },

  // Display: block, inline-block, flex, hidden, etc.
  { pattern: /^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden|contents|flow-root|list-item)$/, getGroup: () => 'display' },

  // Flex direction: flex-row, flex-col
  { pattern: /^flex-(row|col|row-reverse|col-reverse)$/, getGroup: () => 'flex-dir' },

  // Justify content: justify-*
  { pattern: /^justify-(.+)$/, getGroup: () => 'justify' },

  // Align items: items-*
  { pattern: /^items-(.+)$/, getGroup: () => 'items' },

  // Text alignment: text-left, text-center, text-right
  { pattern: /^text-(left|center|right|justify|start|end)$/, getGroup: () => 'text-align' },

  // Text color: text-{color} (but not text-align classes)
  { pattern: /^text-((?!left|center|right|justify|start|end).+)$/, getGroup: () => 'text-color' },

  // Background: bg-*
  { pattern: /^bg-(.+)$/, getGroup: () => 'bg' },

  // Opacity: opacity-*
  { pattern: /^opacity-(.+)$/, getGroup: () => 'opacity' },

  // Z-index: z-*
  { pattern: /^z-(.+)$/, getGroup: () => 'z' },

  // Position: static, fixed, absolute, relative, sticky
  { pattern: /^(static|fixed|absolute|relative|sticky)$/, getGroup: () => 'position' },

  // Inset (all sides): inset-*
  { pattern: /^inset-(.+)$/, getGroup: () => 'inset' },

  // Top/Right/Bottom/Left positioning
  { pattern: /^(top|right|bottom|left)-(.+)$/, getGroup: (m) => m[1] },

  // Margin: m-*, mx-*, my-*, mt-*, mr-*, mb-*, ml-*
  { pattern: /^!?m-(.+)$/, getGroup: () => 'm' },
  { pattern: /^!?mx-(.+)$/, getGroup: () => 'mx' },
  { pattern: /^!?my-(.+)$/, getGroup: () => 'my' },
  { pattern: /^!?mt-(.+)$/, getGroup: () => 'mt' },
  { pattern: /^!?mr-(.+)$/, getGroup: () => 'mr' },
  { pattern: /^!?mb-(.+)$/, getGroup: () => 'mb' },
  { pattern: /^!?ml-(.+)$/, getGroup: () => 'ml' },

  // Padding: p-*, px-*, py-*, pt-*, pr-*, pb-*, pl-*
  { pattern: /^p-(.+)$/, getGroup: () => 'p' },
  { pattern: /^px-(.+)$/, getGroup: () => 'px' },
  { pattern: /^py-(.+)$/, getGroup: () => 'py' },
  { pattern: /^pt-(.+)$/, getGroup: () => 'pt' },
  { pattern: /^pr-(.+)$/, getGroup: () => 'pr' },
  { pattern: /^pb-(.+)$/, getGroup: () => 'pb' },
  { pattern: /^pl-(.+)$/, getGroup: () => 'pl' },

  // Gap: gap-*, gap-x-*, gap-y-*
  { pattern: /^gap-(.+)$/, getGroup: () => 'gap' },

  // Border radius: rounded-*
  { pattern: /^rounded(-.*)?$/, getGroup: () => 'rounded' },

  // Visibility: visible, invisible
  { pattern: /^(visible|invisible)$/, getGroup: () => 'visibility' },

  // Overflow: overflow-*
  { pattern: /^overflow-(.+)$/, getGroup: () => 'overflow' },

  // Cursor: cursor-*
  { pattern: /^cursor-(.+)$/, getGroup: () => 'cursor' },

  // Pointer events: pointer-events-*
  { pattern: /^pointer-events-(.+)$/, getGroup: () => 'pointer-events' },

  // Transition: transition-*
  { pattern: /^transition(-.*)?$/, getGroup: () => 'transition' },

  // Duration: duration-*
  { pattern: /^duration-(.+)$/, getGroup: () => 'duration' },

  // Ease: ease-*
  { pattern: /^ease-(.+)$/, getGroup: () => 'ease' },

  // Animation: animate-*
  { pattern: /^animate-(.+)$/, getGroup: () => 'animate' },

  // Font weight: font-*
  { pattern: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/, getGroup: () => 'font-weight' },

  // Font size: text-{size}
  { pattern: /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/, getGroup: () => 'font-size' },

  // Line height: leading-*
  { pattern: /^leading-(.+)$/, getGroup: () => 'leading' },

  // Outline: outline-*
  { pattern: /^outline(-.*)?$/, getGroup: () => 'outline' },

  // Border: border-*
  { pattern: /^border(-.*)?$/, getGroup: () => 'border' },

  // Shadow: shadow-*
  { pattern: /^shadow(-.*)?$/, getGroup: () => 'shadow' },
];

/**
 * Cache for class group lookups to avoid repeated regex matching
 */
const classGroupCache = new Map<string, string | null>();

/**
 * Gets the conflict group for a class, or null if it doesn't belong to a conflict group.
 * Uses caching for performance.
 */
const getClassGroup = (className: string): string | null => {
  const cached = classGroupCache.get(className);

  if (cached !== undefined) {
    return cached;
  }

  for (const { pattern, getGroup } of CLASS_PATTERNS) {
    const match = className.match(pattern);

    if (match) {
      const group = getGroup(match);

      classGroupCache.set(className, group);

      return group;
    }
  }

  classGroupCache.set(className, null);

  return null;
};

type ClassValue = string | string[] | undefined | null | false;

/**
 * Processes a single class and adds it to the result maps
 */
const processClass = (
  cls: string,
  result: Map<string, string>,
  nonConflicting: string[]
): void => {
  const group = getClassGroup(cls);

  if (group) {
    result.set(group, cls);

    return;
  }

  // Non-conflicting class - add if not already present
  if (!nonConflicting.includes(cls)) {
    nonConflicting.push(cls);
  }
};

/**
 * Flattens inputs into a single array of class strings
 */
const flattenInputs = (inputs: ClassValue[]): string[] => {
  const strings: string[] = [];

  for (const input of inputs) {
    if (!input) {
      continue;
    }

    if (Array.isArray(input)) {
      strings.push(...input.filter(Boolean));
      continue;
    }

    strings.push(input);
  }

  return strings;
};

/**
 * Merges Tailwind CSS class names, resolving conflicts intelligently.
 * Later classes override earlier ones when they conflict.
 *
 * @example
 * twMerge('p-2 p-4') // => 'p-4'
 * twMerge('text-red-500', 'text-blue-500') // => 'text-blue-500'
 * twMerge('px-2 py-1', 'p-3') // => 'py-1 p-3' (p-3 overrides px-2, py-1 kept)
 *
 * Use this when extending base styles from api.styles.*
 * @example
 * const blockStyles = twMerge(api.styles.block, 'my-custom-padding')
 */
export const twMerge = (...inputs: ClassValue[]): string => {
  const result = new Map<string, string>();
  const nonConflicting: string[] = [];
  const flatInputs = flattenInputs(inputs);

  for (const input of flatInputs) {
    const classes = input.split(/\s+/).filter(Boolean);

    classes.forEach((cls) => processClass(cls, result, nonConflicting));
  }

  return [...nonConflicting, ...result.values()].join(' ');
};

/**
 * Joins Tailwind CSS class names without conflict resolution.
 * Use this when you know classes don't conflict and want faster execution.
 *
 * @example
 * twJoin('flex', 'items-center', 'gap-2') // => 'flex items-center gap-2'
 */
export const twJoin = (...inputs: Array<string | undefined | null | false>): string => {
  return inputs.filter(Boolean).join(' ');
};
