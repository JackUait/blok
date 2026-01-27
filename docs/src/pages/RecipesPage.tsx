import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { CodeBlock } from '../components/common/CodeBlock';
import { RecipeCard } from '../components/recipes/RecipeCard';
import { KeyboardShortcuts } from '../components/recipes/KeyboardShortcuts';
import { QuickTips } from '../components/recipes/QuickTips';
import { NAV_LINKS } from '../utils/constants';
import '../../assets/recipes.css';

const SaveIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

const EventIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
  </svg>
);

const ToolIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

const StyleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="13.5" cy="6.5" r=".5" />
    <circle cx="17.5" cy="10.5" r=".5" />
    <circle cx="8.5" cy="7.5" r=".5" />
    <circle cx="6.5" cy="12.5" r=".5" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z" />
  </svg>
);

const ReadOnlyIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const AUTOSAVE_CODE = `const editor = new Blok({
  holder: 'editor',
  tools: { /* your tools */ },
  onChange: async (api) => {
    const data = await api.saver.save();
    
    // Debounce saves to avoid too many requests
    clearTimeout(window.saveTimeout);
    window.saveTimeout = setTimeout(() => {
      saveToServer(data);
    }, 1000);
  },
});`;

const EVENTS_CODE = `const editor = new Blok({
  holder: 'editor',
  tools: { /* your tools */ },
  onReady: () => {
    console.log('Editor is ready!');
  },
  onChange: (api, event) => {
    console.log('Content changed:', event);
  },
});

// Or listen after initialization
editor.isReady.then(() => {
  // Access the blocks API
  const blocks = editor.blocks;
  console.log('Block count:', blocks.getBlocksCount());
});`;

const CUSTOM_TOOL_CODE = `class AlertTool {
  static get toolbox() {
    return {
      title: 'Alert',
      icon: '<svg>...</svg>',
    };
  }

  constructor({ data }) {
    this.data = data;
  }

  render() {
    const wrapper = document.createElement('div');
    wrapper.classList.add('alert-block');
    wrapper.contentEditable = 'true';
    wrapper.innerHTML = this.data.text || '';
    this.wrapper = wrapper;
    return wrapper;
  }

  save(blockContent) {
    return {
      text: blockContent.innerHTML,
    };
  }
}

// Use it in your config
const editor = new Blok({
  tools: {
    alert: AlertTool,
  },
});`;

const STYLING_CODE = `/* Target Blok elements with data attributes */
[data-blok-holder] {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
}

/* Style specific block types */
[data-blok-block="header"] {
  border-bottom: 1px solid #eee;
  padding-bottom: 0.5rem;
}

/* Customize the toolbar */
[data-blok-toolbox] {
  background: #1a1a1a;
  border-radius: 8px;
}

/* Style the inline toolbar */
[data-blok-inline-toolbar] {
  background: white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}`;

const READONLY_CODE = `// Initialize in read-only mode
const editor = new Blok({
  holder: 'editor',
  tools: { /* your tools */ },
  readOnly: true,
  data: savedContent, // Load your saved content
});

// Toggle read-only mode dynamically
await editor.readOnly.toggle();

// Check current state
const isReadOnly = editor.readOnly.isEnabled;`;

const LocaleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const LOCALE_CODE = `import { Blok } from '@jackuait/blok';
import { preloadLocales, buildRegistry } from '@jackuait/blok/locales';

// Preload during app startup (for offline support or to eliminate loading delay)
await preloadLocales(['en', 'fr', 'de']);

// Build registry from preloaded locales (instant, no network request)
const locales = await buildRegistry(['en', 'fr', 'de']);

new Blok({
  holder: 'editor',
  i18n: {
    locales,
    locale: 'auto', // Auto-detect browser language
  }
});

// Or set a specific locale
new Blok({
  holder: 'editor',
  i18n: {
    locale: 'fr',         // Use French
    defaultLocale: 'en',  // Fallback if 'fr' unavailable
  }
});`;

export const RecipesPage: React.FC = () => {
  return (
    <>
      <Nav links={NAV_LINKS} />
      <main className="recipes-main">
        <section className="recipes-hero">
          <span className="recipes-hero-badge">Cookbook</span>
          <h1 className="recipes-hero-title">Recipes</h1>
          <p className="recipes-hero-description">
            Practical tips, patterns, and code snippets to help you get the most out of Blok.
            From basic setup to advanced customization.
          </p>
        </section>

        <section className="recipes-section">
          <h2 className="recipes-section-title">
            <span className="recipes-section-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
            </span>
            Quick Tips
          </h2>
          <QuickTips />
        </section>

        <section className="recipes-section">
          <h2 className="recipes-section-title">
            <span className="recipes-section-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            Keyboard Shortcuts
          </h2>
          <KeyboardShortcuts />
        </section>

        <section className="recipes-section">
          <h2 className="recipes-section-title">
            <span className="recipes-section-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
            </span>
            Code Recipes
          </h2>

          <RecipeCard
            icon={<SaveIcon />}
            title="Autosave with Debouncing"
            description="Automatically save content as users type, with debouncing to prevent excessive server requests."
            tip="A 1-second debounce is usually a good balance between responsiveness and server load."
          >
            <CodeBlock code={AUTOSAVE_CODE} language="typescript" />
          </RecipeCard>

          <RecipeCard
            icon={<EventIcon />}
            title="Working with Events"
            description="Listen to editor events to integrate with your application's state management or analytics."
          >
            <CodeBlock code={EVENTS_CODE} language="typescript" />
          </RecipeCard>

          <RecipeCard
            icon={<ToolIcon />}
            title="Creating a Custom Tool"
            description="Build your own block type to extend Blok's functionality. This example creates a simple alert/callout block."
            tip="Keep tools focused on a single purpose. For complex needs, compose multiple simple tools."
          >
            <CodeBlock code={CUSTOM_TOOL_CODE} language="typescript" />
          </RecipeCard>

          <RecipeCard
            icon={<StyleIcon />}
            title="Styling with Data Attributes"
            description="Customize Blok's appearance using CSS and data attributes. No need to fight with specificity."
          >
            <CodeBlock code={STYLING_CODE} language="css" />
          </RecipeCard>

          <RecipeCard
            icon={<ReadOnlyIcon />}
            title="Read-Only Mode"
            description="Display saved content without editing capabilities, or toggle between edit and preview modes."
            tip="Read-only mode is perfect for previewing content before publishing or displaying user-generated content."
          >
            <CodeBlock code={READONLY_CODE} language="typescript" />
          </RecipeCard>

          <RecipeCard
            icon={<LocaleIcon />}
            title="Localization with Preloading"
            description="Configure Blok for multiple languages with optional preloading for offline support or instant initialization."
            tip="Most apps can use on-demand loading with buildRegistry() directly—the ~50-100ms delay is usually imperceptible."
          >
            <CodeBlock code={LOCALE_CODE} language="typescript" />
          </RecipeCard>
        </section>

        <section className="recipes-cta">
          <div className="recipes-cta-card">
            <h2>Have a recipe to share?</h2>
            <p>
              We're always looking for new patterns and best practices from the community.
            </p>
            <div className="recipes-cta-actions">
              <a
                href="https://github.com/JackUait/blok/discussions"
                className="btn btn--secondary"
                target="_blank"
                rel="noopener noreferrer"
              >
                Share on GitHub
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
};
