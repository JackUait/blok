import { twMerge as merge, twJoin as join } from 'tailwind-merge';

/**
 * Merges Tailwind CSS class names, resolving conflicts intelligently.
 * Later classes override earlier ones when they conflict.
 *
 * @example
 * twMerge('p-2 p-4') // => 'p-4'
 * twMerge('text-red-500', 'text-blue-500') // => 'text-blue-500'
 * twMerge('px-2 py-1', 'p-3') // => 'p-3'
 *
 * Use this when extending base styles from api.styles.*
 * @example
 * const blockStyles = twMerge(api.styles.block, 'my-custom-padding')
 */
export const twMerge = merge;

/**
 * Joins Tailwind CSS class names without conflict resolution.
 * Use this when you know classes don't conflict and want faster execution.
 *
 * @example
 * twJoin('flex', 'items-center', 'gap-2') // => 'flex items-center gap-2'
 */
export const twJoin = join;
