/**
 * Unused CSS Analyzer
 * Compares CSS definitions with actual usage to find unused CSS
 */

import type { ParsedCSS } from './css-parser.js';
import type { ScanResult } from './scanner.js';

export interface AnalyzerOptions {
  ignoreTailwindUtilities?: boolean;
  tailwindPrefix?: string;
}

export interface FileUnusedItems {
  classes: string[];
  attributes: string[];
}

export interface UnusedCSSReport {
  // Overall statistics
  totalClasses: number;
  usedClassesCount: number;
  unusedClassesCount: number;
  classUsagePercentage: number;
  totalAttributes: number;
  usedAttributesCount: number;
  unusedAttributesCount: number;
  attributeUsagePercentage: number;

  // Lists of items
  usedClasses: string[];
  unusedClasses: string[];
  usedAttributes: string[];
  unusedAttributes: string[];

  // Grouped by file
  unusedByFile: Record<string, FileUnusedItems>;
}

/**
 * Common Tailwind CSS utility class patterns
 * These are dynamically generated and used, so we typically ignore them
 */
const TAILWIND_PATTERNS = [
  // Spacing
  /^p-?[0-9xl]+$/,
  /^px-?[0-9xl]+$/,
  /^py-?[0-9xl]+$/,
  /^pt-?[0-9xl]+$/,
  /^pr-?[0-9xl]+$/,
  /^pb-?[0-9xl]+$/,
  /^pl-?[0-9xl]+$/,
  /^m-?[0-9xl]+$/,
  /^mx-?[0-9xl]+$/,
  /^my-?[0-9xl]+$/,
  // Flexbox
  /^flex$/,
  /^flex-(row|col|wrap|nowrap|reverse|grow|shrink)$/,
  /^justify-(start|end|center|between|around|evenly)$/,
  /^items-(start|end|center|baseline|stretch)$/,
  // Display
  /^block$/,
  /^inline-block$/,
  /^hidden$/,
  /^inline$/,
  // Colors
  /^bg-(white|black|transparent|gray-\d+|red-\d+|blue-\d+|green-\d+|yellow-\d+)$/,
  /^text-(white|black|gray-\d+|red-\d+|blue-\d+|green-\d+|yellow-\d+)$/,
  // Borders
  /^border$/,
  /^border-?[0-2]$/,
  /^rounded(-?[0-9xl]+)?$/,
  // Sizing
  /^w-?\d+$/,
  /^h-?\d+$/,
  /^max-w-?\w+$/,
  // Position
  /^relative$/,
  /^absolute$/,
  /^fixed$/,
  /^sticky$/,
  // Typography
  /^text-(xs|sm|base|lg|xl|\d+xl)$/,
  /^font-(thin|light|normal|medium|semibold|bold|extrabold|black)$/,
  // Shadows
  /^shadow(-?\w+)?$/,
  // Other utilities
  /^opacity-?\d+$/,
  /^cursor-(pointer|default|not-allowed)$/,
  /^pointer-events-none$/,
];

/**
 * Check if a class name is likely a Tailwind utility class
 */
const isTailwindUtility = (className: string): boolean => {
  return TAILWIND_PATTERNS.some(pattern => pattern.test(className));
};

/**
 * Determine if a class should be included based on Tailwind filter settings
 */
const shouldIncludeClass = (className: string, ignoreTailwindUtilities: boolean): boolean => {
  return !ignoreTailwindUtilities || !isTailwindUtility(className);
};

/**
 * Analyze CSS definitions vs usage to find unused CSS
 */
export const analyzeUnusedCSS = (
  cssFiles: ParsedCSS[],
  sourceScan: ScanResult,
  options: AnalyzerOptions = {},
): UnusedCSSReport => {
  const { ignoreTailwindUtilities = true } = options;

  // Collect all defined classes and attributes
  const definedClasses = new Set<string>();
  const definedAttributes = new Set<string>();

  for (const cssFile of cssFiles) {
    cssFile.classes
      .filter(className => shouldIncludeClass(className, ignoreTailwindUtilities))
      .forEach(className => definedClasses.add(className));
    cssFile.attributes.forEach(attr => definedAttributes.add(attr));
  }

  // Convert source scan to Sets for easier lookup
  const usedClassesSet = new Set(sourceScan.allClasses);
  const usedAttributesSet = new Set(sourceScan.allAttributes);

  // Find used and unused classes
  const usedClasses: string[] = [];
  const unusedClasses: string[] = [];

  for (const className of definedClasses) {
    if (usedClassesSet.has(className)) {
      usedClasses.push(className);
    } else {
      unusedClasses.push(className);
    }
  }

  // Find used and unused attributes
  const usedAttributes: string[] = [];
  const unusedAttributes: string[] = [];

  for (const attr of definedAttributes) {
    if (usedAttributesSet.has(attr)) {
      usedAttributes.push(attr);
    } else {
      unusedAttributes.push(attr);
    }
  }

  // Group unused items by file
  const unusedByFile: Record<string, FileUnusedItems> = {};

  for (const cssFile of cssFiles) {
    const fileUnusedClasses = cssFile.classes
      .filter(c => shouldIncludeClass(c, ignoreTailwindUtilities))
      .filter(c => !usedClassesSet.has(c));

    const fileUnusedAttributes = cssFile.attributes.filter(a => !usedAttributesSet.has(a));

    if (fileUnusedClasses.length > 0 || fileUnusedAttributes.length > 0) {
      unusedByFile[cssFile.filePath] = {
        classes: fileUnusedClasses,
        attributes: fileUnusedAttributes,
      };
    }
  }

  // Calculate statistics
  const totalClasses = definedClasses.size;
  const usedClassesCount = usedClasses.length;
  const unusedClassesCount = unusedClasses.length;
  const classUsagePercentage = totalClasses > 0
    ? Math.round((usedClassesCount / totalClasses) * 100)
    : 100;

  const totalAttributes = definedAttributes.size;
  const usedAttributesCount = usedAttributes.length;
  const unusedAttributesCount = unusedAttributes.length;
  const attributeUsagePercentage = totalAttributes > 0
    ? Math.round((usedAttributesCount / totalAttributes) * 100)
    : 100;

  return {
    totalClasses,
    usedClassesCount,
    unusedClassesCount,
    classUsagePercentage,
    totalAttributes,
    usedAttributesCount,
    unusedAttributesCount,
    attributeUsagePercentage,
    usedClasses,
    unusedClasses,
    usedAttributes,
    unusedAttributes,
    unusedByFile,
  };
};
