/**
 * Supported modifier commands and their aliases
 */
const SUPPORTED_COMMANDS = {
  SHIFT: ['SHIFT'],
  CMD: ['CMD', 'CONTROL', 'COMMAND', 'WINDOWS', 'CTRL'],
  ALT: ['ALT', 'OPTION'],
} as const;

/**
 * Key name mappings to event.code values
 */
const KEY_CODES: Record<string, string> = {
  '0': 'Digit0',
  '1': 'Digit1',
  '2': 'Digit2',
  '3': 'Digit3',
  '4': 'Digit4',
  '5': 'Digit5',
  '6': 'Digit6',
  '7': 'Digit7',
  '8': 'Digit8',
  '9': 'Digit9',
  'A': 'KeyA',
  'B': 'KeyB',
  'C': 'KeyC',
  'D': 'KeyD',
  'E': 'KeyE',
  'F': 'KeyF',
  'G': 'KeyG',
  'H': 'KeyH',
  'I': 'KeyI',
  'J': 'KeyJ',
  'K': 'KeyK',
  'L': 'KeyL',
  'M': 'KeyM',
  'N': 'KeyN',
  'O': 'KeyO',
  'P': 'KeyP',
  'Q': 'KeyQ',
  'R': 'KeyR',
  'S': 'KeyS',
  'T': 'KeyT',
  'U': 'KeyU',
  'V': 'KeyV',
  'W': 'KeyW',
  'X': 'KeyX',
  'Y': 'KeyY',
  'Z': 'KeyZ',
  'BACKSPACE': 'Backspace',
  'ENTER': 'Enter',
  'ESCAPE': 'Escape',
  'LEFT': 'ArrowLeft',
  'UP': 'ArrowUp',
  'RIGHT': 'ArrowRight',
  'DOWN': 'ArrowDown',
  'INSERT': 'Insert',
  'DELETE': 'Delete',
  '.': 'Period',
};

type ModifierKey = keyof typeof SUPPORTED_COMMANDS;

/**
 * Finds the modifier key that matches the given alias
 * @param alias - The alias to check (e.g., 'CMD', 'CTRL', 'OPTION')
 * @returns The modifier key if found, undefined otherwise
 */
const findModifierKey = (alias: string): ModifierKey | undefined => {
  const modifierKeys = Object.keys(SUPPORTED_COMMANDS) as ModifierKey[];

  return modifierKeys.find((command) =>
    SUPPORTED_COMMANDS[command].includes(alias as never)
  );
};

/**
 * Options for creating a keyboard shortcut
 */
export interface ShortcutOptions {
  /**
   * Shortcut name (e.g., 'CMD+K', 'CMD+B')
   */
  name: string;

  /**
   * Element to attach the shortcut to
   */
  on: HTMLElement | Document;

  /**
   * Callback function to execute when shortcut is triggered
   */
  callback: (event: KeyboardEvent) => void;
}

/**
 * Shortcut class for handling keyboard shortcuts
 *
 * Listens for keydown events on the specified element and executes
 * the callback when the configured key combination is pressed.
 */
export class Shortcut {
  /**
   * Shortcut name
   */
  public name: string;

  /**
   * Parsed modifier commands state
   */
  private commands: Record<ModifierKey, boolean>;

  /**
   * Parsed key codes to match
   */
  private keys: Record<string, boolean>;

  /**
   * Element the shortcut is attached to
   */
  private element: HTMLElement | Document;

  /**
   * Callback to execute when shortcut is triggered
   */
  private callback: (event: KeyboardEvent) => void;

  /**
   * Bound event handler for removal
   */
  private executeShortcut: EventListener;

  /**
   * Creates a new Shortcut instance
   * @param options - Configuration options
   */
  constructor(options: ShortcutOptions) {
    this.commands = {
      SHIFT: false,
      CMD: false,
      ALT: false,
    };
    this.keys = {};
    this.name = options.name;
    this.element = options.on;
    this.callback = options.callback;

    this.parseShortcutName(options.name);

    this.executeShortcut = (event: Event): void => {
      this.execute(event as KeyboardEvent);
    };

    this.element.addEventListener('keydown', this.executeShortcut, false);
  }

  /**
   * Removes the shortcut event listener
   */
  public remove(): void {
    this.element.removeEventListener('keydown', this.executeShortcut);
  }

  /**
   * Parses the shortcut name and extracts modifier keys and regular keys
   * @param name - Shortcut name like 'CMD+K' or 'SHIFT+CMD+B'
   */
  private parseShortcutName(name: string): void {
    const parts = name.split('+');

    for (const part of parts) {
      const upperPart = part.toUpperCase();
      const modifierKey = findModifierKey(upperPart);

      if (modifierKey !== undefined) {
        this.commands[modifierKey] = true;
      } else {
        this.keys[upperPart] = true;
      }
    }
  }

  /**
   * Checks if all modifier commands match the event
   * @param event - Keyboard event to check
   * @returns True if all modifiers match
   */
  private checkModifiers(event: KeyboardEvent): boolean {
    const eventModifiers: Record<ModifierKey, boolean> = {
      CMD: event.ctrlKey || event.metaKey,
      SHIFT: event.shiftKey,
      ALT: event.altKey,
    };

    const modifierKeys = Object.keys(this.commands) as ModifierKey[];

    return modifierKeys.every(
      (command) => this.commands[command] === eventModifiers[command]
    );
  }

  /**
   * Checks if all required keys match the event
   * @param event - Keyboard event to check
   * @returns True if all keys match
   */
  private checkKeys(event: KeyboardEvent): boolean {
    const requiredKeys = Object.keys(this.keys);

    return requiredKeys.every((key) => {
      const expectedCode = KEY_CODES[key];

      return event.code === expectedCode;
    });
  }

  /**
   * Executes the callback if the keyboard event matches the shortcut
   * @param event - Keyboard event to check
   */
  private execute(event: KeyboardEvent): void {
    const commandsMatch = this.checkModifiers(event);
    const keysMatch = this.checkKeys(event);

    if (commandsMatch && keysMatch) {
      this.callback(event);
    }
  }
}

