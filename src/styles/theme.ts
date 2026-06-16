/**
 * Design tokens and theme configuration
 * Based on the existing Tailwind CSS color palette
 */

import { ThemeColors, SpacingScale, BorderRadiusScale, ShadowScale } from '../types/ui';

// Color palette - using Tailwind CSS v3 colors
export const colors: ThemeColors = {
  primary: {
    50: '#eef2ff',
    100: '#e0e7ff',
    200: '#c7d2fe',
    300: '#a5b4fc',
    400: '#818cf8',
    500: '#6366f1',
    600: '#4f46e5',
    700: '#4338ca',
    800: '#3730a3',
    900: '#312e81',
    950: '#1e1b4b',
  },
  slate: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
    950: '#020617',
  },
  emerald: {
    50: '#ecfdf5',
    100: '#d1fae5',
    200: '#a7f3d0',
    300: '#6ee7b7',
    400: '#34d399',
    500: '#10b981',
    600: '#059669',
    700: '#047857',
    800: '#065f46',
    900: '#064e3b',
    950: '#022c22',
  },
  rose: {
    50: '#fff1f2',
    100: '#ffe4e6',
    200: '#fecdd3',
    300: '#fda4af',
    400: '#fb7185',
    500: '#f43f5e',
    600: '#e11d48',
    700: '#be123c',
    800: '#9f1239',
    900: '#881337',
    950: '#4c0519',
  },
  amber: {
    50: '#fffbeb',
    100: '#fef3c7',
    200: '#fde68a',
    300: '#fcd34d',
    400: '#fbbf24',
    500: '#f59e0b',
    600: '#d97706',
    700: '#b45309',
    800: '#92400e',
    900: '#78350f',
    950: '#451a03',
  },
  indigo: {
    50: '#eef2ff',
    100: '#e0e7ff',
    200: '#c7d2fe',
    300: '#a5b4fc',
    400: '#818cf8',
    500: '#6366f1',
    600: '#4f46e5',
    700: '#4338ca',
    800: '#3730a3',
    900: '#312e81',
    950: '#1e1b4b',
  },
  purple: {
    50: '#faf5ff',
    100: '#f3e8ff',
    200: '#e9d5ff',
    300: '#d8b4fe',
    400: '#c084fc',
    500: '#a855f7',
    600: '#9333ea',
    700: '#7e22ce',
    800: '#6b21a8',
    900: '#581c87',
    950: '#3b0764',
  },
  red: {
    50: '#fef2f2',
    100: '#fee2e2',
    200: '#fecaca',
    300: '#fca5a5',
    400: '#f87171',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
    800: '#991b1b',
    900: '#7f1d1d',
    950: '#450a0a',
  },
  green: {
    50: '#f0fdf4',
    100: '#dcfce7',
    200: '#bbf7d0',
    300: '#86efac',
    400: '#4ade80',
    500: '#22c55e',
    600: '#16a34a',
    700: '#15803d',
    800: '#166534',
    900: '#14532d',
    950: '#052e16',
  },
  yellow: {
    50: '#fefce8',
    100: '#fef9c3',
    200: '#fef08a',
    300: '#fde047',
    400: '#facc15',
    500: '#eab308',
    600: '#ca8a04',
    700: '#a16207',
    800: '#854d0e',
    900: '#713f12',
    950: '#422006',
  },
  blue: {
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
    800: '#1e40af',
    900: '#1e3a8a',
    950: '#172554',
  },
};

// Spacing scale (in rem, matches Tailwind)
export const spacing: Record<SpacingScale, string> = {
  '0': '0rem',
  'px': '1px',
  '0.5': '0.125rem',  // 2px
  '1': '0.25rem',     // 4px
  '1.5': '0.375rem',  // 6px
  '2': '0.5rem',      // 8px
  '2.5': '0.625rem',  // 10px
  '3': '0.75rem',     // 12px
  '3.5': '0.875rem',  // 14px
  '4': '1rem',        // 16px
  '5': '1.25rem',     // 20px
  '6': '1.5rem',      // 24px
  '7': '1.75rem',     // 28px
  '8': '2rem',        // 32px
  '9': '2.25rem',     // 36px
  '10': '2.5rem',     // 40px
  '11': '2.75rem',    // 44px
  '12': '3rem',       // 48px
  '14': '3.5rem',     // 56px
  '16': '4rem',       // 64px
  '20': '5rem',       // 80px
  '24': '6rem',       // 96px
  '28': '7rem',       // 112px
  '32': '8rem',       // 128px
  '36': '9rem',       // 144px
  '40': '10rem',      // 160px
  '44': '11rem',      // 176px
  '48': '12rem',      // 192px
  '52': '13rem',      // 208px
  '56': '14rem',      // 224px
  '60': '15rem',      // 240px
  '64': '16rem',      // 256px
  '72': '18rem',      // 288px
  '80': '20rem',      // 320px
  '96': '24rem',      // 384px
};

// Border radius scale
export const borderRadius: Record<BorderRadiusScale, string> = {
  'none': '0rem',
  'sm': '0.125rem',   // 2px
  'default': '0.25rem', // 4px
  'md': '0.375rem',   // 6px
  'lg': '0.5rem',     // 8px
  'xl': '0.75rem',    // 12px
  '2xl': '1rem',      // 16px
  '3xl': '1.5rem',    // 24px
  'full': '9999px',
};

// Shadow scale
export const shadows: Record<ShadowScale, string> = {
  'none': 'none',
  'sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  'default': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
  'md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
  'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  'xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
  '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  'inner': 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)',
};

// Font sizes
export const fontSize = {
  'xs': ['0.75rem', { lineHeight: '1rem' }],      // 12px
  'sm': ['0.875rem', { lineHeight: '1.25rem' }],  // 14px
  'base': ['1rem', { lineHeight: '1.5rem' }],     // 16px
  'lg': ['1.125rem', { lineHeight: '1.75rem' }],  // 18px
  'xl': ['1.25rem', { lineHeight: '1.75rem' }],   // 20px
  '2xl': ['1.5rem', { lineHeight: '2rem' }],      // 24px
  '3xl': ['1.875rem', { lineHeight: '2.25rem' }], // 30px
  '4xl': ['2.25rem', { lineHeight: '2.5rem' }],   // 36px
  '5xl': ['3rem', { lineHeight: '1' }],           // 48px
  '6xl': ['3.75rem', { lineHeight: '1' }],        // 60px
  '7xl': ['4.5rem', { lineHeight: '1' }],         // 72px
  '8xl': ['6rem', { lineHeight: '1' }],           // 96px
  '9xl': ['8rem', { lineHeight: '1' }],           // 128px
};

// Font weights
export const fontWeight = {
  thin: '100',
  extralight: '200',
  light: '300',
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
  black: '900',
};

// Line heights
export const lineHeight = {
  none: '1',
  tight: '1.25',
  snug: '1.375',
  normal: '1.5',
  relaxed: '1.625',
  loose: '2',
};

// Animation durations
export const duration = {
  75: '75ms',
  100: '100ms',
  150: '150ms',
  200: '200ms',
  300: '300ms',
  500: '500ms',
  700: '700ms',
  1000: '1000ms',
};

// Z-index scale
export const zIndex = {
  0: '0',
  10: '10',
  20: '20',
  30: '30',
  40: '40',
  50: '50',
  100: '100',
  auto: 'auto',
};

// Breakpoints
export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
};

// Theme configuration
export const theme = {
  colors,
  spacing,
  borderRadius,
  shadows,
  fontSize,
  fontWeight,
  lineHeight,
  duration,
  zIndex,
  breakpoints,
} as const;

export type Theme = typeof theme;