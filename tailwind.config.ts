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
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        // Only ever applied through Tailwind's `motion-safe:` variant, so
        // prefers-reduced-motion users get the final state with no movement.
        rise: 'rise 0.5s ease-out both',
      },
    },
  },
  plugins: [],
};

export default config;
