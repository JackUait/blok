/**
 * Migration Guide JavaScript
 */

(function() {
  'use strict';

  // ============================================
  // Codemod Tabs
  // ============================================

  function initTabs() {
    const tabs = document.querySelectorAll('.codemod-tab');
    const panels = document.querySelectorAll('.codemod-panel');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-tab');

        // Update tabs
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Update panels
        panels.forEach(panel => {
          if (panel.getAttribute('data-panel') === target) {
            panel.classList.add('active');
          } else {
            panel.classList.remove('active');
          }
        });
      });
    });
  }

  initTabs();

  // ============================================
  // Copy Buttons
  // ============================================

  function initCopyButtons() {
    const copyButtons = document.querySelectorAll('[data-copy]');

    copyButtons.forEach(button => {
      button.addEventListener('click', async () => {
        const code = button.getAttribute('data-code');
        const textElement = button.querySelector('.code-copy-text');

        try {
          await navigator.clipboard.writeText(code);
          button.classList.add('copied');
          textElement.textContent = 'Copied!';

          setTimeout(() => {
            button.classList.remove('copied');
            textElement.textContent = 'Copy';
          }, 2000);
        } catch (err) {
          const textArea = document.createElement('textarea');
          textArea.value = code;
          textArea.style.position = 'fixed';
          textArea.style.left = '-9999px';
          document.body.appendChild(textArea);
          textArea.select();

          try {
            document.execCommand('copy');
            button.classList.add('copied');
            textElement.textContent = 'Copied!';

            setTimeout(() => {
              button.classList.remove('copied');
              textElement.textContent = 'Copy';
            }, 2000);
          } catch (fallbackErr) {
            textElement.textContent = 'Failed';
          }

          document.body.removeChild(textArea);
        }
      });
    });
  }

  initCopyButtons();

  // ============================================
  // Checklist Persistence
  // ============================================

  function initChecklist() {
    const checkboxes = document.querySelectorAll('.checklist-item input[type="checkbox"]');

    // Load saved state
    const savedState = localStorage.getItem('blok-migration-checklist');
    if (savedState) {
      const state = JSON.parse(savedState);
      checkboxes.forEach((checkbox, index) => {
        if (state[index]) {
          checkbox.checked = true;
        }
      });
    }

    // Save state on change
    checkboxes.forEach((checkbox, index) => {
      checkbox.addEventListener('change', () => {
        const state = {};
        checkboxes.forEach((cb, i) => {
          state[i] = cb.checked;
        });
        localStorage.setItem('blok-migration-checklist', JSON.stringify(state));
      });
    });
  }

  initChecklist();

})();
