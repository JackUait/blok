import { useState } from "react";
import { useI18n } from '../../contexts/I18nContext';
import { cn } from "@/lib/utils";

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
    setSelected(manager);
    onChange?.(manager);
  };

  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary p-1"
      data-package-manager-toggle
    >
      {PACKAGE_MANAGERS.map((manager) => {
        const isActive = selected === manager;
        return (
          <button
            key={manager}
            type="button"
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm font-semibold lowercase transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              isActive
                ? "active bg-background text-foreground shadow-sm"
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
