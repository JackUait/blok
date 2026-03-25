// src/tools/callout/constants.ts

export const TOOL_NAME = 'callout';

// i18n keys
export const PLACEHOLDER_KEY = 'tools.callout.placeholder';
export const ADD_EMOJI_KEY = 'tools.callout.addEmoji';
export const REMOVE_EMOJI_KEY = 'tools.callout.removeEmoji';
export const FILTER_EMOJIS_KEY = 'tools.callout.filterEmojis';
export const CALLOUT_EMOJI_CATEGORY_KEY = 'tools.callout.calloutEmojiCategory';

// Defaults
export const DEFAULT_EMOJI = '💡';
export const DEFAULT_COLOR = 'default' as const;

// CSS — Tailwind classes
export const WRAPPER_STYLES = 'rounded-[6px] px-4 py-[5px] my-1 flex flex-col';
export const HEADER_STYLES = 'flex items-start gap-2 leading-[1.5em]';
export const EMOJI_BUTTON_STYLES = 'text-[1.25rem] cursor-pointer bg-transparent border-0 px-0 py-[7px] flex-shrink-0 select-none';
export const TEXT_STYLES = 'flex-1 min-w-0 outline-hidden leading-[1.5] py-[7px]';
export const CHILDREN_STYLES = 'pl-7 empty:hidden';
