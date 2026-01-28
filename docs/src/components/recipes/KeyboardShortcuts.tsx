interface ShortcutGroup {
  category: string;
  icon: React.ReactNode;
  shortcuts: { keys: string[]; action: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    category: 'Navigation',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="3 11 22 2 13 21 11 13 3 11" />
      </svg>
    ),
    shortcuts: [
      { keys: ['/', 'Tab'], action: 'Open block toolbox' },
      { keys: ['Enter'], action: 'Create new block' },
      { keys: ['Backspace'], action: 'Delete / merge block' },
    ],
  },
  {
    category: 'Formatting',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7V4h16v3" />
        <path d="M9 20h6" />
        <path d="M12 4v16" />
      </svg>
    ),
    shortcuts: [
      { keys: ['⌘', 'B'], action: 'Bold' },
      { keys: ['⌘', 'I'], action: 'Italic' },
      { keys: ['⌘', 'U'], action: 'Underline' },
      { keys: ['⌘', 'K'], action: 'Link' },
    ],
  },
  {
    category: 'History',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M12 7v5l4 2" />
      </svg>
    ),
    shortcuts: [
      { keys: ['⌘', 'Z'], action: 'Undo' },
      { keys: ['⌘', '⇧', 'Z'], action: 'Redo' },
    ],
  },
  {
    category: 'Lists',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    ),
    shortcuts: [
      { keys: ['Tab'], action: 'Indent' },
      { keys: ['⇧', 'Tab'], action: 'Outdent' },
    ],
  },
];

const KeyCap: React.FC<{ children: string; isModifier?: boolean }> = ({ children, isModifier }) => {
  const isSymbol = ['⌘', '⇧', '⌥', '⌃'].includes(children);
  return (
    <kbd className={`shortcuts-kbd ${isModifier ? 'shortcuts-kbd--modifier' : ''} ${isSymbol ? 'shortcuts-kbd--symbol' : ''}`}>
      {children}
    </kbd>
  );
};

export const KeyboardShortcuts: React.FC = () => {
  return (
    <div className="shortcuts-wrapper" data-blok-testid="keyboard-shortcuts">
      <div className="shortcuts-header">
        <div className="shortcuts-header-text">
          <h3 className="shortcuts-title">Keyboard Reference</h3>
          <p className="shortcuts-subtitle">Master Blok with these essential shortcuts</p>
        </div>
        <div className="shortcuts-platform-hint">
          <span className="shortcuts-platform-badge">⌘ = Cmd (Mac) / Ctrl (Win)</span>
        </div>
      </div>
      
      <div className="shortcuts-grid">
        {SHORTCUT_GROUPS.map((group, groupIndex) => (
          <div key={groupIndex} className="shortcuts-category" style={{ '--delay': `${groupIndex * 50}ms` } as React.CSSProperties}>
            <div className="shortcuts-category-header">
              <span className="shortcuts-category-icon">{group.icon}</span>
              <span className="shortcuts-category-name">{group.category}</span>
            </div>
            <ul className="shortcuts-list">
              {group.shortcuts.map((shortcut, index) => (
                <li key={index} className="shortcuts-item">
                  <span className="shortcuts-keys">
                    {shortcut.keys.map((key, keyIndex) => (
                      <span key={keyIndex} className="shortcuts-key-group">
                        <KeyCap isModifier={keyIndex < shortcut.keys.length - 1}>{key}</KeyCap>
                        {keyIndex < shortcut.keys.length - 1 && (
                          <span className="shortcuts-plus">+</span>
                        )}
                      </span>
                    ))}
                  </span>
                  <span className="shortcuts-action">{shortcut.action}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      
      <div className="shortcuts-footer">
        <span className="shortcuts-footer-icon">✦</span>
        <span>More shortcuts available in the toolbox menu</span>
      </div>
    </div>
  );
};
