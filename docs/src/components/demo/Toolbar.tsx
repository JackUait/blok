interface ToolbarProps {
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onClear: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  onUndo,
  onRedo,
  onSave,
  onClear,
  canUndo = true,
  canRedo = true,
}) => {
  return (
    <div className="demo-toolbar">
      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo"
          type="button"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M9 14L4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
          </svg>
        </button>
        <button
          className="toolbar-btn"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo"
          type="button"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M15 14l5-5-5-5" />
            <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13" />
          </svg>
        </button>
      </div>
      <div className="toolbar-divider"></div>
      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={onSave}
          title="Save JSON"
          type="button"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
          <span>Save</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={onClear}
          title="Clear Editor"
          type="button"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          <span>Clear</span>
        </button>
      </div>
    </div>
  );
};
