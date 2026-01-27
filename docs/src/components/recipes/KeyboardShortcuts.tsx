const SHORTCUTS = [
  { keys: ['/', 'Tab'], action: 'Open block toolbox (slash menu)' },
  { keys: ['Cmd/Ctrl', 'B'], action: 'Bold text' },
  { keys: ['Cmd/Ctrl', 'I'], action: 'Italic text' },
  { keys: ['Cmd/Ctrl', 'U'], action: 'Underline text' },
  { keys: ['Cmd/Ctrl', 'K'], action: 'Create link' },
  { keys: ['Cmd/Ctrl', 'Z'], action: 'Undo' },
  { keys: ['Cmd/Ctrl', 'Shift', 'Z'], action: 'Redo' },
  { keys: ['Enter'], action: 'Create new block' },
  { keys: ['Backspace'], action: 'Delete empty block / merge with previous' },
  { keys: ['Tab'], action: 'Indent list item' },
  { keys: ['Shift', 'Tab'], action: 'Outdent list item' },
];

export const KeyboardShortcuts: React.FC = () => {
  return (
    <div className="shortcuts-wrapper" data-blok-testid="keyboard-shortcuts">
      <table className="shortcuts-table">
        <thead>
          <tr>
            <th>Shortcut</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map((shortcut, index) => (
            <tr key={index}>
              <td>
                {shortcut.keys.map((key, keyIndex) => (
                  <span key={keyIndex}>
                    <kbd>{key}</kbd>
                    {keyIndex < shortcut.keys.length - 1 && ' + '}
                  </span>
                ))}
              </td>
              <td>{shortcut.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
