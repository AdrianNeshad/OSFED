/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        base: 'var(--bg-base)',
        surface: 'var(--bg-surface)',
        elevated: 'var(--bg-elevated)',
        overlay: 'var(--bg-overlay)',
        sidebar: {
          DEFAULT: 'var(--bg-sidebar)',
          active: 'var(--bg-sidebar-active)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          subtle: 'var(--accent-subtle)',
        },
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary': 'var(--text-tertiary)',
        'text-accent': 'var(--accent)',
        'border-subtle': 'var(--border-subtle)',
        'border-default': 'var(--border-default)',
        'border-strong': 'var(--border-strong)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        error: 'var(--error)',
        info: 'var(--info)',
        'imessage-blue': '#007AFF',
        'imessage-green': '#34C759',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        md: '8px',
        lg: '10px',
        xl: '14px',
      },
      boxShadow: {
        card: '0 2px 8px rgba(0,0,0,0.14)',
        elevated: '0 8px 30px rgba(0,0,0,0.28)',
        focus: '0 0 0 3px var(--accent-subtle)',
      },
      fontSize: {
        caption: ['11px', { lineHeight: '14px', letterSpacing: '0.01em' }],
        body: ['13px', { lineHeight: '20px' }],
        subhead: ['15px', { lineHeight: '22px', letterSpacing: '-0.01em' }],
        title: ['20px', { lineHeight: '26px', letterSpacing: '-0.015em' }],
      },
    },
  },
  plugins: [],
};
