/**
 * Blok Documentation - Main JavaScript
 */

(function() {
  'use strict';

  // ============================================
  // Navigation
  // ============================================

  const nav = document.querySelector('[data-nav]');
  const navToggle = document.querySelector('[data-nav-toggle]');

  let lastScrollY = 0;
  let navHidden = false;

  function updateNav() {
    const scrollY = window.scrollY;

    if (scrollY > 100) {
      if (scrollY > lastScrollY && !navHidden) {
        nav.style.transform = 'translateY(-100%)';
        navHidden = true;
      } else if (scrollY < lastScrollY && navHidden) {
        nav.style.transform = 'translateY(0)';
        navHidden = false;
      }
    } else {
      nav.style.transform = 'translateY(0)';
      navHidden = false;
    }

    lastScrollY = scrollY;
  }

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        updateNav();
        ticking = false;
      });
      ticking = true;
    }
  });

  // Mobile menu toggle
  if (navToggle) {
    navToggle.addEventListener('click', () => {
      navToggle.classList.toggle('active');
      const navLinks = document.querySelector('.nav-links');
      if (navLinks) {
        navLinks.classList.toggle('open');
      }
    });
  }

  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      if (href === '#') return;

      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });

  // ============================================
  // Copy to Clipboard
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
          // Fallback for older browsers
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
  // Intersection Observer for Animations
  // ============================================

  function initScrollAnimations() {
    const observerOptions = {
      root: null,
      rootMargin: '0px 0px -100px 0px',
      threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-in');
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    // Feature cards
    document.querySelectorAll('[data-feature-card]').forEach((el, index) => {
      el.style.animationDelay = `${index * 0.05}s`;
      observer.observe(el);
    });

    // Install steps
    document.querySelectorAll('[data-install-step]').forEach((el, index) => {
      el.style.animationDelay = `${index * 0.1}s`;
      observer.observe(el);
    });
  }

  initScrollAnimations();

  // ============================================
  // Code Syntax Highlighting (Basic)
  // ============================================

  function highlightCode() {
    const codeBlocks = document.querySelectorAll('code');

    codeBlocks.forEach(block => {
      let html = block.innerHTML;

      // Keywords
      html = html.replace(/\b(import|from|const|let|var|function|class|new|return|if|else|async|await|export|default)\b/g, '<span class="token-keyword">$1</span>');

      // Strings
      html = html.replace(/(['"`])(.*?)\1/g, '<span class="token-string">$1$2$1</span>');

      // Comments
      html = html.replace(/(\/\/.*)/g, '<span class="token-comment">$1</span>');

      // Numbers
      html = html.replace(/\b(\d+)\b/g, '<span class="token-number">$1</span>');

      // Functions
      html = html.replace(/\b([a-zA-Z_]\w*)\s*\(/g, '<span class="token-function">$1</span>(');

      block.innerHTML = html;
    });
  }

  highlightCode();

  // ============================================
  // Dynamic Hero Demo
  // ============================================

  function initHeroDemo() {
    const demo = document.querySelector('[data-hero-demo]');
    if (!demo) return;

    const blocks = demo.querySelectorAll('.editor-block');

    // Add hover effect to blocks
    blocks.forEach(block => {
      block.addEventListener('mouseenter', () => {
        blocks.forEach(b => {
          if (b !== block) {
            b.style.opacity = '0.6';
          }
        });
      });

      block.addEventListener('mouseleave', () => {
        blocks.forEach(b => {
          b.style.opacity = '1';
        });
      });
    });
  }

  initHeroDemo();

  // ============================================
  // Theme Detection
  // ============================================

  function detectTheme() {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    document.documentElement.classList.toggle('dark-theme', prefersDark);

    // Listen for theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      document.documentElement.classList.toggle('dark-theme', e.matches);
    });
  }

  detectTheme();

  // ============================================
  // Add animate-in styles dynamically
  // ============================================

  const style = document.createElement('style');
  style.textContent = `
    [data-feature-card],
    [data-install-step] {
      opacity: 0;
      transform: translateY(20px);
      transition: opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1),
                  transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }

    [data-feature-card].animate-in,
    [data-install-step].animate-in {
      opacity: 1;
      transform: translateY(0);
    }
  `;
  document.head.appendChild(style);

})();
