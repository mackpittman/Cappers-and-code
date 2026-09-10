import { Platform, useColorScheme } from 'react-native';

export const palettes = {
  light: {
    bg: '#F1F4F2',
    surface: '#FFFFFF',
    surface2: '#E9EEEB',
    ink: '#14201C',
    ink2: '#3F4C47',
    mute: '#6E7A75',
    line: '#D5DDD9',
    turf: '#1E6B4A',
    turfSoft: '#DDEDE4',
    gold: '#B8791A',
    goldSoft: '#F6EBD6',
    bar: '#2E8B5E',
    barBg: '#DCE3DF',
    up: '#1E6B4A',
    down: '#B4432E',
    warn: '#B8791A',
    onAccent: '#FFFFFF',
  },
  dark: {
    bg: '#0E1512',
    surface: '#161F1A',
    surface2: '#1E2924',
    ink: '#E4EAE6',
    ink2: '#B7C2BC',
    mute: '#8A9691',
    line: '#2A3630',
    turf: '#5CC48E',
    turfSoft: '#1B3128',
    gold: '#E2AB47',
    goldSoft: '#3A2D14',
    bar: '#4FBF87',
    barBg: '#27332D',
    up: '#5CC48E',
    down: '#E0705A',
    warn: '#E2AB47',
    onAccent: '#0E1512',
  },
};
export type Palette = typeof palettes.light;

export function useTheme(): Palette {
  const scheme = useColorScheme();
  return scheme === 'dark' ? palettes.dark : palettes.light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const type = {
  display: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.5 },
  h1: { fontSize: 22, fontWeight: '700' as const },
  h2: { fontSize: 17, fontWeight: '700' as const },
  label: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  mono: {
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'Menlo, Consolas, "Liberation Mono", monospace',
    }),
    fontSize: 13,
  },
};
