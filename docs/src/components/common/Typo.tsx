import { createElement, type ReactNode } from 'react';
import { useI18n } from '../../contexts/I18nContext';
import { applyTypography } from '../../utils/typography';

interface TypoProps {
  /** Text to typographically correct. Strings (and arrays of strings) are processed. */
  children: ReactNode;
  /** Optional wrapper element. When omitted the text is rendered without a wrapper. */
  as?: keyof React.JSX.IntrinsicElements;
  className?: string;
}

/** Flatten string children into a single string; anything non-string is dropped. */
const toText = (children: ReactNode): string => {
  if (typeof children === 'string') {
    return children;
  }
  if (Array.isArray(children)) {
    return children.filter((child): child is string => typeof child === 'string').join('');
  }
  return '';
};

/**
 * Renders prose with locale-aware non-breaking spaces so short words, numbers and
 * dashes never get stranded at the end of a line. Wrap any user-facing text with it:
 * `<Typo>{t('home.hero.description')}</Typo>`. By default it renders the text without
 * a wrapper element; pass `as` to wrap it in an element (and forward `className`).
 */
export const Typo = ({ children, as, className }: TypoProps) => {
  const { locale } = useI18n();
  const text = applyTypography(toText(children), locale);

  if (as) {
    return createElement(as, { className }, text);
  }

  return <>{text}</>;
};
