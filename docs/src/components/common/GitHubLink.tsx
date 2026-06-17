import { useI18n } from "../../contexts/I18nContext";
import { Button } from "@/components/ui/button";

const GITHUB_URL = "https://github.com/JackUait/blok";

/**
 * Link to the project's GitHub repository, rendered as an icon button
 * to match the language and theme controls in the nav.
 */
export const GitHubLink: React.FC = () => {
  const { t } = useI18n();
  const label = t("nav.github");

  return (
    <Button
      asChild
      variant="ghost"
      size="icon-sm"
      className="rounded-full text-foreground/70 hover:text-foreground"
    >
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        title={label}
      >
        <svg
          className="size-[18px]"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.92 1.23 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .32.21.7.82.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
        </svg>
      </a>
    </Button>
  );
};
