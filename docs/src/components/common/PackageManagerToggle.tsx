import { useState } from "react";
import { useI18n } from '../../contexts/I18nContext';
import { cn } from "@/lib/utils";
import { trackEvent, ANALYTICS_EVENTS } from "@/lib/analytics";

export type PackageManager = "yarn" | "npm" | "bun";

interface PackageManagerToggleProps {
  onChange?: (manager: PackageManager) => void;
}

const PACKAGE_MANAGERS: PackageManager[] = ["yarn", "npm", "bun"];

export const PackageManagerToggle: React.FC<PackageManagerToggleProps> = ({
  onChange,
}) => {
  const [selected, setSelected] = useState<PackageManager>("yarn");
  const { t } = useI18n();

  const handleClick = (manager: PackageManager) => {
    // Re-clicking the active segment changes nothing, so it is not a selection.
    if (manager !== selected) {
      trackEvent(ANALYTICS_EVENTS.selectPackageManager, { manager });
    }
    setSelected(manager);
    onChange?.(manager);
  };

  const selectedIndex = PACKAGE_MANAGERS.indexOf(selected);

  return (
    <div
      className="relative inline-grid grid-cols-3 items-center rounded-full bg-secondary p-0.5"
      data-package-manager-toggle
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-full bg-background shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        style={{
          width: "calc((100% - 0.25rem) / 3)",
          transform: `translateX(${selectedIndex * 100}%)`,
        }}
      />
      {PACKAGE_MANAGERS.map((manager) => {
        const isActive = selected === manager;
        return (
          <button
            key={manager}
            type="button"
            className={cn(
              "relative z-10 cursor-pointer rounded-full px-3 py-1 text-center text-[13px] font-medium lowercase transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              isActive
                ? "active font-semibold text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => handleClick(manager)}
            aria-pressed={isActive}
            aria-label={`${t('packageManagerToggle.switchAriaPrefix')} ${manager}`}
          >
            {manager}
          </button>
        );
      })}
    </div>
  );
};

/**
 * Returns the install command for a given package and manager
 */
export const getInstallCommand = (
  packageName: string,
  manager: PackageManager,
): string => {
  switch (manager) {
    case "yarn":
      return `yarn add ${packageName}`;
    case "npm":
      return `npm install ${packageName}`;
    case "bun":
      return `bun add ${packageName}`;
    default:
      return `npm install ${packageName}`;
  }
};
