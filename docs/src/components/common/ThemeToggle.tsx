import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "../../contexts/I18nContext";
import { Button } from "@/components/ui/button";
import { trackEvent, ANALYTICS_EVENTS } from "@/lib/analytics";

/**
 * Theme toggle button that cycles between light and dark modes.
 * Displays appropriate icon based on current theme.
 */
export const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();

  const label = theme === "dark" ? t("theme.dark") : t("theme.light");

  const handleClick = () => {
    // Report the theme the reader is moving TO — that is the choice being made.
    trackEvent(ANALYTICS_EVENTS.toggleTheme, {
      theme: theme === "dark" ? "light" : "dark",
    });
    toggleTheme();
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={handleClick}
      className="rounded-full text-foreground/80 hover:text-foreground"
      aria-label={`Toggle theme (current: ${label})`}
      title={label}
    >
      <span className="relative flex size-[18px] items-center justify-center">
        {/* `key` remounts the glyph on theme change so the enter animation
            replays — a soft rotate-and-fade swap rather than a hard cut. */}
        {theme === "dark" ? (
          <MoonIcon
            key="moon"
            className="size-[18px] animate-in fade-in zoom-in-95 spin-in-45 fill-mode-both duration-300 ease-out motion-reduce:animate-none"
            strokeWidth={2}
          />
        ) : (
          <SunIcon
            key="sun"
            className="size-[18px] animate-in fade-in zoom-in-95 spin-in-45 fill-mode-both duration-300 ease-out motion-reduce:animate-none"
            strokeWidth={2}
          />
        )}
      </span>
    </Button>
  );
};
