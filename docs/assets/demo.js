/**
 * Demo Page Script
 * Initializes the Blok editor and handles toolbar actions
 */

import { Blok } from '/dist/full.mjs';

let editor = null;

/**
 * Initialize the Blok editor
 */
async function initEditor() {
  try {
    const editorHolder = document.getElementById('blok-editor');
    const placeholder = editorHolder.querySelector('.editor-placeholder');

    // Remove placeholder
    if (placeholder) {
      placeholder.remove();
    }

    // Create the editor
    editor = new Blok({
      holder: 'blok-editor',
      tools: {
        header: {
          class: window.BlokHeader,
          config: {
            placeholder: 'Enter a header...',
            levels: [1, 2, 3, 4],
            defaultLevel: 2
          },
          inlineToolbar: ['bold', 'italic', 'link']
        },
        paragraph: {
          class: window.BlokParagraph,
          inlineToolbar: ['bold', 'italic', 'link'],
          config: {
            preserveBlank: true,
            placeholder: 'Type "/" for commands...'
          }
        },
        list: {
          class: window.BlokList,
          inlineToolbar: true,
          config: {
            defaultStyle: 'unordered'
          }
        }
      },
      data: {
        blocks: [
          {
            id: 'welcome-block',
            type: 'header',
            data: {
              text: 'Welcome to Blok',
              level: 2
            }
          },
          {
            id: 'intro-block',
            type: 'paragraph',
            data: {
              text: 'This is a live demo of the Blok editor. Try typing <code>/</code> to see available commands, or select text to format it.'
            }
          },
          {
            id: 'features-list',
            type: 'list',
            data: {
              style: 'unordered',
              items: [
                'Block-based architecture',
                'Slash commands for quick formatting',
                'Drag and drop to reorder blocks',
                'Clean JSON output'
              ]
            }
          }
        ]
      },
      onChange: () => {
        // Optional: Auto-save indicator
        console.log('Content changed');
      },
      onReady: () => {
        console.log('Blok editor is ready!');
      }
    });

    // Store tools globally for inline toolbar
    window.blokEditor = editor;

  } catch (error) {
    console.error('Failed to initialize Blok editor:', error);
    const editorHolder = document.getElementById('blok-editor');
    editorHolder.innerHTML = `
      <div style="padding: 2rem; text-align: center; color: var(--demo-text-muted);">
        <p style="font-weight: 600; margin-bottom: 0.5rem;">Failed to load editor</p>
        <p style="font-size: 14px;">Make sure the server is running with <code>node scripts/serve-docs.mjs</code></p>
        <p style="font-size: 12px; margin-top: 1rem;">Error: ${error.message}</p>
      </div>
    `;
  }
}

/**
 * Show toast notification
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');

  toastMessage.textContent = message;
  toast.classList.add('visible');

  setTimeout(() => {
    toast.classList.remove('visible');
  }, 2500);
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard!');
  } catch (err) {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showToast('Copied to clipboard!');
    } catch (e) {
      showToast('Failed to copy');
    }
    document.body.removeChild(textarea);
  }
}

/**
 * Format JSON for display
 */
function formatJSON(obj) {
  return JSON.stringify(obj, null, 2);
}

/**
 * Setup toolbar event listeners
 */
function setupToolbar() {
  // Undo button
  const undoBtn = document.querySelector('[data-action="undo"]');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      if (editor) {
        editor.undo().catch(err => console.error('Undo failed:', err));
      }
    });
  }

  // Redo button
  const redoBtn = document.querySelector('[data-action="redo"]');
  if (redoBtn) {
    redoBtn.addEventListener('click', () => {
      if (editor) {
        editor.redo().catch(err => console.error('Redo failed:', err));
      }
    });
  }

  // Save button
  const saveBtn = document.querySelector('[data-action="save"]');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      if (editor) {
        try {
          const data = await editor.save();
          const outputContent = document.getElementById('output-content');
          outputContent.textContent = formatJSON(data);
          showToast('Content saved!');
        } catch (err) {
          console.error('Save failed:', err);
          showToast('Failed to save');
        }
      }
    });
  }

  // Clear button
  const clearBtn = document.querySelector('[data-action="clear"]');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (editor) {
        try {
          await editor.clear();
          showToast('Editor cleared');
        } catch (err) {
          console.error('Clear failed:', err);
        }
      }
    });
  }

  // Copy output button
  const copyOutputBtn = document.querySelector('[data-copy-output]');
  if (copyOutputBtn) {
    copyOutputBtn.addEventListener('click', () => {
      const outputContent = document.getElementById('output-content');
      const text = outputContent.textContent;

      if (text && text !== 'Click "Save" to see the JSON output') {
        copyToClipboard(text);

        // Update button state
        copyOutputBtn.classList.add('copied');
        const copyText = copyOutputBtn.querySelector('.copy-text');
        if (copyText) {
          copyText.textContent = 'Copied!';
        }

        setTimeout(() => {
          copyOutputBtn.classList.remove('copied');
          if (copyText) {
            copyText.textContent = 'Copy';
          }
        }, 2000);
      }
    });
  }
}

/**
 * Initialize the demo page
 */
async function init() {
  // Load the full.mjs to get access to the tools
  try {
    // Import the full bundle which includes all tools
    const module = await import('/dist/full.mjs');

    // Store tools on window for the editor config
    window.BlokHeader = module.Header;
    window.BlokParagraph = module.Paragraph;
    window.BlokList = module.List;
    window.BlokBold = module.Bold;
    window.BlokItalic = module.Italic;
    window.BlokLink = module.Link;

    // Initialize the editor
    await initEditor();
  } catch (error) {
    console.error('Failed to load Blok module:', error);
  }

  // Setup toolbar
  setupToolbar();
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
