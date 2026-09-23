// Colours map to the CSS variables in src/index.css (day/night swap there).
// Only these tokens: no other colour scale is added.
const token = (name: string) => `var(--${name})`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'), sf: token('sf'), sf2: token('sf2'), line: token('line'),
        tx: token('tx'), mut: token('mut'),
        pri: token('pri'), prit: token('prit'), prix: token('prix'), pris: token('pris'),
        acc: token('acc'), accs: token('accs'), ok: token('ok'), oks: token('oks'),
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
      },
      borderRadius: { btn: '14px', card: '18px' },
      boxShadow: { card: 'var(--sh)' },
      maxWidth: { app: '560px' },
    },
  },
  plugins: [],
}
