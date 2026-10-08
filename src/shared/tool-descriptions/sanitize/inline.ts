import type { SanitizerConfig } from '../../../../types';
import { isInvisibleBackground } from '../../../components/utils/default-page-colors';
import { EQUATION_SOURCE_ATTR as EQUATION_ATTR } from '../../equation-mark';
import { preservePageReferenceAnchor } from '../../page-reference';

const ALLOWED_STYLE_PROPS = new Set(['color', 'background-color']);

export const markerSanitize = (): SanitizerConfig => {
  return {
    mark: (node: Element): { [attr: string]: boolean | string } => {
      const el = node as HTMLElement;
      const style = el.style;

      /**
       * Collect property names first, then remove disallowed ones.
       * This avoids mutating the CSSStyleDeclaration while iterating its indices.
       */
      const props = Array.from({ length: style.length }, (_, i) => style.item(i));

      for (const prop of props) {
        if (!ALLOWED_STYLE_PROPS.has(prop)) {
          style.removeProperty(prop);
        }
      }

      /**
       * Strip invisible background-colors (transparent, near-white light-page
       * bg, near-black dark-page bg) so a pasted <mark> from another editor
       * (Notion/Word/Summernote/old Blok) doesn't persist a bg that produced
       * no visible highlight — otherwise it lands as a spurious empty <mark>.
       */
      const bg = style.getPropertyValue('background-color');

      if (bg && isInvisibleBackground(bg)) {
        style.removeProperty('background-color');
      }

      /**
       * When text color is set without an explicit background-color,
       * add transparent background to override the browser's default
       * <mark> background (yellow/Mark system color). This handles
       * pasted content where the browser may have dropped the
       * transparent value during clipboard serialization.
       */
      if (style.getPropertyValue('color') && !style.getPropertyValue('background-color')) {
        style.setProperty('background-color', 'transparent');
      }

      return style.length > 0 ? { style: true } : {};
    },
  };
};

export const boldSanitize = (): SanitizerConfig => {
  return {
    strong: {},
    b: {},
  };
};

export const italicSanitize = (): SanitizerConfig => ({
  i: {},
  em: {},
});

export const underlineSanitize = (): SanitizerConfig => ({
  u: {},
});

export const clearFormatSanitize = (): SanitizerConfig => {
  return {};
};

export const linkSanitize = (): SanitizerConfig => {
  return {
    a: preservePageReferenceAnchor,
  };
};

export const strikethroughSanitize = (): SanitizerConfig => ({
  s: {},
  del: {},
  strike: {},
});

export const inlineCodeSanitize = (): SanitizerConfig => {
  return {
    code: {},
  };
};

export const equationSanitize = (): SanitizerConfig => {
  return {
    span: {
      [EQUATION_ATTR]: true,
    },
  };
};

export const supSubSanitize = (): SanitizerConfig => {
  return {
    sup: {},
    sub: {},
  };
};

export const BUILT_IN_INLINE_SANITIZE: Readonly<Record<string, () => SanitizerConfig>> = {
  marker: markerSanitize,
  bold: boldSanitize,
  italic: italicSanitize,
  underline: underlineSanitize,
  clearFormat: clearFormatSanitize,
  link: linkSanitize,
  strikethrough: strikethroughSanitize,
  inlineCode: inlineCodeSanitize,
  equation: equationSanitize,
  supSub: supSubSanitize,
};
