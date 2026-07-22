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
  'mobile popover back-button localization contract',
  'read-only settings tooltip whole-message contract',
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
  ro: ['Emoticoane și persoane', 'Animale și natură', 'Mâncare și băutură', 'Călătorii și locuri'],
  ru: ['Смайлики и люди', 'Животные и природа', 'Еда и напитки', 'Путешествия и места'],
  sd: ['چهرا ۽ ماڻهو', 'جانور ۽ قدرت', 'کاڌو ۽ مشروب', 'سفر ۽ جايون'],
  si: ['සිනහවන් සහ මිනිසුන්', 'සතුන් සහ ස්වභාවය', 'ආහාර සහ පාන', 'සංචාර සහ ස්ථාන'],
  sk: ['Smajlíky a ľudia', 'Zvieratá a príroda', 'Jedlo a nápoje', 'Cestovanie a miesta'],
  sl: ['Smeški in osebe', 'Živali in narava', 'Hrana in pijača', 'Potovanja in kraji'],
  sq: ['Buzëqeshje dhe persona', 'Kafshët dhe natyra', 'Ushqim dhe pije', 'Udhëtime dhe vende'],
  sr: ['Смајлији и људи', 'Животиње и природа', 'Храна и пиће', 'Путовања и места'],
  sv: ['Smileys och människor', 'Djur och natur', 'Mat och dryck', 'Resor och platser'],
  sw: ['Vicheshi na watu', 'Wanyama na maumbile', 'Vyakula na vinywaji', 'Safari na maeneo'],
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
  const trailingBackslashCount = currentCell.match(/\\+$/u)?.[0].length ?? 0;

  return character === '|' && trailingBackslashCount % 2 === 0;
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
