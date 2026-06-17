import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "../../contexts/I18nContext";
import { Button } from "@/components/ui/button";

/**
 * Theme toggle button that cycles between light and dark modes.
 * Displays appropriate icon based on current theme.
 */
export const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();

  const label = theme === "dark" ? t("theme.dark") : t("theme.light");

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={toggleTheme}
      className="rounded-full text-foreground/80 hover:text-foreground"
      aria-label={`Toggle theme (current: ${label})`}
      title={label}
    >
      <span className="relative flex size-[18px] items-center justify-center">
        {theme === "dark" ? (
          <MoonIcon className="size-[18px]" strokeWidth={2} />
        ) : (
          <SunIcon className="size-[18px]" strokeWidth={2} />
        )}
      </span>
    </Button>
  );
};
