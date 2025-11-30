/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './public/**/*.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './.storybook/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      screens: {
        'mobile': { max: '650px' },
        'not-mobile': { min: '651px' },
        'can-hover': { raw: '(hover: hover)' },
      },
      zIndex: {
        overlay: '999',
      },
      colors: {
        // Editor colors (mapped from CSS variables)
        'selection': 'var(--selectionColor)',
        'selection-inline': 'var(--inlineSelectionColor)',
        'selection-highlight': 'rgba(46, 170, 220, 0.2)',
        'bg-light': 'var(--bg-light)',
        'gray-text': 'var(--grayText)',
        'dark': 'var(--color-dark)',
        'active-icon': 'var(--color-active-icon)',
        'link': 'var(--color-link)',
        'line-gray': 'var(--color-line-gray)',
        // Demo colors
        'demo-bg': 'var(--color-bg-main)',
        'demo-border': 'var(--color-border-light)',
        'demo-text': 'var(--color-text-main)',
        'demo-blue': '#4a9df8',
        'demo-blue-hover': '#3d8de5',
        'demo-btn-bg': '#eff1f4',
        'demo-btn-hover': '#e0e4eb',
        'demo-toggler': '#7b8799',
        'demo-dark-btn': '#343842',
      },
      spacing: {
        'content-width': 'var(--content-width)',
        'narrow-mode-right-padding': 'var(--narrow-mode-right-padding)',
        'toolbox-btn': 'var(--toolbox-buttons-size)',
        'toolbox-btn-mobile': 'var(--toolbox-buttons-size--mobile)',
        'icon': 'var(--icon-size)',
        'icon-mobile': 'var(--icon-size--mobile)',
        'block-padding-vertical': 'var(--block-padding-vertical)',
      },
      maxWidth: {
        'content': 'var(--content-width)',
      },
      fontFamily: {
        mono: ['PT Mono', 'Menlo', 'Monaco', 'Consolas', 'Courier New', 'monospace'],
      },
      boxShadow: {
        'overlay-pane': '0 3px 15px -3px rgba(13, 20, 33, 0.13)',
        'tool-icon': '0 0 0 1px var(--color-line-gray)',
        'demo-btn': '0 22px 18px -4px rgba(137, 207, 255, 0.77)',
        'demo-btn-hover': '0 20px 15px -4px rgba(137, 207, 255, 0.77)',
        'demo-btn-primary': '0 7px 8px -4px rgba(137, 207, 255, 0.77)',
        'demo-dark-btn': '0 24px 18px -14px rgba(4, 154, 255, 0.24)',
      },
      animation: {
        'fade-in': 'fade-in 300ms ease forwards',
        'bounce-in': 'bounceIn 0.75s cubic-bezier(0.215, 0.61, 0.355, 1) forwards',
        'selection-bounce': 'selectionBounce 0.75s cubic-bezier(0.215, 0.61, 0.355, 1) forwards',
        'button-clicked': 'buttonClicked 0.75s cubic-bezier(0.215, 0.61, 0.355, 1) forwards',
        'panel-showing': 'panelShowing 100ms ease',
        'panel-showing-mobile': 'panelShowingMobile 250ms ease',
        'wobble': 'wobble 400ms',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'bounceIn': {
          '0%': { transform: 'scale3d(0.9, 0.9, 0.9)' },
          '20%': { transform: 'scale3d(1.03, 1.03, 1.03)' },
          '60%, 100%': { transform: 'scale3d(1, 1, 1)' },
        },
        'selectionBounce': {
          '0%, 100%': { transform: 'scale3d(1, 1, 1)' },
          '50%': { transform: 'scale3d(1.01, 1.01, 1.01)' },
          '70%': { transform: 'scale3d(1, 1, 1)' },
        },
        'buttonClicked': {
          '0%': { transform: 'scale3d(0.95, 0.95, 0.95)' },
          '60%': { transform: 'scale3d(1.02, 1.02, 1.02)' },
          '80%, 100%': { transform: 'scale3d(1, 1, 1)' },
        },
        'panelShowing': {
          from: { opacity: '0', transform: 'translateY(-8px) scale(0.9)' },
          '70%': { opacity: '1', transform: 'translateY(2px)' },
          to: { transform: 'translateY(0)' },
        },
        'panelShowingMobile': {
          from: { opacity: '0', transform: 'translateY(14px) scale(0.98)' },
          '70%': { opacity: '1', transform: 'translateY(-4px)' },
          to: { transform: 'translateY(0)' },
        },
        'wobble': {
          from: { transform: 'translate3d(0, 0, 0)' },
          '15%': { transform: 'translate3d(-9%, 0, 0)' },
          '30%': { transform: 'translate3d(9%, 0, 0)' },
          '45%': { transform: 'translate3d(-4%, 0, 0)' },
          '60%': { transform: 'translate3d(4%, 0, 0)' },
          '75%': { transform: 'translate3d(-1%, 0, 0)' },
          to: { transform: 'translate3d(0, 0, 0)' },
        },
      },
    },
  },
  plugins: [],
};
