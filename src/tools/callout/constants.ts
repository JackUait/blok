// src/tools/callout/constants.ts

export const TOOL_NAME = 'callout';

// i18n keys
export const COLOR_KEY = 'tools.callout.color';
export const EDIT_ICON_KEY = 'tools.callout.editIcon';
export const ADD_EMOJI_KEY = 'tools.callout.addEmoji';
export const REMOVE_EMOJI_KEY = 'tools.callout.removeEmoji';
export const FILTER_EMOJIS_KEY = 'tools.callout.filterEmojis';
export const CALLOUT_EMOJI_CATEGORY_KEY = 'tools.callout.calloutEmojiCategory';
export const NO_EMOJIS_FOUND_KEY = 'tools.callout.noEmojisFound';
export const EMOJI_SEARCH_RESULTS_KEY = 'tools.callout.emojiSearchResults';
export const PICK_RANDOM_KEY = 'tools.callout.pickRandom';
export const SKIN_TONE_KEY = 'tools.callout.skinTone';
export const EMOJI_CATEGORY_PEOPLE_KEY = 'tools.callout.emojiCategoryPeople';
export const EMOJI_CATEGORY_NATURE_KEY = 'tools.callout.emojiCategoryNature';
export const EMOJI_CATEGORY_FOOD_KEY = 'tools.callout.emojiCategoryFood';
export const EMOJI_CATEGORY_ACTIVITY_KEY = 'tools.callout.emojiCategoryActivity';
export const EMOJI_CATEGORY_TRAVEL_KEY = 'tools.callout.emojiCategoryTravel';
export const EMOJI_CATEGORY_OBJECTS_KEY = 'tools.callout.emojiCategoryObjects';
export const EMOJI_CATEGORY_SYMBOLS_KEY = 'tools.callout.emojiCategorySymbols';
export const EMOJI_CATEGORY_FLAGS_KEY = 'tools.callout.emojiCategoryFlags';

// Defaults
export const DEFAULT_EMOJI = '💡';

// CSS — Tailwind classes
// Vertical padding follows the public --blok-block-padding-top/-bottom tokens
// with the callout's own 5px defaults as fallbacks (pl-8/pr-4 are the callout
// card inset, not the generic block inset — they stay hardcoded).
export const WRAPPER_STYLES = 'rounded-xl pl-8 pr-4 pt-[var(--blok-block-padding-top,5px)] pb-[var(--blok-block-padding-bottom,5px)] my-1 flex items-start gap-2 relative';
// h-[38px] = py-[7px]×2 + 1.5rem×1 = 14+24; explicit height prevents platform-specific emoji font metrics from inflating the button
export const EMOJI_BUTTON_STYLES = 'text-[1.5rem] leading-[1] cursor-pointer bg-transparent border-0 px-0 py-[7px] h-[38px] flex-shrink-0 select-none';
export const CHILDREN_STYLES = 'flex-1 min-w-0';
