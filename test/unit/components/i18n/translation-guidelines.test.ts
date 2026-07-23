import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  findDuplicateJsonKeys,
  findLocaleIntegrityIssues,
  getBoundaryWhitespaceExceptions,
} from '../../../../scripts/i18n/check-translations.mjs';

type EnglishMessages = Record<string, string>;
type LocaleMessages = Record<string, unknown>;

const LOCALES_DIR = resolve(
  __dirname,
  '../../../../src/components/i18n/locales'
);
const AUDIT_LEDGER_PATH = resolve(
  __dirname,
  '../../../../docs/plans/2026-07-19-all-locales-translation-audit-ledger.md'
);
const TRANSLATION_GUIDELINES_PATH = resolve(
  __dirname,
  '../../../../src/components/i18n/locales/TRANSLATION_GUIDELINES.md'
);
const LOCALIZED_GROUP_MOVE_EXPECTATIONS_PATH = resolve(
  __dirname,
  'fixtures/localized-group-move-expectations.json'
);
const LOCALIZED_RECENTLY_USED_EXPECTATIONS_PATH = resolve(
  __dirname,
  'fixtures/localized-recently-used-expectations.json'
);
const LOCALIZED_POPOVER_SEARCH_EXPECTATIONS_PATH = resolve(
  __dirname,
  'fixtures/localized-popover-search-expectations.json'
);
const LOCALIZED_LINK_TYPE_EXPECTATIONS_PATH = resolve(
  __dirname,
  'fixtures/localized-link-type-expectations.json'
);

const localeCodes = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();
const localeCache = new Map<
  string,
  { raw: string; messages: LocaleMessages }
>();

const readLocale = (
  locale: string
): { raw: string; messages: LocaleMessages } => {
  const cached = localeCache.get(locale);

  if (cached !== undefined) {
    return cached;
  }

  const raw = readFileSync(join(LOCALES_DIR, locale, 'messages.json'), 'utf-8');
  const result = {
    raw,
    messages: JSON.parse(raw) as LocaleMessages,
  };

  localeCache.set(locale, result);

  return result;
};

const english = readLocale('en').messages as EnglishMessages;
const englishKeys = Object.keys(english).sort();
const auditLedger = readFileSync(AUDIT_LEDGER_PATH, 'utf-8');
const translationGuidelines = readFileSync(
  TRANSLATION_GUIDELINES_PATH,
  'utf-8'
);
const localizedGroupMoveExpectations = JSON.parse(
  readFileSync(LOCALIZED_GROUP_MOVE_EXPECTATIONS_PATH, 'utf-8')
) as Record<string, Record<string, string>>;
const localizedRecentlyUsedExpectations = JSON.parse(
  readFileSync(LOCALIZED_RECENTLY_USED_EXPECTATIONS_PATH, 'utf-8')
) as Record<string, string>;
const localizedPopoverSearchExpectations = JSON.parse(
  readFileSync(LOCALIZED_POPOVER_SEARCH_EXPECTATIONS_PATH, 'utf-8')
) as Record<string, string>;
const localizedLinkTypeExpectations = JSON.parse(
  readFileSync(LOCALIZED_LINK_TYPE_EXPECTATIONS_PATH, 'utf-8')
) as Record<string, string>;
const RESULT_STATES = new Set(['pending', 'open', 'pass']);
const FINAL_STATUSES = new Set([
  'pending',
  'first-pass-complete',
  'second-pass-complete',
  'verified',
]);
const FINDING_STATUSES = new Set(['open', 'verified']);
const RETENTION_CATEGORIES = new Set([
  'universal notation',
  'product-brand',
  'acronym',
  'established cognate',
  'established loanword',
]);
const GLOBAL_FINDING_KEYS = new Set([
  '77 changed English source keys',
  'four expanded emoji category keys',
  'tools.colorPicker.recentlyUsed localized labels',
  'popover.search localized action placeholders',
  'notifier.dismiss helper localization contract',
  'tools.link.webLink catch-all labels',
  'detached editor UI direction contract',
  'drag move destination contract',
  'tool API interpolation contract',
  'lifecycle coverage taxonomy',
  'media URL upload status contract',
  'tools.video.toggleTimeDisplay',
  'tools.video.ctxStats',
  'tools.video playback-statistics detail templates',
  'tools.database tab-overflow count template',
  'mobile popover back-button localization contract',
  'read-only settings tooltip whole-message contract',
  'segmented tooltip shortcut direction contract',
  'Central Kurdish browser-tag alias contract',
  'Sorani emoji metadata dialect contract',
]);

const ENGLISH_GUIDELINE_EXPECTATIONS: Readonly<Record<string, string>> = {
  'popover.search': 'Find an action…',
  'blockSettings.openMenuAction': ' to open the menu',
  'blockSettings.orConjunction': ' or press ',
  'blockSettings.convertWithChildrenWarning':
    'Nested blocks: {count}. Converting this block will move the nested content to the top level. Continue?',
  'tools.marker.textColor': 'Text color',
  'tools.colorPicker.recentlyUsed': 'Recently used',
  'tools.toggle.bodyPlaceholder':
    'Empty toggle. Click to add a block, or drag blocks here.',
  'tools.table.insertColumnLeft': 'Insert column left',
  'tools.table.insertColumnRight': 'Insert column right',
  'tools.table.insertRowAbove': 'Insert row above',
  'tools.table.insertRowBelow': 'Insert row below',
  'tools.table.clearSelection': 'Clear contents',
  'tools.table.placement': 'Alignment',
  'tools.table.placementTopLeft': 'Top left',
  'tools.table.placementTopCenter': 'Top center',
  'tools.table.placementTopRight': 'Top right',
  'tools.table.placementMiddleLeft': 'Middle left',
  'tools.table.placementMiddleRight': 'Middle right',
  'tools.table.placementBottomLeft': 'Bottom left',
  'tools.table.placementBottomCenter': 'Bottom center',
  'tools.table.placementBottomRight': 'Bottom right',
  'a11y.dropCancelled': 'Drag canceled',
  'a11y.atTop': 'Cannot move up. Already at the top.',
  'a11y.atBottom': 'Cannot move down. Already at the bottom.',
  'a11y.movedUp': 'Moved up to position {position} of {total}',
  'a11y.movedDown': 'Moved down to position {position} of {total}',
  'a11y.searchResults': 'Search results: {count}',
  'a11y.allBlocksSelected': 'All blocks selected. Total: {count}',
  'tools.callout.addEmoji': 'Add icon',
  'tools.callout.filterEmojis': 'Search emojis…',
  'tools.callout.pickRandom': 'Pick a random emoji',
  'tools.callout.emojiCategoryPeople': 'Smileys & people',
  'tools.callout.emojiCategoryNature': 'Animals & nature',
  'tools.callout.emojiCategoryFood': 'Food & drink',
  'tools.callout.emojiCategoryTravel': 'Travel & places',
  'tools.code.searchLanguage': 'Search languages…',
  'tools.code.plainText': 'Plain text',
  'tools.link.webLink': 'Link',
  'tools.link.linkTitle': 'Link text',
  'tools.image.altDescription':
    'Describe this image for people who can’t see it.',
  'tools.image.viewFullscreen': 'View full screen',
  'tools.image.exitFullscreen': 'Exit full screen',
  'tools.image.cropAspectRatio': 'Crop shape',
  'tools.image.errorSourceOffline': 'The source file may have moved or be offline.',
  'tools.image.errorDefaultMessage':
    'The image couldn’t be loaded from this URL. Try a different source or upload the file again.',
  'tools.file.previewRaw': 'Source',
  'tools.file.previewRender': 'Preview',
  'tools.file.previewError': 'Couldn’t load preview',
  'tools.file.previewBackToContent': 'Back to content',
  'tools.database.viewTypeListDescription': 'Show items in a simple list',
  'tools.database.viewTypeBoardDescription': 'Show items in columns',
  'tools.bookmark.loading': 'Loading link preview…',
  'tools.embed.empty': 'No embed link',
  'tools.video.toggleTimeDisplay':
    'Switch between elapsed and remaining time',
  'tools.video.ctxStats': 'Playback statistics',
  'tools.video.fullscreen': 'Full screen',
  'tools.video.fullscreenExit': 'Exit full screen',
  'tools.video.captionPlaceholder': 'Write a caption…',
  'tools.audio.errorGoogleDrive':
    'Audio from Google Drive can’t be played directly. Download the file and upload it here instead.',
  'tools.audio.errorOneDrive':
    'Audio from OneDrive can’t be played directly. Download the file and upload it here instead.',
  'tools.audio.captionPlaceholder': 'Write a caption…',
  'tools.linkPaste.embedVideo': 'Embed a video from {provider}',
  'tools.linkPaste.embedAudio': 'Embed audio from {provider}',
  'tools.linkPaste.embedImage': 'Embed an image from {provider}',
  'tools.linkPaste.embedSocial': 'Embed a post from {provider}',
  'tools.linkPaste.embedDocument': 'Embed a document from {provider}',
  'tools.linkPaste.embedTable': 'Embed a table from {provider}',
  'tools.linkPaste.embedForm': 'Embed a form from {provider}',
  'tools.linkPaste.embedCode': 'Embed code from {provider}',
  'tools.linkPaste.embedDesign': 'Embed a design from {provider}',
  'tools.linkPaste.embedChart': 'Embed a chart from {provider}',
  'tools.linkPaste.embedMap': 'Embed a map from {provider}',
  'tools.linkPaste.embedCalendar': 'Embed a calendar from {provider}',
  'tools.callout.emojiSearchResults': 'Emoji matches: {count}',
  'toolNames.clearFormat': 'Clear formatting',
  'notifier.confirm': 'Confirm',
  'notifier.cancel': 'Cancel',
  'notifier.ok': 'OK',
};

const GEORGIAN_CALLER_EXPECTATIONS: Readonly<Record<string, string>> = {
  'blockSettings.lastEditedBy': 'ბოლო რედაქტორი: {name}',
  'a11y.blocksMoved': 'გადატანილია {count} ბლოკი. ახალი პოზიცია: {position}.',
  'a11y.blocksDuplicated':
    'დუბლირებულია {count} ბლოკი. ასლების საწყისი პოზიცია: {position}.',
  'tools.image.resetZoom': 'მასშტაბის საწყისზე დაბრუნება',
  'tools.image.cropReset': 'საწყისზე დაბრუნება',
  'tools.image.errorFileTooLarge':
    'სურათი ძალიან დიდია. ზომა: {size}; ლიმიტი: {max}.',
  'tools.file.errorFileTooLarge':
    'ფაილი ძალიან დიდია. ზომა: {size}; ლიმიტი: {max}.',
  'tools.video.errorFileTooLarge':
    'ვიდეო ძალიან დიდია. ზომა: {size}; ლიმიტი: {max}.',
  'tools.audio.errorFileTooLarge':
    'აუდიო ძალიან დიდია. ზომა: {size}; ლიმიტი: {max}.',
};

const KHMER_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'popover.convertTo': 'បំប្លែងទៅជា',
  'tools.paragraph.placeholder':
    'សរសេរអ្វីមួយ ឬចុច / ដើម្បីជ្រើសរើសឧបករណ៍',
  'tools.table.clearSelection': 'លុបមាតិកា',
  'tools.table.placement': 'ការតម្រឹម',
  'a11y.searchResults': 'លទ្ធផលស្វែងរក៖ {count}',
  'tools.columns.col2': 'ជួរឈរ ២',
  'tools.columns.col3': 'ជួរឈរ ៣',
  'tools.columns.col4': 'ជួរឈរ ៤',
  'tools.columns.col5': 'ជួរឈរ ៥',
  'tools.callout.addEmoji': 'បន្ថែមរូបតំណាង',
  'tools.callout.filterEmojis': 'ស្វែងរករូបអារម្មណ៍…',
  'tools.callout.pickRandom': 'ជ្រើសរើសរូបអារម្មណ៍ដោយចៃដន្យ',
  'tools.database.addColumn': 'បន្ថែមជួរឈរ',
  'tools.database.renameColumn': 'ប្ដូរឈ្មោះជួរឈរ',
  'tools.database.deleteColumn': 'លុបជួរឈរ',
  'tools.database.columnTitlePlaceholder': 'ជួរឈរ',
  'tools.database.addRow': 'បន្ថែមជួរដេក',
  'tools.database.newRow': 'ជួរដេកថ្មី',
  'tools.database.openRow': 'បើកជួរដេក',
  'tools.database.deleteRow': 'លុបជួរដេក',
  'blockSettings.blocksSelected': 'ប្លុក {count}',
  'tools.link.linkTitle': 'អត្ថបទតំណ',
  'tools.image.converting': 'កំពុងបំប្លែង…',
  'tools.file.previewRaw': 'ប្រភព',
  'tools.file.previewRender': 'មើលជាមុន',
  'tools.embed.empty': 'គ្មានតំណសម្រាប់បង្កប់',
  'tools.embed.captionPlaceholder': 'សរសេរចំណងជើងរង…',
  'tools.video.toggleTimeDisplay':
    'ប្ដូររវាងពេលវេលាដែលបានកន្លងផុត និងពេលវេលាដែលនៅសល់',
  'tools.callout.emojiSearchResults': 'រូបអារម្មណ៍ដែលត្រូវគ្នា៖ {count}',
  'toolNames.board': 'ក្ដារ',
  'searchTerms.accordion': 'ផ្ទាំងបិទបើក',
  'searchTerms.grid': 'ក្រឡាចត្រង្គ',
  'tools.callout.emojiCategoryPeople': 'មុខញញឹម និងមនុស្ស',
  'tools.image.altDescription':
    'ពិពណ៌នារូបភាពនេះសម្រាប់អ្នកដែលមិនអាចមើលឃើញវា។',
  'tools.bookmark.loading': 'កំពុងផ្ទុកការមើលតំណជាមុន…',
  'tools.bookmark.error': 'មិនអាចផ្ទុកការមើលតំណជាមុនបានទេ',
  'tools.video.ctxStats': 'ស្ថិតិការចាក់',
  'a11y.allBlocksSelected':
    'បានជ្រើសរើសប្លុកទាំងអស់។ សរុប៖ {count}',
  'tools.code.searchLanguage': 'ស្វែងរកភាសា…',
  'tools.link.jumpToSection': 'រំលងទៅផ្នែក',
  'tools.image.resetZoom': 'កំណត់កម្រិតពង្រីកឡើងវិញ',
  'tools.video.alignmentLeft': 'តម្រឹមឆ្វេង',
  'tools.video.alignmentCenter': 'តម្រឹមកណ្ដាល',
  'tools.video.alignmentRight': 'តម្រឹមស្ដាំ',
  'tools.audio.alignmentLeft': 'តម្រឹមឆ្វេង',
  'tools.audio.alignmentCenter': 'តម្រឹមកណ្ដាល',
  'tools.audio.alignmentRight': 'តម្រឹមស្ដាំ',
  'tools.database.duplicateView': 'ស្ទួន',
  'tools.image.uploading': 'កំពុងបង្ហោះ…',
  'tools.image.uploadingLabel': 'កំពុងបង្ហោះ',
  'tools.image.cancelUpload': 'បោះបង់ការបង្ហោះ',
  'tools.image.uploadProgress': 'វឌ្ឍនភាពនៃការបង្ហោះ',
  'tools.image.errorUploadFailed': 'ការបង្ហោះបានបរាជ័យ',
  'tools.image.errorUploadFailedTitle': 'ការបង្ហោះបានបរាជ័យ',
  'tools.image.errorDefaultMessage':
    'មិនអាចផ្ទុករូបភាពពី URL នេះបានទេ។ សូមសាកល្បងប្រភពផ្សេង ឬបង្ហោះឯកសារឡើងវិញ។',
  'tools.image.emptyUpload': 'បង្ហោះ',
  'tools.image.emptyDropToUpload': 'ទម្លាក់ដើម្បីបង្ហោះ',
  'tools.file.emptyUpload': 'បង្ហោះ',
  'tools.file.emptyDropToUpload': 'ទម្លាក់ដើម្បីបង្ហោះ',
  'tools.file.uploading': 'កំពុងបង្ហោះ…',
  'tools.file.cancelUpload': 'បោះបង់ការបង្ហោះ',
  'tools.file.uploadProgress': 'វឌ្ឍនភាពនៃការបង្ហោះ',
  'tools.file.errorUploadFailed': 'ការបង្ហោះបានបរាជ័យ',
  'tools.video.uploading': 'កំពុងបង្ហោះ…',
  'tools.video.errorUploadFailed': 'ការបង្ហោះបានបរាជ័យ',
  'tools.video.emptyUpload': 'បង្ហោះ',
  'tools.video.emptyDropToUpload': 'ទម្លាក់ដើម្បីបង្ហោះ',
  'tools.audio.uploading': 'កំពុងបង្ហោះ…',
  'tools.audio.errorUploadFailed': 'ការបង្ហោះបានបរាជ័យ',
  'tools.audio.errorGoogleDrive':
    'អូឌីយ៉ូពី Google Drive មិនអាចចាក់ដោយផ្ទាល់បានទេ។ សូមទាញយកឯកសារ រួចបង្ហោះវានៅទីនេះជំនួសវិញ។',
  'tools.audio.errorOneDrive':
    'អូឌីយ៉ូពី OneDrive មិនអាចចាក់ដោយផ្ទាល់បានទេ។ សូមទាញយកឯកសារ រួចបង្ហោះវានៅទីនេះជំនួសវិញ។',
  'tools.audio.emptyUpload': 'បង្ហោះ',
  'tools.audio.emptyDropToUpload': 'ទម្លាក់ដើម្បីបង្ហោះ',
  'tools.audio.coverUpload': 'បង្ហោះ',
  'tools.audio.coverDropToUpload': 'ទម្លាក់ដើម្បីបង្ហោះ',
  'tools.callout.noEmojisFound': 'រកមិនឃើញរូបអារម្មណ៍ទេ',
  'tools.table.insertColumnRight': 'បញ្ចូលជួរឈរខាងស្ដាំ',
  'a11y.dropCreateColumnRight': 'នឹងបង្កើតជួរឈរនៅខាងស្ដាំ',
  'tools.table.placementTopCenter': 'ខាងលើកណ្ដាល',
  'tools.table.placementMiddleLeft': 'កណ្ដាលឆ្វេង',
  'tools.table.placementMiddleCenter': 'កណ្ដាល',
  'tools.table.placementMiddleRight': 'កណ្ដាលស្ដាំ',
  'tools.table.placementBottomCenter': 'ខាងក្រោមកណ្ដាល',
  'tools.database.propertyTypeSelect': 'ជម្រើស',
  'tools.database.propertyTypeMultiSelect': 'ជម្រើសច្រើន',
  'tools.image.exitFullscreen': 'ចាកចេញពីអេក្រង់ពេញ',
  'tools.video.fullscreen': 'អេក្រង់ពេញ',
  'tools.video.fullscreenExit': 'ចាកចេញពីអេក្រង់ពេញ',
  'tools.table.mergeCells': 'បញ្ចូលក្រឡាចូលគ្នា',
  'a11y.blockDuplicated':
    'បានស្ទួនប្លុកនៅទីតាំង {position} នៃ {total}',
  'a11y.blocksDuplicated':
    'បានស្ទួនប្លុក {count} ចាប់ពីទីតាំង {position}',
};

const KANNADA_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'ಫಾರ್ಮ್ಯಾಟಿಂಗ್ ತೆರವುಗೊಳಿಸಿ',
  'tools.marker.textColor': 'ಪಠ್ಯದ ಬಣ್ಣ',
  'tools.toggle.bodyPlaceholder':
    'ಖಾಲಿ ಟಾಗಲ್. ಬ್ಲಾಕ್ ಸೇರಿಸಲು ಕ್ಲಿಕ್ ಮಾಡಿ ಅಥವಾ ಬ್ಲಾಕ್‌ಗಳನ್ನು ಇಲ್ಲಿಗೆ ಎಳೆಯಿರಿ.',
  'a11y.allBlocksSelected':
    'ಎಲ್ಲಾ ಬ್ಲಾಕ್‌ಗಳು ಆಯ್ಕೆಯಾಗಿವೆ. ಒಟ್ಟು: {count}.',
  'a11y.blockDuplicated':
    'ಬ್ಲಾಕ್ ಅನ್ನು ಒಟ್ಟು {total} ರಲ್ಲಿ {position}ನೇ ಸ್ಥಾನದಲ್ಲಿ ನಕಲು ಮಾಡಲಾಗಿದೆ',
  'a11y.blockMoved':
    'ಬ್ಲಾಕ್ ಅನ್ನು ಒಟ್ಟು {total} ರಲ್ಲಿ {position}ನೇ ಸ್ಥಾನಕ್ಕೆ ಸರಿಸಲಾಗಿದೆ',
  'a11y.blocksDuplicated':
    '{position}ನೇ ಸ್ಥಾನದಿಂದ ಆರಂಭಿಸಿ {count} ಬ್ಲಾಕ್‌ಗಳನ್ನು ನಕಲು ಮಾಡಲಾಗಿದೆ',
  'a11y.blocksMoved':
    '{count} ಬ್ಲಾಕ್‌ಗಳನ್ನು {position}ನೇ ಸ್ಥಾನಕ್ಕೆ ಸರಿಸಲಾಗಿದೆ',
  'a11y.dragHandle':
    'ಬ್ಲಾಕ್ ಸರಿಸಲು ಎಳೆಯಿರಿ ಅಥವಾ ಮೆನು ತೆರೆಯಲು ಕ್ಲಿಕ್ ಮಾಡಿ',
  'a11y.dropCreateColumnLeft': 'ಎಡಭಾಗದಲ್ಲಿ ಕಾಲಮ್ ರಚಿಸಲಾಗುವುದು',
  'a11y.dropCreateColumnRight': 'ಬಲಭಾಗದಲ್ಲಿ ಕಾಲಮ್ ರಚಿಸಲಾಗುವುದು',
  'a11y.dropPosition':
    'ಒಟ್ಟು {total} ರಲ್ಲಿ {position}ನೇ ಸ್ಥಾನದಲ್ಲಿ ಬಿಡಲಾಗುವುದು',
  'a11y.searchResults': 'ಹುಡುಕಾಟ ಫಲಿತಾಂಶಗಳ ಸಂಖ್ಯೆ: {count}',
  'blockSettings.clickAction': 'ಒಂದು ಕ್ಲಿಕ್',
  'blockSettings.convertWithChildrenWarning':
    'ಒಳಗಿನ ಬ್ಲಾಕ್‌ಗಳು: {count}. ಈ ಬ್ಲಾಕ್ ಅನ್ನು ಪರಿವರ್ತಿಸಿದರೆ ಒಳಗಿನ ವಿಷಯವು ಮೇಲ್ಮಟ್ಟಕ್ಕೆ ಸರಿಯುತ್ತದೆ. ಮುಂದುವರಿಸುವುದೇ?',
  'blockSettings.openMenuAction': ' ಮೂಲಕ ಮೆನು ತೆರೆಯಿರಿ',
  'searchTerms.columns': 'ಕಾಲಮ್‌ಗಳು',
  'toolNames.columns': 'ಕಾಲಮ್‌ಗಳು',
  'tools.audio.alignmentCenter': 'ಕೇಂದ್ರಕ್ಕೆ ಹೊಂದಿಸಿ',
  'tools.audio.alignmentLeft': 'ಎಡಕ್ಕೆ ಹೊಂದಿಸಿ',
  'tools.audio.alignmentRight': 'ಬಲಕ್ಕೆ ಹೊಂದಿಸಿ',
  'tools.audio.emptyOrDropHere': 'ಅಥವಾ ಆಡಿಯೊ ಫೈಲ್ ಅನ್ನು ಇಲ್ಲಿ ಬಿಡಿ',
  'tools.audio.errorFileTooLarge':
    'ಆಡಿಯೊ ತುಂಬಾ ದೊಡ್ಡದಾಗಿದೆ. ಗಾತ್ರ: {size}. ಗರಿಷ್ಠ ಮಿತಿ: {max}.',
  'tools.audio.pause': 'ವಿರಾಮಗೊಳಿಸಿ',
  'tools.bookmark.error': 'ಲಿಂಕ್ ಮುನ್ನೋಟ ಲೋಡ್ ಮಾಡಲಾಗಲಿಲ್ಲ',
  'tools.bookmark.loading': 'ಲಿಂಕ್ ಮುನ್ನೋಟ ಲೋಡ್ ಆಗುತ್ತಿದೆ…',
  'tools.callout.addEmoji': 'ಐಕಾನ್ ಸೇರಿಸಿ',
  'tools.callout.emojiSearchResults':
    'ಹೊಂದಾಣಿಕೆಯ ಎಮೋಜಿಗಳ ಸಂಖ್ಯೆ: {count}',
  'tools.callout.filterEmojis': 'ಎಮೋಜಿಗಳನ್ನು ಹುಡುಕಿ…',
  'tools.callout.pickRandom': 'ಯಾದೃಚ್ಛಿಕ ಎಮೋಜಿಯನ್ನು ಆಯ್ಕೆಮಾಡಿ',
  'tools.code.searchLanguage': 'ಭಾಷೆಗಳನ್ನು ಹುಡುಕಿ…',
  'tools.code.wrapLines': 'ಸಾಲುಗಳನ್ನು ಸುತ್ತಿಸಿ',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.columns.col2': '2 ಕಾಲಮ್‌ಗಳು',
  'tools.columns.col3': '3 ಕಾಲಮ್‌ಗಳು',
  'tools.columns.col4': '4 ಕಾಲಮ್‌ಗಳು',
  'tools.columns.col5': '5 ಕಾಲಮ್‌ಗಳು',
  'tools.database.close': 'ಮುಚ್ಚಿ',
  'tools.database.duplicateView': 'ನಕಲು ಮಾಡಿ',
  'tools.database.viewTypeListDescription':
    'ಐಟಂಗಳನ್ನು ಸರಳ ಪಟ್ಟಿಯಲ್ಲಿ ತೋರಿಸಿ',
  'tools.embed.empty': 'ಎಂಬೆಡ್ ಲಿಂಕ್ ಇಲ್ಲ',
  'tools.file.errorFileTooLarge':
    'ಫೈಲ್ ತುಂಬಾ ದೊಡ್ಡದಾಗಿದೆ. ಗಾತ್ರ: {size}. ಗರಿಷ್ಠ ಮಿತಿ: {max}.',
  'tools.file.previewRaw': 'ಮೂಲ',
  'tools.file.previewRender': 'ಮುನ್ನೋಟ',
  'tools.file.toggleCaption': 'ಶೀರ್ಷಿಕೆಯನ್ನು ತೋರಿಸಿ ಅಥವಾ ಮರೆಮಾಡಿ',
  'tools.image.altDescription':
    'ನೋಡಲು ಸಾಧ್ಯವಾಗದವರಿಗಾಗಿ ಈ ಚಿತ್ರವನ್ನು ವಿವರಿಸಿ.',
  'tools.image.altEdit': 'ಪರ್ಯಾಯ ಪಠ್ಯವನ್ನು ಸಂಪಾದಿಸಿ',
  'tools.image.altPlaceholder': 'ಪರ್ಯಾಯ ಪಠ್ಯ',
  'tools.image.downloadOriginal': 'ಮೂಲ ಚಿತ್ರವನ್ನು ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ',
  'tools.image.errorDefaultMessage':
    'ಈ URL ನಿಂದ ಚಿತ್ರವನ್ನು ಲೋಡ್ ಮಾಡಲಾಗಲಿಲ್ಲ. ಬೇರೆ ಮೂಲವನ್ನು ಪ್ರಯತ್ನಿಸಿ ಅಥವಾ ಫೈಲ್ ಅನ್ನು ಮತ್ತೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ.',
  'tools.image.errorFileTooLarge':
    'ಚಿತ್ರ ತುಂಬಾ ದೊಡ್ಡದಾಗಿದೆ. ಗಾತ್ರ: {size}. ಗರಿಷ್ಠ ಮಿತಿ: {max}.',
  'tools.image.errorRetry': 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ',
  'tools.image.previewControls': 'ಚಿತ್ರದ ಮುನ್ನೋಟ ನಿಯಂತ್ರಣಗಳು',
  'tools.image.resetZoom': 'ಝೂಮ್ ಮರುಹೊಂದಿಸಿ',
  'tools.image.toggleCaption': 'ಶೀರ್ಷಿಕೆಯನ್ನು ತೋರಿಸಿ ಅಥವಾ ಮರೆಮಾಡಿ',
  'tools.image.viewFullscreen': 'ಪೂರ್ಣ ಪರದೆಯಲ್ಲಿ ವೀಕ್ಷಿಸಿ',
  'tools.image.zoomIn': 'ಝೂಮ್ ಇನ್',
  'tools.image.zoomOut': 'ಝೂಮ್ ಔಟ್',
  'tools.link.linkTitle': 'ಲಿಂಕ್ ಪಠ್ಯ',
  'tools.paragraph.placeholder':
    'ಏನಾದರೂ ಬರೆಯಿರಿ ಅಥವಾ ಪರಿಕರವನ್ನು ಆಯ್ಕೆಮಾಡಲು / ಒತ್ತಿ',
  'tools.table.clearSelection': 'ವಿಷಯವನ್ನು ತೆರವುಗೊಳಿಸಿ',
  'tools.table.clickToAddColumn': 'ಹೊಸ ಕಾಲಮ್ ಸೇರಿಸಲು ಕ್ಲಿಕ್ ಮಾಡಿ',
  'tools.table.copySelection': 'ನಕಲಿಸಿ',
  'tools.table.dragToAddRemoveColumns':
    'ಕಾಲಮ್‌ಗಳನ್ನು ಸೇರಿಸಲು ಅಥವಾ ತೆಗೆಯಲು ಎಳೆಯಿರಿ',
  'tools.table.headerColumn': 'ಹೆಡರ್ ಕಾಲಮ್',
  'tools.table.insertColumnLeft': 'ಎಡಕ್ಕೆ ಕಾಲಮ್ ಸೇರಿಸಿ',
  'tools.table.insertColumnRight': 'ಬಲಕ್ಕೆ ಕಾಲಮ್ ಸೇರಿಸಿ',
  'tools.table.placement': 'ಹೊಂದಾಣಿಕೆ',
  'tools.table.placementBottomCenter': 'ಕೆಳಗಿನ ಮಧ್ಯ',
  'tools.table.placementBottomLeft': 'ಕೆಳಗಿನ ಎಡ',
  'tools.table.placementBottomRight': 'ಕೆಳಗಿನ ಬಲ',
  'tools.table.placementMiddleLeft': 'ಮಧ್ಯದ ಎಡ',
  'tools.table.placementMiddleRight': 'ಮಧ್ಯದ ಬಲ',
  'tools.table.placementTopCenter': 'ಮೇಲಿನ ಮಧ್ಯ',
  'tools.table.placementTopLeft': 'ಮೇಲಿನ ಎಡ',
  'tools.table.placementTopRight': 'ಮೇಲಿನ ಬಲ',
  'tools.toggle.ariaLabelCollapse': 'ಕುಗ್ಗಿಸಿ',
  'tools.toggle.ariaLabelExpand': 'ವಿಸ್ತರಿಸಿ',
  'tools.video.alignmentCenter': 'ಕೇಂದ್ರಕ್ಕೆ ಹೊಂದಿಸಿ',
  'tools.video.alignmentLeft': 'ಎಡಕ್ಕೆ ಹೊಂದಿಸಿ',
  'tools.video.alignmentRight': 'ಬಲಕ್ಕೆ ಹೊಂದಿಸಿ',
  'tools.video.ctxCopyUrlAtTime':
    'ಪ್ರಸ್ತುತ ಪ್ಲೇಬ್ಯಾಕ್ ಸಮಯವನ್ನು ಒಳಗೊಂಡ ವೀಡಿಯೊ URL ಅನ್ನು ನಕಲಿಸಿ',
  'tools.video.ctxStats': 'ಪ್ಲೇಬ್ಯಾಕ್ ಅಂಕಿಅಂಶಗಳು',
  'tools.video.errorFileTooLarge':
    'ವೀಡಿಯೊ ತುಂಬಾ ದೊಡ್ಡದಾಗಿದೆ. ಗಾತ್ರ: {size}. ಗರಿಷ್ಠ ಮಿತಿ: {max}.',
  'tools.video.pause': 'ವಿರಾಮಗೊಳಿಸಿ',
  'tools.video.seek': 'ವೀಡಿಯೊ ಸ್ಥಾನ',
  'tools.video.toggleCaption': 'ಶೀರ್ಷಿಕೆಯನ್ನು ತೋರಿಸಿ ಅಥವಾ ಮರೆಮಾಡಿ',
  'tools.video.toggleTimeDisplay':
    'ಕಳೆದ ಸಮಯ ಮತ್ತು ಉಳಿದ ಸಮಯದ ನಡುವೆ ಬದಲಿಸಿ',
};

const SORANI_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'blockSettings.orConjunction': ' یان ',
  'blockSettings.openMenuAction': ' دابگرە بۆ کردنەوەی مێنیو',
  'tools.table.textSize': 'قەبارەی دەق',
  'tools.table.compactText': 'دەقی چڕ',
  'tools.table.comfortableText': 'دەقی فراوان',
  'a11y.searchResults': 'ئەنجامەکانی گەڕان: {count}',
  'a11y.allBlocksSelected':
    'هەموو بلۆکەکان هەڵبژێردران. کۆی گشتی: {count}',
  'a11y.blocksSelected': '{count} بلۆک هەڵبژێردرا',
  'a11y.navigationModeEntered':
    'دۆخی ڕێدۆزی. بۆ جووڵان لە نێوان بلۆکەکاندا کلیلەکانی ئاراستە بەکاربهێنە، Enter بۆ دەستکاری و Escape بۆ دەرچوون.',
  'a11y.navigationModeExited': 'لە دۆخی ڕێدۆزی دەرچوو',
  'a11y.navigationPosition': '{tool}، {position} لە {total}',
  'a11y.navigatedToBlock': 'چوو بۆ بلۆک',
  'a11y.dropCreateColumnLeft': 'ستوونێک لە لای چەپ دروست دەکرێت',
  'a11y.dropCreateColumnRight': 'ستوونێک لە لای ڕاست دروست دەکرێت',
  'a11y.blockToolbar': 'شریتی ئامرازەکانی بلۆک',
  'a11y.textFormatting': 'شێوەپێدانی دەق',
  'tools.video.autoplay': 'لێدانی خۆکار',
  'tools.video.loop': 'دووبارە لێدانەوە',
  'tools.video.hideControls': 'کۆنترۆڵەکان بشارەوە',
  'tools.audio.loop': 'دووبارە لێدانەوە',
  'popover.convertTo': 'گۆڕین بۆ',
  'tools.marker.textColor': 'ڕەنگی دەق',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.paragraph.placeholder':
    'شتێک بنووسە یان / دابگرە بۆ هەڵبژاردنی ئامرازێک',
  'tools.table.clearSelection': 'ناوەڕۆک پاک بکەرەوە',
  'tools.table.placement': 'ڕیزبەندی',
  'a11y.insertBlock': 'بلۆک زیاد بکە',
  'a11y.blocksDuplicated':
    '{count} بلۆک کۆپی کران، لە شوێنی {position}ەوە',
  'toolNames.strikethrough': 'هێڵ بەسەرداهاتوو',
  'toolNames.clearFormat': 'شێوەپێدانی ڕاستەوخۆ پاک بکەرەوە',
  'tools.columns.turnInto': 'گۆڕین بۆ ستوونەکان',
  'searchTerms.collapsible': 'شیاوی داشکاندن',
  'tools.callout.addEmoji': 'ئایکۆن زیاد بکە',
  'tools.callout.removeEmoji': 'ئایکۆن بسڕەوە',
  'tools.callout.filterEmojis': 'بەدوای ئیمۆجییەکاندا بگەڕێ…',
  'tools.callout.noEmojisFound': 'هیچ ئیمۆجییەک نەدۆزرایەوە',
  'tools.callout.pickRandom': 'ئیمۆجییەکی هەڕەمەکی هەڵبژێرە',
  'tools.code.searchLanguage': 'بەدوای زمانەکاندا بگەڕێ…',
  'tools.code.sideBySide': 'لە تەنیشت یەکدا',
  'tools.link.linkTitle': 'دەقی بەستەر',
  'tools.image.sizeMedium': 'مامناوەند',
  'tools.image.errorDefaultTitle': 'نەتوانرا وێنەکە بار بکرێت',
  'tools.image.errorDefaultMessage':
    'نەتوانرا وێنەکە لەو URLەوە بار بکرێت. سەرچاوەیەکی تر تاقی بکەرەوە یان فایلەکە دووبارە بار بکە.',
  'tools.image.errorRetry': 'دووبارە هەوڵ بدە',
  'tools.file.previewRaw': 'سەرچاوە',
  'tools.file.previewLoading': 'پێشبینین بار دەکرێت…',
  'tools.file.previewError': 'نەتوانرا پێشبینین بار بکرێت',
  'tools.audio.emptyAddAudio': 'دەنگێک زیاد بکە',
  'tools.audio.emptyOrDropHere': 'یان فایلێکی دەنگی لێرە دابنێ',
  'tools.audio.coverSourceAria': 'سەرچاوەی بەرگ',
  'tools.database.duplicateView': 'دووبارەکردنەوە',
  'tools.database.viewTypeListDescription':
    'بڕگەکان لە لیستێکی سادەدا پیشان بدە',
  'tools.database.propertyTypeMultiSelect': 'هەڵبژاردنی چەندانە',
  'tools.database.defaultStatusInProgress': 'لە بەڕێوەچووندایە',
  'tools.bookmark.loading': 'پێشبینینی بەستەر بار دەکرێت…',
  'tools.bookmark.error': 'نەتوانرا پێشبینینی بەستەر بار بکرێت',
  'tools.embed.empty': 'هیچ بەستەرێک بۆ جێگیرکردن نییە',
  'tools.video.toggleTimeDisplay':
    'پیشاندان لە نێوان کاتی تێپەڕیو و کاتی ماوەدا بگۆڕە',
  'tools.video.volume': 'ئاستی دەنگ',
  'tools.audio.volume': 'ئاستی دەنگ',
  'tools.video.ctxStats': 'ئاماری لێدان',
};

const LAO_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'ລ້າງຮູບແບບໂດຍກົງ',
  'tools.marker.textColor': 'ສີຂໍ້ຄວາມ',
  'tools.toggle.bodyPlaceholder':
    'ພັບເປົ່າ. ຄລິກເພື່ອເພີ່ມບລັອກ ຫຼື ລາກບລັອກເຂົ້າມາ.',
  'tools.table.clearSelection': 'ລຶບເນື້ອຫາ',
  'tools.table.placement': 'ການຈັດວາງ',
  'a11y.searchResults': 'ຜົນການຄົ້ນຫາ: {count}',
  'tools.callout.addEmoji': 'ເພີ່ມໄອຄອນ',
  'tools.callout.filterEmojis': 'ຄົ້ນຫາອີໂມຈິ…',
  'tools.callout.pickRandom': 'ເລືອກອີໂມຈິແບບສຸ່ມ',
  'tools.code.searchLanguage': 'ຄົ້ນຫາພາສາ…',
  'tools.link.linkTitle': 'ຂໍ້ຄວາມລິ້ງ',
  'tools.image.altDescription':
    'ອະທິບາຍຮູບນີ້ສຳລັບຜູ້ທີ່ເບິ່ງບໍ່ເຫັນ.',
  'tools.image.previewControls':
    'ຕົວຄວບຄຸມການເບິ່ງຕົວຢ່າງຮູບ',
  'tools.image.zoomOut': 'ຊູມອອກ',
  'tools.image.errorFileTooLarge':
    'ຮູບໃຫຍ່ເກີນໄປ. {size} ເກີນຂີດຈຳກັດ {max}.',
  'tools.image.errorUnavailable': 'ຮູບບໍ່ພ້ອມໃຊ້ງານ',
  'tools.image.errorUploadFailedTitle': 'ອັບໂຫຼດບໍ່ສຳເລັດ',
  'tools.image.errorImageFailedToLoad': 'ບໍ່ສາມາດໂຫຼດຮູບໄດ້',
  'tools.image.errorDefaultMessage':
    'ບໍ່ສາມາດໂຫຼດຮູບຈາກ URL ນີ້ໄດ້. ລອງໃຊ້ແຫຼ່ງອື່ນ ຫຼື ອັບໂຫຼດໄຟລ໌ອີກຄັ້ງ.',
  'tools.file.previewRaw': 'ຕົ້ນສະບັບ',
  'tools.file.previewRender': 'ເບິ່ງຕົວຢ່າງ',
  'tools.file.errorFileTooLarge':
    'ໄຟລ໌ໃຫຍ່ເກີນໄປ. {size} ເກີນຂີດຈຳກັດ {max}.',
  'tools.audio.titlePlaceholder': 'ຊື່ແທຣັກ',
  'tools.audio.emptyOrDropHere': 'ຫຼື ປ່ອຍໄຟລ໌ສຽງໃສ່ນີ້',
  'tools.audio.coverSourceAria': 'ແຫຼ່ງຮູບປົກ',
  'tools.audio.errorFileTooLarge':
    'ສຽງໃຫຍ່ເກີນໄປ. {size} ເກີນຂີດຈຳກັດ {max}.',
  'tools.database.viewTypeListDescription':
    'ສະແດງລາຍການເປັນລາຍຊື່ແບບງ່າຍ',
  'tools.bookmark.loading': 'ກຳລັງໂຫຼດຕົວຢ່າງລິ້ງ…',
  'tools.bookmark.error': 'ບໍ່ສາມາດໂຫຼດຕົວຢ່າງລິ້ງໄດ້',
  'tools.embed.empty': 'ບໍ່ມີລິ້ງສຳລັບຝັງ',
  'tools.video.toggleTimeDisplay':
    'ສະຫຼັບລະຫວ່າງເວລາທີ່ຜ່ານໄປ ແລະ ເວລາທີ່ເຫຼືອ',
  'tools.video.ctxStats': 'ສະຖິຕິການຫຼິ້ນ',
  'tools.video.errorFileTooLarge':
    'ວິດີໂອໃຫຍ່ເກີນໄປ. {size} ເກີນຂີດຈຳກັດ {max}.',
  'tools.linkPaste.embedCode': 'ຝັງໂຄດຈາກ {provider}',
  'toolNames.quote': 'ຄຳອ້າງອີງ',
  'searchTerms.quote': 'ຄຳອ້າງອີງ',
  'searchTerms.blockquote': 'ບລັອກຄຳອ້າງອີງ',
  'searchTerms.citation': 'ການອ້າງອີງ',
  'tools.quote.placeholder': 'ຄຳອ້າງອີງ',
};

const LITHUANIAN_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'Valyti formatavimą',
  'tools.marker.textColor': 'Teksto spalva',
  'tools.toggle.bodyPlaceholder':
    'Tuščias sutraukiamas blokas. Spustelėkite, kad pridėtumėte bloką, arba nuvilkite blokus į vidų.',
  'toolbox.addBelow': 'Spustelėkite, kad pridėtumėte žemiau',
  'toolbox.optionAddAbove':
    'Spustelėkite laikydami nuspaudę klavišą Option, kad pridėtumėte aukščiau',
  'toolbox.ctrlAddAbove':
    'Spustelėkite laikydami nuspaudę klavišą Ctrl, kad pridėtumėte aukščiau',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.table.insertRowAbove': 'Įterpti eilutę aukščiau',
  'tools.table.insertRowBelow': 'Įterpti eilutę žemiau',
  'tools.table.clearSelection': 'Išvalyti turinį',
  'tools.table.placement': 'Lygiuotė',
  'a11y.dragStartedMultiple': 'Velkamų blokų: {count}',
  'a11y.blocksMoved':
    'Perkelta blokų: {count}. Nauja pozicija: {position}.',
  'a11y.blocksDuplicated':
    'Dubliuota blokų: {count}. Kopijų pradinė pozicija: {position}.',
  'a11y.searchResults': 'Paieškos rezultatų: {count}',
  'a11y.allBlocksSelected': 'Pasirinkti visi blokai. Iš viso: {count}',
  'a11y.navigationModeEntered':
    'Naršymo režimas. Rodyklių klavišais judėkite tarp blokų. Norėdami redaguoti, paspauskite Enter, o norėdami išeiti – Escape.',
  'toolNames.divider': 'Skyriklis',
  'searchTerms.divider': 'skiriamoji linija',
  'searchTerms.delimiter': 'atskyrimo ženklas',
  'searchTerms.unordered': 'nenumeruotas',
  'searchTerms.blockquote': 'blokinė citata',
  'searchTerms.citation': 'citavimas',
  'tools.callout.addEmoji': 'Pridėti piktogramą',
  'tools.callout.filterEmojis': 'Ieškoti jaustukų…',
  'tools.callout.pickRandom': 'Pasirinkti atsitiktinį jaustuką',
  'tools.callout.colorTeal': 'Žalsvai mėlyna',
  'tools.quote.defaultSize': 'Numatytasis',
  'tools.code.searchLanguage': 'Ieškoti kalbų…',
  'blockSettings.copyLinkSuccess': 'Nuoroda nukopijuota į iškarpinę',
  'blockSettings.copyLinkError':
    'Nepavyko nukopijuoti nuorodos į bloką',
  'tools.link.linkTitle': 'Nuorodos tekstas',
  'tools.image.viewFullscreen': 'Peržiūrėti visame ekrane',
  'tools.image.moreOptions': 'Daugiau parinkčių',
  'tools.image.altEdit': 'Redaguoti alternatyvųjį tekstą',
  'tools.image.altDescription':
    'Aprašykite šį paveikslą žmonėms, kurie jo nemato.',
  'tools.image.altPlaceholder': 'Alternatyvusis tekstas',
  'tools.image.previewControls': 'Paveikslo peržiūros valdikliai',
  'tools.image.resetZoom': 'Atkurti mastelį',
  'tools.image.errorDefaultMessage':
    'Nepavyko įkelti paveikslo iš šio URL. Pabandykite kitą šaltinį arba įkelkite failą iš naujo.',
  'tools.image.cropRatioFree': 'Laisva',
  'tools.image.cropReset': 'Nustatyti iš naujo',
  'tools.file.previewRaw': 'Šaltinis',
  'tools.video.alignmentLeft': 'Lygiuoti kairėn',
  'tools.video.alignmentCenter': 'Lygiuoti per vidurį',
  'tools.video.alignmentRight': 'Lygiuoti dešinėn',
  'tools.video.moreOptions': 'Daugiau parinkčių',
  'tools.audio.alignmentLeft': 'Lygiuoti kairėn',
  'tools.audio.alignmentCenter': 'Lygiuoti per vidurį',
  'tools.audio.alignmentRight': 'Lygiuoti dešinėn',
  'tools.audio.replace': 'Pakeisti garso įrašą',
  'tools.audio.emptyAddAudio': 'Pridėkite garso įrašą',
  'tools.audio.emptyOrDropHere': 'arba vilkite garso failą čia',
  'tools.audio.emptyUrlPlaceholder': 'Įklijuokite garso įrašo URL…',
  'tools.audio.emptyUrlAria': 'Garso įrašo URL',
  'tools.audio.emptySourceAria': 'Garso įrašo šaltinis',
  'tools.audio.coverSourceAria': 'Viršelio šaltinis',
  'tools.database.viewTypeListDescription':
    'Rodyti elementus paprastame sąraše',
  'tools.database.listView': 'Sąrašo rodinys',
  'tools.database.cardDetails': 'Kortelės informacija',
  'tools.bookmark.loading': 'Įkeliama nuorodos peržiūra…',
  'tools.bookmark.error': 'Nepavyko įkelti nuorodos peržiūros',
  'tools.embed.empty': 'Nėra įterpiamos nuorodos',
  'tools.embed.urlPlaceholder':
    'Įklijuokite norimą įterpti nuorodą…',
  'notifier.dismiss': 'Uždaryti pranešimą',
  'tools.video.seek': 'Atkūrimo vieta',
  'tools.video.toggleTimeDisplay':
    'Perjungti praėjusio ir likusio laiko rodymą',
  'tools.video.ctxStats': 'Atkūrimo statistika',
  'tools.callout.emojiSearchResults': 'Atitinkančių jaustukų: {count}',
};

const LATVIAN_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'Notīrīt formatējumu',
  'toolNames.toggleList': 'Sakļaujams saraksts',
  'tools.marker.textColor': 'Teksta krāsa',
  'tools.colorPicker.defaultSwatchLabel': '{default} {mode}',
  'tools.header.toggleHeading': 'Sakļaujams virsraksts',
  'tools.header.toggleHeading1': 'Sakļaujams virsraksts 1',
  'tools.header.toggleHeading2': 'Sakļaujams virsraksts 2',
  'tools.header.toggleHeading3': 'Sakļaujams virsraksts 3',
  'tools.header.toggleHeading4': 'Sakļaujams virsraksts 4',
  'tools.header.toggleHeading5': 'Sakļaujams virsraksts 5',
  'tools.header.toggleHeading6': 'Sakļaujams virsraksts 6',
  'tools.toggle.placeholder': 'Sakļaujams saraksts',
  'tools.toggle.bodyPlaceholder':
    'Tukšs sakļaujams bloks. Noklikšķiniet, lai pievienotu bloku, vai velciet blokus šeit.',
  'blockSettings.openMenuAction': ', lai atvērtu izvēlni',
  'toolbox.optionAddAbove':
    'Turiet nospiestu taustiņu Option un noklikšķiniet, lai pievienotu augstāk',
  'toolbox.ctrlAddAbove':
    'Turiet nospiestu taustiņu Ctrl un noklikšķiniet, lai pievienotu augstāk',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.paragraph.placeholder':
    'Rakstiet kaut ko vai nospiediet /, lai izvēlētos rīku',
  'tools.table.clearSelection': 'Notīrīt saturu',
  'tools.table.headerColumn': 'Galvenes kolonna',
  'tools.table.headerRow': 'Galvenes rinda',
  'tools.table.insertRowAbove': 'Ievietot rindu virs',
  'tools.table.insertRowBelow': 'Ievietot rindu zem',
  'tools.table.placement': 'Līdzinājums',
  'a11y.dragHandle':
    'Velciet, lai pārvietotu bloku, vai noklikšķiniet, lai atvērtu izvēlni',
  'a11y.dragStartedMultiple': 'Velkamo bloku skaits: {count}',
  'a11y.blocksMoved':
    'Pārvietoto bloku skaits: {count}. Pozīcija: {position}.',
  'a11y.blockDuplicated':
    'Bloks dublēts pozīcijā {position} no {total}',
  'a11y.blocksDuplicated':
    'Dublēto bloku skaits: {count}. Sākuma pozīcija: {position}.',
  'a11y.searchResults': 'Meklēšanas rezultātu skaits: {count}',
  'a11y.allBlocksSelected': 'Atlasīti visi bloki. Kopā: {count}.',
  'a11y.blocksSelected': 'Atlasīto bloku skaits: {count}',
  'a11y.navigationModeEntered':
    'Navigācijas režīms. Izmantojiet bulttaustiņus, lai pārvietotos starp blokiem, taustiņu Enter, lai rediģētu, un taustiņu Escape, lai izietu.',
  'a11y.navigationModeExited': 'Navigācijas režīms izslēgts',
  'a11y.navigatedToBlock': 'Fokuss pārvietots uz bloku',
  'a11y.dropPosition': 'Nomešanas pozīcija: {position} no {total}',
  'tools.columns.turnInto': 'Pārvērst par kolonnām',
  'searchTerms.unordered': 'nenumurēts',
  'tools.callout.addEmoji': 'Pievienot ikonu',
  'tools.callout.filterEmojis': 'Meklēt emocijzīmes…',
  'tools.callout.pickRandom': 'Izvēlēties nejaušu emocijzīmi',
  'toolNames.equation': 'Vienādojums',
  'tools.code.wrapLines': 'Aplauzt rindas',
  'tools.code.searchLanguage': 'Meklēt valodas…',
  'blockSettings.copyLinkSuccess': 'Saite nokopēta starpliktuvē',
  'blockSettings.copyLinkError': 'Neizdevās nokopēt saiti uz bloku',
  'tools.link.linkTitle': 'Saites teksts',
  'tools.image.toggleCaption': 'Rādīt vai paslēpt parakstu',
  'tools.image.viewFullscreen': 'Skatīt pilnekrāna režīmā',
  'tools.image.moreOptions': 'Papildu opcijas',
  'tools.image.altEdit': 'Rediģēt alternatīvo tekstu',
  'tools.image.altDescription':
    'Aprakstiet šo attēlu cilvēkiem, kuri to neredz.',
  'tools.image.altPlaceholder': 'Alternatīvais teksts',
  'tools.image.previewControls': 'Attēla priekšskatījuma vadīklas',
  'tools.image.resetZoom': 'Atiestatīt tālummaiņu',
  'tools.image.errorDefaultMessage':
    'Attēlu neizdevās ielādēt no šī URL. Izmēģiniet citu avotu vai augšupielādējiet failu vēlreiz.',
  'tools.image.cropRatioFree': 'Brīva',
  'tools.image.emptyOrDropHere': 'vai nomest attēlu šeit',
  'tools.file.toggleCaption': 'Rādīt vai paslēpt parakstu',
  'tools.file.previewRaw': 'Avots',
  'tools.file.previewRender': 'Priekšskatījums',
  'tools.file.emptyDropHint': 'vai nomest failu šeit',
  'tools.video.alignmentLeft': 'Līdzināt pa kreisi',
  'tools.video.alignmentCenter': 'Centrēt',
  'tools.video.alignmentRight': 'Līdzināt pa labi',
  'tools.video.toggleCaption': 'Rādīt vai paslēpt parakstu',
  'tools.video.moreOptions': 'Papildu opcijas',
  'tools.audio.alignmentLeft': 'Līdzināt pa kreisi',
  'tools.audio.alignmentCenter': 'Centrēt',
  'tools.audio.alignmentRight': 'Līdzināt pa labi',
  'tools.audio.emptyOrDropHere': 'vai nomest audiofailu šeit',
  'tools.audio.coverSourceAria': 'Vāka avots',
  'tools.database.viewTypeListDescription':
    'Rādīt vienumus vienkāršā sarakstā',
  'tools.database.listView': 'Saraksta skats',
  'tools.database.cardDetails': 'Kartītes informācija',
  'tools.bookmark.loading': 'Notiek saites priekšskatījuma ielāde…',
  'tools.bookmark.error': 'Neizdevās ielādēt saites priekšskatījumu',
  'tools.embed.empty': 'Nav saites iegulšanai',
  'tools.linkPaste.embed': 'Iegult saturu',
  'tools.linkPaste.mention': 'Pieminēt',
  'notifier.dismiss': 'Aizvērt paziņojumu',
  'tools.video.seek': 'Atskaņošanas pozīcija',
  'tools.video.toggleTimeDisplay':
    'Pārslēgt laika rādījumu starp aizritējušo un atlikušo laiku',
  'tools.video.fullscreen': 'Pilnekrāna režīms',
  'tools.video.fullscreenExit': 'Iziet no pilnekrāna režīma',
  'tools.video.speedPresets': 'Ātruma priekšiestatījumi',
  'tools.video.ctxCopyUrlAtTime':
    'Kopēt video URL pašreizējā atskaņošanas pozīcijā',
  'tools.video.ctxStats': 'Atskaņošanas statistika',
  'tools.video.emptyOrDropHere': 'vai nomest video šeit',
  'tools.audio.coverOrDropHere': 'vai nomest attēlu šeit',
  'tools.callout.emojiSearchResults':
    'Atbilstošo emocijzīmju skaits: {count}',
  'tools.database.checkboxChecked': 'Atzīmēta',
  'tools.database.checkboxUnchecked': 'Neatzīmēta',
  'tools.database.defaultStatusDone': 'Pabeigts',
  'tools.embed.captionPlaceholder': 'Ievadiet parakstu…',
};

const MACEDONIAN_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'Избриши форматирање',
  'tools.toggle.bodyPlaceholder':
    'Празен расклоплив блок. Кликнете за да додадете блок или повлечете блокови овде.',
  'blockSettings.convertWithChildrenWarning':
    'Вгнездени блокови: {count}. Претворањето на овој блок ќе ја премести вгнездената содржина на највисоко ниво. Продолжете?',
  'tools.marker.textColor': 'Боја на текстот',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.paragraph.placeholder':
    'Напишете нешто или притиснете / за да изберете алатка',
  'tools.table.clearSelection': 'Исчисти ја содржината',
  'tools.table.headerColumn': 'Заглавна колона',
  'tools.table.headerRow': 'Заглавен ред',
  'tools.table.placement': 'Порамнување',
  'a11y.dragHandle':
    'Повлечете за да го преместите блокот или кликнете за да го отворите менито',
  'a11y.dragStartedMultiple': 'Блокови што се влечат: {count}',
  'a11y.blocksMoved':
    'Преместени блокови: {count}. Позиција: {position}.',
  'a11y.blocksDuplicated':
    'Дуплирани блокови: {count}. Почетна позиција: {position}.',
  'a11y.searchResults': 'Резултати од пребарувањето: {count}',
  'a11y.allBlocksSelected': 'Избрани се сите блокови. Вкупно: {count}.',
  'a11y.blocksSelected': 'Избрани блокови: {count}',
  'a11y.navigatedToBlock': 'Преминавте на блокот',
  'a11y.dropCreateColumnLeft':
    'Ќе се создаде колона од левата страна',
  'a11y.dropCreateColumnRight':
    'Ќе се создаде колона од десната страна',
  'toolNames.spacer': 'Празен простор',
  'tools.spacer.resizeAriaLabel':
    'Промени ја големината на празниот простор',
  'searchTerms.heading': 'наслов на дел',
  'tools.callout.addEmoji': 'Додај икона',
  'tools.callout.filterEmojis': 'Пребарај емоџија…',
  'tools.callout.pickRandom': 'Избери емоџи по случаен избор',
  'tools.callout.colorTeal': 'Тиркизно',
  'tools.code.searchLanguage': 'Пребарај јазици…',
  'tools.code.sideBySide': 'Напоредно',
  'searchTerms.pre': 'претформатиран',
  'blockSettings.copyLinkSuccess':
    'Врската е копирана во таблата со исечоци',
  'blockSettings.copyLinkError':
    'Не може да се копира врската до блокот',
  'tools.link.emailAddress': 'Адреса на е-пошта',
  'tools.link.urlCopied': 'Врската е копирана во таблата со исечоци',
  'tools.link.linkTitle': 'Текст на врската',
  'tools.code.autoDetected': 'автоматски',
  'tools.image.toggleCaption': 'Прикажи или скриј опис',
  'tools.image.viewFullscreen': 'Прикажи на цел екран',
  'tools.image.moreOptions': 'Повеќе опции',
  'tools.image.uploading': 'Се прикачува…',
  'tools.image.uploadingLabel': 'Прикачување',
  'tools.image.cancelUpload': 'Откажи го прикачувањето',
  'tools.image.uploadProgress': 'Напредок на прикачувањето',
  'tools.image.altDescription':
    'Опишете ја оваа слика за лицата што не можат да ја видат.',
  'tools.image.previewControls': 'Контроли за преглед на сликата',
  'tools.image.navigationControls': 'Навигација низ сликите',
  'tools.image.errorUploadFailed': 'Прикачувањето не успеа',
  'tools.image.errorDefaultMessage':
    'Сликата не може да се вчита од овој URL. Обидете се со друг извор или повторно прикачете ја датотеката.',
  'tools.image.emptyUpload': 'Прикачи',
  'tools.image.emptyOrDropHere':
    'или повлечете и пуштете слика овде',
  'tools.image.emptyDropToUpload': 'Пуштете за прикачување',
  'tools.image.cropAspectRatio': 'Облик на исечокот',
  'tools.file.emptyUpload': 'Прикачи',
  'tools.file.emptyDropHint':
    'или повлечете и пуштете датотека овде',
  'tools.file.emptyDropToUpload': 'Пуштете за прикачување',
  'tools.file.uploading': 'Се прикачува…',
  'tools.file.cancelUpload': 'Откажи го прикачувањето',
  'tools.file.uploadProgress': 'Напредок на прикачувањето',
  'tools.file.toggleCaption': 'Прикажи или скриј опис',
  'tools.file.errorUploadFailed': 'Прикачувањето не успеа',
  'tools.file.previewRaw': 'Извор',
  'tools.file.previewOpenInNewTab': 'Отвори во нова картичка',
  'tools.video.alignmentLeft': 'Порамни лево',
  'tools.video.alignmentCenter': 'Порамни во средина',
  'tools.video.alignmentRight': 'Порамни десно',
  'tools.video.toggleCaption': 'Прикажи или скриј опис',
  'tools.video.moreOptions': 'Повеќе опции',
  'tools.video.uploading': 'Се прикачува…',
  'tools.video.emptyUpload': 'Прикачи',
  'tools.video.emptyDropToUpload': 'Пуштете за прикачување',
  'tools.video.errorUploadFailed': 'Прикачувањето не успеа',
  'tools.video.emptyOrDropHere':
    'или повлечете и пуштете видео овде',
  'tools.audio.alignmentLeft': 'Порамни лево',
  'tools.audio.alignmentCenter': 'Порамни во средина',
  'tools.audio.alignmentRight': 'Порамни десно',
  'tools.audio.uploading': 'Се прикачува…',
  'tools.audio.errorUploadFailed': 'Прикачувањето не успеа',
  'tools.audio.titlePlaceholder': 'Наслов на аудиозаписот',
  'tools.audio.emptyUpload': 'Прикачи',
  'tools.audio.emptyOrDropHere':
    'или повлечете и пуштете аудиодатотека овде',
  'tools.audio.emptyDropToUpload': 'Пуштете за прикачување',
  'tools.audio.coverUpload': 'Прикачи',
  'tools.audio.coverOrDropHere':
    'или повлечете и пуштете слика овде',
  'tools.audio.coverDropToUpload': 'Пуштете за прикачување',
  'tools.audio.coverSourceAria': 'Извор на омотот',
  'tools.database.viewTypeList': 'Список',
  'tools.database.viewTypeListDescription':
    'Прикажи ги ставките во едноставен список',
  'tools.database.listView': 'Приказ како список',
  'tools.database.cardDetails': 'Детали за картичката',
  'tools.database.defaultStatusDone': 'Завршено',
  'tools.bookmark.loading': 'Се вчитува прегледот на врската…',
  'tools.bookmark.error': 'Не може да се вчита прегледот на врската',
  'tools.embed.empty': 'Нема врска за вградување',
  'tools.linkPaste.embed': 'Создај вградена содржина',
  'tools.linkPaste.mention': 'Спомни',
  'tools.video.toggleTimeDisplay':
    'Префрли меѓу изминатото и преостанатото време',
  'tools.video.theater': 'Театарски режим',
  'tools.video.theaterExit': 'Излези од театарскиот режим',
  'tools.video.ctxCopyUrlAtTime':
    'Копирај URL на видеото на тековната позиција',
  'tools.video.ctxStats': 'Статистика за репродукцијата',
  'tools.callout.emojiSearchResults':
    'Совпаѓања со емоџи: {count}',
};

const MALAYALAM_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'blockSettings.clickAction': 'മെനു തുറക്കാൻ ക്ലിക്ക് ചെയ്യുക',
  'blockSettings.orConjunction': ' അല്ലെങ്കിൽ ',
  'blockSettings.openMenuAction': ' അമർത്തുക',
  'tools.marker.textColor': 'ടെക്സ്റ്റ് നിറം',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.colorPicker.color.gray': 'ചാരനിറം',
  'tools.colorPicker.color.purple': 'പർപ്പിൾ',
  'tools.paragraph.placeholder':
    'എന്തെങ്കിലും എഴുതുക അല്ലെങ്കിൽ ഒരു ടൂൾ തിരഞ്ഞെടുക്കാൻ / അമർത്തുക',
  'tools.toggle.bodyPlaceholder':
    'ഒഴിഞ്ഞ ടോഗിൾ. ഒരു ബ്ലോക്ക് ചേർക്കാൻ ക്ലിക്ക് ചെയ്യുക അല്ലെങ്കിൽ ബ്ലോക്കുകൾ ഇവിടേക്ക് വലിച്ചിടുക.',
  'tools.table.clearSelection': 'ഉള്ളടക്കം മായ്ക്കുക',
  'tools.table.duplicateColumn': 'പകർപ്പുണ്ടാക്കുക',
  'tools.table.duplicateRow': 'പകർപ്പുണ്ടാക്കുക',
  'tools.table.dragToAddRemoveRows':
    'വരികൾ ചേർക്കാനോ നീക്കം ചെയ്യാനോ വലിച്ചിടുക',
  'tools.table.dragToAddRemoveColumns':
    'കോളങ്ങൾ ചേർക്കാനോ നീക്കം ചെയ്യാനോ വലിച്ചിടുക',
  'blockSettings.duplicate': 'പകർപ്പുണ്ടാക്കുക',
  'blockSettings.lastEditedBy': 'അവസാനം തിരുത്തിയത്: {name}',
  'a11y.dragHandle':
    'ബ്ലോക്ക് നീക്കാൻ വലിച്ചിടുക അല്ലെങ്കിൽ മെനു തുറക്കാൻ ക്ലിക്ക് ചെയ്യുക',
  'a11y.dragStartedMultiple': 'വലിച്ചിടുന്ന ബ്ലോക്കുകളുടെ എണ്ണം: {count}',
  'a11y.dropPosition': 'ഇടുന്ന സ്ഥാനം: {position}. ആകെ: {total}.',
  'a11y.blockMoved':
    'ബ്ലോക്ക് നീക്കി. സ്ഥാനം: {position}. ആകെ: {total}.',
  'a11y.blocksMoved':
    'നീക്കിയ ബ്ലോക്കുകളുടെ എണ്ണം: {count}. സ്ഥാനം: {position}.',
  'a11y.blockDuplicated':
    'ബ്ലോക്ക് പകർത്തി. സ്ഥാനം: {position}. ആകെ: {total}.',
  'a11y.blocksDuplicated':
    'പകർത്തിയ ബ്ലോക്കുകളുടെ എണ്ണം: {count}. ആരംഭ സ്ഥാനം: {position}.',
  'a11y.searchResults': 'തിരയൽ ഫലങ്ങളുടെ എണ്ണം: {count}',
  'a11y.textFormatting': 'ടെക്സ്റ്റ് ഫോർമാറ്റിംഗ്',
  'a11y.allBlocksSelected':
    'എല്ലാ ബ്ലോക്കുകളും തിരഞ്ഞെടുത്തു. ആകെ: {count}.',
  'a11y.blocksSelected': 'തിരഞ്ഞെടുത്ത ബ്ലോക്കുകളുടെ എണ്ണം: {count}',
  'a11y.navigationModeEntered':
    'നാവിഗേഷൻ മോഡ്. ബ്ലോക്കുകൾക്കിടയിൽ നീങ്ങാൻ അമ്പടയാള കീകൾ, എഡിറ്റ് ചെയ്യാൻ Enter, പുറത്തുകടക്കാൻ Escape എന്നിവ ഉപയോഗിക്കുക.',
  'toolNames.clearFormat': 'ഫോർമാറ്റിംഗ് മായ്ക്കുക',
  'toolNames.columns': 'കോളങ്ങൾ',
  'tools.columns.col2': '2 കോളങ്ങൾ',
  'tools.columns.col3': '3 കോളങ്ങൾ',
  'tools.columns.col4': '4 കോളങ്ങൾ',
  'tools.columns.col5': '5 കോളങ്ങൾ',
  'tools.columns.resizeAriaLabel': 'കോളങ്ങളുടെ വലുപ്പം മാറ്റുക',
  'tools.columns.turnInto': 'കോളങ്ങളാക്കി മാറ്റുക',
  'searchTerms.columns': 'കോളങ്ങൾ',
  'tools.callout.addEmoji': 'ഐക്കൺ ചേർക്കുക',
  'tools.callout.filterEmojis': 'ഇമോജികൾ തിരയുക…',
  'tools.callout.pickRandom':
    'ക്രമരഹിതമായ ഒരു ഇമോജി തിരഞ്ഞെടുക്കുക',
  'tools.callout.colorGray': 'ചാരനിറം',
  'tools.callout.colorPurple': 'പർപ്പിൾ',
  'tools.table.placement': 'അലൈൻമെന്റ്',
  'tools.code.searchLanguage': 'ഭാഷകൾ തിരയുക…',
  'searchTerms.snippet': 'കോഡ് ഭാഗം',
  'blockSettings.blocksSelected': 'തിരഞ്ഞെടുത്ത ബ്ലോക്കുകൾ: {count}',
  'tools.link.linkText': 'ടെക്സ്റ്റ്',
  'tools.link.linkTitle': 'ലിങ്ക് ടെക്സ്റ്റ്',
  'tools.code.autoDetected': 'സ്വയമേവ',
  'tools.image.alignmentLeftAria': 'ഇടത്തേക്ക് അലൈൻ ചെയ്യുക',
  'tools.image.alignmentCenterAria': 'മധ്യത്തിലേക്ക് അലൈൻ ചെയ്യുക',
  'tools.image.alignmentRightAria': 'വലത്തേക്ക് അലൈൻ ചെയ്യുക',
  'tools.image.sizeFull': 'പൂർണ്ണം',
  'tools.image.toggleCaption':
    'അടിക്കുറിപ്പ് കാണിക്കുക അല്ലെങ്കിൽ മറയ്ക്കുക',
  'tools.image.altDescription':
    'ഈ ചിത്രം കാണാൻ കഴിയാത്തവർക്കായി വിവരിക്കുക.',
  'tools.image.previewControls': 'ചിത്ര പ്രിവ്യൂ നിയന്ത്രണങ്ങൾ',
  'tools.image.errorDefaultMessage':
    'ഈ URL-ൽ നിന്ന് ചിത്രം ലോഡ് ചെയ്യാനായില്ല. മറ്റൊരു ഉറവിടം പരീക്ഷിക്കുക അല്ലെങ്കിൽ ഫയൽ വീണ്ടും അപ്‌ലോഡ് ചെയ്യുക.',
  'tools.image.emptyOrDropHere':
    'അല്ലെങ്കിൽ ഒരു ചിത്രം ഇവിടേക്ക് വലിച്ചിടുക',
  'tools.image.emptyUrlPlaceholder':
    'ഒരു ചിത്രത്തിന്റെ URL ഒട്ടിക്കുക…',
  'tools.image.emptyUrlAria': 'ചിത്രത്തിന്റെ URL',
  'tools.database.viewTypeList': 'ലിസ്റ്റ്',
  'tools.database.viewTypeBoardDescription':
    'ഇനങ്ങൾ കോളങ്ങളിൽ കാണിക്കുക',
  'tools.database.viewTypeListDescription':
    'ഇനങ്ങൾ ഒരു ലളിതമായ ലിസ്റ്റിൽ കാണിക്കുക',
  'tools.database.listView': 'ലിസ്റ്റ് കാഴ്ച',
  'tools.bookmark.loading': 'ലിങ്ക് പ്രിവ്യൂ ലോഡ് ചെയ്യുന്നു…',
  'tools.bookmark.error': 'ലിങ്ക് പ്രിവ്യൂ ലോഡ് ചെയ്യാനായില്ല',
  'tools.embed.empty': 'എംബെഡ് ലിങ്ക് ഇല്ല',
  'tools.embed.replace': 'മാറ്റുക',
  'tools.linkPaste.mention': 'പരാമർശിക്കുക',
  'tools.file.emptyDropHint':
    'അല്ലെങ്കിൽ ഒരു ഫയൽ ഇവിടേക്ക് വലിച്ചിടുക',
  'tools.file.toggleCaption':
    'അടിക്കുറിപ്പ് കാണിക്കുക അല്ലെങ്കിൽ മറയ്ക്കുക',
  'tools.file.previewRender': 'പ്രിവ്യൂ',
  'tools.video.alignmentLeft': 'ഇടത്തേക്ക് അലൈൻ ചെയ്യുക',
  'tools.video.alignmentCenter': 'മധ്യത്തിലേക്ക് അലൈൻ ചെയ്യുക',
  'tools.video.alignmentRight': 'വലത്തേക്ക് അലൈൻ ചെയ്യുക',
  'tools.video.toggleCaption':
    'അടിക്കുറിപ്പ് കാണിക്കുക അല്ലെങ്കിൽ മറയ്ക്കുക',
  'tools.video.autoplay': 'സ്വയമേവ പ്ലേ ചെയ്യൽ',
  'tools.video.emptyOrDropHere':
    'അല്ലെങ്കിൽ ഒരു വീഡിയോ ഇവിടേക്ക് വലിച്ചിടുക',
  'tools.audio.alignmentLeft': 'ഇടത്തേക്ക് അലൈൻ ചെയ്യുക',
  'tools.audio.alignmentCenter': 'മധ്യത്തിലേക്ക് അലൈൻ ചെയ്യുക',
  'tools.audio.alignmentRight': 'വലത്തേക്ക് അലൈൻ ചെയ്യുക',
  'tools.audio.emptyOrDropHere':
    'അല്ലെങ്കിൽ ഒരു ഓഡിയോ ഫയൽ ഇവിടേക്ക് വലിച്ചിടുക',
  'tools.audio.coverOrDropHere':
    'അല്ലെങ്കിൽ ഒരു ചിത്രം ഇവിടേക്ക് വലിച്ചിടുക',
  'tools.audio.coverUrlPlaceholder':
    'ഒരു ചിത്രത്തിന്റെ URL ഒട്ടിക്കുക…',
  'tools.audio.coverUrlAria': 'ചിത്രത്തിന്റെ URL',
  'tools.audio.coverSourceAria': 'കവർ ഉറവിടം',
  'tools.video.seek': 'പ്ലേബാക്ക് സ്ഥാനം',
  'tools.video.seekValueText': 'നിലവിൽ: {current}; ആകെ: {total}',
  'tools.video.toggleTimeDisplay':
    'കഴിഞ്ഞ സമയത്തിനും ശേഷിക്കുന്ന സമയത്തിനും ഇടയിൽ മാറുക',
  'tools.video.ctxCopyUrlAtTime':
    'നിലവിലെ പ്ലേബാക്ക് സ്ഥാനത്തിലുള്ള വീഡിയോ URL പകർത്തുക',
  'tools.video.ctxStats': 'പ്ലേബാക്ക് സ്ഥിതിവിവരക്കണക്കുകൾ',
  'tools.callout.emojiSearchResults': 'ഇമോജി പൊരുത്തങ്ങൾ: {count}',
  'tools.database.checkboxChecked': 'പരിശോധിച്ചത്',
  'tools.database.checkboxUnchecked': 'പരിശോധിക്കാത്തത്',
};

const MONGOLIAN_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'blockSettings.clickToOpenMenu': 'Цэсийг нээхийн тулд дарна уу',
  'blockSettings.clickAction': 'Цэсийг нээхийн тулд дарна уу',
  'blockSettings.orConjunction': ' эсвэл ',
  'blockSettings.openMenuAction': ' товчийг дарна уу',
  'toolbox.optionAddAbove':
    'Дээр нэмэхийн тулд Option товчийг дарж байгаад товшино уу',
  'toolbox.ctrlAddAbove':
    'Дээр нэмэхийн тулд Ctrl товчийг дарж байгаад товшино уу',
  'tools.marker.textColor': 'Текстийн өнгө',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.paragraph.placeholder':
    'Ямар нэг зүйл бичнэ үү эсвэл хэрэгсэл сонгохын тулд / товчийг дарна уу',
  'tools.toggle.bodyPlaceholder':
    'Хоосон эвхмэл хэсэг. Блок нэмэхийн тулд дарна уу эсвэл блокуудыг энд чирнэ үү.',
  'tools.toggle.ariaLabelCollapse': 'Эвхэх',
  'tools.toggle.ariaLabelExpand': 'Дэлгэх',
  'tools.table.clearSelection': 'Агуулгыг арилгах',
  'tools.table.insertColumnLeft': 'Зүүн талд багана оруулах',
  'tools.table.insertColumnRight': 'Баруун талд багана оруулах',
  'tools.table.insertRowAbove': 'Дээр нь мөр оруулах',
  'tools.table.insertRowBelow': 'Доор нь мөр оруулах',
  'tools.table.comfortableText': 'Ердийн хэмжээтэй текст',
  'tools.table.placement': 'Зэрэгцүүлэлт',
  'tools.table.placementTopLeft': 'Зүүн дээд',
  'tools.table.placementTopCenter': 'Дээд төв',
  'tools.table.placementTopRight': 'Баруун дээд',
  'tools.table.placementMiddleLeft': 'Зүүн дунд',
  'tools.table.placementMiddleCenter': 'Төв',
  'tools.table.placementMiddleRight': 'Баруун дунд',
  'tools.table.placementBottomLeft': 'Зүүн доод',
  'tools.table.placementBottomCenter': 'Доод төв',
  'tools.table.placementBottomRight': 'Баруун доод',
  'a11y.dropPosition':
    'Тавих байрлал: {position}. Нийт: {total}.',
  'a11y.blockMoved':
    'Блок зөөгдлөө. Байрлал: {position}. Нийт: {total}.',
  'a11y.blocksMoved':
    '{count} блок зөөгдлөө. Шинэ байрлал: {position}.',
  'a11y.blockDuplicated':
    'Блок хувилагдлаа. Байрлал: {position}. Нийт: {total}.',
  'a11y.blocksDuplicated':
    '{count} блок хувилагдлаа. Эхлэх байрлал: {position}.',
  'a11y.searchResults': 'Хайлтын үр дүн: {count}.',
  'a11y.textFormatting': 'Текстийн хэлбэржүүлэлт',
  'a11y.allBlocksSelected':
    'Бүх блок сонгогдлоо. Нийт: {count}.',
  'a11y.navigationPosition':
    '{tool}. Байрлал: {position}. Нийт: {total}.',
  'toolNames.clearFormat': 'Шууд форматыг арилгах',
  'toolNames.callout': 'Тодруулга',
  'toolNames.quote': 'Эшлэл',
  'tools.columns.turnInto': 'Баганууд болгон хөрвүүлэх',
  'searchTerms.collapsible': 'эвхэгддэг',
  'searchTerms.bullet': 'тэмдэгт',
  'searchTerms.ordered': 'дугаарласан',
  'searchTerms.collapse': 'эвхэх',
  'searchTerms.expand': 'дэлгэх',
  'searchTerms.spreadsheet': 'цахим хүснэгт',
  'searchTerms.callout': 'тодруулга',
  'searchTerms.blockquote': 'ишлэлийн блок',
  'tools.callout.placeholder': 'Тодруулга',
  'tools.callout.addEmoji': 'Дүрс нэмэх',
  'tools.callout.filterEmojis': 'Эможи хайх…',
  'tools.callout.calloutEmojiCategory': 'Тодруулга',
  'tools.callout.pickRandom': 'Санамсаргүй эможи сонгох',
  'tools.database.renameColumn': 'Баганын нэрийг өөрчлөх',
  'tools.quote.size': 'Эшлэлийн хэмжээ',
  'tools.quote.placeholder': 'Эшлэл',
  'tools.code.wrapLines': 'Мөр шилжүүлэх',
  'tools.code.searchLanguage': 'Хэл хайх…',
  'tools.code.sideBySide': 'Зэрэгцээ',
  'tools.code.lineNumbers': 'Мөрийн дугаарууд',
  'searchTerms.snippet': 'кодын хэсэг',
  'searchTerms.pre': 'кодын блок',
  'blockSettings.blocksSelected': '{count} блок',
  'blockSettings.copyLinkError':
    'Блокийн холбоосыг хуулж чадсангүй',
  'tools.link.emailAddress': 'Имэйл хаяг',
  'tools.link.jumpToSection': 'Хэсэг рүү очих',
  'tools.link.urlCopied': 'Холбоосыг түр санах ой руу хуулав',
  'tools.link.linkTitle': 'Холбоосын текст',
  'tools.image.toggleCaption':
    'Тайлбарыг харуулах эсвэл нуух',
  'tools.image.crop': 'Тайрах',
  'tools.image.altEdit': 'Өөр текстийг засах',
  'tools.image.altDescription':
    'Энэ зургийг харах боломжгүй хүмүүст зориулан тайлбарлана уу.',
  'tools.image.altPlaceholder': 'Өөр текст',
  'tools.image.previewControls':
    'Зургийн урьдчилсан харагдацын удирдлага',
  'tools.image.errorUnavailable': 'Зураг ашиглах боломжгүй',
  'tools.image.errorDefaultMessage':
    'Энэ URL-аас зургийг ачаалж чадсангүй. Өөр эх сурвалж ашиглаж үзнэ үү эсвэл файлыг дахин байршуулна уу.',
  'tools.image.cropAspectRatio': 'Тайралтын хэлбэр',
  'tools.image.cropDialogLabel': 'Зураг тайрах',
  'tools.file.toggleCaption':
    'Тайлбарыг харуулах эсвэл нуух',
  'tools.file.previewRaw': 'Эх текст',
  'tools.file.previewRender': 'Урьдчилан харах',
  'tools.file.previewOpenInNewTab': 'Шинэ таб дээр нээх',
  'tools.video.alignmentLeft': 'Зүүн зэрэгцүүлэх',
  'tools.video.alignmentCenter': 'Төвд зэрэгцүүлэх',
  'tools.video.alignmentRight': 'Баруун зэрэгцүүлэх',
  'tools.video.toggleCaption':
    'Тайлбарыг харуулах эсвэл нуух',
  'tools.video.autoplay': 'Автоматаар тоглуулах',
  'tools.audio.alignmentLeft': 'Зүүн зэрэгцүүлэх',
  'tools.audio.alignmentCenter': 'Төвд зэрэгцүүлэх',
  'tools.audio.alignmentRight': 'Баруун зэрэгцүүлэх',
  'tools.audio.emptyOrDropHere':
    'эсвэл аудио файлыг энд чирж оруулна уу',
  'tools.audio.coverSourceAria': 'Хавтасны эх сурвалж',
  'tools.database.duplicateView': 'Хувилах',
  'tools.database.viewTypeListDescription':
    'Зүйлсийг энгийн жагсаалтаар харуулах',
  'tools.database.propertyTypeSelect': 'Сонголт',
  'tools.bookmark.loading':
    'Холбоосын урьдчилсан харагдацыг ачаалж байна…',
  'tools.embed.empty': 'Шигтгэх холбоос алга',
  'tools.embed.openOriginal': 'Эх хувийг нээх',
  'tools.linkPaste.embedVideo': '{provider}: видео шигтгэх',
  'tools.linkPaste.embedAudio': '{provider}: аудио шигтгэх',
  'tools.linkPaste.embedImage': '{provider}: зураг шигтгэх',
  'tools.linkPaste.embedSocial': '{provider}: нийтлэл шигтгэх',
  'tools.linkPaste.embedDocument': '{provider}: баримт шигтгэх',
  'tools.linkPaste.embedTable': '{provider}: хүснэгт шигтгэх',
  'tools.linkPaste.embedForm': '{provider}: маягт шигтгэх',
  'tools.linkPaste.embedCode': '{provider}: код шигтгэх',
  'tools.linkPaste.embedDesign': '{provider}: дизайн шигтгэх',
  'tools.linkPaste.embedChart': '{provider}: график шигтгэх',
  'tools.linkPaste.embedMap': '{provider}: газрын зураг шигтгэх',
  'tools.linkPaste.embedCalendar': '{provider}: хуанли шигтгэх',
  'tools.video.seek': 'Тоглуулах байрлал',
  'tools.video.seekValueText':
    'Өнгөрсөн хугацаа: {current}. Нийт үргэлжлэх хугацаа: {total}.',
  'tools.video.toggleTimeDisplay':
    'Өнгөрсөн болон үлдсэн хугацааг ээлжлэн харуулах',
  'tools.video.speedPresets': 'Хурдны бэлэн тохиргоо',
  'tools.video.theater': 'Театрын горим',
  'tools.video.theaterExit': 'Театрын горимоос гарах',
  'tools.video.pip': 'Дэлгэц доторх дэлгэц',
  'tools.video.ctxCopyUrlAtTime':
    'Видеоны URL-ийг одоогийн тоглуулах хугацаатай нь хуулах',
  'tools.video.ctxStats': 'Тоглуулалтын статистик',
  'tools.callout.emojiSearchResults': 'Тохирох эможи: {count}',
};

const MARATHI_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'blockSettings.clickAction': 'मेनू उघडण्यासाठी क्लिक करा',
  'blockSettings.orConjunction': ' किंवा ',
  'blockSettings.openMenuAction': ' दाबा',
  'toolNames.toggleList': 'टॉगल यादी',
  'tools.marker.textColor': 'मजकुराचा रंग',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.header.toggleHeading': 'टॉगल शीर्षक',
  'tools.header.toggleHeading1': 'टॉगल शीर्षक 1',
  'tools.header.toggleHeading2': 'टॉगल शीर्षक 2',
  'tools.header.toggleHeading3': 'टॉगल शीर्षक 3',
  'tools.header.toggleHeading4': 'टॉगल शीर्षक 4',
  'tools.header.toggleHeading5': 'टॉगल शीर्षक 5',
  'tools.header.toggleHeading6': 'टॉगल शीर्षक 6',
  'tools.toggle.placeholder': 'टॉगल',
  'tools.toggle.bodyPlaceholder':
    'रिकामा टॉगल. ब्लॉक जोडण्यासाठी क्लिक करा किंवा ब्लॉक येथे ओढा.',
  'tools.toggle.ariaLabelExpand': 'विस्तृत करा',
  'tools.table.clearSelection': 'आशय साफ करा',
  'tools.table.headerColumn': 'हेडर स्तंभ',
  'tools.table.headerRow': 'हेडर पंक्ती',
  'tools.table.comfortableText': 'सामान्य मजकूर',
  'tools.table.placement': 'संरेखन',
  'tools.table.placementMiddleLeft': 'मध्यभागी डावीकडे',
  'tools.table.placementMiddleRight': 'मध्यभागी उजवीकडे',
  'a11y.blockDuplicated':
    'ब्लॉकची प्रत तयार झाली. स्थान: {position}. एकूण: {total}.',
  'a11y.blocksDuplicated':
    '{count} ब्लॉकच्या प्रती तयार झाल्या. सुरुवातीचे स्थान: {position}.',
  'a11y.searchResults': 'शोध परिणाम: {count}',
  'a11y.allBlocksSelected': 'सर्व ब्लॉक निवडले. एकूण: {count}.',
  'a11y.dropCreateColumnLeft': 'डावीकडे स्तंभ तयार केला जाईल',
  'a11y.dropCreateColumnRight': 'उजवीकडे स्तंभ तयार केला जाईल',
  'toolNames.clearFormat': 'मजकूर फॉरमॅटिंग साफ करणे',
  'searchTerms.header': 'हेडर',
  'searchTerms.collapsible': 'संकुचित करता येणारे',
  'searchTerms.number': 'क्रमांक',
  'searchTerms.expand': 'विस्तृत करा',
  'searchTerms.warning': 'चेतावणी',
  'searchTerms.blockquote': 'ब्लॉक कोट',
  'tools.callout.addEmoji': 'चिन्ह जोडा',
  'tools.callout.filterEmojis': 'इमोजी शोधा…',
  'tools.callout.pickRandom': 'यादृच्छिक इमोजी निवडा',
  'tools.quote.size': 'अवतरणाचा आकार',
  'tools.code.wrapLines': 'ओळी रॅप करा',
  'tools.code.searchLanguage': 'भाषा शोधा…',
  'searchTerms.snippet': 'कोडचा तुकडा',
  'searchTerms.pre': 'पूर्वस्वरूपित मजकूर',
  'tools.link.linkTitle': 'दुव्याचा मजकूर',
  'tools.code.autoDetected': 'स्वयंचलित',
  'tools.image.toggleCaption': 'कॅप्शन दाखवा किंवा लपवा',
  'tools.image.exitFullscreen': 'पूर्ण स्क्रीनमधून बाहेर पडा',
  'tools.image.downloadOriginal': 'मूळ प्रतिमा डाउनलोड करा',
  'tools.image.uploadProgress': 'अपलोडची प्रगती',
  'tools.image.altEdit': 'ऑल्ट टेक्स्ट संपादित करा',
  'tools.image.altDescription':
    'ही प्रतिमा पाहू न शकणाऱ्या लोकांसाठी तिचे वर्णन करा.',
  'tools.image.altPlaceholder': 'ऑल्ट टेक्स्ट',
  'tools.image.previewControls':
    'प्रतिमा पूर्वावलोकनासाठीची नियंत्रणे',
  'tools.image.navigationControls': 'प्रतिमांमधील नेव्हिगेशन',
  'tools.image.errorSourceOffline':
    'स्रोत फाइल हलवली गेली असावी किंवा उपलब्ध नसावी.',
  'tools.image.errorDefaultMessage':
    'या URL वरून प्रतिमा लोड करता आली नाही. वेगळा स्रोत वापरून पहा किंवा फाइल पुन्हा अपलोड करा.',
  'tools.image.cropAspectRatio': 'क्रॉपचा आकार',
  'tools.file.uploadProgress': 'अपलोडची प्रगती',
  'tools.file.toggleCaption': 'कॅप्शन दाखवा किंवा लपवा',
  'tools.file.previewRaw': 'स्रोत',
  'tools.file.previewBackToContent': 'आशयावर परत जा',
  'tools.video.alignmentLeft': 'डावीकडे संरेखित करा',
  'tools.video.alignmentCenter': 'मध्यभागी संरेखित करा',
  'tools.video.alignmentRight': 'उजवीकडे संरेखित करा',
  'tools.video.toggleCaption': 'कॅप्शन दाखवा किंवा लपवा',
  'tools.video.autoplay': 'ऑटोप्ले',
  'tools.audio.alignmentLeft': 'डावीकडे संरेखित करा',
  'tools.audio.alignmentCenter': 'मध्यभागी संरेखित करा',
  'tools.audio.alignmentRight': 'उजवीकडे संरेखित करा',
  'tools.audio.emptyOrDropHere': 'किंवा येथे ऑडिओ फाइल ड्रॉप करा',
  'tools.audio.coverSourceAria': 'कव्हर प्रतिमेचा स्रोत',
  'tools.database.viewTypeListDescription': 'आयटम साध्या यादीत दाखवा',
  'tools.database.propertyTypeSelect': 'निवड',
  'tools.bookmark.loading': 'लिंक पूर्वावलोकन लोड होत आहे…',
  'tools.embed.empty': 'एम्बेड लिंक नाही',
  'tools.video.seek': 'प्लेबॅक स्थान',
  'tools.video.seekValueText':
    'गेलेला वेळ: {current}. एकूण कालावधी: {total}.',
  'tools.video.toggleTimeDisplay':
    'गेलेला आणि उरलेला वेळ आलटून पालटून दाखवा',
  'tools.video.speedPresets': 'गतीचे प्रीसेट',
  'tools.video.pip': 'चित्रात-चित्र',
  'tools.video.ctxCopyUrlAtTime':
    'सध्याच्या प्लेबॅक वेळेसह व्हिडिओ URL कॉपी करा',
  'tools.video.ctxStats': 'प्लेबॅकची आकडेवारी',
  'tools.callout.emojiSearchResults': 'जुळणारे इमोजी: {count}',
  'tools.database.checkboxChecked': 'तपासले',
  'tools.database.checkboxUnchecked': 'तपासले नाही',
};

const MALAY_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'blockSettings.dragToMove': 'Seret untuk mengalihkan',
  'blockSettings.clickToOpenMenu': 'Klik untuk membuka menu',
  'blockSettings.openMenuAction': ' untuk membuka menu',
  'toolbox.addBelow': 'Klik untuk menambah di bawah',
  'toolNames.italic': 'Huruf condong',
  'toolNames.bulletedList': 'Senarai berbulet',
  'toolNames.todoList': 'Senarai semak',
  'tools.marker.textColor': 'Warna teks',
  'tools.paragraph.placeholder':
    'Tulis sesuatu atau tekan / untuk memilih alat',
  'tools.toggle.bodyPlaceholder':
    'Togol kosong. Klik untuk tambah satu blok atau seret blok ke sini.',
  'tools.table.clearSelection': 'Kosongkan kandungan',
  'tools.table.mergeCells': 'Gabungkan sel',
  'tools.table.splitCell': 'Pisahkan sel',
  'tools.table.clickToAddRow': 'Klik untuk menambah baris baharu',
  'tools.table.dragToAddRemoveRows':
    'Seret untuk menambah atau mengalih keluar baris',
  'tools.table.clickToAddColumn': 'Klik untuk menambah lajur baharu',
  'tools.table.dragToAddRemoveColumns':
    'Seret untuk menambah atau mengalih keluar lajur',
  'tools.table.placement': 'Penjajaran',
  'tools.table.placementTopLeft': 'Kiri atas',
  'tools.table.placementTopCenter': 'Tengah atas',
  'tools.table.placementTopRight': 'Kanan atas',
  'tools.table.placementMiddleLeft': 'Kiri tengah',
  'tools.table.placementMiddleRight': 'Kanan tengah',
  'tools.table.placementBottomLeft': 'Kiri bawah',
  'tools.table.placementBottomCenter': 'Tengah bawah',
  'tools.table.placementBottomRight': 'Kanan bawah',
  'blockSettings.lastEdited': 'Kali terakhir disunting',
  'blockSettings.lastEditedBy': 'Kali terakhir disunting oleh {name}',
  'a11y.dragHandle':
    'Seret untuk mengalihkan blok atau klik untuk membuka menu',
  'a11y.dropPosition':
    'Akan dilepaskan pada kedudukan {position} daripada {total}',
  'a11y.blockMoved':
    'Blok dialihkan ke kedudukan {position} daripada {total}',
  'a11y.blocksMoved': '{count} blok dialihkan ke kedudukan {position}',
  'a11y.blockDuplicated':
    'Blok digandakan pada kedudukan {position} daripada {total}',
  'a11y.blocksDuplicated':
    '{count} blok digandakan bermula pada kedudukan {position}',
  'a11y.atTop':
    'Tidak dapat dialihkan ke atas. Blok sudah berada di kedudukan paling atas.',
  'a11y.atBottom':
    'Tidak dapat dialihkan ke bawah. Blok sudah berada di kedudukan paling bawah.',
  'a11y.searchResults': 'Hasil carian: {count}',
  'a11y.allBlocksSelected': 'Semua blok dipilih. Jumlah: {count}.',
  'a11y.navigationModeExited': 'Telah keluar daripada mod navigasi',
  'a11y.navigatedToBlock': 'Telah beralih ke blok',
  'toolNames.underline': 'Garis bawah',
  'toolNames.strikethrough': 'Garis batal',
  'toolNames.clearFormat': 'Kosongkan format teks',
  'toolNames.divider': 'Pemisah',
  'searchTerms.layout': 'susun atur',
  'searchTerms.collapsible': 'teks boleh kuncup',
  'searchTerms.bullet': 'bulet',
  'searchTerms.unordered': 'tidak bernombor',
  'searchTerms.ordered': 'bernombor',
  'tools.callout.addEmoji': 'Tambah ikon',
  'tools.callout.editIcon': 'Sunting ikon',
  'tools.callout.removeEmoji': 'Alih keluar ikon',
  'tools.callout.filterEmojis': 'Cari emoji…',
  'tools.callout.pickRandom': 'Pilih emoji rawak',
  'tools.callout.skinTone': 'Ton kulit',
  'tools.code.searchLanguage': 'Cari bahasa…',
  'searchTerms.snippet': 'coretan kod',
  'searchTerms.pre': 'teks praformat',
  'blockSettings.copyLinkSuccess': 'Pautan disalin ke papan keratan',
  'blockSettings.copyLinkError': 'Tidak dapat menyalin pautan ke blok',
  'tools.link.linkTitle': 'Teks pautan',
  'tools.image.toggleCaption': 'Tunjukkan atau sembunyikan kapsyen',
  'tools.image.exitFullscreen': 'Keluar daripada skrin penuh',
  'tools.image.downloadOriginal': 'Muat turun imej asal',
  'tools.image.altDescription':
    'Terangkan imej ini untuk orang yang tidak dapat melihatnya.',
  'tools.image.resetZoom': 'Tetapkan semula zum',
  'tools.image.errorSourceOffline':
    'Fail sumber mungkin telah dipindahkan atau tidak dapat dicapai.',
  'tools.image.errorDefaultMessage':
    'Imej tidak dapat dimuatkan daripada URL ini. Cuba sumber lain atau muat naik fail sekali lagi.',
  'tools.image.emptyDropToUpload': 'Lepaskan untuk memuat naik',
  'tools.image.cropReset': 'Tetapkan semula',
  'tools.file.emptyDropToUpload': 'Lepaskan untuk memuat naik',
  'tools.file.toggleCaption': 'Tunjukkan atau sembunyikan kapsyen',
  'tools.file.previewRender': 'Pratonton',
  'tools.video.alignmentLeft': 'Jajar kiri',
  'tools.video.alignmentCenter': 'Jajar tengah',
  'tools.video.alignmentRight': 'Jajar kanan',
  'tools.video.toggleCaption': 'Tunjukkan atau sembunyikan kapsyen',
  'tools.video.autoplay': 'Automain',
  'tools.video.emptyDropToUpload': 'Lepaskan untuk memuat naik',
  'tools.audio.alignmentLeft': 'Jajar kiri',
  'tools.audio.alignmentCenter': 'Jajar tengah',
  'tools.audio.alignmentRight': 'Jajar kanan',
  'tools.audio.titlePlaceholder': 'Tajuk trek',
  'tools.audio.emptyOrDropHere': 'atau lepaskan fail audio di sini',
  'tools.audio.emptyDropToUpload': 'Lepaskan untuk memuat naik',
  'tools.audio.coverDropToUpload': 'Lepaskan untuk memuat naik',
  'tools.audio.coverSourceAria': 'Sumber imej kulit album',
  'tools.database.viewTypeListDescription':
    'Tunjukkan item dalam senarai ringkas',
  'tools.database.propertyTypeSelect': 'Pilihan',
  'tools.database.propertyTypeMultiSelect': 'Berbilang pilihan',
  'tools.database.defaultStatusInProgress': 'Dalam proses',
  'tools.bookmark.loading': 'Memuatkan pratonton pautan…',
  'tools.embed.empty': 'Tiada pautan untuk dibenamkan',
  'tools.embed.openOriginal': 'Buka kandungan asal',
  'tools.embed.urlSubmit': 'Benamkan pautan',
  'tools.embed.invalidUrl': 'Pautan itu tidak boleh dibenamkan',
  'tools.video.seek': 'Kedudukan main balik',
  'tools.video.toggleTimeDisplay':
    'Tukar antara masa berlalu dengan masa berbaki',
  'tools.video.fullscreenExit': 'Keluar daripada skrin penuh',
  'tools.video.speedIncrease': 'Tingkatkan kelajuan main balik',
  'tools.video.theaterExit': 'Keluar daripada mod teater',
  'tools.video.ctxCopyUrlAtTime':
    'Salin URL video pada masa main balik semasa',
  'tools.video.ctxStats': 'Statistik main balik',
  'tools.audio.speedIncrease': 'Tingkatkan kelajuan main balik',
  'tools.callout.emojiSearchResults': 'Padanan emoji: {count}',
  'tools.database.checkboxChecked': 'Ditandai',
  'tools.database.checkboxUnchecked': 'Tidak ditandai',
};

const BURMESE_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'blockSettings.clickAction': 'မီနူးကို ဖွင့်ရန် နှိပ်ပါ',
  'blockSettings.orConjunction': ' သို့မဟုတ် ',
  'blockSettings.openMenuAction': ' ကို နှိပ်ပါ',
  'popover.search': 'လုပ်ဆောင်ချက်တစ်ခုကို ရှာပါ…',
  'tools.marker.textColor': 'စာသားအရောင်',
  'tools.colorPicker.defaultSwatchLabel': '{default} {mode}',
  'tools.colorPicker.colorSwatchLabel': '{color} {mode}',
  'tools.toggle.bodyPlaceholder': 'ဗလာ ခေါက်စာ။ ဘလောက်တစ်ခုထည့်ရန် နှိပ်ပါ သို့မဟုတ် ဘလောက်များကို ဤနေရာသို့ ဆွဲယူပါ။',
  'tools.toggle.ariaLabelCollapse': 'ခေါက်သိမ်းရန်',
  'tools.table.clearSelection': 'အကြောင်းအရာများကို ရှင်းလင်းရန်',
  'tools.table.placement': 'တန်းညှိခြင်း',
  'tools.table.placementTopLeft': 'ဘယ်ဘက်အပေါ်',
  'tools.table.placementTopCenter': 'အလယ်အပေါ်',
  'tools.table.placementTopRight': 'ညာဘက်အပေါ်',
  'tools.table.placementMiddleLeft': 'ဘယ်ဘက်အလယ်',
  'tools.table.placementMiddleRight': 'ညာဘက်အလယ်',
  'tools.table.placementBottomLeft': 'ဘယ်ဘက်အောက်',
  'tools.table.placementBottomCenter': 'အလယ်အောက်',
  'tools.table.placementBottomRight': 'ညာဘက်အောက်',
  'a11y.dragHandle': 'ဘလောက်ရွှေ့ရန် ဆွဲယူပါ သို့မဟုတ် မီနူးဖွင့်ရန် နှိပ်ပါ',
  'a11y.dropPosition': 'စုစုပေါင်း {total} ခုအနက် အနေအထား {position} တွင် ချပါမည်',
  'a11y.dropCancelled': 'ဆွဲယူမှုကို ပယ်ဖျက်ပြီးပါပြီ',
  'a11y.blockMoved': 'ဘလောက်ကို စုစုပေါင်း {total} ခုအနက် အနေအထား {position} သို့ ရွှေ့ပြီးပါပြီ',
  'a11y.blocksMoved': 'ဘလောက် {count} ခုကို အနေအထား {position} သို့ ရွှေ့ပြီးပါပြီ။',
  'a11y.blockDuplicated': 'ဘလောက်ကို စုစုပေါင်း {total} ခုအနက် အနေအထား {position} တွင် မိတ္တူပွားပြီးပါပြီ',
  'a11y.blocksDuplicated': 'ဘလောက် {count} ခုကို အနေအထား {position} မှစ၍ မိတ္တူပွားပြီးပါပြီ။',
  'a11y.searchResults': 'ရှာဖွေမှုရလဒ် {count} ခု',
  'a11y.allBlocksSelected': 'ဘလောက်အားလုံးကို ရွေးထားသည်။ စုစုပေါင်း {count} ခု',
  'a11y.navigationPosition': '{tool}၊ စုစုပေါင်း {total} ခုအနက် အနေအထား {position}',
  'toolNames.clearFormat': 'ဖော်မတ်ချခြင်းကို ရှင်းလင်းရန်',
  'tools.columns.resizeAriaLabel': 'ကော်လံများ၏ အရွယ်အစားကို ချိန်ညှိရန်',
  'tools.spacer.resizeAriaLabel': 'နေရာလွတ်၏ အရွယ်အစားကို ချိန်ညှိရန်',
  'tools.columns.turnInto': 'ကော်လံများအဖြစ် ပြောင်းရန်',
  'searchTerms.separator': 'ခွဲခြားမျဉ်း',
  'searchTerms.delimiter': 'ပိုင်းခြားသင်္ကေတ',
  'searchTerms.splitter': 'အပိုင်းခွဲကိရိယာ',
  'searchTerms.collapse': 'ခေါက်သိမ်း',
  'searchTerms.grid': 'ဇယားကွက်',
  'searchTerms.tip': 'အကြံပြုချက်',
  'searchTerms.blockquote': 'ဘလောက်ကိုးကားချက်',
  'searchTerms.citation': 'ကိုးကားအညွှန်း',
  'tools.callout.addEmoji': 'အိုင်ကွန် ထည့်ရန်',
  'tools.callout.filterEmojis': 'အီမိုဂျီများကို ရှာပါ…',
  'tools.callout.pickRandom': 'အီမိုဂျီတစ်ခုကို ကျပန်းရွေးရန်',
  'tools.code.copied': 'မိတ္တူကူးပြီးပါပြီ!',
  'tools.code.searchLanguage': 'ဘာသာစကားများကို ရှာပါ…',
  'searchTerms.pre': 'ကြိုတင်ဖော်မတ်ချထားသော စာသား',
  'tools.link.linkTitle': 'လင့်ခ်စာသား',
  'tools.image.toggleCaption': 'စာတန်းကို ပြပါ သို့မဟုတ် ဖျောက်ပါ',
  'tools.image.downloadOriginal': 'မူရင်းပုံကို ဒေါင်းလုဒ်လုပ်ရန်',
  'tools.image.cancelUpload': 'အပ်လုဒ်ကို ပယ်ဖျက်ရန်',
  'tools.image.altDescription': 'ပုံကို မမြင်နိုင်သူများအတွက် ဤပုံကို ဖော်ပြပါ။',
  'tools.image.previewControls': 'ပုံအစမ်းကြည့်ရှုမှု ထိန်းချုပ်ခလုတ်များ',
  'tools.image.navigationControls': 'ပုံများကြား လမ်းညွှန်မှု',
  'tools.image.errorSourceOffline': 'ရင်းမြစ်ဖိုင်ကို ရွှေ့ထားခြင်း သို့မဟုတ် အွန်လိုင်းတွင် မရနိုင်ခြင်း ဖြစ်နိုင်သည်။',
  'tools.image.errorDefaultMessage': 'ဤ URL မှ ပုံကို ဖွင့်၍မရပါ။ အခြားရင်းမြစ်တစ်ခုကို စမ်းသုံးပါ သို့မဟုတ် ဖိုင်ကို ပြန်အပ်လုဒ်တင်ပါ။',
  'tools.image.emptyOrDropHere': 'သို့မဟုတ် ပုံကို ဤနေရာတွင် လွှတ်ချပါ',
  'tools.image.emptyUrlPlaceholder': 'ပုံ URL ကို ကူးထည့်ပါ…',
  'tools.image.emptySourceAria': 'ပုံရင်းမြစ်',
  'tools.file.emptyDropHint': 'သို့မဟုတ် ဖိုင်ကို ဤနေရာတွင် လွှတ်ချပါ',
  'tools.file.emptySourceAria': 'ဖိုင်ရင်းမြစ်',
  'tools.file.emptyUrlPlaceholder': 'ဖိုင် URL ကို ကူးထည့်ပါ…',
  'tools.file.cancelUpload': 'အပ်လုဒ်ကို ပယ်ဖျက်ရန်',
  'tools.file.toggleCaption': 'စာတန်းကို ပြပါ သို့မဟုတ် ဖျောက်ပါ',
  'tools.file.previewRaw': 'ရင်းမြစ်',
  'tools.file.previewRender': 'အစမ်းကြည့်ရှုမှု',
  'tools.video.alignmentLeft': 'ဘယ်ဘက်ညှိ',
  'tools.video.alignmentCenter': 'အလယ်ညှိ',
  'tools.video.alignmentRight': 'ညာဘက်ညှိ',
  'tools.video.toggleCaption': 'စာတန်းကို ပြပါ သို့မဟုတ် ဖျောက်ပါ',
  'tools.video.emptyOrDropHere': 'သို့မဟုတ် ဗီဒီယိုကို ဤနေရာတွင် လွှတ်ချပါ',
  'tools.video.emptyUrlPlaceholder': 'ဗီဒီယို URL ကို ကူးထည့်ပါ…',
  'tools.video.emptySourceAria': 'ဗီဒီယိုရင်းမြစ်',
  'tools.audio.alignmentLeft': 'ဘယ်ဘက်ညှိ',
  'tools.audio.alignmentCenter': 'အလယ်ညှိ',
  'tools.audio.alignmentRight': 'ညာဘက်ညှိ',
  'tools.audio.titlePlaceholder': 'အသံဖိုင်ခေါင်းစဉ်',
  'tools.audio.emptyOrDropHere': 'သို့မဟုတ် အသံဖိုင်ကို ဤနေရာတွင် လွှတ်ချပါ',
  'tools.audio.emptyUrlPlaceholder': 'အသံ URL ကို ကူးထည့်ပါ…',
  'tools.audio.emptySourceAria': 'အသံရင်းမြစ်',
  'tools.audio.coverOrDropHere': 'သို့မဟုတ် ပုံကို ဤနေရာတွင် လွှတ်ချပါ',
  'tools.audio.coverUrlPlaceholder': 'ပုံ URL ကို ကူးထည့်ပါ…',
  'tools.audio.coverSourceAria': 'အဖုံးပုံရင်းမြစ်',
  'tools.database.viewTypeListDescription': 'အကြောင်းအရာများကို ရိုးရှင်းသော စာရင်းတွင် ပြရန်',
  'tools.database.propertyTypeHeading': 'ဂုဏ်သတ္တိအမျိုးအစား',
  'tools.database.propertyTypeNumber': 'ကိန်းဂဏန်း',
  'tools.database.propertyTypeSelect': 'ရွေးချယ်မှု',
  'tools.database.propertyTypeMultiSelect': 'အများအပြားရွေးချယ်မှု',
  'toolNames.bookmark': 'စာညှပ်',
  'toolNames.embed': 'မြှုပ်သွင်းမှု',
  'tools.bookmark.empty': 'စာညှပ်တစ်ခု ဖန်တီးရန် လင့်ခ်ကို ကူးထည့်ပါ',
  'tools.bookmark.loading': 'လင့်ခ်အစမ်းကြည့်ရှုမှုကို တင်နေသည်…',
  'tools.embed.empty': 'မြှုပ်သွင်းရန် လင့်ခ်မရှိပါ',
  'tools.embed.urlPlaceholder': 'မြှုပ်သွင်းရန် လင့်ခ်ကို ကူးထည့်ပါ…',
  'tools.embed.urlSubmit': 'လင့်ခ်ကို မြှုပ်သွင်းရန်',
  'tools.embed.invalidUrl': 'ထိုလင့်ခ်ကို မြှုပ်သွင်း၍မရပါ',
  'tools.linkPaste.bookmark': 'စာညှပ် ဖန်တီးရန်',
  'tools.linkPaste.embed': 'မြှုပ်သွင်းမှု ဖန်တီးရန်',
  'tools.linkPaste.embedVideo': '{provider} မှ ဗီဒီယိုကို မြှုပ်သွင်းရန်',
  'tools.linkPaste.embedAudio': '{provider} မှ အသံကို မြှုပ်သွင်းရန်',
  'tools.linkPaste.embedImage': '{provider} မှ ပုံကို မြှုပ်သွင်းရန်',
  'tools.linkPaste.embedSocial': '{provider} မှ ပို့စ်ကို မြှုပ်သွင်းရန်',
  'tools.linkPaste.embedDocument': '{provider} မှ စာရွက်စာတမ်းကို မြှုပ်သွင်းရန်',
  'tools.linkPaste.embedTable': '{provider} မှ ဇယားကို မြှုပ်သွင်းရန်',
  'tools.linkPaste.embedForm': '{provider} မှ ဖောင်ကို မြှုပ်သွင်းရန်',
  'tools.linkPaste.embedCode': '{provider} မှ ကုဒ်ကို မြှုပ်သွင်းရန်',
  'tools.linkPaste.embedDesign': '{provider} မှ ဒီဇိုင်းကို မြှုပ်သွင်းရန်',
  'tools.linkPaste.embedChart': '{provider} မှ ကားချပ်ကို မြှုပ်သွင်းရန်',
  'tools.linkPaste.embedMap': '{provider} မှ မြေပုံကို မြှုပ်သွင်းရန်',
  'tools.linkPaste.embedCalendar': '{provider} မှ ပြက္ခဒိန်ကို မြှုပ်သွင်းရန်',
  'tools.linkPaste.mention': 'အမည်ဖော်ပြခြင်း',
  'tools.video.seek': 'ဗီဒီယိုအချိန်မှတ်တမ်း',
  'tools.video.toggleTimeDisplay': 'ကုန်လွန်ချိန်နှင့် ကျန်ရှိချိန်ကို အပြန်အလှန် ပြရန်',
  'tools.video.ctxCopyUrlAtTime': 'လက်ရှိဖွင့်ချိန်ပါသော ဗီဒီယို URL ကို ကူးရန်',
  'tools.video.ctxStats': 'ဗီဒီယိုဖွင့်ခြင်းဆိုင်ရာ စာရင်းအင်းများ',
};

const NEPALI_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'popover.convertTo': 'यसमा रूपान्तरण गर्नुहोस्',
  'toolNames.link': 'लिङ्क',
  'toolNames.bold': 'बाक्लो',
  'toolNames.bulletedList': 'गोलिचिन्ह सूची',
  'toolNames.numberedList': 'क्रमाङ्कित सूची',
  'toolNames.toggleList': 'टगल सूची',
  'tools.link.addLink': 'लिङ्क थप्नुहोस्',
  'tools.link.invalidLink': 'अमान्य लिङ्क',
  'tools.marker.textColor': 'पाठको रङ',
  'tools.colorPicker.defaultSwatchLabel': '{default} {mode}',
  'tools.colorPicker.colorSwatchLabel': '{color} {mode}',
  'tools.header.toggleHeading': 'टगल शीर्षक',
  'tools.header.toggleHeading1': 'टगल शीर्षक १',
  'tools.header.toggleHeading2': 'टगल शीर्षक २',
  'tools.header.toggleHeading3': 'टगल शीर्षक ३',
  'tools.header.toggleHeading4': 'टगल शीर्षक ४',
  'tools.header.toggleHeading5': 'टगल शीर्षक ५',
  'tools.header.toggleHeading6': 'टगल शीर्षक ६',
  'blockSettings.copyLink': 'ब्लकको लिङ्क प्रतिलिपि गर्नुहोस्',
  'a11y.dragHandle': 'ब्लक सार्न तान्नुहोस् वा मेनु खोल्न क्लिक गर्नुहोस्',
  'a11y.dragStarted': 'ब्लक तानिँदै छ',
  'a11y.dragStartedMultiple': 'तानिँदै गरेका ब्लकहरूको सङ्ख्या: {count}',
  'a11y.dropCancelled': 'तान्ने कार्य रद्द भयो',
  'a11y.blocksMoved': 'स्थान {position} मा सारिएका ब्लकहरूको सङ्ख्या: {count}',
  'a11y.blocksDuplicated': 'स्थान {position} बाट सुरु हुने गरी नक्कल गरिएका ब्लकहरूको सङ्ख्या: {count}',
  'a11y.searchResults': 'खोज परिणामहरूको सङ्ख्या: {count}',
  'a11y.allBlocksSelected': 'सबै ब्लकहरू चयन गरिए। जम्मा: {count}।',
  'a11y.blocksSelected': 'चयन गरिएका ब्लकहरूको सङ्ख्या: {count}',
  'a11y.navigationModeEntered': 'नेभिगेसन मोड। ब्लकहरूबीच जान एरो कुञ्जीहरू, सम्पादन गर्न Enter र बाहिर निस्कन Escape प्रयोग गर्नुहोस्।',
  'a11y.navigationPosition': '{tool}, कुल {total} मध्ये स्थान {position}',
  'blockSettings.clickAction': 'मेनु खोल्न क्लिक गर्नुहोस्',
  'blockSettings.orConjunction': ' वा ',
  'blockSettings.openMenuAction': ' थिच्नुहोस्',
  'tools.toggle.placeholder': 'टगल',
  'tools.toggle.bodyPlaceholder': 'खाली टगल। ब्लक थप्न क्लिक गर्नुहोस् वा ब्लकहरू यहाँ तान्नुहोस्।',
  'tools.table.clearSelection': 'सामग्री खाली गर्नुहोस्',
  'tools.table.copySelection': 'प्रतिलिपि गर्नुहोस्',
  'tools.table.headerColumn': 'हेडर स्तम्भ',
  'tools.table.headerRow': 'हेडर पङ्क्ति',
  'blockSettings.convertWithChildrenWarning': 'नेस्टेड ब्लक: {count}। यो ब्लक रूपान्तरण गर्दा नेस्टेड सामग्री शीर्ष तहमा सारिनेछ। जारी राख्नुहुन्छ?',
  'toolNames.clearFormat': 'ढाँचा खाली गर्नुहोस्',
  'searchTerms.header': 'हेडर',
  'tools.callout.addEmoji': 'आइकन थप्नुहोस्',
  'tools.callout.filterEmojis': 'इमोजी खोज्नुहोस्…',
  'tools.callout.pickRandom': 'अनियमित इमोजी छान्नुहोस्',
  'tools.callout.emojiCategorySymbols': 'चिन्हहरू',
  'tools.callout.emojiCategoryFlags': 'झण्डाहरू',
  'tools.quote.size': 'उद्धरणको आकार',
  'tools.code.sideBySide': 'छेउछाउमा',
  'tools.table.placement': 'पङ्क्तिबद्धता',
  'tools.table.placementTopLeft': 'माथिल्लो बायाँ',
  'tools.table.placementTopCenter': 'माथिल्लो केन्द्र',
  'tools.table.placementTopRight': 'माथिल्लो दायाँ',
  'tools.table.placementBottomLeft': 'तल्लो बायाँ',
  'tools.table.placementBottomCenter': 'तल्लो केन्द्र',
  'tools.table.placementBottomRight': 'तल्लो दायाँ',
  'toolNames.inlineCode': 'इनलाइन कोड',
  'tools.code.searchLanguage': 'भाषाहरू खोज्नुहोस्…',
  'searchTerms.pre': 'पूर्वढाँचाबद्ध पाठ',
  'toolNames.image': 'तस्बिर',
  'tools.link.linkTitle': 'लिङ्कको पाठ',
  'tools.image.caption': 'क्याप्सन',
  'tools.image.toggleCaption': 'क्याप्सन देखाउनुहोस् वा लुकाउनुहोस्',
  'tools.image.captionPlaceholder': 'क्याप्सन लेख्नुहोस्…',
  'tools.image.replace': 'तस्बिर बदल्नुहोस्',
  'tools.image.downloadOriginal': 'मूल तस्बिर डाउनलोड गर्नुहोस्',
  'tools.image.copyUrl': 'URL को प्रतिलिपि गर्नुहोस्',
  'tools.image.altEdit': 'वैकल्पिक पाठ सम्पादन गर्नुहोस्',
  'tools.image.altDescription': 'यो तस्बिर देख्न नसक्ने व्यक्तिहरूका लागि यसको वर्णन गर्नुहोस्।',
  'tools.image.altPlaceholder': 'वैकल्पिक पाठ',
  'tools.image.preview': 'तस्बिरको पूर्वावलोकन',
  'tools.image.previewControls': 'तस्बिर पूर्वावलोकनका नियन्त्रणहरू',
  'tools.image.navigationControls': 'तस्बिर नेभिगेसन',
  'tools.image.previousImage': 'अघिल्लो तस्बिर',
  'tools.image.nextImage': 'अर्को तस्बिर',
  'tools.image.errorFileTooLarge': 'तस्बिर धेरै ठूलो छ। {size} ले {max} सीमा नाघेको छ।',
  'tools.image.errorUnavailable': 'तस्बिर उपलब्ध छैन',
  'tools.image.errorImageFailedToLoad': 'तस्बिर लोड गर्न सकिएन',
  'tools.image.errorDefaultTitle': 'तस्बिर लोड गर्न सकिएन',
  'tools.image.errorDefaultMessage': 'यो URL बाट तस्बिर लोड गर्न सकिएन। फरक स्रोत प्रयोग गर्नुहोस् वा फाइल फेरि अपलोड गर्नुहोस्।',
  'tools.image.emptyAddImage': 'तस्बिर थप्नुहोस्',
  'tools.image.emptyOrDropHere': 'वा यहाँ तस्बिर छोड्नुहोस्',
  'tools.image.emptyDropToUpload': 'अपलोड गर्न यहाँ छोड्नुहोस्',
  'tools.image.emptyUrlPlaceholder': 'तस्बिरको URL टाँस्नुहोस्…',
  'tools.image.emptyUrlAria': 'तस्बिरको URL',
  'tools.image.emptySourceAria': 'तस्बिरको स्रोत',
  'tools.image.cropDialogLabel': 'तस्बिर क्रप गर्नुहोस्',
  'tools.database.duplicateView': 'नक्कल बनाउनुहोस्',
  'tools.database.viewTypeBoardDescription': 'वस्तुहरू स्तम्भहरूमा देखाउनुहोस्',
  'tools.database.viewTypeListDescription': 'वस्तुहरू साधारण सूचीमा देखाउनुहोस्',
  'tools.database.propertyTypeHeading': 'गुणको प्रकार',
  'tools.database.propertyTypeSelect': 'छनोट',
  'tools.bookmark.loading': 'लिङ्क पूर्वावलोकन लोड हुँदैछ…',
  'tools.embed.empty': 'इम्बेड गर्ने लिङ्क छैन',
  'tools.embed.captionPlaceholder': 'क्याप्सन लेख्नुहोस्…',
  'tools.embed.urlPlaceholder': 'इम्बेड गर्न लिङ्क टाँस्नुहोस्…',
  'tools.embed.urlSubmit': 'लिङ्क इम्बेड गर्नुहोस्',
  'tools.embed.invalidUrl': 'त्यो लिङ्क इम्बेड गर्न मिल्दैन',
  'tools.linkPaste.mention': 'उल्लेख गर्नुहोस्',
  'tools.file.emptyDropToUpload': 'अपलोड गर्न यहाँ छोड्नुहोस्',
  'tools.file.toggleCaption': 'क्याप्सन देखाउनुहोस् वा लुकाउनुहोस्',
  'tools.file.captionPlaceholder': 'क्याप्सन लेख्नुहोस्…',
  'tools.file.copyUrl': 'URL को प्रतिलिपि गर्नुहोस्',
  'tools.video.alignmentLeft': 'बायाँ पङ्क्तिबद्ध गर्नुहोस्',
  'tools.video.alignmentCenter': 'केन्द्रमा पङ्क्तिबद्ध गर्नुहोस्',
  'tools.video.alignmentRight': 'दायाँ पङ्क्तिबद्ध गर्नुहोस्',
  'tools.video.caption': 'क्याप्सन',
  'tools.video.captionPlaceholder': 'क्याप्सन लेख्नुहोस्…',
  'tools.video.toggleCaption': 'क्याप्सन देखाउनुहोस् वा लुकाउनुहोस्',
  'tools.video.copyUrl': 'URL को प्रतिलिपि गर्नुहोस्',
  'tools.video.emptyDropToUpload': 'अपलोड गर्न यहाँ छोड्नुहोस्',
  'tools.audio.alignmentLeft': 'बायाँ पङ्क्तिबद्ध गर्नुहोस्',
  'tools.audio.alignmentCenter': 'केन्द्रमा पङ्क्तिबद्ध गर्नुहोस्',
  'tools.audio.alignmentRight': 'दायाँ पङ्क्तिबद्ध गर्नुहोस्',
  'tools.audio.caption': 'क्याप्सन',
  'tools.audio.captionPlaceholder': 'क्याप्सन लेख्नुहोस्…',
  'tools.audio.copyUrl': 'URL को प्रतिलिपि गर्नुहोस्',
  'tools.audio.emptyOrDropHere': 'वा यहाँ अडियो फाइल छोड्नुहोस्',
  'tools.audio.emptyDropToUpload': 'अपलोड गर्न यहाँ छोड्नुहोस्',
  'tools.audio.coverSet': 'कभर तस्बिर सेट गर्नुहोस्',
  'tools.audio.coverErrorType': 'तस्बिर फाइल छान्नुहोस्',
  'tools.audio.coverErrorTooLarge': 'तस्बिर धेरै ठूलो छ',
  'tools.audio.coverOrDropHere': 'वा यहाँ तस्बिर छोड्नुहोस्',
  'tools.audio.coverDropToUpload': 'अपलोड गर्न यहाँ छोड्नुहोस्',
  'tools.audio.coverUrlPlaceholder': 'तस्बिरको URL टाँस्नुहोस्…',
  'tools.audio.coverUrlAria': 'तस्बिरको URL',
  'tools.audio.coverSourceAria': 'कभरको स्रोत',
  'tools.video.seek': 'प्लेब्याकको स्थान',
  'tools.video.seekValueText': 'हालको समय: {current}। कुल अवधि: {total}।',
  'tools.video.toggleTimeDisplay': 'बितेको समय र बाँकी समयबीच बदल्नुहोस्',
  'tools.video.ctxCopyUrlAtTime': 'हालको प्लेब्याक समयमा भिडियो URL प्रतिलिपि गर्नुहोस्',
  'tools.video.ctxStats': 'प्लेब्याक तथ्याङ्क',
  'tools.callout.emojiSearchResults': 'मिल्ने इमोजीहरूको सङ्ख्या: {count}',
  'tools.database.checkboxChecked': 'जाँच गरिएको',
  'tools.database.checkboxUnchecked': 'जाँच गरिएको छैन',
};

const DUTCH_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'blockSettings.clickToOpenMenu': 'Klik om het menu te openen',
  'blockSettings.openMenuAction': ' om het menu te openen',
  'blockSettings.convertWithChildrenWarning':
    'Geneste blokken: {count}. Door dit blok om te zetten, wordt de geneste inhoud naar het hoogste niveau verplaatst. Doorgaan?',
  'toolbox.optionAddAbove': '⌥-klik om erboven in te voegen',
  'toolbox.ctrlAddAbove': 'Ctrl-klik om erboven in te voegen',
  'tools.marker.textColor': 'Tekstkleur',
  'tools.paragraph.placeholder':
    'Schrijf iets of druk op / om een blok te kiezen',
  'tools.toggle.bodyPlaceholder':
    'Lege inklaplijst. Klik om een blok toe te voegen of sleep blokken hierheen.',
  'tools.table.clearSelection': 'Inhoud wissen',
  'tools.table.placement': 'Uitlijning',
  'a11y.dragHandle':
    'Sleep om het blok te verplaatsen of klik om het menu te openen',
  'a11y.atTop':
    'Omhoog verplaatsen is niet mogelijk. De bovenste positie is al bereikt.',
  'a11y.atBottom':
    'Omlaag verplaatsen is niet mogelijk. De onderste positie is al bereikt.',
  'a11y.searchResults': 'Zoekresultaten: {count}',
  'a11y.allBlocksSelected': 'Alle blokken geselecteerd. Totaal: {count}',
  'a11y.navigationModeEntered':
    'Navigatiemodus. Gebruik de pijltoetsen om tussen blokken te navigeren. Druk op Enter om te bewerken en op Escape om af te sluiten.',
  'a11y.navigatedToBlock': 'Naar het blok genavigeerd',
  'a11y.dropCreateColumnLeft': 'Bij loslaten wordt links een kolom gemaakt',
  'a11y.dropCreateColumnRight':
    'Bij loslaten wordt rechts een kolom gemaakt',
  'tools.columns.resizeAriaLabel': 'Kolombreedte aanpassen',
  'toolNames.callout': 'Markering',
  'tools.callout.placeholder': 'Markering',
  'tools.callout.calloutEmojiCategory': 'Markering',
  'tools.callout.addEmoji': 'Pictogram toevoegen',
  'tools.callout.filterEmojis': 'Emoji\'s zoeken…',
  'tools.callout.pickRandom': 'Willekeurige emoji kiezen',
  'toolNames.equation': 'Vergelijking',
  'tools.equation.placeholder': 'Voer een LaTeX-formule in…',
  'tools.code.searchLanguage': 'Talen zoeken…',
  'tools.link.linkTitle': 'Linktekst',
  'tools.image.sizeMedium': 'Middelgroot',
  'tools.image.converting': 'Converteren…',
  'tools.image.altDescription':
    'Beschrijf de afbeelding voor mensen die deze niet kunnen zien.',
  'tools.image.errorFileTooLarge':
    'De afbeelding is te groot. {size} overschrijdt de limiet van {max}.',
  'tools.image.errorDefaultMessage':
    'De afbeelding kon niet via deze URL worden geladen. Probeer een andere bron of upload het bestand opnieuw.',
  'tools.file.errorFileTooLarge':
    'Het bestand is te groot. {size} overschrijdt de limiet van {max}.',
  'tools.video.alignmentLeft': 'Links uitlijnen',
  'tools.video.alignmentCenter': 'Centreren',
  'tools.video.alignmentRight': 'Rechts uitlijnen',
  'tools.video.errorFileTooLarge':
    'De video is te groot. {size} overschrijdt de limiet van {max}.',
  'tools.audio.alignmentLeft': 'Links uitlijnen',
  'tools.audio.alignmentCenter': 'Centreren',
  'tools.audio.alignmentRight': 'Rechts uitlijnen',
  'tools.audio.errorFileTooLarge':
    'Het audiobestand is te groot. {size} overschrijdt de limiet van {max}.',
  'tools.audio.errorGoogleDrive':
    'Audio uit Google Drive kan niet rechtstreeks worden afgespeeld. Download het bestand en upload het in plaats daarvan hier.',
  'tools.audio.errorOneDrive':
    'Audio uit OneDrive kan niet rechtstreeks worden afgespeeld. Download het bestand en upload het in plaats daarvan hier.',
  'tools.audio.titlePlaceholder': 'Titel',
  'tools.audio.artistPlaceholder': 'Artiest',
  'tools.audio.emptyOrDropHere': 'of sleep een audiobestand hierheen',
  'tools.audio.coverChange': 'Illustratie wijzigen',
  'tools.audio.coverSet': 'Illustratie instellen',
  'tools.audio.coverRemove': 'Illustratie verwijderen',
  'tools.audio.coverErrorType': 'Kies een afbeeldingsbestand',
  'tools.audio.coverErrorTooLarge': 'De afbeelding is te groot',
  'tools.audio.coverAdd': 'Illustratie toevoegen',
  'tools.audio.coverSourceAria': 'Bron van illustratie',
  'tools.database.viewTypeListDescription':
    'Items in een eenvoudige lijst weergeven',
  'tools.bookmark.loading': 'Linkvoorbeeld laden…',
  'tools.embed.empty': 'Geen ingesloten link',
  'tools.video.seek': 'Afspeelpositie',
  'tools.video.toggleTimeDisplay':
    'Wisselen tussen verstreken en resterende tijd',
  'tools.video.speedPresets': 'Vooraf ingestelde snelheden',
  'tools.video.pip': 'Beeld in beeld',
  'tools.video.ctxCopyUrlAtTime':
    'Video-URL vanaf de huidige afspeelpositie kopiëren',
  'tools.video.ctxStats': 'Afspeelstatistieken',
  'tools.callout.emojiSearchResults': 'Emojiresultaten: {count}',
  'toolNames.clearFormat': 'Opmaak wissen',
  'tools.table.headerColumn': 'Koptekstkolom',
  'tools.table.headerRow': 'Koptekstrij',
  'tools.table.placementTopLeft': 'Linksboven',
  'tools.table.placementTopCenter': 'Midden boven',
  'tools.table.placementTopRight': 'Rechtsboven',
  'tools.table.placementMiddleLeft': 'Linksmidden',
  'tools.table.placementMiddleRight': 'Rechtsmidden',
  'tools.table.placementBottomLeft': 'Linksonder',
  'tools.table.placementBottomCenter': 'Middenonder',
  'tools.table.placementBottomRight': 'Rechtsonder',
  'toolNames.inlineCode': 'Inlinecode',
  'tools.image.errorRetry': 'Opnieuw proberen',
  'tools.database.propertyTypeSelect': 'Selecteren',
  'tools.database.propertyTypeMultiSelect': 'Meerdere selecteren',
  'tools.linkPaste.mention': 'Vermelden',
  'tools.file.previewRender': 'Voorbeeld',
  'tools.video.theater': 'Theatermodus',
  'tools.video.theaterExit': 'Theatermodus sluiten',
  'tools.callout.emojiCategoryActivity': 'Activiteiten',
  'tools.image.previewControls': 'Regelaars voor afbeeldingsvoorbeeld',
  'tools.image.errorSourceOffline':
    'Het bronbestand is mogelijk verplaatst of niet beschikbaar.',
  'searchTerms.header': 'tussenkop',
  'searchTerms.number': 'nummering',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
};

const NORWEGIAN_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'blockSettings.convertWithChildrenWarning':
    'Nestede blokker: {count}. Når denne blokken konverteres, flyttes det nestede innholdet til øverste nivå. Vil du fortsette?',
  'toolbox.optionAddAbove': 'Tilvalg-klikk for å legge til ovenfor',
  'tools.marker.textColor': 'Tekstfarge',
  'tools.paragraph.placeholder':
    'Skriv noe, eller trykk på / for å velge et verktøy',
  'tools.toggle.placeholder': 'Sammenleggbar liste',
  'tools.toggle.bodyPlaceholder':
    'Tom sammenleggbar blokk. Klikk for å legge til en blokk, eller dra blokker hit.',
  'tools.table.clearSelection': 'Fjern innhold',
  'tools.table.comfortableText': 'Luftig tekst',
  'tools.table.placement': 'Justering',
  'a11y.dragHandle':
    'Dra for å flytte blokken, eller klikk for å åpne menyen',
  'a11y.atTop': 'Kan ikke flyttes opp. Øverste posisjon er allerede nådd.',
  'a11y.atBottom': 'Kan ikke flyttes ned. Nederste posisjon er allerede nådd.',
  'a11y.searchResults': 'Søkeresultater: {count}',
  'a11y.allBlocksSelected': 'Alle blokker er valgt. Totalt: {count}',
  'a11y.navigationModeExited': 'Navigasjonsmodus avsluttet',
  'a11y.navigatedToBlock': 'Navigert til blokken',
  'a11y.dropCreateColumnLeft':
    'En kolonne opprettes til venstre når du slipper',
  'a11y.dropCreateColumnRight':
    'En kolonne opprettes til høyre når du slipper',
  'searchTerms.header': 'rubrikk',
  'searchTerms.unordered': 'uordnet',
  'searchTerms.ordered': 'ordnet',
  'tools.callout.addEmoji': 'Legg til ikon',
  'tools.callout.filterEmojis': 'Søk etter emojier…',
  'tools.callout.pickRandom': 'Velg en tilfeldig emoji',
  'tools.callout.skinTone': 'Hudtone',
  'toolNames.equation': 'Ligning',
  'tools.equation.placeholder': 'Skriv inn en LaTeX-formel…',
  'tools.code.searchLanguage': 'Søk etter språk…',
  'tools.link.linkTitle': 'Lenketekst',
  'tools.image.exitFullscreen': 'Avslutt fullskjerm',
  'tools.image.converting': 'Konverterer…',
  'tools.image.altDescription':
    'Beskriv dette bildet for personer som ikke kan se det.',
  'tools.image.errorFileTooLarge':
    'Bildet er for stort. {size} overskrider grensen på {max}.',
  'tools.image.errorDefaultMessage':
    'Bildet kunne ikke lastes inn fra denne URL-en. Prøv en annen kilde eller last opp filen på nytt.',
  'tools.file.errorFileTooLarge':
    'Filen er for stor. {size} overskrider grensen på {max}.',
  'tools.file.previewRender': 'Forhåndsvisning',
  'tools.video.alignmentLeft': 'Venstrejuster',
  'tools.video.alignmentCenter': 'Midtstill',
  'tools.video.alignmentRight': 'Høyrejuster',
  'tools.video.hideControls': 'Skjul avspillingskontroller',
  'tools.video.errorFileTooLarge':
    'Videoen er for stor. {size} overskrider grensen på {max}.',
  'tools.video.emptyAddVideo': 'Legg til en video',
  'tools.video.emptyOrDropHere': 'eller slipp en video her',
  'tools.audio.alignmentLeft': 'Venstrejuster',
  'tools.audio.alignmentCenter': 'Midtstill',
  'tools.audio.alignmentRight': 'Høyrejuster',
  'tools.audio.errorFileTooLarge':
    'Lydfilen er for stor. {size} overskrider grensen på {max}.',
  'tools.audio.errorGoogleDrive':
    'Lyd fra Google Drive kan ikke spilles av direkte. Last ned filen og last den opp her i stedet.',
  'tools.audio.errorOneDrive':
    'Lyd fra OneDrive kan ikke spilles av direkte. Last ned filen og last den opp her i stedet.',
  'tools.audio.titlePlaceholder': 'Tittel',
  'tools.audio.emptyAddAudio': 'Legg til lyd',
  'tools.audio.emptyOrDropHere': 'eller slipp en lydfil her',
  'tools.audio.coverChange': 'Endre omslagsbilde',
  'tools.audio.coverSet': 'Angi omslagsbilde',
  'tools.audio.coverRemove': 'Fjern omslagsbilde',
  'tools.audio.coverErrorType': 'Velg en bildefil',
  'tools.audio.coverErrorTooLarge': 'Bildet er for stort',
  'tools.audio.coverAdd': 'Legg til et omslagsbilde',
  'tools.audio.coverSourceAria': 'Kilde til omslagsbilde',
  'tools.database.viewTypeBoardDescription': 'Vis elementer i kolonner',
  'tools.database.viewTypeListDescription': 'Vis elementer i en enkel liste',
  'tools.bookmark.loading': 'Laster inn forhåndsvisning av lenke…',
  'tools.embed.empty': 'Ingen innebygd lenke',
  'tools.video.seek': 'Avspillingsposisjon',
  'tools.video.toggleTimeDisplay': 'Veksle mellom avspilt og gjenstående tid',
  'tools.video.speedDecrease': 'Senk avspillingshastigheten',
  'tools.video.speedIncrease': 'Øk avspillingshastigheten',
  'tools.video.speedPresets': 'Forhåndsinnstilte hastigheter',
  'tools.video.pip': 'Bilde i bilde',
  'tools.video.ctxCopyUrlAtTime':
    'Kopier video-URL ved gjeldende avspillingsposisjon',
  'tools.video.ctxStats': 'Avspillingsstatistikk',
  'tools.audio.speedDecrease': 'Senk avspillingshastigheten',
  'tools.audio.speedIncrease': 'Øk avspillingshastigheten',
  'tools.callout.emojiSearchResults': 'Emojitreff: {count}',
  'toolNames.clearFormat': 'Fjern formatering',
  'tools.colorPicker.defaultSwatchLabel': '{default} {mode}',
  'tools.colorPicker.colorSwatchLabel': '{color} {mode}',
  'tools.file.previewRaw': 'Kilde',
  'tools.linkPaste.mention': 'Omtal',
  'tools.callout.emojiCategoryActivity': 'Aktiviteter',
  'tools.image.previewControls': 'Kontroller for forhåndsvisning av bilde',
  'toolNames.inlineCode': 'Innebygd kode',
  'searchTerms.number': 'nummerering',
  'tools.image.navigationControls': 'Navigering mellom bilder',
  'tools.image.errorSourceOffline':
    'Kildefilen kan ha blitt flyttet eller være utilgjengelig.',
};

const PUNJABI_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'ਫਾਰਮੈਟਿੰਗ ਸਾਫ਼ ਕਰੋ',
  'tools.toggle.bodyPlaceholder':
    'ਖਾਲੀ ਟੌਗਲ। ਬਲਾਕ ਜੋੜਨ ਲਈ ਕਲਿੱਕ ਕਰੋ ਜਾਂ ਬਲਾਕਾਂ ਨੂੰ ਇੱਥੇ ਖਿੱਚੋ।',
  'blockSettings.clickAction': 'ਮੀਨੂ ਖੋਲ੍ਹਣ ਲਈ ਕਲਿੱਕ ਕਰੋ',
  'blockSettings.orConjunction': ' ਜਾਂ ',
  'blockSettings.openMenuAction': ' ਦਬਾਓ',
  'blockSettings.convertWithChildrenWarning':
    'ਅੰਦਰਲੇ ਬਲਾਕ: {count}। ਇਸ ਬਲਾਕ ਨੂੰ ਬਦਲਣ ਨਾਲ ਅੰਦਰਲੀ ਸਮੱਗਰੀ ਸਿਖਰਲੇ ਪੱਧਰ \'ਤੇ ਚਲੀ ਜਾਵੇਗੀ। ਜਾਰੀ ਰੱਖਣਾ ਹੈ?',
  'toolNames.bold': 'ਗੂੜ੍ਹਾ',
  'toolNames.numberedList': 'ਗਿਣਤੀ ਵਾਲੀ ਸੂਚੀ',
  'tools.marker.textColor': 'ਲਿਖਤ ਦਾ ਰੰਗ',
  'tools.colorPicker.defaultSwatchLabel': '{default} {mode}',
  'tools.colorPicker.colorSwatchLabel': '{color} {mode}',
  'tools.paragraph.placeholder':
    'ਕੁਝ ਲਿਖੋ ਜਾਂ ਟੂਲ ਚੁਣਨ ਲਈ / ਦਬਾਓ',
  'tools.table.clearSelection': 'ਸਮੱਗਰੀ ਹਟਾਓ',
  'tools.table.copySelection': 'ਕਾਪੀ ਕਰੋ',
  'tools.table.placement': 'ਇਕਸਾਰਤਾ',
  'a11y.dropCancelled': 'ਖਿੱਚਣਾ ਰੱਦ ਕੀਤਾ ਗਿਆ',
  'a11y.searchResults': 'ਖੋਜ ਨਤੀਜੇ: {count}',
  'a11y.allBlocksSelected': 'ਸਾਰੇ ਬਲਾਕ ਚੁਣੇ ਗਏ। ਕੁੱਲ: {count}।',
  'a11y.navigationModeEntered':
    'ਨੈਵੀਗੇਸ਼ਨ ਮੋਡ। ਬਲਾਕਾਂ ਵਿਚਕਾਰ ਜਾਣ ਲਈ ਤੀਰ ਕੁੰਜੀਆਂ ਵਰਤੋ, ਸੋਧਣ ਲਈ Enter ਅਤੇ ਬਾਹਰ ਨਿਕਲਣ ਲਈ Escape ਦਬਾਓ।',
  'toolNames.underline': 'ਰੇਖਾਂਕਿਤ',
  'toolNames.strikethrough': 'ਵਿੰਨ੍ਹੋ',
  'toolNames.database': 'ਡਾਟਾਬੇਸ',
  'tools.callout.addEmoji': 'ਆਈਕਨ ਜੋੜੋ',
  'tools.callout.filterEmojis': 'ਇਮੋਜੀ ਖੋਜੋ…',
  'tools.callout.pickRandom': 'ਬੇਤਰਤੀਬ ਇਮੋਜੀ ਚੁਣੋ',
  'tools.quote.size': 'ਹਵਾਲੇ ਦਾ ਆਕਾਰ',
  'tools.code.wrapLines': 'ਲਾਈਨਾਂ ਸਮੇਟੋ',
  'tools.code.searchLanguage': 'ਭਾਸ਼ਾਵਾਂ ਖੋਜੋ…',
  'tools.link.linkTitle': 'ਲਿੰਕ ਦੀ ਲਿਖਤ',
  'tools.image.toggleCaption': 'ਕੈਪਸ਼ਨ ਦਿਖਾਓ ਜਾਂ ਲੁਕਾਓ',
  'tools.image.exitFullscreen': 'ਪੂਰੀ ਸਕ੍ਰੀਨ ਤੋਂ ਬਾਹਰ ਆਓ',
  'tools.image.downloadOriginal': 'ਮੂਲ ਤਸਵੀਰ ਡਾਊਨਲੋਡ ਕਰੋ',
  'tools.image.uploadProgress': 'ਅੱਪਲੋਡ ਦੀ ਪ੍ਰਗਤੀ',
  'tools.image.altDescription':
    'ਜਿਹੜੇ ਲੋਕ ਇਸ ਤਸਵੀਰ ਨੂੰ ਨਹੀਂ ਦੇਖ ਸਕਦੇ, ਉਨ੍ਹਾਂ ਲਈ ਇਸ ਦਾ ਵਰਣਨ ਕਰੋ।',
  'tools.image.preview': 'ਤਸਵੀਰ ਦੀ ਝਲਕ',
  'tools.image.previewControls': 'ਤਸਵੀਰ ਦੀ ਝਲਕ ਦੇ ਕੰਟਰੋਲ',
  'tools.image.resetZoom': 'ਜ਼ੂਮ ਮੁੜ-ਸੈੱਟ ਕਰੋ',
  'tools.image.errorFileTooLarge':
    'ਤਸਵੀਰ ਬਹੁਤ ਵੱਡੀ ਹੈ। ਆਕਾਰ: {size}; ਸੀਮਾ: {max}।',
  'tools.image.errorRetry': 'ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ',
  'tools.image.errorDefaultMessage':
    'ਇਸ URL ਤੋਂ ਤਸਵੀਰ ਲੋਡ ਨਹੀਂ ਹੋ ਸਕੀ। ਕੋਈ ਵੱਖਰਾ ਸਰੋਤ ਅਜ਼ਮਾਓ ਜਾਂ ਫ਼ਾਈਲ ਦੁਬਾਰਾ ਅੱਪਲੋਡ ਕਰੋ।',
  'tools.image.emptyChooseFile': 'ਫ਼ਾਈਲ ਚੁਣੋ',
  'tools.image.cropAspectRatio': 'ਕਰੌਪ ਦਾ ਆਕਾਰ',
  'tools.image.cropReset': 'ਮੁੜ-ਸੈੱਟ ਕਰੋ',
  'tools.file.emptyDropHint': 'ਜਾਂ ਫ਼ਾਈਲ ਇੱਥੇ ਛੱਡੋ',
  'tools.file.uploadProgress': 'ਅੱਪਲੋਡ ਦੀ ਪ੍ਰਗਤੀ',
  'tools.file.toggleCaption': 'ਕੈਪਸ਼ਨ ਦਿਖਾਓ ਜਾਂ ਲੁਕਾਓ',
  'tools.file.errorFileTooLarge':
    'ਫ਼ਾਈਲ ਬਹੁਤ ਵੱਡੀ ਹੈ। ਆਕਾਰ: {size}; ਸੀਮਾ: {max}।',
  'tools.file.previewRaw': 'ਸਰੋਤ',
  'tools.video.alignmentLeft': 'ਖੱਬੇ ਇਕਸਾਰ ਕਰੋ',
  'tools.video.alignmentCenter': 'ਕੇਂਦਰ ਵਿੱਚ ਇਕਸਾਰ ਕਰੋ',
  'tools.video.alignmentRight': 'ਸੱਜੇ ਇਕਸਾਰ ਕਰੋ',
  'tools.video.toggleCaption': 'ਕੈਪਸ਼ਨ ਦਿਖਾਓ ਜਾਂ ਲੁਕਾਓ',
  'tools.video.errorFileTooLarge':
    'ਵੀਡੀਓ ਬਹੁਤ ਵੱਡਾ ਹੈ। ਆਕਾਰ: {size}; ਸੀਮਾ: {max}।',
  'tools.video.emptyChooseFile': 'ਫ਼ਾਈਲ ਚੁਣੋ',
  'tools.audio.alignmentLeft': 'ਖੱਬੇ ਇਕਸਾਰ ਕਰੋ',
  'tools.audio.alignmentCenter': 'ਕੇਂਦਰ ਵਿੱਚ ਇਕਸਾਰ ਕਰੋ',
  'tools.audio.alignmentRight': 'ਸੱਜੇ ਇਕਸਾਰ ਕਰੋ',
  'tools.audio.errorFileTooLarge':
    'ਆਡੀਓ ਬਹੁਤ ਵੱਡਾ ਹੈ। ਆਕਾਰ: {size}; ਸੀਮਾ: {max}।',
  'tools.audio.emptyChooseFile': 'ਫ਼ਾਈਲ ਚੁਣੋ',
  'tools.audio.emptyOrDropHere': 'ਜਾਂ ਇੱਥੇ ਆਡੀਓ ਫ਼ਾਈਲ ਛੱਡੋ',
  'tools.audio.coverChooseFile': 'ਫ਼ਾਈਲ ਚੁਣੋ',
  'tools.audio.coverSourceAria': 'ਕਵਰ ਦਾ ਸਰੋਤ',
  'tools.database.duplicateView': 'ਨਕਲ ਬਣਾਓ',
  'tools.database.viewTypeListDescription':
    'ਆਈਟਮਾਂ ਨੂੰ ਸਧਾਰਨ ਸੂਚੀ ਵਿੱਚ ਦਿਖਾਓ',
  'tools.database.propertyTypeHeading': 'ਵਿਸ਼ੇਸ਼ਤਾ ਦੀ ਕਿਸਮ',
  'tools.database.propertyTypeSelect': 'ਚੋਣ',
  'tools.bookmark.loading': 'ਲਿੰਕ ਦੀ ਝਲਕ ਲੋਡ ਹੋ ਰਹੀ ਹੈ…',
  'tools.bookmark.error': 'ਲਿੰਕ ਦੀ ਝਲਕ ਲੋਡ ਨਹੀਂ ਹੋ ਸਕੀ',
  'tools.embed.empty': 'ਕੋਈ ਇੰਬੈੱਡ ਲਿੰਕ ਨਹੀਂ',
  'tools.linkPaste.mention': 'ਜ਼ਿਕਰ ਕਰੋ',
  'tools.video.seek': 'ਪਲੇਬੈਕ ਦੀ ਸਥਿਤੀ',
  'tools.video.toggleTimeDisplay':
    'ਬੀਤੇ ਅਤੇ ਬਾਕੀ ਸਮੇਂ ਵਿਚਕਾਰ ਬਦਲੋ',
  'tools.video.fullscreenExit': 'ਪੂਰੀ ਸਕ੍ਰੀਨ ਤੋਂ ਬਾਹਰ ਆਓ',
  'tools.video.theaterExit': 'ਥੀਏਟਰ ਮੋਡ ਤੋਂ ਬਾਹਰ ਆਓ',
  'tools.video.ctxCopyUrlAtTime':
    'ਮੌਜੂਦਾ ਪਲੇਬੈਕ ਸਮੇਂ ਦਾ ਵੀਡੀਓ URL ਕਾਪੀ ਕਰੋ',
  'tools.video.ctxStats': 'ਪਲੇਬੈਕ ਦੇ ਅੰਕੜੇ',
  'tools.callout.emojiSearchResults': 'ਮਿਲਦੇ ਇਮੋਜੀ: {count}',
  'tools.database.checkboxChecked': 'ਨਿਸ਼ਾਨਬੱਧ ਕੀਤਾ ਗਿਆ',
  'tools.database.checkboxUnchecked': 'ਨਿਸ਼ਾਨਬੱਧ ਨਹੀਂ ਕੀਤਾ ਗਿਆ',
};

const POLISH_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'Wyczyść formatowanie',
  'blockSettings.convertWithChildrenWarning': 'Liczba zagnieżdżonych bloków: {count}. Przekształcenie tego bloku przeniesie zagnieżdżoną zawartość na poziom główny. Kontynuować?',
  'toolbox.optionAddAbove': 'Kliknij z naciśniętym klawiszem ⌥, aby dodać powyżej',
  'toolbox.ctrlAddAbove': 'Kliknij z naciśniętym klawiszem Ctrl, aby dodać powyżej',
  'tools.marker.textColor': 'Kolor tekstu',
  'tools.marker.default': 'Domyślnie',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.paragraph.placeholder': 'Napisz coś lub naciśnij /, aby wybrać narzędzie',
  'tools.toggle.bodyPlaceholder': 'Pusty blok zwijany. Kliknij, aby dodać blok, lub przeciągnij tutaj bloki.',
  'tools.table.clearSelection': 'Wyczyść zawartość',
  'tools.table.headerColumn': 'Kolumna nagłówkowa',
  'tools.table.headerRow': 'Wiersz nagłówkowy',
  'tools.table.comfortableText': 'Tekst standardowy',
  'tools.table.placement': 'Wyrównanie',
  'tools.table.placementTopLeft': 'Lewy górny róg',
  'tools.table.placementTopCenter': 'Środek u góry',
  'tools.table.placementTopRight': 'Prawy górny róg',
  'tools.table.placementMiddleLeft': 'Środek po lewej',
  'tools.table.placementMiddleRight': 'Środek po prawej',
  'tools.table.placementBottomLeft': 'Lewy dolny róg',
  'tools.table.placementBottomCenter': 'Środek u dołu',
  'tools.table.placementBottomRight': 'Prawy dolny róg',
  'a11y.dragHandle': 'Przeciągnij, aby przenieść blok, lub kliknij, aby otworzyć menu',
  'a11y.dragHandleRole': 'uchwyt do przeciągania',
  'a11y.dragStartedMultiple': 'Liczba przeciąganych bloków: {count}',
  'a11y.blocksMoved': 'Przeniesione bloki: {count}. Pozycja: {position}',
  'a11y.blocksDuplicated': 'Powielone bloki: {count}. Pozycja początkowa: {position}',
  'a11y.atTop': 'Nie można przenieść wyżej. Osiągnięto już najwyższą pozycję.',
  'a11y.atBottom': 'Nie można przenieść niżej. Osiągnięto już najniższą pozycję.',
  'a11y.searchResults': 'Wyniki wyszukiwania: {count}',
  'a11y.allBlocksSelected': 'Zaznaczono wszystkie bloki. Łącznie: {count}',
  'a11y.navigationModeEntered': 'Tryb nawigacji. Użyj klawiszy strzałek, aby przechodzić między blokami. Naciśnij Enter, aby edytować. Naciśnij Esc, aby wyjść.',
  'a11y.navigationModeExited': 'Tryb nawigacji wyłączony',
  'a11y.dropCreateColumnLeft': 'Po upuszczeniu zostanie utworzona kolumna po lewej stronie',
  'a11y.dropCreateColumnRight': 'Po upuszczeniu zostanie utworzona kolumna po prawej stronie',
  'tools.columns.turnInto': 'Przekształć w kolumny',
  'searchTerms.blockquote': 'cytat blokowy',
  'searchTerms.citation': 'cytowanie',
  'tools.callout.addEmoji': 'Dodaj ikonę',
  'tools.callout.filterEmojis': 'Szukaj emoji…',
  'tools.callout.pickRandom': 'Wybierz losowe emoji',
  'tools.callout.skinTone': 'Odcień skóry',
  'tools.callout.emojiCategoryObjects': 'Przedmioty',
  'toolNames.inlineCode': 'Kod w tekście',
  'toolNames.equation': 'Równanie',
  'tools.equation.placeholder': 'Wpisz formułę LaTeX…',
  'tools.code.searchLanguage': 'Szukaj języków…',
  'blockSettings.copyLinkSuccess': 'Link skopiowano do schowka',
  'blockSettings.copyLinkError': 'Nie udało się skopiować linku do bloku',
  'tools.link.linkTitle': 'Tekst linku',
  'tools.image.toggleCaption': 'Pokaż lub ukryj podpis',
  'tools.image.viewFullscreen': 'Wyświetl na pełnym ekranie',
  'tools.image.exitFullscreen': 'Wyjdź z trybu pełnoekranowego',
  'tools.image.moreOptions': 'Więcej opcji',
  'tools.image.converting': 'Konwertowanie…',
  'tools.image.altDescription': 'Opisz ten obraz osobom, które go nie widzą.',
  'tools.image.previewControls': 'Elementy sterujące podglądem obrazu',
  'tools.image.errorFileTooLarge': 'Obraz jest za duży. Rozmiar {size} przekracza limit {max}.',
  'tools.image.errorDefaultMessage': 'Nie udało się wczytać obrazu z tego adresu URL. Spróbuj użyć innego źródła lub ponownie prześlij plik.',
  'tools.image.emptyUrlPlaceholder': 'Wklej adres URL obrazu…',
  'tools.file.toggleCaption': 'Pokaż lub ukryj podpis',
  'tools.file.errorFileTooLarge': 'Plik jest za duży. Rozmiar {size} przekracza limit {max}.',
  'tools.file.previewRaw': 'Źródło',
  'tools.video.alignmentLeft': 'Wyrównaj do lewej',
  'tools.video.alignmentCenter': 'Wyśrodkuj',
  'tools.video.alignmentRight': 'Wyrównaj do prawej',
  'tools.video.toggleCaption': 'Pokaż lub ukryj podpis',
  'tools.video.moreOptions': 'Więcej opcji',
  'tools.video.errorFileTooLarge': 'Wideo jest za duże. Rozmiar {size} przekracza limit {max}.',
  'tools.audio.alignmentLeft': 'Wyrównaj do lewej',
  'tools.audio.alignmentCenter': 'Wyśrodkuj',
  'tools.audio.alignmentRight': 'Wyrównaj do prawej',
  'tools.audio.errorFileTooLarge': 'Plik audio jest za duży. Rozmiar {size} przekracza limit {max}.',
  'tools.audio.titlePlaceholder': 'Tytuł utworu',
  'tools.audio.artistPlaceholder': 'Wykonawca',
  'tools.audio.emptyOrDropHere': 'lub upuść tutaj plik audio',
  'tools.audio.emptyUrlPlaceholder': 'Wklej adres URL pliku audio…',
  'tools.audio.emptyUrlAria': 'Adres URL pliku audio',
  'tools.audio.emptySourceAria': 'Źródło pliku audio',
  'tools.audio.coverChange': 'Zmień okładkę',
  'tools.audio.coverSet': 'Ustaw obraz okładki',
  'tools.audio.coverRemove': 'Usuń okładkę',
  'tools.audio.coverErrorType': 'Wybierz plik obrazu',
  'tools.audio.coverErrorTooLarge': 'Obraz jest za duży',
  'tools.audio.coverAdd': 'Dodaj okładkę',
  'tools.audio.coverUrlPlaceholder': 'Wklej adres URL obrazu…',
  'tools.audio.coverUrlAria': 'Adres URL obrazu',
  'tools.audio.coverSourceAria': 'Źródło okładki',
  'tools.database.viewTypeListDescription': 'Pokaż elementy na prostej liście',
  'tools.database.listView': 'Widok listy',
  'tools.database.cardDetails': 'Szczegóły karty',
  'tools.bookmark.loading': 'Ładowanie podglądu linku…',
  'tools.embed.empty': 'Brak linku do osadzenia',
  'tools.linkPaste.embed': 'Osadź zawartość',
  'tools.linkPaste.embedVideo': 'Osadź wideo z serwisu {provider}',
  'tools.linkPaste.embedAudio': 'Osadź plik audio z serwisu {provider}',
  'tools.linkPaste.embedImage': 'Osadź obraz z serwisu {provider}',
  'tools.linkPaste.embedSocial': 'Osadź wpis z serwisu {provider}',
  'tools.linkPaste.embedDocument': 'Osadź dokument z serwisu {provider}',
  'tools.linkPaste.embedTable': 'Osadź tabelę z serwisu {provider}',
  'tools.linkPaste.embedForm': 'Osadź formularz z serwisu {provider}',
  'tools.linkPaste.embedCode': 'Osadź kod z serwisu {provider}',
  'tools.linkPaste.embedDesign': 'Osadź projekt z serwisu {provider}',
  'tools.linkPaste.embedChart': 'Osadź wykres z serwisu {provider}',
  'tools.linkPaste.embedMap': 'Osadź mapę z serwisu {provider}',
  'tools.linkPaste.embedCalendar': 'Osadź kalendarz z serwisu {provider}',
  'tools.linkPaste.mention': 'Dodaj wzmiankę',
  'notifier.dismiss': 'Zamknij',
  'tools.video.seek': 'Pozycja odtwarzania',
  'tools.video.toggleTimeDisplay': 'Przełącz między czasem, który upłynął, a pozostałym czasem',
  'tools.video.fullscreenExit': 'Wyjdź z trybu pełnoekranowego',
  'tools.video.speedPresets': 'Wstępnie ustawione prędkości',
  'tools.video.theaterExit': 'Wyjdź z trybu kinowego',
  'tools.video.ctxStats': 'Statystyki odtwarzania',
  'searchTerms.divider': 'linia pozioma',
  'tools.callout.emojiCategoryTravel': 'Podróże i miejsca',
  'tools.image.errorUploadFailedTitle': 'Wysyłanie nie powiodło się',
  'tools.video.loop': 'Odtwarzanie w pętli',
  'tools.audio.loop': 'Odtwarzanie w pętli',
  'tools.audio.errorGoogleDrive': 'Dźwięku z Dysku Google nie można odtworzyć bezpośrednio. Pobierz plik i zamiast tego prześlij go tutaj.',
  'tools.audio.errorOneDrive': 'Dźwięku z usługi OneDrive nie można odtworzyć bezpośrednio. Pobierz plik i zamiast tego prześlij go tutaj.',
  'a11y.dropPosition': 'Pozycja docelowa: {position} z {total}',
  'tools.callout.emojiCategoryPeople': 'Buźki i osoby',
  'tools.callout.emojiCategoryNature': 'Zwierzęta i natura',
  'tools.callout.emojiCategoryFood': 'Jedzenie i napoje',
  'tools.image.cropRatioFree': 'Dowolny',
  'searchTerms.number': 'numerowanie',
  'blockSettings.openMenuAction': ', aby otworzyć menu',
};

const PASHTO_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'blockSettings.dragToMove': 'د لېږدولو لپاره کش کړئ',
  'blockSettings.clickAction': 'د مینو خلاصولو لپاره کلیک وکړئ',
  'blockSettings.orConjunction': ' یا ',
  'blockSettings.openMenuAction': ' کېکاږئ',
  'blockSettings.convertWithChildrenWarning': 'دننه بلاکونه: {count}. د دې بلاک بدلول به دننه منځپانګه تر ټولو لوړې کچې ته یوسي. دوام ورکړئ؟',
  'toolbox.optionAddAbove': 'پورته د زیاتولو لپاره Option-کلیک وکړئ',
  'toolbox.ctrlAddAbove': 'پورته د زیاتولو لپاره Ctrl-کلیک وکړئ',
  'popover.nothingFound': 'هېڅ شی ونه موندل شو',
  'popover.convertTo': 'دې ته یې واړوئ',
  'toolNames.bold': 'زغرد',
  'toolNames.italic': 'رېوند',
  'toolNames.bulletedList': 'ټکي لرونکی لیست',
  'toolNames.numberedList': 'شمېره لرونکی لیست',
  'tools.marker.textColor': 'د متن رنګ',
  'tools.marker.default': 'تلواله',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.stub.blockCannotBeDisplayed': 'دا بلاک نه شي ښودل کېدای',
  'tools.paragraph.placeholder': 'یو څه ولیکئ یا د وسیلې د غوره کولو لپاره / کېکاږئ',
  'tools.toggle.placeholder': 'راټولېدونکی',
  'tools.toggle.bodyPlaceholder': 'خالي راټولېدونکی. د یوه بلاک د اضافه کولو لپاره کلیک وکړئ یا بلاکونه دلته کش کړئ.',
  'tools.table.clearSelection': 'منځپانګه پاکه کړئ',
  'tools.table.copySelection': 'کاپي کړئ',
  'tools.table.splitCell': 'حجره ووېشئ',
  'tools.table.insertColumnLeft': 'کیڼ لوري ته کالم دننه کړئ',
  'tools.table.insertColumnRight': 'ښي لوري ته کالم دننه کړئ',
  'tools.table.duplicateColumn': 'کاپي جوړه کړئ',
  'tools.table.deleteColumn': 'ړنګ کړئ',
  'tools.table.insertRowAbove': 'پورته قطار دننه کړئ',
  'tools.table.insertRowBelow': 'لاندې قطار دننه کړئ',
  'tools.table.duplicateRow': 'کاپي جوړه کړئ',
  'tools.table.deleteRow': 'ړنګ کړئ',
  'tools.table.clickToAddRow': 'د نوي قطار د اضافه کولو لپاره کلیک وکړئ',
  'tools.table.clickToAddColumn': 'د نوي کالم د اضافه کولو لپاره کلیک وکړئ',
  'tools.table.placement': 'سمون',
  'blockSettings.delete': 'ړنګ کړئ',
  'blockSettings.duplicate': 'کاپي جوړه کړئ',
  'a11y.dragHandle': 'د بلاک لېږدولو لپاره یې کش کړئ یا د مینو لپاره کلیک وکړئ',
  'a11y.dragStarted': 'بلاک کشول کېږي',
  'a11y.dragStartedMultiple': '{count} بلاکونه کشول کېږي',
  'a11y.dropPosition': 'په {position} ځای کې به پرېښودل شي (ټول ځایونه: {total})',
  'a11y.blockMoved': 'بلاک {position} ځای ته ولېږدول شو (ټول ځایونه: {total})',
  'a11y.blocksMoved': '{count} بلاکونه {position} ځای ته ولېږدول شول',
  'a11y.blockDuplicated': 'بلاک په {position} ځای کې کاپي شو (ټول ځایونه: {total})',
  'a11y.blocksDuplicated': 'د {count} بلاکونو کاپيانې له {position} ځایه پیل شوې',
  'a11y.movedUp': 'پورته ولېږدول شو. ځای: له {total} څخه {position}.',
  'a11y.movedDown': 'لاندې ولېږدول شو. ځای: له {total} څخه {position}.',
  'a11y.searchResults': 'د لټون پایلې: {count}',
  'a11y.allBlocksSelected': 'ټول بلاکونه غوره شول. ټولټال: {count}.',
  'a11y.navigationModeEntered': 'د نیویګیشن حالت. د بلاکونو ترمنځ د حرکت لپاره د غشو تڼۍ وکاروئ، د سمون لپاره Enter او د وتلو لپاره Escape کېکاږئ.',
  'a11y.navigationModeExited': 'د نیویګیشن له حالته ووتئ',
  'a11y.navigationPosition': '{tool}، له {total} څخه {position}',
  'a11y.navigatedToBlock': 'بلاک ته ورسېدئ',
  'toolNames.underline': 'کرښن',
  'toolNames.strikethrough': 'کرښول',
  'toolNames.clearFormat': 'بڼه پاکه کړئ',
  'searchTerms.collapsible': 'راټولېدونکی',
  'searchTerms.number': 'شمېره',
  'tools.callout.addEmoji': 'آیکون اضافه کړئ',
  'tools.callout.editIcon': 'آیکون سم کړئ',
  'tools.callout.removeEmoji': 'آیکون لرې کړئ',
  'tools.callout.filterEmojis': 'ایموجي ولټوئ…',
  'tools.callout.noEmojisFound': 'هېڅ ایموجي ونه موندل شو',
  'tools.callout.pickRandom': 'یو تصادفي ایموجي وټاکئ',
  'tools.database.newPage': 'نوې پاڼه',
  'tools.database.editCardTitle': 'سرلیک سم کړئ',
  'tools.callout.colorDefault': 'تلواله',
  'tools.quote.size': 'د اقتباس اندازه',
  'tools.quote.defaultSize': 'تلواله',
  'tools.code.searchLanguage': 'ژبې ولټوئ…',
  'tools.code.lineNumbers': 'د کرښو شمېرې',
  'blockSettings.blocksSelected': 'بلاکونه: {count}',
  'blockSettings.copyLinkSuccess': 'لینک کلیپبورډ ته کاپي شو',
  'blockSettings.copyLinkError': 'د بلاک لینک کاپي نه شو',
  'tools.link.emailAddress': 'د برېښنالیک پته',
  'tools.link.edit': 'سم یې کړئ',
  'tools.link.linkTitle': 'د لینک متن',
  'tools.image.alignment': 'سمون',
  'tools.image.alignmentRight': 'ښی',
  'tools.image.alignmentLeftAria': 'کیڼ لوري ته برابر کړئ',
  'tools.image.alignmentCenterAria': 'منځ ته برابر کړئ',
  'tools.image.alignmentRightAria': 'ښي لوري ته برابر کړئ',
  'tools.image.crop': 'پرې کړئ',
  'tools.image.viewFullscreen': 'په بشپړه پرده کې وګورئ',
  'tools.image.exitFullscreen': 'له بشپړې پردې ووځئ',
  'tools.image.downloadOriginal': 'اصلي انځور ډاونلوډ کړئ',
  'tools.image.download': 'ډاونلوډ کړئ',
  'tools.image.copyUrl': 'URL کاپي کړئ',
  'tools.image.uploading': 'اپلوډ کېږي…',
  'tools.image.uploadingLabel': 'اپلوډ کېږي',
  'tools.image.converting': 'بدلېږي…',
  'tools.image.cancelUpload': 'اپلوډ لغوه کړئ',
  'tools.image.altEdit': 'بدیل متن سم کړئ',
  'tools.image.altDescription': 'دا انځور د هغو خلکو لپاره بیان کړئ چې لیدلای یې نه شي.',
  'tools.image.altPlaceholder': 'بدیل متن',
  'tools.image.preview': 'د انځور مخکتنه',
  'tools.image.previewControls': 'د انځور د مخکتنې کنټرولونه',
  'tools.image.zoomIn': 'زوم زیات کړئ',
  'tools.image.zoomOut': 'زوم کم کړئ',
  'tools.image.resetZoom': 'زوم بیا تنظیم کړئ',
  'tools.image.errorImageFailedToLoad': 'انځور بار نه شو',
  'tools.image.errorDefaultTitle': 'انځور بار نه شو',
  'tools.image.errorDefaultMessage': 'انځور له دې URL څخه بار نه شو. بله سرچینه وازمویئ یا فایل بیا اپلوډ کړئ.',
  'tools.image.errorRetry': 'بیا هڅه وکړئ',
  'tools.image.errorReplace': 'بدل یې کړئ',
  'tools.image.emptyUpload': 'اپلوډ کړئ',
  'tools.image.emptyInsert': 'دننه کړئ',
  'tools.image.emptyUrlAria': 'د انځور URL',
  'tools.image.cropReset': 'بیا تنظیم کړئ',
  'tools.image.cropCancel': 'لغوه کړئ',
  'tools.file.emptyUpload': 'اپلوډ کړئ',
  'tools.file.emptyDropHint': 'یا فایل دلته پرېږدئ',
  'tools.file.emptyInsert': 'دننه کړئ',
  'tools.file.uploading': 'اپلوډ کېږي…',
  'tools.file.cancelUpload': 'اپلوډ لغوه کړئ',
  'tools.file.download': 'ډاونلوډ کړئ',
  'tools.file.copyUrl': 'URL کاپي کړئ',
  'tools.file.errorUploadFailed': 'اپلوډ ناکام شو',
  'tools.file.errorReplace': 'بدل یې کړئ',
  'tools.file.previewRaw': 'سرچینه',
  'tools.file.previewLoading': 'مخکتنه بارېږي…',
  'tools.file.previewError': 'مخکتنه بار نه شوه',
  'tools.file.previewDownload': 'ډاونلوډ کړئ',
  'tools.video.alignment': 'سمون',
  'tools.video.alignmentLeft': 'کیڼ لوري ته برابر کړئ',
  'tools.video.alignmentCenter': 'منځ ته برابر کړئ',
  'tools.video.alignmentRight': 'ښي لوري ته برابر کړئ',
  'tools.video.autoplay': 'په خپله غږول',
  'tools.video.download': 'ډاونلوډ کړئ',
  'tools.video.copyUrl': 'URL کاپي کړئ',
  'tools.video.uploading': 'اپلوډ کېږي…',
  'tools.video.errorUploadFailed': 'اپلوډ ناکام شو',
  'tools.video.errorReplace': 'بدل یې کړئ',
  'tools.video.emptyUpload': 'اپلوډ کړئ',
  'tools.video.emptyInsert': 'دننه کړئ',
  'tools.video.emptyUrlAria': 'د ویډیو URL',
  'tools.audio.alignment': 'سمون',
  'tools.audio.alignmentLeft': 'کیڼ لوري ته برابر کړئ',
  'tools.audio.alignmentCenter': 'منځ ته برابر کړئ',
  'tools.audio.alignmentRight': 'ښي لوري ته برابر کړئ',
  'tools.audio.download': 'ډاونلوډ کړئ',
  'tools.audio.copyUrl': 'URL کاپي کړئ',
  'tools.audio.uploading': 'اپلوډ کېږي…',
  'tools.audio.errorUploadFailed': 'اپلوډ ناکام شو',
  'tools.audio.errorFileTooLarge': 'غږیز فایل ډېر لوی دی. {size} د {max} له حده اوړي.',
  'tools.audio.errorReplace': 'بدل یې کړئ',
  'tools.audio.titlePlaceholder': 'د ټرېک سرلیک',
  'tools.audio.emptyUpload': 'اپلوډ کړئ',
  'tools.audio.emptyInsert': 'دننه کړئ',
  'tools.audio.emptyOrDropHere': 'یا دلته یو غږیز فایل پرېږدئ',
  'tools.audio.emptyUrlAria': 'د غږ URL',
  'tools.audio.coverUpload': 'اپلوډ کړئ',
  'tools.audio.coverInsert': 'دننه کړئ',
  'tools.audio.coverUrlAria': 'د انځور URL',
  'tools.audio.coverSourceAria': 'د پوښ سرچینه',
  'tools.database.renameView': 'نوم بدل کړئ',
  'tools.database.duplicateView': 'کاپي جوړه کړئ',
  'tools.database.deleteView': 'ړنګ کړئ',
  'tools.database.viewTypeListDescription': 'توکي په یوه ساده لیست کې وښایئ',
  'tools.database.propertyTypeNumber': 'شمېره',
  'tools.database.propertyTypeSelect': 'غوراوی',
  'tools.database.propertyTypeMultiSelect': 'څوګونی غوراوی',
  'tools.database.close': 'وتړئ',
  'tools.database.defaultStatusNotStarted': 'نه دی پیل شوی',
  'toolNames.bookmark': 'لیکنښه',
  'toolNames.embed': 'ځای پر ځای کول',
  'tools.bookmark.empty': 'د لیکنښې جوړولو لپاره یو لینک پیسټ کړئ',
  'tools.bookmark.loading': 'د لینک مخکتنه بارېږي…',
  'tools.bookmark.error': 'د لینک مخکتنه بار نه شوه',
  'tools.embed.empty': 'د ځای پر ځای کولو لینک نشته',
  'tools.embed.openOriginal': 'اصلي نسخه پرانیزئ',
  'tools.embed.replace': 'بدل یې کړئ',
  'tools.embed.urlPlaceholder': 'د ځای پر ځای کولو لپاره لینک پیسټ کړئ…',
  'tools.embed.invalidUrl': 'دا لینک نه شي ځای پر ځای کېدای',
  'tools.linkPaste.bookmark': 'لیکنښه جوړه کړئ',
  'tools.linkPaste.embed': 'ځای پر ځای یې کړئ',
  'tools.linkPaste.embedVideo': 'له {provider} څخه ویډیو ځای پر ځای کړئ',
  'tools.linkPaste.embedAudio': 'له {provider} څخه غږ ځای پر ځای کړئ',
  'tools.linkPaste.embedImage': 'له {provider} څخه انځور ځای پر ځای کړئ',
  'tools.linkPaste.embedSocial': 'له {provider} څخه پوسټ ځای پر ځای کړئ',
  'tools.linkPaste.embedDocument': 'له {provider} څخه سند ځای پر ځای کړئ',
  'tools.linkPaste.embedTable': 'له {provider} څخه جدول ځای پر ځای کړئ',
  'tools.linkPaste.embedForm': 'له {provider} څخه فورمه ځای پر ځای کړئ',
  'tools.linkPaste.embedCode': 'له {provider} څخه کوډ ځای پر ځای کړئ',
  'tools.linkPaste.embedDesign': 'له {provider} څخه ډیزاین ځای پر ځای کړئ',
  'tools.linkPaste.embedChart': 'له {provider} څخه چارټ ځای پر ځای کړئ',
  'tools.linkPaste.embedMap': 'له {provider} څخه نقشه ځای پر ځای کړئ',
  'tools.linkPaste.embedCalendar': 'له {provider} څخه جنتري ځای پر ځای کړئ',
  'tools.linkPaste.mention': 'یاد یې کړئ',
  'tools.video.seek': 'د پلې کولو ځای',
  'tools.video.seekValueText': 'له {total} څخه {current}',
  'tools.video.toggleTimeDisplay': 'د تېر شوي او پاتې وخت ترمنځ واړوئ',
  'tools.video.unmute': 'غږ بېرته فعال کړئ',
  'tools.video.volume': 'د غږ کچه',
  'tools.video.speedPresets': 'مخکې ټاکلي سرعتونه',
  'tools.video.off': 'غیر فعال',
  'tools.video.theaterExit': 'د تیاتر له حالته ووځئ',
  'tools.video.ctxCopyUrlAtTime': 'د ویډیو URL د پلې کولو له اوسني وخت سره کاپي کړئ',
  'tools.video.ctxStats': 'د پلې کولو احصایې',
  'tools.audio.unmute': 'غږ بېرته فعال کړئ',
  'tools.audio.volume': 'د غږ کچه',
  'tools.callout.emojiSearchResults': 'د ورته ایموجیو شمېر: {count}',
};

const PORTUGUESE_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'blockSettings.convertWithChildrenWarning': 'Blocos aninhados: {count}. Converter este bloco moverá o conteúdo aninhado para o nível superior. Deseja continuar?',
  'toolbox.optionAddAbove': '⌥ + clique para adicionar acima',
  'toolbox.ctrlAddAbove': 'Ctrl + clique para adicionar acima',
  'tools.marker.textColor': 'Cor do texto',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.paragraph.placeholder': 'Escreva algo ou pressione / para selecionar uma ferramenta',
  'tools.toggle.placeholder': 'Lista recolhível',
  'tools.toggle.bodyPlaceholder': 'Bloco recolhível vazio. Clique para adicionar um bloco ou arraste blocos para cá.',
  'tools.table.clearSelection': 'Limpar conteúdo',
  'tools.table.placement': 'Alinhamento',
  'tools.table.placementTopLeft': 'Canto superior esquerdo',
  'tools.table.placementTopCenter': 'Centro superior',
  'tools.table.placementTopRight': 'Canto superior direito',
  'tools.table.placementMiddleLeft': 'Centro esquerdo',
  'tools.table.placementMiddleRight': 'Centro direito',
  'tools.table.placementBottomLeft': 'Canto inferior esquerdo',
  'tools.table.placementBottomCenter': 'Centro inferior',
  'tools.table.placementBottomRight': 'Canto inferior direito',
  'a11y.dragHandle': 'Arraste para mover o bloco ou clique para abrir o menu',
  'a11y.dragHandleRole': 'alça de arrasto',
  'a11y.dropPosition': 'Posição de destino: {position} de {total}',
  'a11y.movedUp': 'Movimento para cima concluído: posição {position} de {total}.',
  'a11y.movedDown': 'Movimento para baixo concluído: posição {position} de {total}.',
  'a11y.atTop': 'Não é possível mover para cima. Já no topo.',
  'a11y.atBottom': 'Não é possível mover para baixo. Já no fim.',
  'a11y.searchResults': 'Resultados da pesquisa: {count}',
  'a11y.allBlocksSelected': 'Todos os blocos selecionados. Total: {count}',
  'a11y.navigationModeEntered': 'Modo de navegação. Use as teclas de seta para navegar entre os blocos. Pressione Enter para editar e Esc para sair.',
  'a11y.navigatedToBlock': 'Navegou até o bloco',
  'toolNames.clearFormat': 'Limpar formatação',
  'tools.callout.addEmoji': 'Adicionar ícone',
  'tools.callout.filterEmojis': 'Pesquisar emojis…',
  'tools.callout.pickRandom': 'Escolher um emoji aleatório',
  'tools.callout.emojiCategoryActivity': 'Atividades',
  'tools.callout.emojiCategoryTravel': 'Viagens e lugares',
  'toolNames.equation': 'Equação',
  'tools.equation.placeholder': 'Insira uma fórmula LaTeX…',
  'tools.code.searchLanguage': 'Pesquisar linguagens…',
  'tools.link.linkTitle': 'Texto do link',
  'tools.image.converting': 'Convertendo…',
  'tools.image.altDescription': 'Descreva esta imagem para quem não consegue vê-la.',
  'tools.image.previewControls': 'Controles da pré-visualização da imagem',
  'tools.image.errorFileTooLarge': 'A imagem é muito grande. {size} excede o limite de {max}.',
  'tools.image.errorDefaultMessage': 'Não foi possível carregar a imagem a partir desta URL. Tente outra origem ou envie o arquivo novamente.',
  'tools.file.errorFileTooLarge': 'O arquivo é muito grande. {size} excede o limite de {max}.',
  'tools.file.previewRaw': 'Código-fonte',
  'tools.file.previewRender': 'Pré-visualização',
  'tools.video.alignmentLeft': 'Alinhar à esquerda',
  'tools.video.alignmentCenter': 'Alinhar ao centro',
  'tools.video.alignmentRight': 'Alinhar à direita',
  'tools.video.errorFileTooLarge': 'O vídeo é muito grande. {size} excede o limite de {max}.',
  'tools.audio.alignmentLeft': 'Alinhar à esquerda',
  'tools.audio.alignmentCenter': 'Alinhar ao centro',
  'tools.audio.alignmentRight': 'Alinhar à direita',
  'tools.audio.errorFileTooLarge': 'O arquivo de áudio é muito grande. {size} excede o limite de {max}.',
  'tools.audio.titlePlaceholder': 'Título da faixa',
  'tools.audio.artistPlaceholder': 'Artista',
  'tools.audio.emptyOrDropHere': 'ou solte um arquivo de áudio aqui',
  'tools.audio.coverChange': 'Alterar capa',
  'tools.audio.coverSet': 'Definir imagem de capa',
  'tools.audio.coverRemove': 'Remover capa',
  'tools.audio.coverErrorType': 'Escolha um arquivo de imagem',
  'tools.audio.coverErrorTooLarge': 'A imagem é muito grande',
  'tools.audio.coverAdd': 'Adicionar uma capa',
  'tools.audio.coverSourceAria': 'Origem da capa',
  'tools.database.viewTypeBoardDescription': 'Mostrar itens em colunas',
  'tools.database.viewTypeListDescription': 'Mostrar itens em uma lista simples',
  'tools.database.propertyTypeSelect': 'Selecionar',
  'tools.database.defaultStatusProperty': 'Status',
  'tools.bookmark.loading': 'Carregando pré-visualização do link…',
  'tools.embed.empty': 'Nenhum link incorporado',
  'tools.linkPaste.embed': 'Criar integração',
  'tools.linkPaste.mention': 'Mencionar',
  'notifier.dismiss': 'Fechar',
  'tools.video.seek': 'Posição da reprodução',
  'tools.video.toggleTimeDisplay': 'Alternar entre o tempo decorrido e o tempo restante',
  'tools.video.theater': 'Modo teatro',
  'tools.video.theaterExit': 'Sair do modo teatro',
  'tools.video.pip': 'Picture-in-picture',
  'tools.video.ctxCopyUrlAtTime': 'Copiar URL do vídeo na posição de reprodução atual',
  'tools.video.ctxStats': 'Estatísticas de reprodução',
  'tools.callout.emojiSearchResults': 'Resultados da pesquisa de emojis: {count}',
  'tools.database.checkboxChecked': 'Marcada',
  'tools.database.checkboxUnchecked': 'Desmarcada',
};

const ROMANIAN_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'Șterge formatarea',
  'tools.toggle.bodyPlaceholder': 'Bloc reductibil gol. Faceți clic pentru a adăuga un bloc sau trageți blocuri aici.',
  'blockSettings.clickToOpenMenu': 'Faceți clic pentru a deschide meniul',
  'blockSettings.clickAction': 'Faceți clic',
  'toolbox.addBelow': 'Faceți clic pentru a adăuga dedesubt',
  'toolbox.optionAddAbove': '⌥ + clic pentru a adăuga deasupra',
  'toolbox.ctrlAddAbove': 'Ctrl + clic pentru a adăuga deasupra',
  'popover.search': 'Căutați o acțiune…',
  'toolNames.bold': 'Aldin',
  'toolNames.bulletedList': 'Listă cu marcatori',
  'tools.marker.textColor': 'Culoare text',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.paragraph.placeholder': 'Scrieți ceva sau apăsați / pentru a selecta un instrument',
  'tools.table.clearSelection': 'Șterge conținutul',
  'tools.table.mergeCells': 'Îmbină celulele',
  'tools.table.splitCell': 'Scindează celula',
  'tools.table.duplicateColumn': 'Duplică',
  'tools.table.duplicateRow': 'Duplică',
  'tools.table.clickToAddRow': 'Faceți clic pentru a adăuga un rând nou',
  'tools.table.clickToAddColumn': 'Faceți clic pentru a adăuga o coloană nouă',
  'tools.table.comfortableText': 'Text aerisit',
  'tools.table.placement': 'Aliniere',
  'tools.table.placementTopLeft': 'Stânga sus',
  'tools.table.placementTopCenter': 'Centru sus',
  'tools.table.placementTopRight': 'Dreapta sus',
  'tools.table.placementMiddleLeft': 'Stânga la mijloc',
  'tools.table.placementMiddleRight': 'Dreapta la mijloc',
  'tools.table.placementBottomLeft': 'Stânga jos',
  'tools.table.placementBottomCenter': 'Centru jos',
  'tools.table.placementBottomRight': 'Dreapta jos',
  'blockSettings.duplicate': 'Duplică',
  'a11y.dragHandle': 'Trageți pentru a muta blocul sau faceți clic pentru a deschide meniul',
  'a11y.dragStarted': 'Se mută blocul',
  'a11y.dragStartedMultiple': 'Blocuri în curs de mutare: {count}',
  'a11y.dropPosition': 'Poziție de plasare: {position} din {total}',
  'a11y.blocksMoved': 'Blocuri mutate: {count}. Poziție: {position}.',
  'a11y.blocksDuplicated': 'Blocuri duplicate: {count}. Poziția primului bloc duplicat: {position}.',
  'a11y.searchResults': 'Rezultate ale căutării: {count}',
  'a11y.allBlocksSelected': 'Toate blocurile sunt selectate. Total: {count}.',
  'a11y.blocksSelected': 'Blocuri selectate: {count}',
  'a11y.navigationModeEntered': 'Mod de navigare. Folosiți tastele săgeată pentru a vă deplasa între blocuri, Enter pentru editare și Escape pentru ieșire.',
  'a11y.navigatedToBlock': 'Ați navigat la bloc',
  'toolNames.strikethrough': 'Tăiat cu o linie',
  'toolNames.board': 'Panou',
  'searchTerms.number': 'numerotare',
  'searchTerms.checkbox': 'casetă de selectare',
  'tools.callout.addEmoji': 'Adaugă o pictogramă',
  'tools.callout.filterEmojis': 'Căutați emoji…',
  'tools.callout.pickRandom': 'Alege un emoji aleatoriu',
  'tools.callout.emojiCategoryPeople': 'Fețe zâmbitoare și persoane',
  'tools.database.cardMenuLabel': 'Opțiunile cardului',
  'tools.quote.size': 'Dimensiunea citatului',
  'tools.equation.placeholder': 'Introduceți o formulă LaTeX…',
  'tools.code.placeholder': 'Scrieți cod…',
  'tools.code.wrapLines': 'Încadrare text',
  'tools.code.searchLanguage': 'Căutați limbaje…',
  'blockSettings.blocksSelected': 'Blocuri selectate: {count}',
  'tools.link.keepTyping': 'Continuați să scrieți pentru a adăuga un link',
  'tools.link.linkTitle': 'Textul linkului',
  'tools.image.captionPlaceholder': 'Scrieți o legendă…',
  'tools.image.altDescription': 'Descrieți această imagine pentru persoanele care nu o pot vedea.',
  'tools.image.preview': 'Previzualizarea imaginii',
  'tools.image.previewControls': 'Comenzi pentru previzualizarea imaginii',
  'tools.image.navigationControls': 'Comenzi de navigare între imagini',
  'tools.image.errorDefaultMessage': 'Imaginea nu a putut fi încărcată de la acest URL. Încercați o altă sursă sau încărcați din nou fișierul.',
  'tools.image.emptyOrDropHere': 'sau plasați o imagine aici',
  'tools.image.emptyDropToUpload': 'Plasați pentru a încărca',
  'tools.image.emptyUrlPlaceholder': 'Lipiți URL-ul unei imagini…',
  'tools.image.cropRatioFree': 'Liberă',
  'tools.file.emptyDropHint': 'sau trageți un fișier aici',
  'tools.file.emptyDropToUpload': 'Plasați pentru a încărca',
  'tools.file.emptyUrlPlaceholder': 'Lipiți URL-ul unui fișier…',
  'tools.file.emptyUrlAria': 'URL-ul fișierului',
  'tools.file.captionPlaceholder': 'Scrieți o legendă…',
  'tools.file.previewRender': 'Previzualizare',
  'tools.file.previewOpenInNewTab': 'Deschide într-o filă nouă',
  'tools.video.captionPlaceholder': 'Scrieți o legendă…',
  'tools.video.alignmentLeft': 'Aliniază la stânga',
  'tools.video.alignmentCenter': 'Aliniază la centru',
  'tools.video.alignmentRight': 'Aliniază la dreapta',
  'tools.video.emptyOrDropHere': 'sau plasați un videoclip aici',
  'tools.video.emptyDropToUpload': 'Plasați pentru a încărca',
  'tools.video.emptyUrlPlaceholder': 'Lipiți URL-ul unui videoclip…',
  'tools.audio.captionPlaceholder': 'Scrieți o legendă…',
  'tools.audio.alignmentLeft': 'Aliniază la stânga',
  'tools.audio.alignmentCenter': 'Aliniază la centru',
  'tools.audio.alignmentRight': 'Aliniază la dreapta',
  'tools.audio.replace': 'Înlocuiește fișierul audio',
  'tools.audio.emptyAddAudio': 'Adaugă un fișier audio',
  'tools.audio.emptyOrDropHere': 'sau plasați un fișier audio aici',
  'tools.audio.emptyDropToUpload': 'Plasați pentru a încărca',
  'tools.audio.emptyUrlPlaceholder': 'Lipiți URL-ul unui fișier audio…',
  'tools.audio.emptyUrlAria': 'URL-ul fișierului audio',
  'tools.audio.emptySourceAria': 'Sursa fișierului audio',
  'tools.audio.coverOrDropHere': 'sau plasați o imagine aici',
  'tools.audio.coverDropToUpload': 'Plasați pentru a încărca',
  'tools.audio.coverUrlPlaceholder': 'Lipiți URL-ul unei imagini…',
  'tools.audio.coverSourceAria': 'Sursa copertei',
  'tools.audio.coverErrorType': 'Alegeți un fișier imagine',
  'tools.database.viewTypeListDescription': 'Afișează elementele într-o listă simplă',
  'tools.database.propertyTypeCheckbox': 'Casetă de selectare',
  'tools.database.kanbanBoard': 'Panou Kanban',
  'tools.database.cardDetails': 'Detaliile cardului',
  'tools.database.cardTitle': 'Titlul cardului',
  'tools.database.defaultStatusDone': 'Finalizat',
  'tools.bookmark.loading': 'Se încarcă previzualizarea linkului…',
  'tools.embed.empty': 'Niciun link de încorporare',
  'tools.embed.captionPlaceholder': 'Scrieți o legendă…',
  'tools.embed.replace': 'Înlocuiește',
  'tools.embed.urlSubmit': 'Încorporează linkul',
  'tools.linkPaste.embed': 'Creează conținut încorporat',
  'tools.linkPaste.mention': 'Menționează',
  'tools.video.seek': 'Derulare',
  'tools.video.toggleTimeDisplay': 'Comută între timpul scurs și cel rămas',
  'tools.video.pip': 'Picture-in-picture',
  'tools.video.ctxStats': 'Statistici de redare',
  'tools.callout.emojiSearchResults': 'Potriviri pentru emoji: {count}',
  'tools.toggle.placeholder': 'Listă reductibilă',
};

const RUSSIAN_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'Очистить форматирование',
  'blockSettings.dragToMove': 'Перетащите, чтобы переместить',
  'blockSettings.clickToOpenMenu': 'Нажмите, чтобы открыть меню',
  'toolbox.optionAddAbove': '⌥ + щелчок — добавить выше',
  'toolbox.ctrlAddAbove': 'Ctrl + щелчок — добавить выше',
  'toolbox.typeToSearch': 'Введите запрос для поиска',
  'toolNames.bold': 'Полужирный',
  'tools.marker.textColor': 'Цвет текста',
  'tools.marker.default': 'По умолчанию',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.paragraph.placeholder': 'Напишите что-нибудь или нажмите /, чтобы выбрать инструмент',
  'tools.toggle.placeholder': 'Сворачиваемый список',
  'tools.toggle.bodyPlaceholder': 'Пустой сворачиваемый блок. Нажмите, чтобы добавить блок, или перетащите блоки сюда.',
  'tools.table.clearSelection': 'Очистить содержимое',
  'tools.table.headerColumn': 'Столбец заголовков',
  'tools.table.headerRow': 'Строка заголовков',
  'tools.table.clickToAddRow': 'Нажмите, чтобы добавить новую строку',
  'tools.table.dragToAddRemoveRows': 'Перетащите, чтобы добавить или удалить строки',
  'tools.table.clickToAddColumn': 'Нажмите, чтобы добавить новый столбец',
  'tools.table.dragToAddRemoveColumns': 'Перетащите, чтобы добавить или удалить столбцы',
  'tools.table.comfortableText': 'Обычный текст',
  'tools.table.placement': 'Выравнивание',
  'a11y.dragHandle': 'Перетащите, чтобы переместить блок, или нажмите, чтобы открыть меню',
  'a11y.dragHandleRole': 'маркер перетаскивания',
  'a11y.dropPosition': 'Будет размещено на позиции {position} из {total}',
  'a11y.blocksMoved': 'Перемещено блоков: {count}. Позиция: {position}',
  'a11y.movedUp': 'Перемещено вверх на позицию {position} из {total}.',
  'a11y.movedDown': 'Перемещено вниз на позицию {position} из {total}.',
  'a11y.atTop': 'Невозможно переместить выше. Уже вверху.',
  'a11y.atBottom': 'Невозможно переместить ниже. Уже внизу.',
  'a11y.searchResults': 'Результаты поиска: {count}',
  'blockSettings.convertWithChildrenWarning': 'Вложенных блоков: {count}. При преобразовании этого блока вложенное содержимое будет перемещено на верхний уровень. Продолжить?',
  'searchTerms.separator': 'линия',
  'searchTerms.plain': 'обычный текст',
  'searchTerms.header': 'название',
  'searchTerms.number': 'нумерация',
  'searchTerms.citation': 'цитирование',
  'tools.callout.addEmoji': 'Добавить значок',
  'tools.callout.editIcon': 'Изменить значок',
  'tools.callout.removeEmoji': 'Удалить значок',
  'tools.callout.filterEmojis': 'Поиск эмодзи…',
  'tools.callout.pickRandom': 'Выбрать случайный эмодзи',
  'tools.callout.skinTone': 'Оттенок кожи',
  'tools.callout.emojiCategoryActivity': 'Действия',
  'tools.callout.colorDefault': 'По умолчанию',
  'tools.quote.defaultSize': 'По умолчанию',
  'toolNames.equation': 'Формула',
  'tools.equation.placeholder': 'Введите формулу LaTeX…',
  'tools.code.searchLanguage': 'Поиск языков…',
  'blockSettings.copyLinkError': 'Не удалось скопировать ссылку на блок',
  'tools.link.linkTitle': 'Текст ссылки',
  'tools.code.plainText': 'Обычный текст',
  'tools.image.converting': 'Преобразование…',
  'tools.image.toggleCaption': 'Показать или скрыть подпись',
  'tools.image.altDescription': 'Опишите изображение для тех, кто его не видит.',
  'tools.image.previewControls': 'Элементы управления просмотром изображения',
  'tools.image.errorFileTooLarge': 'Размер изображения ({size}) превышает ограничение {max}.',
  'tools.image.errorDefaultMessage': 'Не удалось загрузить изображение по этому URL. Попробуйте другой источник или загрузите файл ещё раз.',
  'tools.image.emptyOrDropHere': 'или перетащите изображение сюда',
  'tools.image.cropRatioFree': 'Свободный формат',
  'tools.database.addView': 'Добавить представление',
  'tools.database.viewTypeListDescription': 'Показывать элементы простым списком',
  'tools.database.propertyTypeSelect': 'Выбор',
  'tools.database.propertyTypeMultiSelect': 'Множественный выбор',
  'tools.database.cardDetails': 'Сведения о карточке',
  'tools.bookmark.loading': 'Загрузка предварительного просмотра ссылки…',
  'tools.bookmark.error': 'Не удалось загрузить предварительный просмотр ссылки',
  'tools.embed.empty': 'Нет ссылки для встраивания',
  'tools.linkPaste.embed': 'Встроить содержимое',
  'tools.linkPaste.embedVideo': 'Встроить видео из {provider}',
  'tools.linkPaste.embedAudio': 'Встроить аудио из {provider}',
  'tools.linkPaste.embedImage': 'Встроить изображение из {provider}',
  'tools.linkPaste.embedSocial': 'Встроить публикацию из {provider}',
  'tools.linkPaste.embedDocument': 'Встроить документ из {provider}',
  'tools.linkPaste.embedTable': 'Встроить таблицу из {provider}',
  'tools.linkPaste.embedForm': 'Встроить форму из {provider}',
  'tools.linkPaste.embedCode': 'Встроить код из {provider}',
  'tools.linkPaste.embedDesign': 'Встроить макет из {provider}',
  'tools.linkPaste.embedChart': 'Встроить диаграмму из {provider}',
  'tools.linkPaste.embedMap': 'Встроить карту из {provider}',
  'tools.linkPaste.embedCalendar': 'Встроить календарь из {provider}',
  'tools.linkPaste.mention': 'Упомянуть',
  'tools.file.toggleCaption': 'Показать или скрыть подпись',
  'tools.file.errorFileTooLarge': 'Размер файла ({size}) превышает ограничение {max}.',
  'tools.file.previewRaw': 'Исходный текст',
  'tools.file.previewRender': 'Предпросмотр',
  'tools.video.alignmentLeft': 'Выровнять по левому краю',
  'tools.video.alignmentCenter': 'Выровнять по центру',
  'tools.video.alignmentRight': 'Выровнять по правому краю',
  'tools.video.toggleCaption': 'Показать или скрыть подпись',
  'tools.video.errorFileTooLarge': 'Размер видео ({size}) превышает ограничение {max}.',
  'tools.video.emptyOrDropHere': 'или перетащите видео сюда',
  'tools.audio.alignmentLeft': 'Выровнять по левому краю',
  'tools.audio.alignmentCenter': 'Выровнять по центру',
  'tools.audio.alignmentRight': 'Выровнять по правому краю',
  'tools.audio.errorFileTooLarge': 'Размер аудиофайла ({size}) превышает ограничение {max}.',
  'tools.audio.errorGoogleDrive': 'Аудио из Google Диска нельзя воспроизвести напрямую. Скачайте файл и загрузите его сюда.',
  'tools.audio.errorOneDrive': 'Аудио из OneDrive нельзя воспроизвести напрямую. Скачайте файл и загрузите его сюда.',
  'tools.audio.titlePlaceholder': 'Название трека',
  'tools.audio.artistPlaceholder': 'Исполнитель',
  'tools.audio.emptyOrDropHere': 'или перетащите аудиофайл сюда',
  'tools.audio.coverChange': 'Изменить обложку',
  'tools.audio.coverSet': 'Установить обложку',
  'tools.audio.coverRemove': 'Удалить обложку',
  'tools.audio.coverErrorType': 'Выберите файл изображения',
  'tools.audio.coverErrorTooLarge': 'Изображение слишком большое',
  'tools.audio.coverAdd': 'Добавьте обложку',
  'tools.audio.coverOrDropHere': 'или перетащите изображение сюда',
  'tools.audio.coverSourceAria': 'Источник обложки',
  'a11y.allBlocksSelected': 'Выбраны все блоки. Всего: {count}',
  'a11y.navigationModeEntered': 'Режим навигации. Используйте клавиши со стрелками для перехода между блоками, Enter — для редактирования, Esc — для выхода.',
  'a11y.navigationModeExited': 'Режим навигации завершён',
  'a11y.navigatedToBlock': 'Вы перешли к блоку',
  'blockSettings.orConjunction': ' или используйте ',
  'blockSettings.openMenuAction': ', чтобы открыть меню',
  'tools.video.seek': 'Позиция воспроизведения',
  'tools.video.toggleTimeDisplay': 'Переключить отображение прошедшего и оставшегося времени',
  'tools.video.speedPresets': 'Предустановленные скорости',
  'tools.video.ctxStats': 'Статистика воспроизведения',
  'tools.callout.emojiCategoryTravel': 'Путешествия и места',
  'blockSettings.lastEdited': 'Последнее изменение',
  'blockSettings.lastEditedBy': 'Автор последнего изменения: {name}',
  'tools.callout.emojiCategoryPeople': 'Смайлики и люди',
  'tools.callout.emojiCategoryNature': 'Животные и природа',
  'tools.callout.emojiCategoryFood': 'Еда и напитки',
  'tools.database.viewTypeBoardDescription': 'Показывать элементы в колонках',
};

const SINDHI_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'فارميٽنگ صاف ڪريو',
  'tools.toggle.bodyPlaceholder': 'خالي سمٽيل بلاڪ. هڪ بلاڪ شامل ڪرڻ لاءِ ڪلڪ ڪريو يا بلاڪن کي هتي ڇڪيو.',
  'blockSettings.clickAction': 'مينيو کولڻ لاءِ ڪلڪ ڪريو',
  'blockSettings.orConjunction': ' يا ',
  'blockSettings.openMenuAction': ' دٻايو',
  'toolbox.optionAddAbove': 'مٿي شامل ڪرڻ لاءِ Option-ڪلڪ ڪريو',
  'toolbox.ctrlAddAbove': 'مٿي شامل ڪرڻ لاءِ Ctrl-ڪلڪ ڪريو',
  'popover.convertTo': '۾ تبديل ڪريو',
  'tools.marker.textColor': 'متن جو رنگ',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.table.clearSelection': 'مواد صاف ڪريو',
  'tools.table.copySelection': 'ڪاپي ڪريو',
  'tools.table.mergeCells': 'سيلن کي ملايو',
  'tools.table.placement': 'ترتيب',
  'blockSettings.lastEditedBy': 'آخري ترميم ڪندڙ: {name}',
  'a11y.dragHandle': 'بلاڪ کي منتقل ڪرڻ لاءِ ڇڪيو يا مينيو کولڻ لاءِ ڪلڪ ڪريو',
  'a11y.dropPosition': 'ڪل {total} مان پوزيشن {position} تي رکيو ويندو',
  'a11y.blockMoved': 'بلاڪ ڪل {total} مان پوزيشن {position} تي منتقل ٿيو',
  'a11y.blockDuplicated': 'بلاڪ ڪل {total} مان پوزيشن {position} تي نقل ٿيو',
  'a11y.searchResults': 'ڳولا جا نتيجا: {count}',
  'a11y.navigationModeEntered': 'نيويگيشن موڊ. بلاڪن جي وچ ۾ هلڻ لاءِ تير وارا بٽڻ استعمال ڪريو، ترميم ڪرڻ لاءِ Enter ۽ ٻاهر نڪرڻ لاءِ Escape دٻايو.',
  'toolNames.strikethrough': 'منجهي ليڪ',
  'searchTerms.warning': 'چتاءُ',
  'tools.callout.addEmoji': 'آئڪن شامل ڪريو',
  'tools.callout.editIcon': 'آئڪن تبديل ڪريو',
  'tools.callout.removeEmoji': 'آئڪن هٽايو',
  'tools.callout.filterEmojis': 'ايموجي ڳوليو…',
  'tools.callout.pickRandom': 'بي ترتيب ايموجي چونڊيو',
  'tools.database.newRow': 'نئين قطار',
  'tools.code.wrapLines': 'سٽون ويڙهيو',
  'tools.code.searchLanguage': 'ٻوليون ڳوليو…',
  'tools.link.linkTitle': 'لنڪ جو متن',
  'tools.image.alignmentLeftAria': 'کاٻي پاسي ترتيب ڏيو',
  'tools.image.alignmentCenterAria': 'وچ ۾ ترتيب ڏيو',
  'tools.image.alignmentRightAria': 'ساڄي پاسي ترتيب ڏيو',
  'tools.image.toggleCaption': 'ڪئپشن ڏيکاريو يا لڪايو',
  'tools.image.downloadOriginal': 'اصل تصوير ڊائون لوڊ ڪريو',
  'tools.image.download': 'ڊائون لوڊ ڪريو',
  'tools.image.copyUrl': 'URL ڪاپي ڪريو',
  'tools.image.cancelUpload': 'اپ لوڊ منسوخ ڪريو',
  'tools.image.previewControls': 'تصوير جي اڳ ڏيک جا ڪنٽرول',
  'tools.image.previousImage': 'پوئين تصوير',
  'tools.image.resetZoom': 'زوم ٻيهر سيٽ ڪريو',
  'tools.image.errorDefaultMessage': 'تصوير هن URL تان لوڊ نه ٿي سگهي. ٻيو ذريعو ڪوشش ڪريو يا فائل ٻيهر اپ لوڊ ڪريو.',
  'tools.image.errorRetry': 'ٻيهر ڪوشش ڪريو',
  'tools.image.emptyUpload': 'اپ لوڊ ڪريو',
  'tools.image.emptyUrlAria': 'تصوير جو URL',
  'tools.image.cropReset': 'ٻيهر سيٽ ڪريو',
  'tools.image.cropCancel': 'رد ڪريو',
  'tools.file.emptyUpload': 'اپ لوڊ ڪريو',
  'tools.file.emptyUrlPlaceholder': 'فائيل جو URL پيسٽ ڪريو…',
  'tools.file.emptyUrlAria': 'فائيل جو URL',
  'tools.file.cancelUpload': 'اپ لوڊ منسوخ ڪريو',
  'tools.file.toggleCaption': 'ڪئپشن ڏيکاريو يا لڪايو',
  'tools.file.download': 'ڊائون لوڊ ڪريو',
  'tools.file.copyUrl': 'URL ڪاپي ڪريو',
  'tools.file.previewRaw': 'ذريعو',
  'tools.file.previewRender': 'اڳ ڏيک',
  'tools.file.previewDownload': 'ڊائون لوڊ ڪريو',
  'tools.video.alignmentLeft': 'کاٻي پاسي ترتيب ڏيو',
  'tools.video.alignmentCenter': 'وچ ۾ ترتيب ڏيو',
  'tools.video.alignmentRight': 'ساڄي پاسي ترتيب ڏيو',
  'tools.video.toggleCaption': 'ڪئپشن ڏيکاريو يا لڪايو',
  'tools.video.download': 'ڊائون لوڊ ڪريو',
  'tools.video.copyUrl': 'URL ڪاپي ڪريو',
  'tools.video.emptyUpload': 'اپ لوڊ ڪريو',
  'tools.video.emptyUrlAria': 'وڊيو جو URL',
  'tools.audio.alignmentLeft': 'کاٻي پاسي ترتيب ڏيو',
  'tools.audio.alignmentCenter': 'وچ ۾ ترتيب ڏيو',
  'tools.audio.alignmentRight': 'ساڄي پاسي ترتيب ڏيو',
  'tools.audio.download': 'ڊائون لوڊ ڪريو',
  'tools.audio.copyUrl': 'URL ڪاپي ڪريو',
  'tools.audio.emptyUpload': 'اپ لوڊ ڪريو',
  'tools.audio.emptyOrDropHere': 'يا هتي آڊيو فائل ڇڏيو',
  'tools.audio.emptyUrlAria': 'آڊيو جو URL',
  'tools.audio.coverUpload': 'اپ لوڊ ڪريو',
  'tools.audio.coverUrlAria': 'تصوير جو URL',
  'tools.database.duplicateView': 'نقل ٺاهيو',
  'tools.database.viewTypeListDescription': 'شيون هڪ سادي فهرست ۾ ڏيکاريو',
  'tools.database.propertyTypeHeading': 'پراپرٽي جو قسم',
  'tools.database.propertyTypeSelect': 'چونڊ',
  'tools.database.propertyTypeMultiSelect': 'گهڻن جي چونڊ',
  'tools.database.listView': 'فهرست وارو ڏيک',
  'tools.bookmark.loading': 'لنڪ جو اڳ ڏيک لوڊ ٿي رهيو آهي…',
  'tools.bookmark.error': 'لنڪ جو اڳ ڏيک لوڊ نه ٿي سگهيو',
  'tools.embed.empty': 'ڪو به ايمبيڊ لنڪ ناهي',
  'tools.embed.invalidUrl': 'اهو لنڪ ايمبيڊ نٿو ڪري سگهجي',
  'tools.video.seek': 'پلي بيڪ جي پوزيشن',
  'tools.video.toggleTimeDisplay': 'گذريل ۽ باقي وقت جي وچ ۾ مٽايو',
  'tools.video.volume': 'آواز جي سطح',
  'tools.video.ctxCopyUrlAtTime': 'وڊيو جو URL موجوده پلي بيڪ وقت سميت ڪاپي ڪريو',
  'tools.video.ctxStats': 'پلي بيڪ جا انگ اکر',
  'tools.audio.volume': 'آواز جي سطح',
  'tools.callout.emojiSearchResults': 'ملندڙ ايموجي: {count}',
  'tools.database.checkboxChecked': 'نشان لڳل',
  'tools.database.checkboxUnchecked': 'نشان نه لڳل',
};

const SINHALA_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'හැඩතල ගැන්වීම ඉවත් කරන්න',
  'tools.toggle.bodyPlaceholder': 'හිස් හැකිලෙන කොටස. කොටසක් එක් කිරීමට ක්ලික් කරන්න හෝ කොටස් මෙතැනට ඇදගෙන දමන්න.',
  'blockSettings.clickAction': 'මෙනුව විවෘත කිරීමට ක්ලික් කරන්න',
  'blockSettings.orConjunction': ' හෝ ',
  'blockSettings.openMenuAction': ' ඔබන්න',
  'tools.marker.textColor': 'පෙළ වර්ණය',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.paragraph.placeholder': 'යමක් ලියන්න හෝ මෙවලමක් තෝරා ගැනීමට / ඔබන්න',
  'tools.table.placement': 'පෙළ ගැස්ම',
  'a11y.searchResults': 'සෙවුම් ප්‍රතිඵල: {count}',
  'toolNames.strikethrough': 'කැපූ',
  'tools.callout.addEmoji': 'නිරූපකයක් එක් කරන්න',
  'tools.callout.filterEmojis': 'ඉමෝජි සොයන්න…',
  'tools.callout.pickRandom': 'අහඹු ඉමෝජියක් තෝරන්න',
  'tools.code.searchLanguage': 'භාෂා සොයන්න…',
  'searchTerms.pre': 'පූර්ව හැඩතල ගැන්වූ පෙළ',
  'tools.link.linkTitle': 'සබැඳි පෙළ',
  'tools.image.previewControls': 'රූප පෙරදසුන් පාලන',
  'tools.image.errorDefaultMessage': 'මෙම URL එකෙන් රූපය පූරණය කළ නොහැකි විය. වෙනත් මූලාශ්‍රයක් උත්සාහ කරන්න හෝ ගොනුව නැවත උඩුගත කරන්න.',
  'tools.file.previewRaw': 'මූලාශ්‍රය',
  'tools.file.previewRender': 'පෙරදසුන',
  'tools.audio.replace': 'ශ්‍රව්‍යය ප්‍රතිස්ථාපනය',
  'tools.audio.titlePlaceholder': 'ශ්‍රව්‍ය පථයේ මාතෘකාව',
  'tools.audio.emptyAddAudio': 'ශ්‍රව්‍යයක් එක් කරන්න',
  'tools.audio.emptyOrDropHere': 'හෝ ශ්‍රව්‍ය ගොනුවක් මෙහි දමන්න',
  'tools.audio.emptySourceAria': 'ශ්‍රව්‍යයේ මූලාශ්‍රය',
  'tools.database.viewTypeListDescription': 'අයිතම සරල ලැයිස්තුවක පෙන්වන්න',
  'tools.database.propertyTypeHeading': 'ගුණාංග වර්ගය',
  'tools.database.propertyTypeSelect': 'තේරීම',
  'tools.database.defaultStatusInProgress': 'ක්‍රියාත්මක වෙමින්',
  'tools.bookmark.loading': 'සබැඳි පෙරදසුන පූරණය වෙමින්…',
  'tools.embed.empty': 'කාවැද්දීමේ සබැඳියක් නැත',
  'tools.video.seek': 'ධාවන ස්ථානය',
  'tools.video.toggleTimeDisplay': 'ගත වූ සහ ඉතිරි කාලය අතර මාරු වන්න',
  'tools.video.ctxCopyUrlAtTime': 'වත්මන් ධාවන වේලාව සහිත වීඩියෝ URL එක පිටපත් කරන්න',
  'tools.video.ctxStats': 'ධාවන සංඛ්‍යාලේඛන',
};

const SLOVAK_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'Vymazať formátovanie',
  'toolbox.optionAddAbove': 'Kliknutím so stlačeným klávesom Option pridáte blok vyššie',
  'toolbox.ctrlAddAbove': 'Kliknutím so stlačeným klávesom Ctrl pridáte blok vyššie',
  'toolNames.toggleList': 'Zbaliteľný zoznam',
  'tools.marker.textColor': 'Farba textu',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.colorPicker.color.gray': 'Sivá',
  'tools.header.toggleHeading': 'Zbaliteľný nadpis',
  'tools.header.toggleHeading1': 'Zbaliteľný nadpis 1',
  'tools.header.toggleHeading2': 'Zbaliteľný nadpis 2',
  'tools.header.toggleHeading3': 'Zbaliteľný nadpis 3',
  'tools.header.toggleHeading4': 'Zbaliteľný nadpis 4',
  'tools.header.toggleHeading5': 'Zbaliteľný nadpis 5',
  'tools.header.toggleHeading6': 'Zbaliteľný nadpis 6',
  'blockSettings.lastEditedBy': 'Autor poslednej úpravy: {name}',
  'a11y.dragStartedMultiple': 'Počet presúvaných blokov: {count}',
  'a11y.blocksMoved': 'Počet presunutých blokov: {count}. Nová pozícia: {position}',
  'a11y.blocksDuplicated': 'Počet duplikovaných blokov: {count}. Počiatočná pozícia: {position}',
  'a11y.searchResults': 'Výsledky vyhľadávania: {count}',
  'tools.paragraph.placeholder': 'Napíšte niečo alebo stlačte /, aby ste vybrali nástroj',
  'tools.toggle.placeholder': 'Zbaliteľný zoznam',
  'tools.toggle.bodyPlaceholder': 'Prázdny zbaliteľný blok. Kliknutím pridáte blok alebo sem presuňte bloky.',
  'tools.table.clearSelection': 'Vymazať obsah',
  'toolNames.quote': 'Citát',
  'searchTerms.delimiter': 'oddeľovací znak',
  'searchTerms.collapsible': 'zbaliteľný',
  'searchTerms.quote': 'citát',
  'searchTerms.citation': 'citácia',
  'tools.callout.addEmoji': 'Pridať ikonu',
  'tools.callout.filterEmojis': 'Hľadať emoji…',
  'tools.callout.pickRandom': 'Vybrať náhodné emoji',
  'tools.callout.colorGray': 'Sivá',
  'tools.code.searchLanguage': 'Hľadať jazyk…',
  'tools.quote.placeholder': 'Citát',
  'tools.table.placement': 'Zarovnanie',
  'blockSettings.copyLinkSuccess': 'Odkaz bol skopírovaný do schránky',
  'blockSettings.copyLinkError': 'Odkaz na blok sa nepodarilo skopírovať',
  'tools.link.linkTitle': 'Text odkazu',
  'tools.image.toggleCaption': 'Zobraziť alebo skryť popis',
  'tools.image.moreOptions': 'Ďalšie možnosti',
  'tools.image.previewControls': 'Ovládacie prvky náhľadu obrázka',
  'tools.image.errorDefaultMessage': 'Obrázok sa z tejto adresy URL nepodarilo načítať. Skúste iný zdroj alebo súbor nahrajte znova.',
  'tools.database.viewTypeListDescription': 'Zobraziť položky v jednoduchom zozname',
  'tools.database.listView': 'Zobrazenie zoznamu',
  'tools.database.cardDetails': 'Podrobnosti karty',
  'tools.embed.empty': 'Chýba odkaz na vložený obsah',
  'tools.linkPaste.embed': 'Vložiť obsah',
  'tools.linkPaste.mention': 'Spomenúť',
  'tools.file.toggleCaption': 'Zobraziť alebo skryť popis',
  'tools.file.previewRaw': 'Zdroj',
  'tools.video.alignmentLeft': 'Zarovnať vľavo',
  'tools.video.alignmentCenter': 'Zarovnať na stred',
  'tools.video.alignmentRight': 'Zarovnať vpravo',
  'tools.video.toggleCaption': 'Zobraziť alebo skryť popis',
  'tools.video.moreOptions': 'Ďalšie možnosti',
  'tools.audio.alignmentLeft': 'Zarovnať vľavo',
  'tools.audio.alignmentCenter': 'Zarovnať na stred',
  'tools.audio.alignmentRight': 'Zarovnať vpravo',
  'tools.audio.emptyOrDropHere': 'alebo sem presuňte zvukový súbor',
  'tools.audio.emptyUrlPlaceholder': 'Vložte URL zvukového súboru…',
  'tools.audio.emptyUrlAria': 'URL zvukového súboru',
  'tools.audio.emptySourceAria': 'Zdroj zvuku',
  'tools.audio.coverSourceAria': 'Zdroj obalu',
  'tools.bookmark.loading': 'Načítava sa náhľad odkazu…',
  'a11y.allBlocksSelected': 'Všetky bloky boli vybrané. Celkový počet: {count}.',
  'a11y.navigatedToBlock': 'Prešli ste na blok',
  'notifier.dismiss': 'Zavrieť',
  'tools.video.seek': 'Pozícia prehrávania',
  'tools.video.toggleTimeDisplay': 'Prepnúť medzi uplynutým a zostávajúcim časom',
  'tools.video.ctxStats': 'Štatistiky prehrávania',
  'tools.callout.emojiSearchResults': 'Zhody emoji: {count}',
};

const SLOVENIAN_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'Počisti oblikovanje',
  'tools.toggle.bodyPlaceholder': 'Prazen preklopni blok. Kliknite za dodajanje bloka ali povlecite bloke sem.',
  'toolbox.optionAddAbove': 'Kliknite s pritisnjeno tipko Option, da zgoraj dodate blok',
  'toolbox.ctrlAddAbove': 'Kliknite s pritisnjeno tipko Ctrl, da zgoraj dodate blok',
  'tools.marker.textColor': 'Barva besedila',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.paragraph.placeholder': 'Napišite nekaj ali pritisnite / za izbiro orodja',
  'tools.table.clearSelection': 'Počisti vsebino',
  'tools.table.headerColumn': 'Stolpec z glavo',
  'tools.table.headerRow': 'Vrstica z glavo',
  'tools.table.placement': 'Poravnava',
  'blockSettings.lastEditedBy': 'Nazadnje urejeno: {name}',
  'a11y.dragHandle': 'Povlecite za premik bloka ali kliknite za odprtje menija',
  'a11y.dragStartedMultiple': 'Vlečenje blokov: {count}',
  'a11y.blocksMoved': 'Premaknjeni bloki: {count}. Nov položaj: {position}',
  'a11y.blocksDuplicated': 'Podvojeni bloki: {count}. Začetni položaj: {position}',
  'a11y.searchResults': 'Rezultati iskanja: {count}',
  'a11y.allBlocksSelected': 'Izbrani so vsi bloki. Skupaj: {count}',
  'a11y.navigatedToBlock': 'Pomaknili ste se na blok',
  'a11y.dropCreateColumnLeft': 'Ustvarjen bo stolpec na levi',
  'a11y.dropCreateColumnRight': 'Ustvarjen bo stolpec na desni',
  'searchTerms.blockquote': 'citatni blok',
  'tools.callout.addEmoji': 'Dodaj ikono',
  'tools.callout.filterEmojis': 'Poišči emojije…',
  'tools.callout.pickRandom': 'Izberi naključni emoji',
  'tools.code.searchLanguage': 'Poišči jezike…',
  'toolNames.audio': 'Zvok',
  'blockSettings.copyLinkSuccess': 'Povezava je kopirana v odložišče',
  'blockSettings.copyLinkError': 'Povezave do bloka ni bilo mogoče kopirati',
  'tools.link.linkTitle': 'Besedilo povezave',
  'tools.image.moreOptions': 'Več možnosti',
  'tools.image.previewControls': 'Kontrolniki predogleda slike',
  'tools.image.errorDefaultMessage': 'Slike s tega URL-ja ni bilo mogoče naložiti. Poskusite drug vir ali znova naložite datoteko.',
  'tools.file.previewRaw': 'Izvor',
  'tools.video.moreOptions': 'Več možnosti',
  'tools.audio.replace': 'Zamenjaj zvočni posnetek',
  'tools.audio.emptyAddAudio': 'Dodajte zvočni posnetek',
  'tools.audio.emptyOrDropHere': 'ali spustite zvočno datoteko sem',
  'tools.audio.emptyUrlPlaceholder': 'Prilepite URL zvočnega posnetka…',
  'tools.audio.emptyUrlAria': 'URL zvočnega posnetka',
  'tools.audio.emptySourceAria': 'Vir zvočnega posnetka',
  'tools.bookmark.loading': 'Nalaganje predogleda povezave…',
  'tools.database.viewTypeListDescription': 'Prikaži elemente na preprostem seznamu',
  'tools.database.listView': 'Pogled seznama',
  'tools.embed.empty': 'Ni povezave za vdelavo',
  'tools.embed.urlPlaceholder': 'Prilepite povezavo za vdelavo…',
  'tools.embed.urlSubmit': 'Vdelaj povezavo',
  'tools.embed.invalidUrl': 'Te povezave ni mogoče vdelati',
  'tools.linkPaste.embed': 'Ustvari vdelavo',
  'tools.linkPaste.mention': 'Omeni',
  'tools.video.seek': 'Položaj predvajanja',
  'tools.video.toggleTimeDisplay': 'Preklopi med pretečenim in preostalim časom',
  'tools.video.ctxCopyUrlAtTime': 'Kopiraj URL videa na trenutnem položaju predvajanja',
  'tools.video.ctxStats': 'Statistika predvajanja',
  'tools.callout.emojiSearchResults': 'Zadetki za emojije: {count}',
};

const ALBANIAN_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'Largo formatimin',
  'tools.toggle.bodyPlaceholder': 'Palosje bosh. Klikoni për të shtuar një bllok ose tërhiqni blloqe këtu.',
  'tools.marker.textColor': 'Ngjyra e tekstit',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.paragraph.placeholder': 'Shkruaj diçka ose shtyp / për të zgjedhur një vegël',
  'tools.table.clearSelection': 'Pastro përmbajtjen',
  'tools.table.headerColumn': 'Kolona e kokës',
  'tools.table.headerRow': 'Rreshti i kokës',
  'a11y.dragHandle': 'Tërhiq për të lëvizur bllokun ose kliko për të hapur menynë',
  'a11y.dropPosition': 'Pozicioni i vendosjes: {position} nga {total}',
  'a11y.blockDuplicated': 'Blloku u dyfishua në pozicionin {position} nga {total}',
  'a11y.blocksDuplicated': 'Blloqe të dyfishuara: {count}. Pozicioni fillestar: {position}',
  'a11y.searchResults': 'Rezultatet e kërkimit: {count}',
  'tools.callout.addEmoji': 'Shto ikonë',
  'tools.callout.filterEmojis': 'Kërko emoji…',
  'tools.callout.pickRandom': 'Zgjidh një emoji rastësisht',
  'tools.table.placement': 'Rreshtimi',
  'tools.code.searchLanguage': 'Kërko gjuhë…',
  'tools.link.linkTitle': 'Teksti i lidhjes',
  'tools.image.caption': 'Diçiturë',
  'tools.image.toggleCaption': 'Shfaq ose fshih diçiturën',
  'tools.image.captionPlaceholder': 'Shkruaj një diçiturë…',
  'tools.image.previewControls': 'Kontrollet e parapamjes së imazhit',
  'tools.image.errorSourceOffline': 'Skedari burimor mund të jetë zhvendosur ose jashtë linje.',
  'tools.image.errorDefaultMessage':
    'Imazhi nuk mund të ngarkohej nga kjo URL. Provo një burim tjetër ose ngarko skedarin përsëri.',
  'tools.image.emptyOrDropHere': 'ose lësho një imazh këtu',
  'tools.database.viewTypeListDescription': 'Shfaq elementet në një listë të thjeshtë',
  'tools.bookmark.loading': 'Po ngarkohet pamja paraprake e lidhjes…',
  'tools.embed.empty': 'Nuk ka lidhje për ngulitje',
  'tools.embed.captionPlaceholder': 'Shkruaj një diçiturë…',
  'tools.embed.urlPlaceholder': 'Ngjit një lidhje për ta ngulitur…',
  'tools.embed.urlSubmit': 'Ngulit lidhjen',
  'tools.embed.invalidUrl': 'Kjo lidhje nuk mund të ngulitet',
  'tools.linkPaste.embedVideo': 'Ngulit video nga {provider}',
  'tools.linkPaste.embedAudio': 'Ngulit audio nga {provider}',
  'tools.linkPaste.embedImage': 'Ngulit imazh nga {provider}',
  'tools.linkPaste.embedSocial': 'Ngulit postim nga {provider}',
  'tools.linkPaste.embedDocument': 'Ngulit dokument nga {provider}',
  'tools.linkPaste.embedTable': 'Ngulit tabelë nga {provider}',
  'tools.linkPaste.embedForm': 'Ngulit formular nga {provider}',
  'tools.linkPaste.embedCode': 'Ngulit kod nga {provider}',
  'tools.linkPaste.embedDesign': 'Ngulit dizajn nga {provider}',
  'tools.linkPaste.embedChart': 'Ngulit grafik nga {provider}',
  'tools.linkPaste.embedMap': 'Ngulit hartë nga {provider}',
  'tools.linkPaste.embedCalendar': 'Ngulit kalendar nga {provider}',
  'tools.linkPaste.mention': 'Përmend',
  'tools.file.emptyDropHint': 'ose lësho një skedar këtu',
  'tools.file.toggleCaption': 'Shfaq ose fshih diçiturën',
  'tools.file.captionPlaceholder': 'Shkruaj një diçiturë…',
  'tools.file.previewRaw': 'Burimi',
  'tools.file.previewRender': 'Pamje paraprake',
  'tools.video.caption': 'Diçiturë',
  'tools.video.captionPlaceholder': 'Shkruaj një diçiturë…',
  'tools.video.toggleCaption': 'Shfaq ose fshih diçiturën',
  'tools.video.emptyOrDropHere': 'ose lësho një video këtu',
  'tools.audio.caption': 'Diçiturë',
  'tools.audio.captionPlaceholder': 'Shkruaj një diçiturë…',
  'tools.audio.titlePlaceholder': 'Titulli i pjesës audio',
  'tools.audio.emptyOrDropHere': 'ose lësho një skedar audio këtu',
  'tools.audio.coverOrDropHere': 'ose lësho një imazh këtu',
  'a11y.allBlocksSelected': 'Të gjitha blloqet janë zgjedhur. Gjithsej: {count}',
  'a11y.blocksSelected': 'Blloqe të zgjedhura: {count}',
  'tools.video.pause': 'Pauzë',
  'tools.video.seek': 'Kërko në video',
  'tools.video.toggleTimeDisplay': 'Kalo midis kohës së kaluar dhe asaj të mbetur',
  'tools.video.mute': 'Çaktivizo zërin',
  'tools.video.unmute': 'Aktivizo zërin',
  'tools.video.theater': 'Modaliteti i teatrit',
  'tools.video.theaterExit': 'Dil nga modaliteti i teatrit',
  'tools.video.ctxCopyUrlAtTime': 'Kopjo URL-në e videos në pozicionin aktual të luajtjes',
  'tools.video.ctxStats': 'Statistikat e luajtjes',
  'tools.audio.pause': 'Pauzë',
  'tools.audio.mute': 'Çaktivizo zërin',
  'tools.audio.unmute': 'Aktivizo zërin',
  'tools.callout.emojiSearchResults': 'Përputhje për emoji: {count}',
};

const SERBIAN_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'Уклони форматирање',
  'tools.toggle.bodyPlaceholder':
    'Празан склопиви блок. Кликните за додавање блока или превуците блокове овде.',
  'toolbox.optionAddAbove': 'Држите тастер Option и кликните за додавање изнад',
  'toolbox.ctrlAddAbove': 'Држите тастер Ctrl и кликните за додавање изнад',
  'toolbox.typeToSearch': 'Унесите текст за претрагу',
  'tools.marker.textColor': 'Боја текста',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.colorPicker.color.gray': 'Сива',
  'tools.colorPicker.color.brown': 'Смеђа',
  'tools.colorPicker.color.orange': 'Наранџаста',
  'tools.colorPicker.color.yellow': 'Жута',
  'tools.colorPicker.color.green': 'Зелена',
  'tools.colorPicker.color.blue': 'Плава',
  'tools.colorPicker.color.purple': 'Љубичаста',
  'tools.colorPicker.color.pink': 'Ружичаста',
  'tools.colorPicker.color.red': 'Црвена',
  'tools.paragraph.placeholder': 'Напишите нешто или притисните / да бисте изабрали алатку',
  'tools.toggle.placeholder': 'Склопива листа',
  'tools.table.clearSelection': 'Очисти садржај',
  'a11y.dragHandle': 'Превуците за премештање блока или кликните да отворите мени',
  'a11y.dragStartedMultiple': 'Блокови који се превлаче: {count}',
  'a11y.dropPosition': 'Позиција испуштања: {position} од {total}',
  'a11y.blocksMoved': 'Премештени блокови: {count}. Нова позиција: {position}.',
  'a11y.blockDuplicated': 'Блок је дуплиран на позицији {position} од {total}',
  'a11y.blocksDuplicated': 'Дуплирани блокови: {count}. Почетна позиција: {position}.',
  'a11y.searchResults': 'Резултати претраге: {count}',
  'searchTerms.blockquote': 'цитатни блок',
  'tools.callout.addEmoji': 'Додај икону',
  'tools.callout.filterEmojis': 'Претражи емоџије…',
  'tools.callout.pickRandom': 'Изабери насумични емоџи',
  'tools.callout.colorGray': 'Сива',
  'tools.callout.colorBrown': 'Смеђа',
  'tools.callout.colorOrange': 'Наранџаста',
  'tools.callout.colorYellow': 'Жута',
  'tools.callout.colorGreen': 'Зелена',
  'tools.callout.colorBlue': 'Плава',
  'tools.callout.colorPurple': 'Љубичаста',
  'tools.callout.colorPink': 'Ружичаста',
  'tools.callout.colorRed': 'Црвена',
  'tools.table.placement': 'Поравнање',
  'blockSettings.blocksSelected': 'Изабрани блокови: {count}',
  'blockSettings.copyLinkSuccess': 'Веза је копирана у оставу',
  'blockSettings.copyLinkError': 'Није могуће копирати везу ка блоку',
  'tools.link.linkTitle': 'Текст везе',
  'tools.code.autoDetected': 'аутоматски',
  'tools.code.searchLanguage': 'Претражи језике…',
  'tools.image.toggleCaption': 'Прикажи или сакриј натпис',
  'tools.image.moreOptions': 'Још опција',
  'tools.image.previewControls': 'Контроле прегледа слике',
  'tools.image.navigationControls': 'Навигација између слика',
  'tools.image.errorDefaultMessage':
    'Слику није могуће учитати са овог URL-а. Покушајте са другим извором или поново отпремите датотеку.',
  'tools.image.cropReset': 'Врати исецање на почетно стање',
  'tools.database.viewTypeListDescription': 'Прикажи ставке у једноставној листи',
  'tools.database.listView': 'Приказ листе',
  'tools.database.cardDetails': 'Детаљи картице',
  'tools.bookmark.loading': 'Учитавање прегледа везе…',
  'tools.embed.empty': 'Нема везе за уграђивање',
  'tools.linkPaste.mention': 'Помени',
  'tools.file.toggleCaption': 'Прикажи или сакриј натпис',
  'tools.file.previewRender': 'Преглед',
  'tools.video.toggleCaption': 'Прикажи или сакриј натпис',
  'tools.video.moreOptions': 'Још опција',
  'tools.audio.emptyOrDropHere': 'или превуците аудио-датотеку овде',
  'tools.audio.emptyUrlPlaceholder': 'Налепите URL аудио-записа…',
  'tools.audio.emptyUrlAria': 'URL аудио-записа',
  'tools.audio.emptySourceAria': 'Извор аудио-записа',
  'tools.audio.coverSourceAria': 'Извор омота',
  'a11y.allBlocksSelected': 'Изабрани су сви блокови. Укупно: {count}.',
  'a11y.blocksSelected': 'Изабрани блокови: {count}',
  'a11y.navigationModeEntered':
    'Режим навигације. Користите тастере са стрелицама за кретање између блокова, Enter за уређивање, Escape за излаз.',
  'a11y.navigationModeExited': 'Изашли сте из режима навигације',
  'a11y.navigatedToBlock': 'Прешли сте на блок',
  'a11y.dropCreateColumnLeft': 'Биће додата колона са леве стране',
  'a11y.dropCreateColumnRight': 'Биће додата колона са десне стране',
  'tools.video.seek': 'Позиција репродукције',
  'tools.video.toggleTimeDisplay': 'Пребаци између протеклог и преосталог времена',
  'tools.video.ctxCopyUrl': 'Копирај URL видеа',
  'tools.video.ctxCopyUrlAtTime': 'Копирај URL видеа са тренутном временском ознаком',
  'tools.video.ctxStats': 'Статистика репродукције',
  'tools.callout.emojiSearchResults': 'Број подударних емоџија: {count}',
};

const SWAHILI_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'Ondoa uumbizaji',
  'tools.toggle.bodyPlaceholder': 'Kinachokunjuka ni kitupu. Bofya ili kuongeza kizuizi au buruta vizuizi hapa.',
  'toolbox.typeToSearch': 'Andika ili kutafuta',
  'toolNames.bold': 'Koza',
  'tools.marker.textColor': 'Rangi ya maandishi',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.paragraph.placeholder': 'Andika kitu au bonyeza / ili kuchagua zana',
  'tools.table.clearSelection': 'Futa yaliyomo',
  'tools.table.compactText': 'Maandishi yaliyobanana',
  'tools.table.comfortableText': 'Maandishi yenye nafasi',
  'blockSettings.lastEdited': 'Kimehaririwa mara ya mwisho',
  'blockSettings.lastEditedBy': 'Kimehaririwa mara ya mwisho na {name}',
  'a11y.dragStarted': 'Kizuizi kinaburutwa',
  'a11y.dragStartedMultiple': 'Vizuizi {count} vinaburutwa',
  'a11y.dropPosition': 'Nafasi ya kudondosha: {position} kati ya {total}',
  'a11y.blockDuplicated': 'Kizuizi kimerudufiwa katika nafasi {position} kati ya {total}',
  'a11y.blocksDuplicated': 'Vizuizi {count} vimerudufiwa kuanzia nafasi {position}',
  'a11y.searchResults': 'Matokeo ya utafutaji: {count}',
  'tools.columns.col2': 'Safu wima mbili',
  'tools.columns.col3': 'Safu wima tatu',
  'tools.columns.col4': 'Safu wima nne',
  'tools.columns.col5': 'Safu wima tano',
  'tools.columns.resizeAriaLabel': 'Badilisha ukubwa wa safu wima',
  'tools.columns.turnInto': 'Badilisha kuwa safu wima',
  'searchTerms.columns': 'safu wima',
  'searchTerms.delimiter': 'kitenganishi',
  'searchTerms.checkbox': 'kisanduku tiki',
  'searchTerms.accordion': 'akodioni',
  'tools.callout.addEmoji': 'Ongeza ikoni',
  'tools.callout.filterEmojis': 'Tafuta emoji…',
  'tools.callout.pickRandom': 'Chagua emoji bila mpangilio',
  'tools.callout.emojiCategoryPeople': 'Nyuso zenye tabasamu na watu',
  'tools.database.addColumn': 'Ongeza safu wima',
  'tools.database.columnTitlePlaceholder': 'Safu wima',
  'tools.database.deleteColumn': 'Futa safu wima',
  'tools.database.renameColumn': 'Badilisha jina la safu wima',
  'tools.callout.colorTeal': 'Kijani kibluu',
  'tools.code.previewTab': 'Onyesho la awali',
  'tools.table.placement': 'Mpangilio',
  'tools.code.copied': 'Msimbo umenakiliwa!',
  'tools.code.searchLanguage': 'Tafuta lugha…',
  'searchTerms.pre': 'maandishi yaliyopangwa awali',
  'blockSettings.copyLinkError': 'Imeshindikana kunakili kiungo cha kizuizi',
  'tools.link.urlCopied': 'Kiungo kimenakiliwa kwenye ubao wa kunakili',
  'tools.link.linkTitle': 'Maandishi ya kiungo',
  'tools.image.downloadOriginal': 'Pakua picha ya asili',
  'tools.image.moreOptions': 'Chaguo zaidi',
  'tools.image.altDescription': 'Eleza picha hii kwa watu ambao hawawezi kuiona.',
  'tools.image.preview': 'Onyesho la awali la picha',
  'tools.image.previewControls': 'Vidhibiti vya onyesho la awali la picha',
  'tools.image.zoomIn': 'Kuza',
  'tools.image.zoomOut': 'Punguza',
  'tools.image.errorSourceOffline': 'Faili ya chanzo huenda imehamishwa au haipo mtandaoni.',
  'tools.image.errorDefaultTitle': 'Imeshindikana kupakia picha',
  'tools.image.errorDefaultMessage': 'Picha haikuweza kupakiwa kutoka kwenye URL hii. Jaribu chanzo tofauti au upakie faili tena.',
  'tools.image.cropAspectRatio': 'Umbo la kukata picha',
  'tools.image.cropRatioOval': 'Duaradufu',
  'tools.image.cropDone': 'Maliza',
  'tools.database.viewTypeListDescription': 'Onyesha vipengee katika orodha rahisi',
  'tools.database.propertyTypeSelect': 'Chaguo',
  'tools.database.propertyTypeMultiSelect': 'Chaguo nyingi',
  'tools.bookmark.loading': 'Inapakia onyesho la awali la kiungo…',
  'tools.bookmark.error': 'Imeshindwa kupakia onyesho la awali la kiungo',
  'tools.embed.empty': 'Hakuna kiungo cha kupachika',
  'tools.file.previewRender': 'Onyesho la awali',
  'tools.video.alignmentLeft': 'Panga kushoto',
  'tools.video.alignmentCenter': 'Panga katikati',
  'tools.video.alignmentRight': 'Panga kulia',
  'tools.video.moreOptions': 'Chaguo zaidi',
  'tools.audio.alignmentLeft': 'Panga kushoto',
  'tools.audio.alignmentCenter': 'Panga katikati',
  'tools.audio.alignmentRight': 'Panga kulia',
  'tools.audio.errorFileTooLarge': 'Faili ya sauti ni kubwa mno. {size} imezidi kikomo cha {max}.',
  'tools.audio.emptyOrDropHere': 'au dondosha faili ya sauti hapa',
  'tools.audio.coverSourceAria': 'Chanzo cha jalada',
  'a11y.allBlocksSelected': 'Vizuizi vyote vimechaguliwa. Jumla: {count}',
  'a11y.blocksSelected': 'Idadi ya vizuizi vilivyochaguliwa: {count}',
  'a11y.navigationModeEntered': 'Hali ya usogezaji. Tumia vitufe vya mishale kusogea kati ya vizuizi, Enter kuhariri na Escape kutoka.',
  'a11y.navigationModeExited': 'Umetoka kwenye hali ya usogezaji',
  'a11y.dropCreateColumnLeft': 'Safu wima itaundwa upande wa kushoto',
  'a11y.dropCreateColumnRight': 'Safu wima itaundwa upande wa kulia',
  'tools.video.pause': 'Sitisha',
  'tools.video.seek': 'Nafasi ya uchezaji',
  'tools.video.toggleTimeDisplay': 'Badilisha kati ya muda uliopita na muda uliosalia',
  'tools.video.volume': 'Kiwango cha sauti',
  'tools.video.theaterExit': 'Toka kwenye hali ya sinema',
  'tools.video.ctxCopyUrlAtTime': 'Nakili URL ya video katika muda wa sasa wa uchezaji',
  'tools.video.ctxStats': 'Takwimu za uchezaji',
  'tools.audio.pause': 'Sitisha',
  'tools.audio.volume': 'Kiwango cha sauti',
  'tools.callout.emojiSearchResults': 'Emoji zinazolingana: {count}',
  'tools.database.checkboxChecked': 'Kimewekewa tiki',
  'tools.database.checkboxUnchecked': 'Hakijawekewa tiki',
};

const TAMIL_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'வடிவமைப்பை அகற்று',
  'tools.toggle.bodyPlaceholder': 'காலி மடிப்பு. ஒரு தொகுதியைச் சேர்க்க கிளிக் செய்யவும் அல்லது தொகுதிகளை இங்கே இழுக்கவும்.',
  'blockSettings.clickToOpenMenu': 'மெனுவைத் திறக்க கிளிக் செய்யவும்',
  'blockSettings.clickAction': 'மெனுவைத் திறக்க கிளிக் செய்யவும்',
  'blockSettings.orConjunction': ' அல்லது ',
  'blockSettings.openMenuAction': ' விசைகளை அழுத்தவும்',
  'toolbox.addBelow': 'கீழே சேர்க்க கிளிக் செய்யவும்',
  'toolbox.optionAddAbove': 'மேலே சேர்க்க Option விசையை அழுத்திப் பிடித்துக் கிளிக் செய்யவும்',
  'toolbox.ctrlAddAbove': 'மேலே சேர்க்க Ctrl விசையை அழுத்திப் பிடித்துக் கிளிக் செய்யவும்',
  'toolbox.typeToSearch': 'தேடுவதற்குத் தட்டச்சு செய்யவும்',
  'popover.convertTo': 'இதற்கு மாற்று',
  'toolNames.bold': 'தடித்த எழுத்து',
  'tools.marker.textColor': 'உரை நிறம்',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.stub.blockCannotBeDisplayed': 'இந்தத் தொகுதியைக் காட்ட முடியாது',
  'tools.paragraph.placeholder': 'ஏதாவது எழுதவும் அல்லது கருவியைத் தேர்ந்தெடுக்க / விசையை அழுத்தவும்',
  'tools.table.clearSelection': 'உள்ளடக்கத்தை அழி',
  'tools.table.insertColumnLeft': 'இடப்புறத்தில் நெடுவரிசையைச் செருகு',
  'tools.table.insertColumnRight': 'வலப்புறத்தில் நெடுவரிசையைச் செருகு',
  'tools.table.insertRowAbove': 'மேலே வரிசையைச் செருகு',
  'tools.table.insertRowBelow': 'கீழே வரிசையைச் செருகு',
  'tools.table.clickToAddRow': 'புதிய வரிசையைச் சேர்க்க கிளிக் செய்யவும்',
  'tools.table.clickToAddColumn': 'புதிய நெடுவரிசையைச் சேர்க்க கிளிக் செய்யவும்',
  'tools.table.fitToPageWidth': 'பக்க அகலத்திற்குப் பொருத்து',
  'tools.table.compactText': 'இறுக்கமான உரை',
  'tools.table.comfortableText': 'இடைவெளியுள்ள உரை',
  'tools.table.placement': 'சீரமைப்பு',
  'blockSettings.lastEditedBy': 'கடைசியாகத் திருத்தியவர்: {name}',
  'a11y.dragHandle': 'தொகுதியை நகர்த்த இழுக்கவும் அல்லது மெனுவைத் திறக்க கிளிக் செய்யவும்',
  'a11y.dragStarted': 'தொகுதி இழுக்கப்படுகிறது',
  'a11y.dragStartedMultiple': 'இழுக்கப்படுகின்ற தொகுதிகள்: {count}',
  'a11y.dropPosition': 'மொத்த இடங்கள்: {total}. விடப்படும் இடம்: {position}.',
  'a11y.blockMoved': 'தொகுதி நகர்த்தப்பட்டது. நிலை: {position}. மொத்தம்: {total}.',
  'a11y.blocksMoved': 'நகர்த்தப்பட்ட தொகுதிகள்: {count}. நிலை: {position}.',
  'a11y.blockDuplicated': 'தொகுதி நகலெடுக்கப்பட்டது. நிலை: {position}. மொத்தம்: {total}.',
  'a11y.blocksDuplicated': 'நகலெடுக்கப்பட்ட தொகுதிகள்: {count}. தொடக்க நிலை: {position}.',
  'a11y.searchResults': 'தேடல் முடிவுகள்: {count}',
  'a11y.allBlocksSelected': 'அனைத்துத் தொகுதிகளும் தேர்ந்தெடுக்கப்பட்டன. மொத்தம்: {count}',
  'a11y.blocksSelected': 'தேர்ந்தெடுக்கப்பட்ட தொகுதிகள்: {count}',
  'a11y.navigationModeEntered': 'வழிசெலுத்தல் பயன்முறை. தொகுதிகளுக்கு இடையே செல்ல அம்புக்குறி விசைகளைப் பயன்படுத்தவும். திருத்துவதற்கு Enter விசையையும், வெளியேறுவதற்கு Escape விசையையும் அழுத்தவும்.',
  'a11y.navigationModeExited': 'வழிசெலுத்தல் பயன்முறை முடிந்தது',
  'a11y.navigationPosition': '{tool}. நிலை: {position}. மொத்தம்: {total}.',
  'a11y.navigatedToBlock': 'தொகுதிக்கு வழிசெலுத்தப்பட்டது',
  'a11y.dropCreateColumnLeft': 'இடப்புறத்தில் ஒரு நெடுவரிசை உருவாக்கப்படும்',
  'a11y.dropCreateColumnRight': 'வலப்புறத்தில் ஒரு நெடுவரிசை உருவாக்கப்படும்',
  'a11y.blockToolbar': 'தொகுதிக் கருவிப்பட்டை',
  'toolNames.strikethrough': 'குறுக்குக்கோடு',
  'searchTerms.gap': 'இடைவு',
  'searchTerms.collapsible': 'மடிக்கக்கூடிய',
  'tools.callout.addEmoji': 'ஐகானைச் சேர்',
  'tools.callout.filterEmojis': 'எமோஜிகளைத் தேடு…',
  'tools.callout.noEmojisFound': 'எமோஜிகள் எதுவும் கிடைக்கவில்லை',
  'tools.callout.pickRandom': 'சீரற்ற எமோஜியைத் தேர்ந்தெடு',
  'tools.callout.emojiCategoryActivity': 'செயல்பாடுகள்',
  'tools.callout.emojiCategoryObjects': 'பொருட்கள்',
  'toolNames.inlineCode': 'வரிக்குள் குறியீடு',
  'tools.code.placeholder': 'குறியீட்டை எழுதவும்…',
  'tools.code.wrapLines': 'வரிகளை மடக்கு',
  'tools.code.searchLanguage': 'மொழிகளைத் தேடு…',
  'tools.code.sideBySide': 'அருகருகே',
  'blockSettings.blocksSelected': 'தொகுதிகள்: {count}',
  'tools.link.jumpToSection': 'பிரிவுக்குச் செல்',
  'tools.link.linkTitle': 'இணைப்பு உரை',
  'tools.image.toggleCaption': 'தலைப்புரையைக் காட்டு அல்லது மறை',
  'tools.image.captionPlaceholder': 'தலைப்புரையை எழுதவும்…',
  'tools.image.crop': 'செதுக்கு',
  'tools.image.viewFullscreen': 'முழுத் திரையில் பார்',
  'tools.image.exitFullscreen': 'முழுத் திரையிலிருந்து வெளியேறு',
  'tools.image.uploading': 'பதிவேற்றப்படுகிறது…',
  'tools.image.uploadingLabel': 'பதிவேற்றப்படுகிறது',
  'tools.image.altEdit': 'மாற்று உரையைத் திருத்து',
  'tools.image.altDescription': 'இந்தப் படத்தைப் பார்க்க முடியாதவர்களுக்காக இதை விவரிக்கவும்.',
  'tools.image.altPlaceholder': 'மாற்று உரை',
  'tools.image.preview': 'பட முன்னோட்டம்',
  'tools.image.previewControls': 'பட முன்னோட்டக் கட்டுப்பாடுகள்',
  'tools.image.errorUploadFailed': 'பதிவேற்றம் தோல்வியடைந்தது',
  'tools.image.errorUploadFailedTitle': 'பதிவேற்றம் தோல்வியடைந்தது',
  'tools.image.errorSourceOffline': 'மூலக் கோப்பு நகர்த்தப்பட்டிருக்கலாம் அல்லது கிடைக்காமல் இருக்கலாம்.',
  'tools.image.errorDefaultMessage': 'இந்த URL-இலிருந்து படத்தை ஏற்ற முடியவில்லை. வேறு மூலத்தை முயற்சிக்கவும் அல்லது கோப்பை மீண்டும் பதிவேற்றவும்.',
  'tools.image.emptyDropToUpload': 'பதிவேற்றுவதற்கு இங்கே விடவும்',
  'tools.image.cropAspectRatio': 'செதுக்கும் வடிவம்',
  'tools.image.cropDialogLabel': 'படத்தைச் செதுக்கு',
  'tools.file.emptyDropToUpload': 'பதிவேற்றுவதற்கு இங்கே விடவும்',
  'tools.file.uploading': 'பதிவேற்றப்படுகிறது…',
  'tools.file.toggleCaption': 'தலைப்புரையைக் காட்டு அல்லது மறை',
  'tools.file.captionPlaceholder': 'தலைப்புரையை எழுதவும்…',
  'tools.file.errorUploadFailed': 'பதிவேற்றம் தோல்வியடைந்தது',
  'tools.file.previewRaw': 'மூல உரை',
  'tools.file.previewRender': 'முன்னோட்டம்',
  'tools.video.alignmentLeft': 'இடப்புறம் சீரமை',
  'tools.video.alignmentCenter': 'மையமாகச் சீரமை',
  'tools.video.alignmentRight': 'வலப்புறம் சீரமை',
  'tools.video.captionPlaceholder': 'தலைப்புரையை எழுதவும்…',
  'tools.video.toggleCaption': 'தலைப்புரையைக் காட்டு அல்லது மறை',
  'tools.video.loop': 'மீண்டும் மீண்டும் இயக்கு',
  'tools.video.uploading': 'பதிவேற்றப்படுகிறது…',
  'tools.video.errorUploadFailed': 'பதிவேற்றம் தோல்வியடைந்தது',
  'tools.video.emptyDropToUpload': 'பதிவேற்றுவதற்கு இங்கே விடவும்',
  'tools.audio.alignmentLeft': 'இடப்புறம் சீரமை',
  'tools.audio.alignmentCenter': 'மையமாகச் சீரமை',
  'tools.audio.alignmentRight': 'வலப்புறம் சீரமை',
  'tools.audio.captionPlaceholder': 'தலைப்புரையை எழுதவும்…',
  'tools.audio.loop': 'மீண்டும் மீண்டும் இயக்கு',
  'tools.audio.uploading': 'பதிவேற்றப்படுகிறது…',
  'tools.audio.errorUploadFailed': 'பதிவேற்றம் தோல்வியடைந்தது',
  'tools.audio.emptyOrDropHere': 'அல்லது ஒலிக் கோப்பை இங்கே விடவும்',
  'tools.audio.emptyDropToUpload': 'பதிவேற்றுவதற்கு இங்கே விடவும்',
  'tools.audio.coverChange': 'அட்டைப்படத்தை மாற்று',
  'tools.audio.coverSet': 'அட்டைப்படத்தை அமை',
  'tools.audio.coverRemove': 'அட்டைப்படத்தை அகற்று',
  'tools.audio.coverAdd': 'அட்டைப்படத்தைச் சேர்',
  'tools.audio.coverDropToUpload': 'பதிவேற்றுவதற்கு இங்கே விடவும்',
  'tools.audio.coverSourceAria': 'அட்டைப்பட மூலம்',
  'tools.database.viewTypeListDescription': 'உருப்படிகளை எளிய பட்டியலில் காட்டு',
  'tools.database.propertyTypeCheckbox': 'தேர்வுப்பெட்டி',
  'tools.bookmark.loading': 'இணைப்பு முன்னோட்டம் ஏற்றப்படுகிறது…',
  'tools.embed.empty': 'உட்பொதி இணைப்பு இல்லை',
  'tools.linkPaste.embed': 'உட்பொதியை உருவாக்கு',
  'notifier.dismiss': 'மூடு',
  'tools.video.seek': 'இயக்க நிலை',
  'tools.video.seekValueText': 'தற்போது {current}; மொத்தம் {total}',
  'tools.video.toggleTimeDisplay': 'கழிந்த நேரத்திற்கும் மீதமுள்ள நேரத்திற்கும் இடையே மாற்று',
  'tools.video.ctxCopyUrlAtTime': 'தற்போதைய இயக்க நிலையில் வீடியோ URL-ஐ நகலெடு',
  'tools.video.ctxStats': 'இயக்கப் புள்ளிவிவரங்கள்',
  'tools.callout.emojiSearchResults': 'பொருந்தும் எமோஜிகள்: {count}',
  'tools.database.openRow': 'வரிசையைத் திற',
  'tools.image.alignmentCenterAria': 'மையமாகச் சீரமை',
};

const TELUGU_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'ఫార్మాటింగ్‌ను తొలగించు',
  'tools.toggle.bodyPlaceholder': 'ఖాళీ మడత. బ్లాక్‌ను జోడించడానికి నొక్కండి లేదా బ్లాక్‌లను ఇక్కడికి లాగండి.',
  'blockSettings.orConjunction': ' లేదా ',
  'blockSettings.openMenuAction': ' నొక్కి మెనూను తెరవండి',
  'toolNames.bold': 'బోల్డ్',
  'toolNames.italic': 'ఇటాలిక్',
  'tools.marker.textColor': 'టెక్స్ట్ రంగు',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.stub.blockCannotBeDisplayed': 'ఈ బ్లాక్‌ను ప్రదర్శించలేము',
  'tools.paragraph.placeholder': 'ఏదైనా రాయండి లేదా సాధనాన్ని ఎంచుకోవడానికి / నొక్కండి',
  'tools.table.clearSelection': 'కంటెంట్‌ను క్లియర్ చేయి',
  'tools.table.placement': 'సమలేఖనం',
  'a11y.dragHandle': 'బ్లాక్‌ను తరలించడానికి లాగండి లేదా మెనూ కోసం నొక్కండి',
  'a11y.dragStarted': 'బ్లాక్‌ను లాగుతున్నారు',
  'a11y.dragStartedMultiple': '{count} బ్లాక్‌లను లాగుతున్నారు',
  'a11y.dropPosition': 'వదలబడే స్థానం: {position}. మొత్తం: {total}.',
  'a11y.blockMoved': 'బ్లాక్ తరలించబడింది. స్థానం: {position}. మొత్తం: {total}.',
  'a11y.blocksMoved': '{count} బ్లాక్‌లు {position}వ స్థానానికి తరలించబడ్డాయి',
  'a11y.blockDuplicated': 'బ్లాక్ నకలు చేయబడింది. స్థానం: {position}. మొత్తం: {total}.',
  'a11y.blocksDuplicated': '{count} బ్లాక్‌లు {position}వ స్థానం నుంచి ప్రారంభమయ్యేలా నకలు చేయబడ్డాయి',
  'a11y.searchResults': 'శోధన ఫలితాలు: {count}',
  'a11y.allBlocksSelected': 'అన్ని బ్లాక్‌లు ఎంపికయ్యాయి. మొత్తం: {count}',
  'a11y.blocksSelected': 'ఎంపికైన బ్లాక్‌ల సంఖ్య: {count}',
  'a11y.navigationModeEntered': 'నావిగేషన్ మోడ్. బ్లాక్‌ల మధ్య కదలడానికి బాణం కీలను, సవరించడానికి Enterను, నిష్క్రమించడానికి Escapeను ఉపయోగించండి.',
  'a11y.navigatedToBlock': 'బ్లాక్‌కు వెళ్లారు',
  'searchTerms.delimiter': 'డెలీమీటర్',
  'tools.callout.addEmoji': 'చిహ్నాన్ని జోడించండి',
  'tools.callout.filterEmojis': 'ఎమోజీలను వెతకండి…',
  'tools.callout.pickRandom': 'యాదృచ్ఛిక ఎమోజీని ఎంచుకోండి',
  'tools.code.wrapLines': 'లైన్‌లను చుట్టు',
  'tools.code.searchLanguage': 'భాషలను వెతకండి…',
  'tools.code.previewTab': 'ప్రివ్యూ',
  'tools.code.lineNumbers': 'లైన్ నంబర్‌లు',
  'searchTerms.snippet': 'కోడ్ స్నిప్పెట్',
  'searchTerms.pre': 'ముందే ఫార్మాట్ చేసిన వచనం',
  'tools.link.linkTitle': 'లింక్ వచనం',
  'tools.image.caption': 'క్యాప్షన్',
  'tools.image.toggleCaption': 'క్యాప్షన్‌ను చూపు లేదా దాచు',
  'tools.image.captionPlaceholder': 'క్యాప్షన్ రాయండి…',
  'tools.image.altDescription': 'ఈ చిత్రాన్ని చూడలేని వ్యక్తుల కోసం వివరించండి.',
  'tools.image.previewControls': 'చిత్ర ప్రివ్యూ నియంత్రణలు',
  'tools.image.errorImageFailedToLoad': 'చిత్రం లోడ్ కాలేదు',
  'tools.image.errorDefaultMessage': 'ఈ URL నుంచి చిత్రాన్ని లోడ్ చేయలేకపోయాము. వేరే మూలాన్ని ప్రయత్నించండి లేదా ఫైల్‌ను మళ్లీ అప్‌లోడ్ చేయండి.',
  'tools.file.toggleCaption': 'క్యాప్షన్‌ను చూపు లేదా దాచు',
  'tools.file.captionPlaceholder': 'క్యాప్షన్ రాయండి…',
  'tools.file.preview': 'ప్రివ్యూ',
  'tools.file.previewClose': 'ప్రివ్యూను మూసివేయి',
  'tools.file.previewRaw': 'మూలం',
  'tools.file.previewRender': 'ప్రివ్యూ',
  'tools.file.previewLoading': 'ప్రివ్యూ లోడ్ అవుతోంది…',
  'tools.file.previewError': 'ప్రివ్యూను లోడ్ చేయడం సాధ్యం కాలేదు',
  'tools.file.previewBackToContent': 'కంటెంట్‌కు తిరిగి వెళ్లు',
  'tools.video.alignmentLeft': 'ఎడమవైపు సమలేఖనం చేయి',
  'tools.video.alignmentCenter': 'మధ్యలో సమలేఖనం చేయి',
  'tools.video.alignmentRight': 'కుడివైపు సమలేఖనం చేయి',
  'tools.video.caption': 'క్యాప్షన్',
  'tools.video.captionPlaceholder': 'క్యాప్షన్ రాయండి…',
  'tools.video.toggleCaption': 'క్యాప్షన్‌ను చూపు లేదా దాచు',
  'tools.audio.alignmentLeft': 'ఎడమవైపు సమలేఖనం చేయి',
  'tools.audio.alignmentCenter': 'మధ్యలో సమలేఖనం చేయి',
  'tools.audio.alignmentRight': 'కుడివైపు సమలేఖనం చేయి',
  'tools.audio.caption': 'క్యాప్షన్',
  'tools.audio.captionPlaceholder': 'క్యాప్షన్ రాయండి…',
  'tools.audio.emptyOrDropHere': 'లేదా ఇక్కడ ఆడియో ఫైల్‌ను వదలండి',
  'tools.audio.coverSourceAria': 'కవర్ మూలం',
  'tools.database.duplicateView': 'నకలు చేయి',
  'tools.database.viewTypeListDescription': 'అంశాలను సరళమైన జాబితాలో చూపండి',
  'tools.bookmark.loading': 'లింక్ ప్రివ్యూ లోడ్ అవుతోంది…',
  'tools.embed.empty': 'పొందుపరచడానికి లింక్ లేదు',
  'tools.embed.captionPlaceholder': 'క్యాప్షన్ రాయండి…',
  'tools.video.seek': 'ప్లేబ్యాక్ స్థానం',
  'tools.video.toggleTimeDisplay': 'గడిచిన సమయం మరియు మిగిలిన సమయం మధ్య మార్చు',
  'tools.video.ctxCopyUrlAtTime': 'ప్రస్తుత ప్లేబ్యాక్ సమయానికి వీడియో URLని కాపీ చేయి',
  'tools.video.ctxStats': 'ప్లేబ్యాక్ గణాంకాలు',
  'tools.callout.emojiSearchResults': 'సరిపోలే ఎమోజీల సంఖ్య: {count}',
};

const THAI_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'ล้างการจัดรูปแบบ',
  'tools.toggle.bodyPlaceholder': 'ส่วนที่พับได้นี้ว่างเปล่า คลิกเพื่อเพิ่มบล็อก หรือลากบล็อกมาที่นี่',
  'tools.marker.textColor': 'สีข้อความ',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.table.clearSelection': 'ล้างเนื้อหา',
  'tools.table.fitToPageWidth': 'ปรับให้พอดีกับความกว้างของหน้า',
  'tools.table.fullWidth': 'เต็มความกว้าง',
  'tools.table.placement': 'การจัดแนว',
  'tools.table.placementTopLeft': 'ซ้ายบน',
  'tools.table.placementTopCenter': 'กึ่งกลางด้านบน',
  'tools.table.placementTopRight': 'ขวาบน',
  'tools.table.placementMiddleLeft': 'กึ่งกลางด้านซ้าย',
  'tools.table.placementMiddleCenter': 'กึ่งกลาง',
  'tools.table.placementMiddleRight': 'กึ่งกลางด้านขวา',
  'tools.table.placementBottomLeft': 'ซ้ายล่าง',
  'tools.table.placementBottomCenter': 'กึ่งกลางด้านล่าง',
  'tools.table.placementBottomRight': 'ขวาล่าง',
  'a11y.blockMoved': 'ย้ายบล็อกไปยังตำแหน่ง {position} จากทั้งหมด {total} แล้ว',
  'a11y.blocksMoved': 'ย้ายบล็อก {count} บล็อกไปยังตำแหน่ง {position} แล้ว',
  'a11y.blockDuplicated': 'ทำสำเนาบล็อกไว้ที่ตำแหน่ง {position} จากทั้งหมด {total} แล้ว',
  'a11y.blocksDuplicated': 'ทำสำเนาบล็อก {count} บล็อกโดยเริ่มที่ตำแหน่ง {position} แล้ว',
  'a11y.searchResults': 'ผลการค้นหา: {count} รายการ',
  'a11y.allBlocksSelected': 'เลือกบล็อกทั้งหมดแล้ว จำนวนรวม: {count}',
  'a11y.navigationModeEntered': 'โหมดนำทาง ใช้ปุ่มลูกศรเพื่อย้ายระหว่างบล็อก กด Enter เพื่อแก้ไข และกด Escape เพื่อออก',
  'toolNames.quote': 'ข้อความอ้างอิง',
  'searchTerms.quote': 'ข้อความอ้างอิง',
  'searchTerms.blockquote': 'บล็อกข้อความอ้างอิง',
  'tools.callout.addEmoji': 'เพิ่มไอคอน',
  'tools.callout.filterEmojis': 'ค้นหาอีโมจิ…',
  'tools.callout.noEmojisFound': 'ไม่พบอีโมจิ',
  'tools.callout.pickRandom': 'สุ่มเลือกอีโมจิ',
  'tools.quote.size': 'ขนาดข้อความอ้างอิง',
  'tools.quote.placeholder': 'ข้อความอ้างอิง',
  'tools.code.searchLanguage': 'ค้นหาภาษา…',
  'searchTerms.pre': 'ข้อความจัดรูปแบบล่วงหน้า',
  'tools.link.linkTitle': 'ข้อความลิงก์',
  'tools.image.alignment': 'การจัดแนว',
  'tools.image.altDescription': 'อธิบายรูปภาพนี้สำหรับผู้ที่มองไม่เห็น',
  'tools.image.preview': 'ตัวอย่างรูปภาพ',
  'tools.image.previewControls': 'ตัวควบคุมตัวอย่างรูปภาพ',
  'tools.image.errorUnavailable': 'รูปภาพไม่พร้อมใช้งาน',
  'tools.image.errorDefaultMessage': 'ไม่สามารถโหลดรูปภาพจาก URL นี้ได้ ลองใช้แหล่งที่มาอื่นหรืออัปโหลดไฟล์อีกครั้ง',
  'tools.video.alignment': 'การจัดแนว',
  'tools.video.alignmentLeft': 'จัดชิดซ้าย',
  'tools.video.alignmentCenter': 'จัดกึ่งกลาง',
  'tools.video.alignmentRight': 'จัดชิดขวา',
  'tools.audio.alignment': 'การจัดแนว',
  'tools.audio.alignmentLeft': 'จัดชิดซ้าย',
  'tools.audio.alignmentCenter': 'จัดกึ่งกลาง',
  'tools.audio.alignmentRight': 'จัดชิดขวา',
  'tools.audio.errorFileTooLarge': 'ไฟล์เสียงมีขนาดใหญ่เกินไป {size} เกินขีดจำกัด {max}',
  'tools.audio.titlePlaceholder': 'ชื่อแทร็ก',
  'tools.audio.emptyOrDropHere': 'หรือวางไฟล์เสียงที่นี่',
  'tools.audio.coverSourceAria': 'แหล่งที่มาของภาพปก',
  'tools.database.viewTypeListDescription': 'แสดงข้อมูลเป็นรายการแบบเรียบง่าย',
  'tools.bookmark.loading': 'กำลังโหลดตัวอย่างลิงก์…',
  'tools.embed.empty': 'ไม่มีลิงก์สำหรับฝัง',
  'tools.video.seek': 'ตำแหน่งการเล่น',
  'tools.video.toggleTimeDisplay': 'สลับระหว่างเวลาที่ผ่านไปและเวลาที่เหลือ',
  'tools.video.ctxCopyUrlAtTime': 'คัดลอก URL ของวิดีโอ ณ ตำแหน่งการเล่นปัจจุบัน',
  'tools.video.ctxStats': 'สถิติการเล่น',
  'tools.callout.emojiSearchResults': 'อีโมจิที่ตรงกัน: {count} รายการ',
};

const TURKISH_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'blockSettings.clickAction': 'Menüyü açmak için tıkla',
  'blockSettings.orConjunction': ' veya ',
  'blockSettings.openMenuAction': ' kısayoluna bas',
  'blockSettings.convertWithChildrenWarning': 'İç içe bloklar: {count}. Bu blok dönüştürüldüğünde içindeki bloklar en üst düzeye taşınacak. Devam edilsin mi?',
  'toolbox.optionAddAbove': 'Üste eklemek için ⌥ tuşunu basılı tutup tıkla',
  'toolbox.ctrlAddAbove': 'Üste eklemek için Ctrl tuşunu basılı tutup tıkla',
  'tools.marker.textColor': 'Metin rengi',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.paragraph.placeholder': 'Bir şeyler yazın veya bir araç seçmek için / tuşuna basın',
  'tools.toggle.bodyPlaceholder': 'Boş açılır blok. Blok eklemek için tıklayın veya blokları buraya sürükleyin.',
  'tools.table.clearSelection': 'İçeriği temizle',
  'tools.table.placement': 'Hizalama',
  'blockSettings.copyLink': 'Blok bağlantısını kopyala',
  'a11y.searchResults': 'Arama sonuçları: {count}',
  'toolNames.clearFormat': 'Biçimlendirmeyi temizle',
  'tools.callout.addEmoji': 'Simge ekle',
  'tools.callout.filterEmojis': 'Emoji ara…',
  'tools.callout.pickRandom': 'Rastgele bir emoji seç',
  'tools.link.linkTitle': 'Bağlantı metni',
  'tools.image.errorFileTooLarge': 'Görsel çok büyük. {size} boyutuyla {max} sınırını aşıyor.',
  'tools.image.errorDefaultMessage': 'Görsel bu URL\'den yüklenemedi. Farklı bir kaynak deneyin veya dosyayı yeniden yükleyin.',
  'tools.image.emptyMaxSize': 'en fazla {size}',
  'tools.file.errorFileTooLarge': 'Dosya çok büyük. {size} boyutuyla {max} sınırını aşıyor.',
  'tools.file.previewRender': 'Önizleme',
  'tools.video.alignmentLeft': 'Sola hizala',
  'tools.video.alignmentCenter': 'Ortaya hizala',
  'tools.video.alignmentRight': 'Sağa hizala',
  'tools.video.errorFileTooLarge': 'Video çok büyük. {size} boyutuyla {max} sınırını aşıyor.',
  'tools.video.emptyMaxSize': 'en fazla {size}',
  'tools.audio.alignmentLeft': 'Sola hizala',
  'tools.audio.alignmentCenter': 'Ortaya hizala',
  'tools.audio.alignmentRight': 'Sağa hizala',
  'tools.audio.errorFileTooLarge': 'Ses dosyası çok büyük. {size} boyutuyla {max} sınırını aşıyor.',
  'tools.audio.emptyMaxSize': 'en fazla {size}',
  'tools.audio.coverSourceAria': 'Kapak kaynağı',
  'tools.database.viewTypeListDescription': 'Öğeleri basit bir listede göster',
  'tools.embed.empty': 'Yerleştirme bağlantısı yok',
  'tools.video.toggleTimeDisplay': 'Geçen ve kalan süre arasında geçiş yap',
  'tools.video.ctxStats': 'Oynatma istatistikleri',
};

const UYGHUR_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'toolNames.clearFormat': 'پىچىمنى چىقىرىۋەت',
  'toolbox.optionAddAbove': 'ئۈستىگە قوشۇش ئۈچۈن Option نى بېسىپ تۇرۇپ چېكىڭ',
  'toolbox.ctrlAddAbove': 'ئۈستىگە قوشۇش ئۈچۈن Ctrl نى بېسىپ تۇرۇپ چېكىڭ',
  'tools.marker.textColor': 'تېكىست رەڭگى',
  'tools.colorPicker.defaultSwatchLabel': '{default} {mode}',
  'tools.colorPicker.colorSwatchLabel': '{color} {mode}',
  'tools.toggle.bodyPlaceholder': 'بوش يىغىلما. بىر بۆلەك قوشۇش ئۈچۈن چېكىڭ ياكى بۆلەكلەرنى بۇ يەرگە سۆرەڭ.',
  'tools.table.clearSelection': 'مەزمۇننى تازىلاش',
  'a11y.dropPosition': 'تاشلىنىدىغان ئورۇن: {position}. جەمئىي: {total}.',
  'a11y.blockMoved': 'بۆلەك يۆتكەلدى. ئورۇن: {position}. جەمئىي: {total}.',
  'a11y.blockDuplicated': 'بۆلەك كۆپەيتىلدى. ئورۇن: {position}. جەمئىي: {total}.',
  'a11y.blocksDuplicated': '{count} بۆلەك كۆپەيتىلدى. باشلىنىش ئورنى: {position}.',
  'a11y.searchResults': 'ئىزدەش نەتىجىسى: {count}',
  'tools.callout.addEmoji': 'سىنبەلگە قوشۇش',
  'tools.callout.filterEmojis': 'ئېموجى ئىزدەش…',
  'tools.callout.pickRandom': 'ئىختىيارىي بىر ئېموجى تاللاش',
  'tools.callout.skinTone': 'تېرە رەڭگى',
  'tools.table.placement': 'توغرىلاش',
  'searchTerms.pre': 'ئالدىن پىچىملانغان',
  'tools.link.linkTitle': 'ئۇلانما تېكىستى',
  'tools.code.plainText': 'ئاددىي تېكىست',
  'tools.image.toggleCaption': 'ئىزاھاتنى كۆرسىتىش ياكى يوشۇرۇش',
  'tools.image.converting': 'ئايلاندۇرۇلۇۋاتىدۇ…',
  'tools.image.altEdit': 'Alt تېكىستىنى تەھرىرلەش',
  'tools.image.altDescription': 'بۇ رەسىمنى كۆرەلمەيدىغان كىشىلەر ئۈچۈن تەسۋىرلەڭ.',
  'tools.image.altPlaceholder': 'Alt تېكىستى',
  'tools.image.preview': 'رەسىمنىڭ ئالدىن كۆرۈنۈشى',
  'tools.image.previewControls': 'رەسىمنى ئالدىن كۆرۈش تىزگىنلىرى',
  'tools.image.errorDefaultMessage': 'بۇ URL دىن رەسىمنى يۈكلىگىلى بولمىدى. باشقا مەنبە سىناڭ ياكى ھۆججەتنى قايتا يۈكلەڭ.',
  'tools.database.titlePlaceholder': 'يېڭى ساندان',
  'tools.database.viewTypeListDescription': 'تۈرلەرنى ئاددىي تىزىملىكتە كۆرسىتىش',
  'tools.database.propertyTypeText': 'تېكىست',
  'tools.embed.empty': 'سىڭدۈرۈش ئۇلانمىسى يوق',
  'tools.file.toggleCaption': 'ئىزاھاتنى كۆرسىتىش ياكى يوشۇرۇش',
  'tools.file.previewRender': 'ئالدىن كۆرۈش',
  'tools.video.alignmentLeft': 'سولغا توغرىلاش',
  'tools.video.alignmentCenter': 'ئوتتۇرىغا توغرىلاش',
  'tools.video.alignmentRight': 'ئوڭغا توغرىلاش',
  'tools.video.toggleCaption': 'ئىزاھاتنى كۆرسىتىش ياكى يوشۇرۇش',
  'tools.audio.alignmentLeft': 'سولغا توغرىلاش',
  'tools.audio.alignmentCenter': 'ئوتتۇرىغا توغرىلاش',
  'tools.audio.alignmentRight': 'ئوڭغا توغرىلاش',
  'tools.audio.errorFileTooLarge': 'ئاۋاز ھۆججىتى بەك چوڭ. {size} بولسا {max} چېكىدىن ئېشىپ كەتتى.',
  'tools.audio.titlePlaceholder': 'ئاۋاز يولى نامى',
  'tools.audio.emptyOrDropHere': 'ياكى بۇ يەرگە ئاۋاز ھۆججىتى تاشلاڭ',
  'tools.audio.coverSet': 'مۇقاۋا رەسىمىنى بەلگىلەش',
  'tools.audio.coverSourceAria': 'مۇقاۋا مەنبەسى',
  'blockSettings.clickAction': 'تىزىملىكنى ئېچىش ئۈچۈن چېكىڭ',
  'blockSettings.orConjunction': ' ياكى ',
  'blockSettings.openMenuAction': ' نى بېسىڭ',
  'tools.video.seek': 'قويۇش ئورنى',
  'tools.video.toggleTimeDisplay': 'ئۆتكەن ۋاقىت بىلەن قالغان ۋاقىت ئارىسىدا ئالماشتۇرۇش',
  'tools.video.ctxStats': 'قويۇش ستاتىستىكىسى',
};

const UKRAINIAN_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'blockSettings.clickToOpenMenu': 'Клацніть, щоб відкрити меню',
  'blockSettings.clickAction': 'Щоб відкрити меню, клацніть',
  'blockSettings.openMenuAction': ' на клавіатурі',
  'toolbox.optionAddAbove': 'Клацніть, утримуючи Option, щоб додати вище',
  'toolbox.ctrlAddAbove': 'Клацніть, утримуючи Ctrl, щоб додати вище',
  'tools.marker.textColor': 'Колір тексту',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.paragraph.placeholder': 'Напишіть щось або натисніть /, щоб вибрати інструмент',
  'tools.toggle.bodyPlaceholder': 'Порожній згортний блок. Натисніть, щоб додати блок, або перетягніть блоки сюди.',
  'tools.table.clearSelection': 'Очистити вміст',
  'tools.table.placement': 'Вирівнювання',
  'a11y.dragHandle': 'Перетягніть, щоб перемістити блок, або клацніть, щоб відкрити меню',
  'a11y.dragHandleRole': 'маркер перетягування',
  'a11y.dragStartedMultiple': 'Перетягування блоків: {count}',
  'a11y.blocksMoved': 'Блоки переміщено на позицію {position}. Кількість: {count}',
  'a11y.blockDuplicated': 'Копію блока створено на позиції {position} із {total}',
  'a11y.blocksDuplicated': 'Копії блоків створено, починаючи з позиції {position}. Кількість: {count}',
  'a11y.searchResults': 'Результатів пошуку: {count}',
  'a11y.allBlocksSelected': 'Вибрано всі блоки. Усього: {count}',
  'a11y.blocksSelected': 'Вибрано блоків: {count}',
  'a11y.navigationModeExited': 'Режим навігації завершено',
  'toolNames.clearFormat': 'Очистити форматування',
  'searchTerms.citation': 'цитування',
  'tools.callout.addEmoji': 'Додати іконку',
  'tools.callout.filterEmojis': 'Пошук емодзі…',
  'tools.callout.pickRandom': 'Вибрати випадкове емодзі',
  'tools.code.searchLanguage': 'Шукати мову…',
  'searchTerms.pre': 'попередньо форматований',
  'blockSettings.copyLinkError': 'Не вдалося скопіювати посилання на блок',
  'tools.link.linkTitle': 'Текст посилання',
  'tools.code.plainText': 'Звичайний текст',
  'tools.image.toggleCaption': 'Показати або приховати підпис',
  'tools.image.preview': 'Попередній перегляд зображення',
  'tools.image.previewControls': 'Керування попереднім переглядом зображення',
  'tools.image.errorDefaultMessage': 'Не вдалося завантажити зображення за цією URL-адресою. Спробуйте інше джерело або завантажте файл ще раз.',
  'tools.image.emptyOrDropHere': 'або перетягніть зображення сюди',
  'tools.file.toggleCaption': 'Показати або приховати підпис',
  'tools.file.previewRaw': 'Вихідний текст',
  'tools.file.previewRender': 'Попередній перегляд',
  'tools.file.previewBackToContent': 'Повернутися до вмісту',
  'tools.video.toggleCaption': 'Показати або приховати підпис',
  'tools.audio.coverOrDropHere': 'або перетягніть зображення сюди',
  'tools.database.addView': 'Додати подання',
  'tools.database.viewTypeListDescription': 'Показати елементи у простому списку',
  'tools.database.propertyTypeMultiSelect': 'Множинний вибір',
  'tools.database.cardDetails': 'Відомості про картку',
  'tools.embed.empty': 'Немає посилання для вбудовування',
  'tools.video.seek': 'Позиція відтворення',
  'tools.video.toggleTimeDisplay': 'Перемкнути між часом, що минув, і часом, що залишився',
  'tools.video.ctxCopyUrlAtTime': 'Копіювати URL відео з поточної позиції',
  'tools.video.ctxStats': 'Статистика відтворення',
};

const URDU_REVIEWED_EXPECTATIONS: Readonly<Record<string, string>> = {
  'blockSettings.clickAction': 'مینو کھولنے کے لیے کلک کریں',
  'blockSettings.orConjunction': ' یا کی بورڈ پر ',
  'blockSettings.openMenuAction': ' دبائیں',
  'toolbox.optionAddAbove': 'اوپر شامل کرنے کے لیے Option دبا کر کلک کریں',
  'toolbox.ctrlAddAbove': 'اوپر شامل کرنے کے لیے Ctrl دبا کر کلک کریں',
  'toolNames.bold': 'بولڈ',
  'toolNames.bulletedList': 'بلیٹ والی فہرست',
  'toolNames.numberedList': 'نمبر والی فہرست',
  'tools.marker.textColor': 'متن کا رنگ',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.paragraph.placeholder': 'کچھ لکھیں یا کوئی ٹول منتخب کرنے کے لیے / دبائیں',
  'tools.table.clearSelection': 'مواد صاف کریں',
  'tools.table.placement': 'سیدھ',
  'a11y.dropPosition': 'کل {total} میں سے پوزیشن {position} پر رکھا جائے گا',
  'a11y.blockMoved': 'بلاک کو کل {total} میں سے پوزیشن {position} پر منتقل کر دیا گیا',
  'a11y.blockDuplicated': 'بلاک کی نقل کل {total} میں سے پوزیشن {position} پر بنائی گئی',
  'a11y.searchResults': 'تلاش کے نتائج: {count}',
  'a11y.allBlocksSelected': 'تمام بلاکس منتخب ہو گئے۔ کل: {count}',
  'toolNames.strikethrough': 'بیچ سے خط کشیدہ',
  'tools.callout.addEmoji': 'آئیکن شامل کریں',
  'tools.callout.editIcon': 'آئیکن میں ترمیم کریں',
  'tools.callout.filterEmojis': 'ایموجی تلاش کریں…',
  'tools.callout.noEmojisFound': 'کوئی ایموجی نہیں ملا',
  'tools.callout.pickRandom': 'ایک بے ترتیب ایموجی منتخب کریں',
  'tools.database.editCardTitle': 'عنوان میں ترمیم کریں',
  'tools.code.wrapLines': 'سطریں لپیٹیں',
  'searchTerms.pre': 'پہلے سے فارمیٹ شدہ',
  'tools.link.linkTitle': 'لنک کا متن',
  'tools.image.alignment': 'سیدھ',
  'tools.image.alignmentLeftAria': 'بائیں سیدھ کریں',
  'tools.image.alignmentCenterAria': 'درمیان میں سیدھ کریں',
  'tools.image.alignmentRightAria': 'دائیں سیدھ کریں',
  'tools.image.previewControls': 'تصویر کے پیش نظارے کے کنٹرولز',
  'tools.image.errorDefaultMessage': 'اس URL سے تصویر لوڈ نہیں ہو سکی۔ کوئی دوسرا ذریعہ آزمائیں یا فائل دوبارہ اپ لوڈ کریں۔',
  'tools.file.previewRaw': 'ماخذ',
  'tools.file.previewRender': 'پیش نظارہ',
  'tools.video.alignment': 'سیدھ',
  'tools.video.alignmentLeft': 'بائیں سیدھ کریں',
  'tools.video.alignmentCenter': 'درمیان میں سیدھ کریں',
  'tools.video.alignmentRight': 'دائیں سیدھ کریں',
  'tools.audio.alignment': 'سیدھ',
  'tools.audio.alignmentLeft': 'بائیں سیدھ کریں',
  'tools.audio.alignmentCenter': 'درمیان میں سیدھ کریں',
  'tools.audio.alignmentRight': 'دائیں سیدھ کریں',
  'tools.audio.coverSourceAria': 'کور کا ذریعہ',
  'tools.database.viewTypeListDescription': 'اشیا کو ایک سادہ فہرست میں دکھائیں',
  'tools.database.propertyTypeSelect': 'انتخاب',
  'tools.bookmark.loading': 'لنک کا پیش نظارہ لوڈ ہو رہا ہے…',
  'tools.bookmark.error': 'لنک کا پیش نظارہ لوڈ نہیں ہو سکا',
  'tools.embed.empty': 'کوئی ایمبیڈ لنک نہیں',
  'tools.video.toggleTimeDisplay': 'گزرے ہوئے اور باقی وقت کے درمیان سوئچ کریں',
  'tools.video.ctxStats': 'پلے بیک کے اعداد و شمار',
  'tools.callout.emojiSearchResults': 'مماثل ایموجیز: {count}',
  'toolNames.clearFormat': 'فارمیٹ ہٹائیں',
  'tools.toggle.bodyPlaceholder': 'خالی ٹوگل۔ ایک بلاک شامل کرنے کے لیے کلک کریں یا بلاکس کو یہاں گھسیٹیں۔',
};

const EMOJI_CATEGORY_SCOPE_KEYS = [
  'tools.callout.emojiCategoryPeople',
  'tools.callout.emojiCategoryNature',
  'tools.callout.emojiCategoryFood',
  'tools.callout.emojiCategoryTravel',
] as const;

const GROUP_MOVE_KEYS = [
  'a11y.atTop',
  'a11y.atBottom',
  'a11y.movedUp',
  'a11y.movedDown',
] as const;

const LOCALIZED_EMOJI_CATEGORY_SCOPE = {
  am: ['ሳቂታዎች እና ሰዎች', 'እንስሳት እና ተፈጥሮ', 'ምግብ እና መጠጥ', 'ጉዞ እና ቦታዎች'],
  ar: ['الوجوه الضاحكة والأشخاص', 'الحيوانات والطبيعة', 'الطعام والشراب', 'السفر والأماكن'],
  az: ['Smayliklər və insanlar', 'Heyvanlar və təbiət', 'Yemək-içmək', 'Səyahət və yerlər'],
  bg: ['Усмивки и хора', 'Животни и природа', 'Храна и напитки', 'Пътуване и места'],
  bn: ['হাসিমুখ ও মানুষ', 'প্রাণী ও প্রকৃতি', 'খাবার ও পানীয়', 'ভ্রমণ ও স্থান'],
  bs: ['Smajlići i ljudi', 'Životinje i priroda', 'Hrana i piće', 'Putovanja i mjesta'],
  cs: ['Smajlíci a lidé', 'Zvířata a příroda', 'Jídlo a pití', 'Cestování a místa'],
  da: ['Smileys og personer', 'Dyr og natur', 'Mad og drikke', 'Rejser og steder'],
  de: ['Smileys und Personen', 'Tiere und Natur', 'Essen und Trinken', 'Reisen und Orte'],
  dv: ['ސްމައިލީސް އާއި މީހުން', 'ޖަނަވާރުތަކާއި ޤުދުރަތް', 'ކާބޯތަކެތި', 'ދަތުރުފަތުރާއި ތަންތަން'],
  el: ['Φατσούλες και άτομα', 'Ζώα και φύση', 'Φαγητό και ποτό', 'Ταξίδια και μέρη'],
  es: ['Emoticonos y personas', 'Animales y naturaleza', 'Comida y bebida', 'Viajes y destinos'],
  et: ['Naerunäod ja inimesed', 'Loomad ja loodus', 'Toit ja jook', 'Reisimine ja kohad'],
  fa: ['شکلک‌ها و افراد', 'حیوانات و طبیعت', 'غذا و نوشیدنی', 'سفر و مکان‌ها'],
  fi: ['Hymiöt ja ihmiset', 'Eläimet ja luonto', 'Ruoka ja juoma', 'Matkailu ja paikat'],
  fil: ['Smiley at mga tao', 'Mga hayop at kalikasan', 'Pagkain at inumin', 'Paglalakbay at mga lugar'],
  fr: ['Smileys et personnes', 'Animaux et nature', 'Nourriture et boissons', 'Voyages et lieux'],
  gu: ['સ્માઈલીઝ અને લોકો', 'પ્રાણીઓ અને પ્રકૃતિ', 'ખોરાક અને પીણાં', 'પ્રવાસ અને સ્થળો'],
  he: ['סמיילים ואנשים', 'בעלי חיים וטבע', 'מזון ומשקאות', 'נסיעות ומקומות'],
  hi: ['स्माइली और लोग', 'पशु और प्रकृति', 'भोजन और पेय', 'यात्रा और स्थान'],
  hr: ['Smajlići i osobe', 'Životinje i priroda', 'Hrana i piće', 'Putovanja i mjesta'],
  hu: ['Hangulatjelek és emberek', 'Állatok és természet', 'Ételek és italok', 'Utazás és helyek'],
  hy: ['Ժպիտներ և մարդիկ', 'Կենդանիներ և բնություն', 'Սնունդ և խմիչք', 'Ճամփորդություն և վայրեր'],
  id: ['Wajah tersenyum dan orang', 'Hewan dan alam', 'Makanan dan minuman', 'Perjalanan dan tempat'],
  it: ['Faccine e persone', 'Animali e natura', 'Cibi e bevande', 'Viaggi e luoghi'],
  ja: ['スマイリーと人々', '動物と自然', '食べ物と飲み物', '旅行と場所'],
  ka: ['სიცილაკები და ადამიანები', 'ცხოველები და ბუნება', 'საჭმელი და სასმელი', 'მოგზაურობა და ადგილები'],
  km: ['មុខញញឹម និងមនុស្ស', 'សត្វ និងធម្មជាតិ', 'អាហារ និងភេសជ្ជៈ', 'ការធ្វើដំណើរ និងទីកន្លែង'],
  kn: ['ಸ್ಮೈಲಿಗಳು ಮತ್ತು ಜನರು', 'ಪ್ರಾಣಿಗಳು ಮತ್ತು ಪ್ರಕೃತಿ', 'ಆಹಾರ ಮತ್ತು ಪಾನೀಯಗಳು', 'ಪ್ರಯಾಣ ಮತ್ತು ಸ್ಥಳಗಳು'],
  ko: ['스마일리 및 사람', '동물 및 자연', '음식 및 음료', '여행 및 장소'],
  ku: ['ڕووخساری زەردەخەنە و خەڵک', 'ئاژەڵ و سروشت', 'خواردن و خواردنەوە', 'گەشت و شوێنەکان'],
  lo: ['ໜ້າຍິ້ມ ແລະ ຄົນ', 'ສັດ ແລະ ທຳມະຊາດ', 'ອາຫານ ແລະ ເຄື່ອງດື່ມ', 'ການເດີນທາງ ແລະ ສະຖານທີ່'],
  lt: ['Šypsenėlės ir žmonės', 'Gyvūnai ir gamta', 'Maistas ir gėrimai', 'Kelionės ir vietos'],
  lv: ['Smaidiņi un cilvēki', 'Dzīvnieki un daba', 'Ēdieni un dzērieni', 'Ceļojumi un vietas'],
  mk: ['Емотикони и луѓе', 'Животни и природа', 'Храна и пијалак', 'Патување и места'],
  ml: ['സ്മൈലികളും ആളുകളും', 'മൃഗങ്ങളും പ്രകൃതിയും', 'ഭക്ഷണവും പാനീയവും', 'യാത്രകളും സ്ഥലങ്ങളും'],
  mn: ['Инээмсэглэлийн тэмдэг, хүмүүс', 'Ан амьтан ба байгаль', 'Хоол, унд', 'Аялал ба газар нутаг'],
  mr: ['स्माइली आणि लोक', 'प्राणी आणि निसर्ग', 'अन्न आणि पेये', 'प्रवास आणि ठिकाणे'],
  ms: ['Senyuman dan orang', 'Haiwan dan alam', 'Makanan dan minuman', 'Perjalanan dan tempat'],
  my: ['အပြုံးပုံများနှင့် လူများ', 'တိရစ္ဆာန်များနှင့် သဘာဝ', 'အစားအသောက်', 'ခရီးသွားခြင်းနှင့် နေရာများ'],
  ne: ['स्माइली तथा व्यक्तिहरू', 'जनावर तथा प्रकृति', 'खाना तथा पेय', 'यात्रा तथा ठाउँहरू'],
  nl: ['Smileys en mensen', 'Dieren en natuur', 'Eten en drinken', 'Reizen en plaatsen'],
  no: ['Smilefjes og personer', 'Dyr og natur', 'Mat og drikke', 'Reise og steder'],
  pa: ['ਸਮਾਇਲੀ ਅਤੇ ਲੋਕ', 'ਜਾਨਵਰ ਅਤੇ ਕੁਦਰਤ', 'ਭੋਜਨ ਅਤੇ ਪੇਅ ਪਦਾਰਥ', 'ਸਫ਼ਰ ਅਤੇ ਸਥਾਨ'],
  pl: ['Buźki i osoby', 'Zwierzęta i natura', 'Jedzenie i napoje', 'Podróże i miejsca'],
  ps: ['مخونه او خلک', 'حیوانات او طبیعت', 'خواړه او مشروبات', 'سفر او ځایونه'],
  pt: ['Carinhas e pessoas', 'Animais e natureza', 'Comidas e bebidas', 'Viagens e lugares'],
  ro: ['Fețe zâmbitoare și persoane', 'Animale și natură', 'Mâncare și băutură', 'Călătorii și locuri'],
  ru: ['Смайлики и люди', 'Животные и природа', 'Еда и напитки', 'Путешествия и места'],
  sd: ['چهرا ۽ ماڻهو', 'جانور ۽ قدرت', 'کاڌو ۽ مشروب', 'سفر ۽ جايون'],
  si: ['සිනහවන් සහ මිනිසුන්', 'සතුන් සහ ස්වභාවය', 'ආහාර සහ පාන', 'සංචාර සහ ස්ථාන'],
  sk: ['Smajlíky a ľudia', 'Zvieratá a príroda', 'Jedlo a nápoje', 'Cestovanie a miesta'],
  sl: ['Smeški in osebe', 'Živali in narava', 'Hrana in pijača', 'Potovanja in kraji'],
  sq: ['Buzëqeshje dhe persona', 'Kafshët dhe natyra', 'Ushqim dhe pije', 'Udhëtime dhe vende'],
  sr: ['Смајлији и људи', 'Животиње и природа', 'Храна и пиће', 'Путовања и места'],
  sv: ['Smileys och människor', 'Djur och natur', 'Mat och dryck', 'Resor och platser'],
  sw: [
    'Nyuso zenye tabasamu na watu',
    'Wanyama na maumbile',
    'Vyakula na vinywaji',
    'Safari na maeneo',
  ],
  ta: ['ஸ்மைலிகள் மற்றும் மக்கள்', 'விலங்குகள் மற்றும் இயற்கை', 'உணவு மற்றும் பானங்கள்', 'பயணம் மற்றும் இடங்கள்'],
  te: ['స్మైలీస్ మరియు వ్యక్తులు', 'జంతువులు మరియు ప్రకృతి', 'ఆహారం మరియు పానీయాలు', 'ప్రయాణం మరియు ప్రదేశాలు'],
  th: ['หน้ายิ้มและผู้คน', 'สัตว์และธรรมชาติ', 'อาหารและเครื่องดื่ม', 'การเดินทางและสถานที่'],
  tr: ['Suratlar ve insanlar', 'Hayvanlar ve doğa', 'Yiyecek ve içecek', 'Seyahat ve yerler'],
  ug: ['چىرايلار ۋە كىشىلەر', 'ھايۋانلار ۋە تەبىئەت', 'يېمەك-ئىچمەك', 'ساياھەت ۋە جايلار'],
  uk: ['Смайли та люди', 'Тварини і природа', 'Їжа та напої', 'Подорожі та місця'],
  ur: ['مسکراہٹیں اور لوگ', 'حیوانات و فطرت', 'خوراک اور مشروب', 'سفر اور مقامات'],
  vi: ['Mặt cười và con người', 'Động vật và thiên nhiên', 'Đồ ăn và đồ uống', 'Du lịch và địa điểm'],
  yi: ['שמייכלען און מענטשן', 'בעלי־חיים און נאַטור', 'עסן און טרינקען', 'רײַזן און ערטער'],
  zh: ['笑脸与人物', '动物与自然', '食物与饮品', '旅行与地点'],
  'zh-TW': ['表情符號與人物', '動物與自然', '飲食', '旅遊與地點'],
} as const;

const decodeLedgerCode = (cell: string): string => {
  const trimmed = cell.trim().replace(/\\\|/gu, '|');

  if (!trimmed.startsWith('`') || !trimmed.endsWith('`')) {
    return trimmed;
  }

  const code = trimmed.slice(1, -1);

  if (code.startsWith('"') && code.endsWith('"')) {
    return JSON.parse(code) as string;
  }

  return code;
};

const isMarkdownCellDelimiter = (
  character: string,
  currentCell: string
): boolean => {
  if (character !== '|') {
    return false;
  }

  const trailingBackslashCount = currentCell.match(/\\+$/u)?.[0].length ?? 0;

  return trailingBackslashCount % 2 === 0;
};

const parseMarkdownRow = (line: string): string[] => {
  if (!line.startsWith('|') || !line.endsWith('|')) {
    return [];
  }

  const cells: string[] = [];
  let cell = '';

  for (const character of line.slice(1, -1)) {
    if (isMarkdownCellDelimiter(character, cell)) {
      cells.push(cell.trim());
      cell = '';
      continue;
    }

    cell += character;
  }

  cells.push(cell.trim());

  return cells;
};

const parseLedgerFindings = (ledger: string) => {
  return ledger
    .split('\n')
    .filter(line => line.startsWith('| `F-'))
    .map(line => {
      const cells = parseMarkdownRow(line);

      return {
        id: decodeLedgerCode(cells[0] ?? ''),
        locale: decodeLedgerCode(cells[1] ?? ''),
        key: decodeLedgerCode(cells[2] ?? ''),
        category: decodeLedgerCode(cells[3] ?? ''),
        expected: decodeLedgerCode(cells[5] ?? ''),
        status: decodeLedgerCode(cells[7] ?? ''),
      };
    });
};

const parseFindingIdCell = (cell: string): string[] => {
  return cell.split(',').flatMap(token => {
    const normalizedToken = token.trim();
    const rangeMatch = normalizedToken.match(
      /^`?F-([a-z]{2,3}(?:-[A-Z]{2})?)-(\d{3})`?\s*–\s*`?F-\1-(\d{3})`?$/u
    );

    if (rangeMatch !== null) {
      const [, locale = '', rawStart = '', rawEnd = ''] = rangeMatch;
      const start = Number(rawStart);
      const end = Number(rawEnd);

      if (end < start) {
        return [];
      }

      return Array.from({ length: end - start + 1 }, (_, offset) => {
        const sequence = String(start + offset).padStart(3, '0');

        return `F-${locale}-${sequence}`;
      });
    }

    const singleMatch = normalizedToken.match(
      /^`?(F-[a-z]{2,3}(?:-[A-Z]{2})?-\d{3})`?$/u
    );

    return singleMatch?.[1] === undefined ? [] : [singleMatch[1]];
  });
};

const parseLocaleAuditRows = (ledger: string) => {
  const localeAudit = ledger.slice(
    ledger.indexOf('## Locale Audit'),
    ledger.indexOf('## Reviewed Dictionary Digests')
  );

  return localeAudit
    .split('\n')
    .filter(line => /^\| `[a-z]{2,3}(?:-[A-Z]{2})?` \|/u.test(line))
    .map(line => {
      const cells = parseMarkdownRow(line);

      return {
        locale: decodeLedgerCode(cells[0] ?? ''),
        register: decodeLedgerCode(cells[4] ?? ''),
        firstReviewer: decodeLedgerCode(cells[5] ?? ''),
        secondReviewer: decodeLedgerCode(cells[6] ?? ''),
        results: cells.slice(7, 10).map(decodeLedgerCode),
        findingIds: parseFindingIdCell(cells[10] ?? ''),
        finalStatus: decodeLedgerCode(cells[11] ?? ''),
      };
    });
};

const parseRetentionRows = (ledger: string) => {
  return ledger
    .split('\n')
    .filter(line => /^\| `R-(?!<locale>)[^`]+` \|/u.test(line))
    .map(line => {
      const cells = parseMarkdownRow(line);

      return {
        id: decodeLedgerCode(cells[0] ?? ''),
        locale: decodeLedgerCode(cells[1] ?? ''),
        key: decodeLedgerCode(cells[2] ?? ''),
        category: decodeLedgerCode(cells[3] ?? ''),
        justification: cells[4] ?? '',
        source: cells[5] ?? '',
      };
    });
};

const parseReviewedDictionaryDigests = (ledger: string) => {
  const digestSection = ledger.slice(
    ledger.indexOf('## Reviewed Dictionary Digests'),
    ledger.indexOf('## English Source Audit Evidence')
  );

  return digestSection
    .split('\n')
    .filter(line =>
      /^\| `[a-z]{2,3}(?:-[A-Z]{2})?` \| `[^`]+` \| `sha256:[a-f0-9]{64}` \|/u.test(
        line
      )
    )
    .map(line => {
      const cells = parseMarkdownRow(line);

      return {
        locale: decodeLedgerCode(cells[0] ?? ''),
        firstReviewer: decodeLedgerCode(cells[1] ?? ''),
        firstDigest: decodeLedgerCode(cells[2] ?? ''),
        secondReviewer: decodeLedgerCode(cells[3] ?? ''),
        secondDigest: decodeLedgerCode(cells[4] ?? ''),
      };
    });
};

const hashRawDictionary = (raw: string): string => {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`;
};

const withSyntheticEnglishFirstPass = (ledger: string): string => {
  const englishRow = ledger
    .split('\n')
    .find(line => line.startsWith('| `en` |'));

  if (englishRow === undefined) {
    return ledger;
  }

  const cells = parseMarkdownRow(englishRow);

  cells[5] = 'fixture-en-pass1';
  cells[6] = '—';
  cells[7] = 'pass';
  cells[8] = 'pass';
  cells[9] = 'pass';
  cells[11] = 'first-pass-complete';

  const completedRow = `| ${cells.join(' | ')} |`;
  const digestHeader =
    '| Locale | First-pass reviewer | First-pass dictionary SHA-256 | Second-pass reviewer | Second-pass dictionary SHA-256 |\n' +
    '|---|---|---|---|---|\n';
  const digestRow =
    `| \`en\` | \`fixture-en-pass1\` | \`${hashRawDictionary(readLocale('en').raw)}\` | — | — |\n`;

  return ledger
    .replace(englishRow, completedRow)
    .replace(digestHeader, `${digestHeader}${digestRow}`);
};

const findLedgerRowWidthIssues = (ledger: string): string[] => {
  const issues: string[] = [];
  const localeSection = ledger.slice(
    ledger.indexOf('## Locale Audit'),
    ledger.indexOf('## Reviewed Dictionary Digests')
  );
  const digestSection = ledger.slice(
    ledger.indexOf('## Reviewed Dictionary Digests'),
    ledger.indexOf('## English Source Audit Evidence')
  );
  const checks = [
    {
      lines: localeSection
        .split('\n')
        .filter(line => /^\| `[a-z]{2,3}(?:-[A-Z]{2})?` \|/u.test(line)),
      expected: 12,
      table: 'locale audit',
    },
    {
      lines: digestSection
        .split('\n')
        .filter(line => /^\| `[a-z]{2,3}(?:-[A-Z]{2})?` \|/u.test(line)),
      expected: 5,
      table: 'reviewed dictionary digest',
    },
    {
      lines: ledger.split('\n').filter(line => line.startsWith('| `F-')),
      expected: 8,
      table: 'finding',
    },
    {
      lines: ledger
        .split('\n')
        .filter(line => /^\| `R-(?!<locale>)[^`]+` \|/u.test(line)),
      expected: 6,
      table: 'retention',
    },
  ];

  const rowsToCheck = checks.flatMap(check =>
    check.lines.map(line => ({ ...check, line }))
  );

  for (const { expected, line, table } of rowsToCheck) {
    const cells = parseMarkdownRow(line);

    if (cells.length !== expected) {
      issues.push(
        `${decodeLedgerCode(cells[0] ?? 'unknown row')}: ${table} row must contain exactly ${expected} cells`
      );
    }
  }

  return issues;
};

const sameSortedValues = (left: string[], right: string[]): boolean => {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
};

const isAssignedReviewer = (reviewer: string): boolean => {
  return /^[a-z0-9][a-z0-9._-]*$/iu.test(reviewer);
};

const isValidReviewer = (reviewer: string): boolean => {
  return reviewer === '—' || isAssignedReviewer(reviewer);
};

type LedgerFinding = ReturnType<typeof parseLedgerFindings>[number];

const findFindingDomainIssues = (finding: LedgerFinding): string[] => {
  const issues: string[] = [];
  const isGlobalFinding = finding.id.startsWith('F-global-');

  if (isGlobalFinding) {
    const hasValidGlobalId = /^F-global-\d{3}$/u.test(finding.id);

    if (!hasValidGlobalId) {
      issues.push(`${finding.id}: invalid global finding identifier`);
    }

    if (finding.locale !== 'all non-English') {
      issues.push(`${finding.id}: global locale must be all non-English`);
    }

    if (!GLOBAL_FINDING_KEYS.has(finding.key)) {
      issues.push(`${finding.id}: invalid global finding key ${finding.key}`);
    }

    return issues;
  }

  if (!localeCodes.includes(finding.locale)) {
    issues.push(`${finding.id}: invalid finding locale ${finding.locale}`);

    return issues;
  }

  const findingSequence = finding.id.slice(`F-${finding.locale}-`.length);
  const findingIdMatchesLocale =
    finding.id.startsWith(`F-${finding.locale}-`) &&
    /^\d{3}$/u.test(findingSequence);

  if (!findingIdMatchesLocale) {
    issues.push(`${finding.id}: identifier does not match ${finding.locale}`);
  }

  const isOpenMissingKeyFinding =
    finding.status === 'open' && finding.category.includes('missing key');

  if (
    !(finding.key in readLocale(finding.locale).messages) &&
    !isOpenMissingKeyFinding
  ) {
    issues.push(`${finding.id}: unknown ${finding.locale} key ${finding.key}`);
  }

  return issues;
};

const findLedgerContractIssues = (ledger: string): string[] => {
  const issues = findLedgerRowWidthIssues(ledger);
  const findings = parseLedgerFindings(ledger);
  const localeRows = parseLocaleAuditRows(ledger);
  const retentions = parseRetentionRows(ledger);
  const digests = parseReviewedDictionaryDigests(ledger);
  const localeRowCodes = localeRows.map(row => row.locale);
  const findingIds = findings.map(finding => finding.id);
  const retentionIds = retentions.map(retention => retention.id);
  const retentionLocaleKeys = retentions.map(
    retention => `${retention.locale}:${retention.key}`
  );
  const digestLocales = digests.map(digest => digest.locale);

  if (!sameSortedValues(localeRowCodes, localeCodes)) {
    issues.push('locale audit rows must match the on-disk locale set exactly');
  }

  if (new Set(localeRowCodes).size !== localeRowCodes.length) {
    issues.push('locale audit rows must be unique');
  }

  if (new Set(findingIds).size !== findingIds.length) {
    issues.push('finding identifiers must be unique');
  }

  if (new Set(retentionIds).size !== retentionIds.length) {
    issues.push('retention identifiers must be unique');
  }

  if (new Set(retentionLocaleKeys).size !== retentionLocaleKeys.length) {
    issues.push('retention locale/key pairs must be unique');
  }

  if (new Set(digestLocales).size !== digestLocales.length) {
    issues.push('reviewed dictionary digest locales must be unique');
  }

  for (const finding of findings) {
    if (!FINDING_STATUSES.has(finding.status)) {
      issues.push(`${finding.id}: invalid finding status ${finding.status}`);
    }

    issues.push(...findFindingDomainIssues(finding));
  }

  for (const retention of retentions) {
    if (!localeCodes.includes(retention.locale) || retention.locale === 'en') {
      issues.push(`${retention.id}: invalid retention locale ${retention.locale}`);
      continue;
    }

    const retentionSequence = retention.id.slice(
      `R-${retention.locale}-`.length
    );
    const retentionIdMatchesLocale =
      retention.id.startsWith(`R-${retention.locale}-`) &&
      /^\d{3}$/u.test(retentionSequence);

    if (!retentionIdMatchesLocale) {
      issues.push(
        `${retention.id}: identifier does not match ${retention.locale}`
      );
    }

    if (!RETENTION_CATEGORIES.has(retention.category)) {
      issues.push(`${retention.id}: invalid category ${retention.category}`);
    }

    const messages = readLocale(retention.locale).messages;

    if (!(retention.key in messages)) {
      issues.push(`${retention.id}: unknown key ${retention.key}`);
    } else if (messages[retention.key] !== english[retention.key]) {
      issues.push(
        `${retention.id}: ${retention.locale} ${retention.key} is not identical to English`
      );
    }

    if (
      retention.justification.length === 0 ||
      retention.justification === 'justification'
    ) {
      issues.push(`${retention.id}: missing locale-specific justification`);
    }

    if (retention.source.length === 0 || retention.source === 'source') {
      issues.push(`${retention.id}: missing supporting source`);
    }
  }

  const hasOpenGlobalFinding = findings.some(
    finding =>
      finding.id.startsWith('F-global-') && finding.status === 'open'
  );
  const completedLocaleCodes = localeRows
    .filter(row => row.finalStatus !== 'pending')
    .map(row => row.locale);

  if (!sameSortedValues(digestLocales, completedLocaleCodes)) {
    issues.push(
      'reviewed dictionary digests must match completed locale rows exactly'
    );
  }

  for (const digest of digests) {
    const row = localeRows.find(candidate => candidate.locale === digest.locale);

    if (row === undefined) {
      issues.push(`${digest.locale}: digest has no locale audit row`);
      continue;
    }

    const currentDigest = hashRawDictionary(readLocale(digest.locale).raw);

    if (digest.firstReviewer !== row.firstReviewer) {
      issues.push(
        `${digest.locale}: first-pass digest reviewer does not match locale row`
      );
    }

    if (digest.firstDigest !== currentDigest) {
      issues.push(
        `${digest.locale}: first-pass digest does not match current dictionary`
      );
    }

    const leavesSecondPassUnassigned =
      digest.secondReviewer === '—' && digest.secondDigest === '—';
    const matchesCompletedReview =
      digest.secondReviewer === row.secondReviewer &&
      digest.secondDigest === currentDigest;

    if (row.finalStatus === 'first-pass-complete' && !leavesSecondPassUnassigned) {
      issues.push(
        `${digest.locale}: first-pass digest row must leave second-pass evidence unassigned`
      );
    } else if (
      ['second-pass-complete', 'verified'].includes(row.finalStatus) &&
      !matchesCompletedReview
    ) {
      issues.push(
        `${digest.locale}: second-pass evidence does not match the current completed review`
      );
    }
  }

  for (const row of localeRows) {
    const localeFindings = findings.filter(
      finding => finding.locale === row.locale
    );
    const expectedFindingIds = localeFindings.map(finding => finding.id);

    if (!sameSortedValues(row.findingIds, expectedFindingIds)) {
      issues.push(
        `${row.locale}: locale finding IDs must match the finding table exactly`
      );
    }

    if (row.results.length !== 3 || row.results.some(result => !RESULT_STATES.has(result))) {
      issues.push(`${row.locale}: invalid result state`);
    }

    if (!FINAL_STATUSES.has(row.finalStatus)) {
      issues.push(`${row.locale}: invalid final status ${row.finalStatus}`);
    }

    if (!isValidReviewer(row.firstReviewer)) {
      issues.push(`${row.locale}: invalid first reviewer identifier`);
    }

    if (!isValidReviewer(row.secondReviewer)) {
      issues.push(`${row.locale}: invalid second reviewer identifier`);
    }

    const hasCompletedPass = row.finalStatus !== 'pending';

    if (hasCompletedPass && (row.register.length === 0 || row.register === 'to-audit')) {
      issues.push(`${row.locale}: ${row.finalStatus} requires a register`);
    }

    if (hasCompletedPass && !isAssignedReviewer(row.firstReviewer)) {
      issues.push(
        `${row.locale}: ${row.finalStatus} requires a first reviewer`
      );
    }

    if (hasCompletedPass && row.results.some(result => result !== 'pass')) {
      issues.push(
        `${row.locale}: ${row.finalStatus} requires all results to pass`
      );
    }

    if (
      hasCompletedPass &&
      localeFindings.some(finding => finding.status !== 'verified')
    ) {
      issues.push(
        `${row.locale}: ${row.finalStatus} requires every locale finding to be verified`
      );
    }

    if (
      row.finalStatus === 'first-pass-complete' &&
      row.secondReviewer !== '—'
    ) {
      issues.push(
        `${row.locale}: first-pass-complete requires an unassigned second reviewer`
      );
    }

    if (
      ['second-pass-complete', 'verified'].includes(row.finalStatus) &&
      (!isAssignedReviewer(row.secondReviewer) ||
        row.secondReviewer === row.firstReviewer)
    ) {
      issues.push(
        `${row.locale}: ${row.finalStatus} requires a distinct second reviewer`
      );
    }

    if (row.finalStatus === 'verified' && hasOpenGlobalFinding) {
      issues.push(
        `${row.locale}: verified is blocked by an open global finding`
      );
    }

    const auditsRetention = row.results[2] === 'pass' && row.locale !== 'en';
    const auditedMessages = auditsRetention
      ? readLocale(row.locale).messages
      : null;
    const exactEnglishKeys =
      auditedMessages === null
        ? []
        : Object.keys(english).filter(
          key => auditedMessages[key] === english[key]
        );
    const retainedKeys = retentions
      .filter(retention => retention.locale === row.locale)
      .map(retention => retention.key);

    if (auditsRetention && !sameSortedValues(exactEnglishKeys, retainedKeys)) {
      issues.push(
        `${row.locale}: exact-English pass requires a complete retention inventory`
      );
    }
  }

  return issues;
};

const ledgerFindings = parseLedgerFindings(auditLedger);
const englishLedgerFindings = ledgerFindings.filter(
  finding => finding.locale === 'en'
);
const localizedLedgerFindings = ledgerFindings.filter(
  finding => finding.locale !== 'en' && !finding.id.startsWith('F-global-')
);

describe('translation guideline corpus integrity', () => {
  it('retains Emoji Mart’s established singular English activity label', () => {
    expect(english['tools.callout.emojiCategoryActivity']).toBe('Activity');
  });

  it('defines sentence case for English UI labels', () => {
    expect(translationGuidelines).toContain(
      'English uses sentence case for UI labels'
    );
    expect(translationGuidelines).not.toContain(
      'English title-cases UI labels'
    );
  });

  it('uses caller-safe Georgian interpolation and action labels', () => {
    const messages = readLocale('ka').messages;
    const actual = Object.fromEntries(
      Object.keys(GEORGIAN_CALLER_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(GEORGIAN_CALLER_EXPECTATIONS);
  });

  it('uses the independently adjudicated Khmer correction oracle', () => {
    const messages = readLocale('km').messages;
    const actual = Object.fromEntries(
      Object.keys(KHMER_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(KHMER_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Kannada correction oracle', () => {
    const messages = readLocale('kn').messages;
    const actual = Object.fromEntries(
      Object.keys(KANNADA_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(KANNADA_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Sorani correction oracle', () => {
    const messages = readLocale('ku').messages;
    const actual = Object.fromEntries(
      Object.keys(SORANI_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(SORANI_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Lao correction oracle', () => {
    const messages = readLocale('lo').messages;
    const actual = Object.fromEntries(
      Object.keys(LAO_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(LAO_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Lithuanian correction oracle', () => {
    const messages = readLocale('lt').messages;
    const actual = Object.fromEntries(
      Object.keys(LITHUANIAN_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(LITHUANIAN_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Latvian correction oracle', () => {
    const messages = readLocale('lv').messages;
    const actual = Object.fromEntries(
      Object.keys(LATVIAN_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(LATVIAN_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Macedonian correction oracle', () => {
    const messages = readLocale('mk').messages;
    const actual = Object.fromEntries(
      Object.keys(MACEDONIAN_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(MACEDONIAN_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Malayalam correction oracle', () => {
    const messages = readLocale('ml').messages;
    const actual = Object.fromEntries(
      Object.keys(MALAYALAM_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(MALAYALAM_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Mongolian correction oracle', () => {
    const messages = readLocale('mn').messages;
    const actual = Object.fromEntries(
      Object.keys(MONGOLIAN_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(MONGOLIAN_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Marathi correction oracle', () => {
    const messages = readLocale('mr').messages;
    const actual = Object.fromEntries(
      Object.keys(MARATHI_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(MARATHI_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Malay correction oracle', () => {
    const messages = readLocale('ms').messages;
    const actual = Object.fromEntries(
      Object.keys(MALAY_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(MALAY_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Burmese correction oracle', () => {
    const messages = readLocale('my').messages;
    const actual = Object.fromEntries(
      Object.keys(BURMESE_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(BURMESE_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Nepali correction oracle', () => {
    const messages = readLocale('ne').messages;
    const actual = Object.fromEntries(
      Object.keys(NEPALI_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(NEPALI_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Dutch correction oracle', () => {
    const messages = readLocale('nl').messages;
    const actual = Object.fromEntries(
      Object.keys(DUTCH_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(DUTCH_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Norwegian correction oracle', () => {
    const messages = readLocale('no').messages;
    const actual = Object.fromEntries(
      Object.keys(NORWEGIAN_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(NORWEGIAN_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Punjabi correction oracle', () => {
    const messages = readLocale('pa').messages;
    const actual = Object.fromEntries(
      Object.keys(PUNJABI_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(PUNJABI_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Polish correction oracle', () => {
    const messages = readLocale('pl').messages;
    const actual = Object.fromEntries(
      Object.keys(POLISH_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(POLISH_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Pashto correction oracle', () => {
    const messages = readLocale('ps').messages;
    const actual = Object.fromEntries(
      Object.keys(PASHTO_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(PASHTO_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Portuguese correction oracle', () => {
    const messages = readLocale('pt').messages;
    const actual = Object.fromEntries(
      Object.keys(PORTUGUESE_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(PORTUGUESE_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Romanian correction oracle', () => {
    const messages = readLocale('ro').messages;
    const actual = Object.fromEntries(
      Object.keys(ROMANIAN_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(ROMANIAN_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Russian correction oracle', () => {
    const messages = readLocale('ru').messages;
    const actual = Object.fromEntries(
      Object.keys(RUSSIAN_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(RUSSIAN_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Sindhi correction oracle', () => {
    const messages = readLocale('sd').messages;
    const actual = Object.fromEntries(
      Object.keys(SINDHI_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(SINDHI_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Sinhala correction oracle', () => {
    const messages = readLocale('si').messages;
    const actual = Object.fromEntries(
      Object.keys(SINHALA_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(SINHALA_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Slovak correction oracle', () => {
    const messages = readLocale('sk').messages;
    const actual = Object.fromEntries(
      Object.keys(SLOVAK_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(SLOVAK_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Slovenian correction oracle', () => {
    const messages = readLocale('sl').messages;
    const actual = Object.fromEntries(
      Object.keys(SLOVENIAN_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(SLOVENIAN_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Albanian correction oracle', () => {
    const messages = readLocale('sq').messages;
    const actual = Object.fromEntries(
      Object.keys(ALBANIAN_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(ALBANIAN_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Serbian correction oracle', () => {
    const messages = readLocale('sr').messages;
    const actual = Object.fromEntries(
      Object.keys(SERBIAN_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(SERBIAN_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Swahili correction oracle', () => {
    const messages = readLocale('sw').messages;
    const actual = Object.fromEntries(
      Object.keys(SWAHILI_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(SWAHILI_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Tamil correction oracle', () => {
    const messages = readLocale('ta').messages;
    const actual = Object.fromEntries(
      Object.keys(TAMIL_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(TAMIL_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Telugu correction oracle', () => {
    const messages = readLocale('te').messages;
    const actual = Object.fromEntries(
      Object.keys(TELUGU_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(TELUGU_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Thai correction oracle', () => {
    const messages = readLocale('th').messages;
    const actual = Object.fromEntries(
      Object.keys(THAI_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(THAI_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Turkish correction oracle', () => {
    const messages = readLocale('tr').messages;
    const actual = Object.fromEntries(
      Object.keys(TURKISH_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(TURKISH_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Uyghur correction oracle', () => {
    const messages = readLocale('ug').messages;
    const actual = Object.fromEntries(
      Object.keys(UYGHUR_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(UYGHUR_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Ukrainian correction oracle', () => {
    const messages = readLocale('uk').messages;
    const actual = Object.fromEntries(
      Object.keys(UKRAINIAN_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(UKRAINIAN_REVIEWED_EXPECTATIONS);
  });

  it('uses the independently adjudicated Urdu correction oracle', () => {
    const messages = readLocale('ur').messages;
    const actual = Object.fromEntries(
      Object.keys(URDU_REVIEWED_EXPECTATIONS).map(key => [
        key,
        messages[key],
      ])
    );

    expect(actual).toEqual(URDU_REVIEWED_EXPECTATIONS);
  });

  it('covers every non-English locale in the emoji category scope matrix', () => {
    expect(Object.keys(LOCALIZED_EMOJI_CATEGORY_SCOPE).sort()).toEqual(
      localeCodes.filter(locale => locale !== 'en')
    );
  });

  it('covers every non-English locale in the group-move matrix', () => {
    expect(Object.keys(localizedGroupMoveExpectations).sort()).toEqual(
      localeCodes.filter(locale => locale !== 'en')
    );
  });

  it('covers every non-English locale in the recently-used label matrix', () => {
    expect(Object.keys(localizedRecentlyUsedExpectations).sort()).toEqual(
      localeCodes.filter(locale => locale !== 'en')
    );
  });

  it.each(Object.entries(localizedRecentlyUsedExpectations))(
    '$0 uses its reviewed recently-used color label',
    (locale, expected) => {
      expect(readLocale(locale).messages['tools.colorPicker.recentlyUsed']).toBe(
        expected
      );
    }
  );

  it('covers every non-English locale in the action-placeholder matrix', () => {
    expect(Object.keys(localizedPopoverSearchExpectations).sort()).toEqual(
      localeCodes.filter(locale => locale !== 'en')
    );
  });

  it.each(Object.entries(localizedPopoverSearchExpectations))(
    '$0 uses its reviewed action-oriented popover placeholder',
    (locale, expected) => {
      expect(readLocale(locale).messages['popover.search']).toBe(expected);
    }
  );

  it('covers every non-English locale in the generic link-label matrix', () => {
    expect(Object.keys(localizedLinkTypeExpectations).sort()).toEqual(
      localeCodes.filter(locale => locale !== 'en')
    );
  });

  it.each(Object.entries(localizedLinkTypeExpectations))(
    '$0 uses its reviewed generic catch-all link label',
    (locale, expected) => {
      expect(readLocale(locale).messages['tools.link.webLink']).toBe(expected);
    }
  );

  it.each(Object.entries(localizedGroupMoveExpectations))(
    '$0 uses count-neutral group-move announcements',
    (locale, expected) => {
      const messages = readLocale(locale).messages;
      const actual = Object.fromEntries(
        GROUP_MOVE_KEYS.map(key => [key, messages[key]])
      );

      expect(Object.keys(expected)).toEqual(GROUP_MOVE_KEYS);
      expect(actual).toEqual(expected);
    }
  );

  it.each(Object.entries(LOCALIZED_EMOJI_CATEGORY_SCOPE))(
    '$0 uses complete localized emoji category scope',
    (locale, expected) => {
      const messages = readLocale(locale).messages;
      const actual = EMOJI_CATEGORY_SCOPE_KEYS.map(key => messages[key]);

      expect(actual).toEqual(expected);
    }
  );

  it.each(Object.entries(ENGLISH_GUIDELINE_EXPECTATIONS))(
    'English %s uses the approved source wording',
    (key, expected) => {
      expect(english[key], `${key} violates the English source-copy audit`).toBe(
        expected
      );
    }
  );

  it('keeps English source expectations synchronized with verified ledger findings', () => {
    const findingExpectations = Object.fromEntries(
      englishLedgerFindings.map(finding => [
        finding.key,
        finding.expected,
      ])
    );
    const expectedFindingIds = englishLedgerFindings
      .map(finding => finding.id)
      .sort();
    const localeAudit = auditLedger.slice(
      auditLedger.indexOf('## Locale Audit'),
      auditLedger.indexOf('## English Source Audit Evidence')
    );
    const englishRow = localeAudit
      .split('\n')
      .find(line => line.startsWith('| `en` |'));
    const englishCells =
      englishRow === undefined ? undefined : parseMarkdownRow(englishRow);
    const recordedFindingIds = parseFindingIdCell(
      englishCells?.[10] ?? ''
    ).sort();

    expect(findingExpectations).toEqual(ENGLISH_GUIDELINE_EXPECTATIONS);
    expect(
      englishLedgerFindings.every(finding => finding.status === 'verified')
    ).toBe(true);
    expect(recordedFindingIds).toEqual(expectedFindingIds);
  });

  it.each(localizedLedgerFindings)(
    '$id keeps $locale $key at its reviewed wording',
    ({ id, locale, key, expected }) => {
      const messages = readLocale(locale).messages;

      expect(
        messages[key],
        `${id} requires the reviewed ${locale} wording for ${key}`
      ).toBe(expected);
    }
  );

  it('keeps localized finding identifiers and locale/key pairs unique', () => {
    const ids = localizedLedgerFindings.map(finding => finding.id);
    const localeKeys = localizedLedgerFindings.map(
      finding => `${finding.locale}:${finding.key}`
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(localeKeys).size).toBe(localeKeys.length);
  });

  it('rejects a locale completion claim with an unverified finding', () => {
    const completedLedger = withSyntheticEnglishFirstPass(auditLedger);
    const verifiedFinding = completedLedger
      .split('\n')
      .find(line => line.startsWith('| `F-en-001` |'));
    const openFinding = verifiedFinding?.replace(
      /\| verified \|$/u,
      '| open |'
    );
    const invalidLedger =
      verifiedFinding === undefined || openFinding === undefined
        ? completedLedger
        : completedLedger.replace(verifiedFinding, openFinding);

    expect(findLedgerContractIssues(invalidLedger)).toContain(
      'en: first-pass-complete requires every locale finding to be verified'
    );
  });

  it('rejects a completed locale with an empty first reviewer', () => {
    const completedLedger = withSyntheticEnglishFirstPass(auditLedger);
    const englishRow = completedLedger
      .split('\n')
      .find(line => line.startsWith('| `en` |'));
    const invalidRow = englishRow?.replace(
      '| fixture-en-pass1 |',
      '|  |'
    );
    const invalidLedger =
      englishRow === undefined || invalidRow === undefined
        ? completedLedger
        : completedLedger.replace(englishRow, invalidRow);

    expect(findLedgerContractIssues(invalidLedger)).toContain(
      'en: first-pass-complete requires a first reviewer'
    );
  });

  it('rejects stale first-pass evidence after dictionary content changes', () => {
    const currentDigest = hashRawDictionary(readLocale('en').raw);
    const staleLedger = withSyntheticEnglishFirstPass(auditLedger).replace(
      currentDigest,
      `sha256:${'0'.repeat(64)}`
    );

    expect(findLedgerContractIssues(staleLedger)).toContain(
      'en: first-pass digest does not match current dictionary'
    );
  });

  it('rejects a global finding outside the global locale domain', () => {
    const invalidLedger = auditLedger.replace(
      '| `F-global-001` | all non-English |',
      '| `F-global-001` | arbitrary locale |'
    );

    expect(findLedgerContractIssues(invalidLedger)).toContain(
      'F-global-001: global locale must be all non-English'
    );
  });

  it('allows an open missing-key finding to precede dictionary remediation', () => {
    const originalRow = auditLedger
      .split('\n')
      .find(line => line.startsWith('| `F-en-001` |'));
    const missingKeyRow = originalRow
      ?.replace('`blockSettings.openMenuAction`', '`toolNames.notYetDefined`')
      .replace('| grammar |', '| missing key / source coverage |')
      .replace('| verified |', '| open |');
    const preRemediationLedger =
      originalRow === undefined || missingKeyRow === undefined
        ? auditLedger
        : auditLedger.replace(originalRow, missingKeyRow);

    expect(findLedgerContractIssues(preRemediationLedger)).not.toContain(
      'F-en-001: unknown en key toolNames.notYetDefined'
    );
  });

  it('rejects a verified missing-key finding until its key exists', () => {
    const originalRow = auditLedger
      .split('\n')
      .find(line => line.startsWith('| `F-en-001` |'));
    const invalidRow = originalRow
      ?.replace('`blockSettings.openMenuAction`', '`toolNames.notYetDefined`')
      .replace('| grammar |', '| missing key / source coverage |');
    const invalidLedger =
      originalRow === undefined || invalidRow === undefined
        ? auditLedger
        : auditLedger.replace(originalRow, invalidRow);

    expect(findLedgerContractIssues(invalidLedger)).toContain(
      'F-en-001: unknown en key toolNames.notYetDefined'
    );
  });

  it('parses escaped Markdown table pipes without creating extra cells', () => {
    expect(
      parseMarkdownRow('| `F-example-001` | `"before \\| after"` | evidence |')
    ).toEqual(['`F-example-001`', '`"before \\| after"`', 'evidence']);
  });

  it('expands inclusive same-locale finding ranges', () => {
    expect(
      parseFindingIdCell('`F-da-001`–`F-da-003`, `F-da-005`')
    ).toEqual(['F-da-001', 'F-da-002', 'F-da-003', 'F-da-005']);
  });

  it('keeps locale progress and retention evidence internally consistent', () => {
    expect(findLedgerContractIssues(auditLedger)).toEqual([]);
  });

  it.each(localeCodes)('%s satisfies structural translation rules', locale => {
    const { raw, messages } = readLocale(locale);
    const duplicateKeys = findDuplicateJsonKeys(raw);
    const localeKeys = Object.keys(messages).sort();
    const integrityIssues = findLocaleIntegrityIssues(english, messages, {
      boundaryWhitespaceExceptions: getBoundaryWhitespaceExceptions(locale),
    });

    expect(
      duplicateKeys,
      `${locale} has duplicate decoded JSON keys`
    ).toEqual([]);
    expect(localeKeys, `${locale} keys differ from English`).toEqual(
      englishKeys
    );
    expect(
      integrityIssues,
      `${locale} has translation integrity issues`
    ).toEqual([]);
  });
});
