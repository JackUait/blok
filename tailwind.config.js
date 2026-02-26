/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './public/**/*.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './.storybook/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: ['class', 'dark-mode'],
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
        // Core editor colors (from variables.css)
        'selection': '#e1f2ff',
        'selection-inline': '#d4ecff',
        'selection-highlight': 'rgba(46, 170, 220, 0.2)',
        'bg-light': '#eff2f5',
        'gray-text': '#707684',
        'dark': '#1d202b',
        'active-icon': '#388ae5',
        'link': '#388ae5',
        'line-gray': '#eff0f1',

        // Tooltip colors (from tooltip.css)
        'tooltip-bg': '#1d202b',
        'tooltip-font': '#cdd1e0',

        // Interactive states (from inline-toolbar.css & popover.css)
        'icon-active-bg': 'rgba(56, 138, 229, 0.1)',
        'icon-active-text': '#388ae5',
        'text-primary': 'black',
        'text-secondary': '#707684',

        // Popover colors (from popover.css)
        'popover-border': '#eff0f1',
        'popover-shadow': 'rgba(13, 20, 33, 0.1)',
        'popover-bg': '#ffffff',
        'popover-border-icon': 'rgb(201 201 204 / 48%)',
        'popover-border-icon-disabled': '#eff0f1',
        'item-focus-bg': 'rgba(34, 186, 255, 0.08)',
        'item-focus-shadow': 'rgba(7, 161, 227, 0.08)',
        'item-hover-bg': '#f8f8f8',
        'item-confirm-bg': '#e24a4a',
        'item-confirm-hover-bg': '#ce4343',
        'item-destructive-text': '#e24a4a',
        'item-destructive-hover-bg': 'rgba(226, 74, 74, 0.08)',

        // Notifier colors (from notifier/index.css)
        'notify-success-bg': '#fafffe',
        'notify-success-bar': '#41ffb1',
        'notify-error-bg': '#fffbfb',
        'notify-error-bar': '#fb5d5d',
        'notify-btn-cancel-bg': '#f2f5f7',
        'notify-btn-cancel-text': '#656b7c',
        'notify-btn-confirm-bg': '#34c992',


      },
      spacing: {
        // Layout (from variables.css)
        'content-width': '650px',
        'narrow-mode-right-padding': '50px',

        // Toolbox sizing (from variables.css)
        'toolbox-btn': '26px',
        'toolbox-btn-mobile': '36px',

        // Icon sizing (from variables.css)
        'icon': '20px',
        'icon-mobile': '28px',

        // Block spacing (from variables.css)
        'block-padding-vertical': '0.4em',
      },
      maxWidth: {
        'content': '650px',
      },
      width: {
        'toolbox-btn': '26px',
        'toolbox-btn-mobile': '36px',
        'icon': '20px',
        'icon-mobile': '28px',
      },
      height: {
        'toolbox-btn': '26px',
        'toolbox-btn-mobile': '36px',
        'icon': '20px',
        'icon-mobile': '28px',
      },
      fontFamily: {
        mono: ['PT Mono', 'Menlo', 'Monaco', 'Consolas', 'Courier New', 'monospace'],
      },
      boxShadow: {
        'overlay-pane': '0 3px 15px -3px rgba(13, 20, 33, 0.13)',
        'tool-icon': '0 0 0 1px #eff0f1',
        'tooltip': '0 8px 12px 0 rgba(29, 32, 43, 0.17), 0 4px 5px -3px rgba(5, 6, 12, 0.49)',
        'notify': '0 11px 17px 0 rgba(23, 32, 61, 0.13)',
        'button-focused': 'inset 0 0 0 1px rgba(7, 161, 227, 0.08)',
        'input': 'inset 0 1px 2px 0 rgba(35, 44, 72, 0.06)',
        'button-base': '0 2px 2px 0 rgba(18, 30, 57, 0.04)',
        'button-base-hover': '0 1px 3px 0 rgba(18, 30, 57, 0.08)',
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
        'rotation': 'rotation 1.2s infinite linear',
        'notify-bounce-in': 'notifyBounceIn 600ms 1',
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
        'rotation': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'notifyBounceIn': {
          '0%': { opacity: '0', transform: 'scale(0.3)' },
          '50%': { opacity: '1', transform: 'scale(1.05)' },
          '70%': { transform: 'scale(0.9)' },
          '100%': { transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
