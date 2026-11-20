/**
 * Brand configuration — the one place to change name, colours and logo.
 *
 * Logo: drop a file named `logo.svg`, `logo.png` or `logo.webp` into this
 * folder (src/brand/) and rebuild. It is used in the top bar, browser tab,
 * desktop window and work order. Without one, a monogram is drawn.
 */
export const BRAND = {
  company: 'Hero Braces',
  product: 'Hero Braces Studio',
  tagline: 'Custom orthotic design',
  website: 'herobraces.com',
  /** Two-letter monogram used when no logo file is present. */
  monogram: 'HB',
  /** Prefix for new case IDs, e.g. HB-20261120-1234. */
  casePrefix: 'HB',
  /** Accent colours per theme (buttons, highlights, selected states). */
  colors: {
    light: { accent: '#0d9488', accentHover: '#0f766e', accentText: '#ffffff' },
    dark: { accent: '#2dd4bf', accentHover: '#5eead4', accentText: '#032b26' },
  },
};

const logos = import.meta.glob('./logo.{svg,png,webp,jpg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** URL of the brand logo file, or null to use the monogram. */
export const BRAND_LOGO: string | null = Object.values(logos)[0] ?? null;

/** Apply brand colours as CSS variables (other accent shades are derived in CSS). */
export function applyBrand() {
  const { light, dark } = BRAND.colors;
  const vars = (c: typeof light) => `--accent:${c.accent};--accent-hover:${c.accentHover};--accent-text:${c.accentText};`;
  const style = document.createElement('style');
  style.id = 'brand-colors';
  style.textContent = `:root,:root[data-theme='light']{${vars(light)}}:root[data-theme='dark']{${vars(dark)}}`;
  document.head.appendChild(style);

  document.title = BRAND.product;
  const href = BRAND_LOGO ?? monogramIcon(light.accent);
  let link = document.querySelector<HTMLLinkElement>('link[rel=icon]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = href;
}

function monogramIcon(color: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='${color}'/><text x='16' y='21' font-family='Arial,sans-serif' font-size='13' font-weight='700' fill='white' text-anchor='middle'>${BRAND.monogram}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
