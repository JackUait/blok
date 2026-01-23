/**
 * API Documentation JavaScript
 */

(function() {
  'use strict';

  // ============================================
  // Active Section Highlighting
  // ============================================

  function initActiveSection() {
    const sections = document.querySelectorAll('.api-section[id]');
    const navLinks = document.querySelectorAll('.api-sidebar-link');

    const observerOptions = {
      rootMargin: '-100px 0px -70% 0px'
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');

          navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${id}`) {
              link.classList.add('active');
            }
          });
        }
      });
    }, observerOptions);

    sections.forEach(section => observer.observe(section));
  }

  initActiveSection();

  // ============================================
  // Smooth Scroll with Offset
  // ============================================

  document.querySelectorAll('.api-sidebar-link[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      const target = document.querySelector(href);

      if (target) {
        e.preventDefault();

        const navHeight = 52;
        const targetPosition = target.getBoundingClientRect().top + window.scrollY - navHeight - 24;

        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      }
    });
  });

  // ============================================
  // Initialize Copy Buttons
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

})();
