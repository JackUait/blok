// src/tools/callout/constants.ts

import { CALLOUT_CHILDREN_CLASSES, CALLOUT_WRAPPER_CLASSES } from '../../shared/tool-classes/callout';

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
/**
 * Static presentational classes live in `src/shared/tool-classes/callout.ts` so
 * the view emitter stamps the exact same set.
 */
export const WRAPPER_STYLES = CALLOUT_WRAPPER_CLASSES.join(' ');
// h-[38px] = py-[7px]×2 + 1.5rem×1 = 14+24; explicit height prevents platform-specific emoji font metrics from inflating the button
// relative anchors the absolutely-positioned knock-out ghost during the swap animation
export const EMOJI_BUTTON_STYLES = 'relative text-[1.5rem] leading-[1] cursor-pointer bg-transparent border-0 px-0 py-[7px] h-[38px] flex-shrink-0 select-none';
// inline-block: transforms don't apply to non-replaced inline elements
export const EMOJI_FACE_STYLES = 'inline-block origin-bottom';
export const EMOJI_JUMP_IN_ANIMATION = 'animate-[blok-callout-emoji-jump-in_420ms_ease-out_both]';
// top-[7px] mirrors the button's py-[7px] so the ghost sits exactly on the face
export const EMOJI_GHOST_STYLES = 'absolute left-0 top-[7px] origin-bottom pointer-events-none select-none animate-[blok-callout-emoji-knock-out_250ms_ease-in_both]';
export const CHILDREN_STYLES = CALLOUT_CHILDREN_CLASSES.join(' ');
