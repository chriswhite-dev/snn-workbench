import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0c0b09',
        surface: '#111009',
        raised: '#1f1d19',
        border: '#3a3728',
        accent: '#d4622a',
        text: {
          primary: '#f7f3eb',
          secondary: '#cbbcac',
          muted: '#9e8f7e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
} satisfies Config
