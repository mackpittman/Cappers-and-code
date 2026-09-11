// Cappers & Code design tokens. Source of truth: brand/tokens.json and brand/BRAND_GUIDE.md.
// The brand commits to one near-black world, so the app is single-theme: black establishes weight,
// white carries information, electric green is a signal (data, key words, calls to action), never wallpaper.
import { Platform } from 'react-native';

export const palette = {
  bg: '#050608', // near black: core background
  surface: '#0B0E0C', // charcoal: cards and bars
  surface2: '#101512', // raised panel
  surface3: '#151B17',
  ink: '#F5F7F2', // soft white: primary type
  ink2: '#C8CFC8', // secondary type (tint of white, brand extension)
  mute: '#9DA59D', // cool gray: muted type
  line: '#1F2622',
  lineGreen: 'rgba(182,255,0,0.45)', // brand panel border
  green: '#B6FF00', // electric green: signal
  green2: '#79E000', // signal green: deep accent
  greenSoft: 'rgba(182,255,0,0.12)',
  onGreen: '#050608',
  bar: '#B6FF00',
  barBg: '#1A211C',
  up: '#B6FF00',
  down: '#9DA59D',
  danger: '#E0705A', // restrained; used only for Out / IR status
};
export type Palette = typeof palette;
export function useTheme(): Palette {
  return palette;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

// Fonts are loaded in app/_layout.tsx (expo-font). Names must match the loaded keys.
export const fonts = {
  display: 'BarlowCondensed_700Bold',
  displayMed: 'BarlowCondensed_600SemiBold',
  body: 'Manrope_500Medium',
  bodyBold: 'Manrope_700Bold',
  data: 'JetBrainsMono_500Medium',
  dataBold: 'JetBrainsMono_700Bold',
};
const sys = Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' });

export const type = {
  display: {
    fontFamily: fonts.display,
    fontSize: 38,
    lineHeight: 38,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
  h1: {
    fontFamily: fonts.display,
    fontSize: 28,
    lineHeight: 28,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
  h2: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 24,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
  label: {
    fontFamily: fonts.data,
    fontSize: 10.5,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
  },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  bodyBold: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 21 },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  mono: { fontFamily: fonts.data, fontSize: 13 },
  fallback: { fontFamily: sys },
};
export const radius = { sm: 8, md: 16 };
export const copy = {
  tagline: 'AI Models. Human Insight. One Edge.',
  positioning: 'The Sports Intelligence Community.',
  trust: 'Locked In. Trust the Code.',
  performance: 'Real Data. Real Wins. No Fluff.',
  handle: '@cappersandcode',
};
