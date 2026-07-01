import { useState, useRef, useEffect } from "react";
import { Check, Globe } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import type { Locale } from "../../i18n";
import { cn } from "@/lib/utils";

/* SVG Flag Icons - Clean, minimal style */
const FlagIcon = ({ locale }: { locale: Locale }) => {
  if (locale === "en") {
    // US flag - simplified for small size
    return (
      <svg width="20" height="14" viewBox="0 0 20 14" fill="none" className="rounded-[3px] shadow-sm">
        <rect width="20" height="14" rx="2" fill="#fff" />
        <rect width="20" height="1.077" fill="#B22234" />
        <rect y="2.154" width="20" height="1.077" fill="#B22234" />
        <rect y="4.308" width="20" height="1.077" fill="#B22234" />
        <rect y="6.462" width="20" height="1.077" fill="#B22234" />
        <rect y="8.615" width="20" height="1.077" fill="#B22234" />
        <rect y="10.769" width="20" height="1.077" fill="#B22234" />
        <rect y="12.923" width="20" height="1.077" fill="#B22234" />
        <rect width="8" height="7.538" fill="#3C3B6E" />
        <g fill="white">
          <circle cx="1.5" cy="1.1" r="0.6" />
          <circle cx="4" cy="1.1" r="0.6" />
          <circle cx="6.5" cy="1.1" r="0.6" />
          <circle cx="2.75" cy="2.5" r="0.6" />
          <circle cx="5.25" cy="2.5" r="0.6" />
          <circle cx="1.5" cy="3.9" r="0.6" />
          <circle cx="4" cy="3.9" r="0.6" />
          <circle cx="6.5" cy="3.9" r="0.6" />
          <circle cx="2.75" cy="5.3" r="0.6" />
          <circle cx="5.25" cy="5.3" r="0.6" />
          <circle cx="1.5" cy="6.7" r="0.6" />
          <circle cx="4" cy="6.7" r="0.6" />
          <circle cx="6.5" cy="6.7" r="0.6" />
        </g>
      </svg>
    );
  }
  // Russian flag
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" fill="none" className="rounded-[3px] shadow-sm">
      <rect width="20" height="14" rx="2" fill="#0039A6" />
      <rect width="20" height="4.67" rx="2" ry="0" fill="white" />
      <rect y="9.33" width="20" height="4.67" rx="0" ry="2" fill="#D52B1E" />
    </svg>
  );
};

export const LanguageSelector = () => {
  const { locale, setLocale, localeNames, t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const handleLocaleChange = (newLocale: Locale) => {
    setLocale(newLocale);
    setIsOpen(false);
  };

  const locales: Locale[] = ["en", "ru"];

  return (
    <div className="relative" ref={containerRef}>
      <button
        className={cn(
          "flex size-9 cursor-pointer items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          isOpen && "bg-secondary text-foreground",
        )}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`${t("languageSelector.label")}: ${localeNames[locale]}`}
        type="button"
      >
        <Globe className="size-[18px]" strokeWidth={1.75} />
      </button>

      <div
        className={cn(
          "absolute right-0 top-[calc(100%+0.5rem)] z-50 min-w-[12rem] origin-top-right rounded-2xl border border-border bg-popover p-1.5 shadow-card transition-all duration-150",
          isOpen
            ? "pointer-events-auto scale-100 opacity-100"
            : "pointer-events-none scale-95 opacity-0",
        )}
        role="listbox"
        aria-label={t("languageSelector.selectLanguage")}
        aria-hidden={!isOpen}
      >
        {locales.map((loc) => {
          const active = loc === locale;
          return (
            <button
              key={loc}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors hover:bg-secondary",
                active && "text-foreground",
              )}
              onClick={() => handleLocaleChange(loc)}
              role="option"
              aria-selected={active}
              type="button"
              tabIndex={isOpen ? 0 : -1}
            >
              <span className="flex shrink-0 items-center">
                <FlagIcon locale={loc} />
              </span>
              <span className="flex-1">{localeNames[loc]}</span>
              <Check
                className={cn(
                  "size-4 text-primary transition-opacity",
                  active ? "opacity-100" : "opacity-0",
                )}
                strokeWidth={2.5}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};
