import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Spec §8: the shell's layered shadow lives here as a named token rather
      // than being repeated as an arbitrary string at every call site.
      boxShadow: {
        shell: '0 30px 70px -28px rgba(58,46,143,0.28)',
      },
      fontFamily: {
        heading: ['var(--font-rajdhani)', 'sans-serif'],
        sans: ['var(--font-plex-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-plex-mono)', 'monospace'],
      },
      backgroundImage: {
        // The one brand gradient: promo and primary CTAs only, never a status.
        brand: 'linear-gradient(135deg,#ec4899,#7c3aed 55%,#4338ca)',
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pop: {
          from: { transform: 'scale(0)', opacity: '0' },
          to: { transform: 'scale(1)', opacity: '1' },
        },
        'card-establish': {
          from: { opacity: '.5', transform: 'translateY(10px) scale(.985)' },
          to: { opacity: '1', transform: 'none' },
        },
        'hud-resolve': {
          from: { opacity: '0', transform: 'translateY(9px) scale(.972)' },
          to: { opacity: '1', transform: 'none' },
        },
        'support-reveal': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        // Only ever applied through Tailwind's `motion-safe:` variant, so
        // prefers-reduced-motion users get the final state with no movement.
        rise: 'rise 0.5s ease-out both',
        pop: 'pop .5s cubic-bezier(.2,.9,.3,1.4) both',
        'card-establish': 'card-establish .76s cubic-bezier(.16,1,.3,1) both',
        'hud-resolve': 'hud-resolve .82s cubic-bezier(.16,1,.3,1) .28s both',
        'support-reveal': 'support-reveal .6s cubic-bezier(.16,1,.3,1) .5s both',
      },
    },
  },
  plugins: [],
};

export default config;
