/**
 * Brand configuration — the one place to change name, colours and logos.
 *
 * Logo files in this folder (src/brand/):
 *   logo.png       full logo for light backgrounds (top bar, work order)
 *   logo-dark.png  full logo for dark backgrounds (dark mode top bar)
 *   mark.png       square mark (browser tab icon); build/icon.png is the desktop app icon
 * SVG or WebP files with the same names work too. Delete them to fall back to the monogram.
 *
 * Colours are taken from goherogo.com: deep navy, Hero yellow, Hero teal.
 */
export const BRAND = {
  company: 'Hero Braces',
  product: 'Hero Braces Studio',
  /** Shown next to the logo in the top bar. */
  appLabel: 'Brace Studio',
  tagline: 'Custom orthotic design',
  website: 'goherogo.com',
  /** Two-letter monogram used when no logo file is present. */
  monogram: 'HB',
  /** Prefix for new case IDs, e.g. HB-20261120-1234. */
  casePrefix: 'HB',
  palette: {
    navy: '#123b4e',
    yellow: '#eeea13',
    yellowText: '#123840',
    teal: '#108474',
  },
  /** Per-theme UI colours. accent = highlights (switches, sliders, focus); primary = main buttons. */
  colors: {
    light: {
      accent: '#108474', accentHover: '#0c6b5e', accentText: '#ffffff',
      primary: '#eeea13', primaryText: '#123840',
      brandText: '#123b4e',
    },
    dark: {
      accent: '#3fc2ad', accentHover: '#6ad6c4', accentText: '#062a26',
      primary: '#eeea13', primaryText: '#123840',
      brandText: '#e8f0f3',
      // Navy-tinted dark surfaces, matching the site's navy sections.
      bg: '#0a1820', surface: '#0f222c', surface2: '#132a36', surface3: '#1a3442',
      border: '#1f3a48', borderStrong: '#2b4a5a', glass: 'rgba(15, 34, 44, 0.74)',
      vpBg: 'radial-gradient(120% 90% at 50% 30%, #1a3442 0%, #10232e 55%, #0a1820 100%)',
    },
  },
};

const files = import.meta.glob('./{logo,logo-dark,mark}.{svg,png,webp}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const find = (name: string) => Object.entries(files).find(([k]) => k.replace(/^\.\//, '').replace(/\.\w+$/, '') === name)?.[1] ?? null;

/** Logo URLs, or null to use the monogram. */
export const BRAND_LOGO: string | null = find('logo');
export const BRAND_LOGO_DARK: string | null = find('logo-dark') ?? BRAND_LOGO;
export const BRAND_MARK: string | null = find('mark');

/** Apply brand colours as CSS variables (other accent shades are derived in CSS). */
export function applyBrand() {
  const { light, dark } = BRAND.colors;
  const common = (c: typeof light) =>
    `--accent:${c.accent};--accent-hover:${c.accentHover};--accent-text:${c.accentText};--primary-bg:${c.primary};--primary-text:${c.primaryText};--brand-text:${c.brandText};`;
  const surfaces = `--bg:${dark.bg};--surface:${dark.surface};--surface-2:${dark.surface2};--surface-3:${dark.surface3};--border:${dark.border};--border-strong:${dark.borderStrong};--glass:${dark.glass};--vp-bg:${dark.vpBg};`;
  const style = document.createElement('style');
  style.id = 'brand-colors';
  style.textContent = `:root,:root[data-theme='light']{${common(light)}}:root[data-theme='dark']{${common(dark)}${surfaces}}`;
  document.head.appendChild(style);

  document.title = BRAND.product;
  let link = document.querySelector<HTMLLinkElement>('link[rel=icon]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = BRAND_MARK ?? monogramIcon(BRAND.palette.navy);
}

function monogramIcon(color: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='${color}'/><text x='16' y='21' font-family='Arial,sans-serif' font-size='13' font-weight='700' fill='white' text-anchor='middle'>${BRAND.monogram}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
