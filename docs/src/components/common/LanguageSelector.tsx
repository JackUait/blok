import { useState, useRef, useEffect } from 'react';
import { useI18n } from '../../contexts/I18nContext';
import type { Locale } from '../../i18n';
import styles from './LanguageSelector.module.css';

/* SVG Flag Icons - Clean, minimal style */
const FlagIcon = ({ locale }: { locale: Locale }) => {
  if (locale === 'en') {
    // US flag - simplified for small size
    return (
      <svg width="20" height="14" viewBox="0 0 20 14" fill="none" className={styles.flagIcon}>
        <rect width="20" height="14" rx="2" fill="#fff"/>
        <rect width="20" height="1.077" fill="#B22234"/>
        <rect y="2.154" width="20" height="1.077" fill="#B22234"/>
        <rect y="4.308" width="20" height="1.077" fill="#B22234"/>
        <rect y="6.462" width="20" height="1.077" fill="#B22234"/>
        <rect y="8.615" width="20" height="1.077" fill="#B22234"/>
        <rect y="10.769" width="20" height="1.077" fill="#B22234"/>
        <rect y="12.923" width="20" height="1.077" fill="#B22234"/>
        <rect width="8" height="7.538" fill="#3C3B6E"/>
        <g fill="white">
          <circle cx="1.5" cy="1.1" r="0.6"/>
          <circle cx="4" cy="1.1" r="0.6"/>
          <circle cx="6.5" cy="1.1" r="0.6"/>
          <circle cx="2.75" cy="2.5" r="0.6"/>
          <circle cx="5.25" cy="2.5" r="0.6"/>
          <circle cx="1.5" cy="3.9" r="0.6"/>
          <circle cx="4" cy="3.9" r="0.6"/>
          <circle cx="6.5" cy="3.9" r="0.6"/>
          <circle cx="2.75" cy="5.3" r="0.6"/>
          <circle cx="5.25" cy="5.3" r="0.6"/>
          <circle cx="1.5" cy="6.7" r="0.6"/>
          <circle cx="4" cy="6.7" r="0.6"/>
          <circle cx="6.5" cy="6.7" r="0.6"/>
        </g>
      </svg>
    );
  }
  // Russian flag
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" fill="none" className={styles.flagIcon}>
      <rect width="20" height="14" rx="2" fill="#0039A6"/>
      <rect width="20" height="4.67" rx="2" ry="0" fill="white"/>
      <rect y="9.33" width="20" height="4.67" rx="0" ry="2" fill="#D52B1E"/>
    </svg>
  );
};

export const LanguageSelector = () => {
  const { locale, setLocale, localeNames } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const handleLocaleChange = (newLocale: Locale) => {
    setLocale(newLocale);
    setIsOpen(false);
  };

  const locales: Locale[] = ['en', 'ru'];

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        className={`${styles.trigger} ${isOpen ? styles.triggerOpen : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Language: ${localeNames[locale]}`}
        type="button"
      >
        <svg 
          className={styles.globeIcon} 
          width="18" 
          height="18" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="1.5"
          strokeLinecap="round" 
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      </button>
      
      <div 
        className={`${styles.dropdown} ${isOpen ? styles.dropdownOpen : ''}`} 
        role="listbox" 
        aria-label="Select language"
        aria-hidden={!isOpen}
      >
        {locales.map((loc) => (
          <button
            key={loc}
            className={`${styles.option} ${loc === locale ? styles.optionActive : ''}`}
            onClick={() => handleLocaleChange(loc)}
            role="option"
            aria-selected={loc === locale}
            type="button"
            tabIndex={isOpen ? 0 : -1}
          >
            <span className={styles.optionFlag}>
              <FlagIcon locale={loc} />
            </span>
            <span className={styles.optionLabel}>{localeNames[loc]}</span>
            <svg 
              className={styles.checkIcon}
              width="14" 
              height="14" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2.5"
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
