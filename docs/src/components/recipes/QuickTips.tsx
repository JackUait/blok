const TIPS = [
  {
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
    title: 'Nest blocks with drag & drop',
    description: 'Drag a block onto another to create nested content. Perfect for building complex layouts.',
  },
  {
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18" />
      </svg>
    ),
    title: 'Use the settings menu',
    description: 'Click the ☰ icon to access block-specific settings like heading levels or list styles.',
  },
  {
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
    title: 'Paste rich content',
    description: 'Paste from Word, Google Docs, or other editors. Blok intelligently converts formatting.',
  },
  {
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
    title: 'Autosave works out of the box',
    description: 'Use the onChange callback to save content automatically as users type.',
  },
];

export const QuickTips: React.FC = () => {
  return (
    <div className="recipe-grid" data-blok-testid="quick-tips">
      {TIPS.map((tip, index) => (
        <div key={index} className="recipe-mini-card">
          <h4 className="recipe-mini-card-title">
            {tip.icon}
            {tip.title}
          </h4>
          <p className="recipe-mini-card-description">{tip.description}</p>
        </div>
      ))}
    </div>
  );
};
