import { colorVarName } from '../shared/color-presets';
import { mapToNearestPresetName } from './color-mapping';

const PROPS = ['color', 'background-color'] as const;
type Prop = typeof PROPS[number];

const PROP_MODE: Record<Prop, 'text' | 'bg'> = {
  'color': 'text',
  'background-color': 'bg',
};

/**
 * Scan all <mark> elements inside container and replace raw hex color/background-color
 * inline style values with their corresponding CSS custom property references.
 *
 * Safe to call multiple times — already-migrated var() values and 'transparent' are
 * left unchanged.
 *
 * @param container - Root element to search within (e.g. the editor redactor node)
 */
export function migrateMarkColors(container: Element): void {
  container.querySelectorAll('mark').forEach((mark) => {
    const el = mark as HTMLElement;

    for (const prop of PROPS) {
      const value = el.style.getPropertyValue(prop);

      if (!value || value === 'transparent' || value.startsWith('var(')) {
        continue;
      }

      const name = mapToNearestPresetName(value, PROP_MODE[prop]);

      if (name !== null) {
        el.style.setProperty(prop, colorVarName(name, PROP_MODE[prop]));
      }
    }
  });
}
