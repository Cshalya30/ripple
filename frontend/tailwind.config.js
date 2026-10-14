/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        sunken: token('sunken'),
        ink: token('ink'),
        muted: token('muted'),
        line: token('line'),
        brand: token('brand'),
        'brand-soft': token('brand-soft'),
        'on-brand': token('on-brand'),
        gain: token('gain'),
        'gain-soft': token('gain-soft'),
        loss: token('loss'),
        'loss-soft': token('loss-soft'),
        warn: token('warn'),
        'warn-soft': token('warn-soft'),
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Instrument Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgb(var(--shadow) / 0.05), 0 8px 24px -8px rgb(var(--shadow) / 0.10)',
        lift: '0 2px 4px rgb(var(--shadow) / 0.06), 0 16px 32px -10px rgb(var(--shadow) / 0.18)',
      },
      keyframes: {
        softPulse: {
          '0%': { transform: 'scale(1)', opacity: '0.45' },
          '70%': { transform: 'scale(1.55)', opacity: '0' },
          '100%': { transform: 'scale(1.55)', opacity: '0' },
        },
        ripple: {
          '0%': { transform: 'scale(0.35)', opacity: '0.5' },
          '100%': { transform: 'scale(1)', opacity: '0' },
        },
        wave: {
          '0%, 100%': { transform: 'scaleY(0.25)' },
          '50%': { transform: 'scaleY(1)' },
        },
        typing: {
          '0%, 80%, 100%': { transform: 'translateY(0)', opacity: '0.4' },
          '40%': { transform: 'translateY(-4px)', opacity: '1' },
        },
      },
      animation: {
        'soft-pulse': 'softPulse 2.6s ease-out infinite',
        ripple: 'ripple 5.4s ease-out infinite',
        wave: 'wave 0.9s ease-in-out infinite',
        typing: 'typing 1.1s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
