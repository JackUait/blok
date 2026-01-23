import { useState } from 'react';

export type PackageManager = 'yarn' | 'npm' | 'bun';

interface PackageManagerToggleProps {
  onChange?: (manager: PackageManager) => void;
}

const PACKAGE_MANAGERS: PackageManager[] = ['yarn', 'npm', 'bun'];

export const PackageManagerToggle: React.FC<PackageManagerToggleProps> = ({
  onChange,
}) => {
  const [selected, setSelected] = useState<PackageManager>('yarn');

  const handleClick = (manager: PackageManager) => {
    setSelected(manager);
    onChange?.(manager);
  };

  return (
    <div className="package-manager-toggle" data-package-manager-toggle>
      {PACKAGE_MANAGERS.map((manager) => (
        <button
          key={manager}
          type="button"
          className={`package-manager-option ${selected === manager ? 'active' : ''}`}
          onClick={() => handleClick(manager)}
          aria-pressed={selected === manager}
          aria-label={`Switch to ${manager} command`}
        >
          {manager}
        </button>
      ))}
    </div>
  );
};

/**
 * Returns the install command for a given package and manager
 */
export const getInstallCommand = (
  packageName: string,
  manager: PackageManager
): string => {
  switch (manager) {
    case 'yarn':
      return `yarn add ${packageName}`;
    case 'npm':
      return `npm install ${packageName}`;
    case 'bun':
      return `bun add ${packageName}`;
    default:
      return `npm install ${packageName}`;
  }
};
