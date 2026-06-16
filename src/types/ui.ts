import React from 'react';

/**
 * UI component type definitions
 */

// Button variants
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'success';

// Button sizes
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

// Card variants
export type CardVariant = 'default' | 'elevated' | 'outline' | 'ghost';

// Input variants
export type InputVariant = 'default' | 'filled' | 'outline' | 'ghost';

// Toggle sizes
export type ToggleSize = 'sm' | 'md' | 'lg';

// Select option
export interface SelectOption<T = string> {
  value: T;
  label: string;
  description?: string;
  icon?: React.ReactNode;
}

// Common props for form components
export interface FormFieldProps {
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

// Common props for interactive components
export interface InteractiveProps {
  onClick?: React.MouseEventHandler<HTMLElement>;
  onFocus?: React.FocusEventHandler<HTMLElement>;
  onBlur?: React.FocusEventHandler<HTMLElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  tabIndex?: number;
  role?: string;
  'aria-label'?: string;
}

// Color palette tokens
export interface ColorPalette {
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
  950: string;
}

// Theme colors
export interface ThemeColors {
  primary: ColorPalette;
  slate: ColorPalette;
  emerald: ColorPalette;
  rose: ColorPalette;
  amber: ColorPalette;
  indigo: ColorPalette;
  purple: ColorPalette;
  red: ColorPalette;
  green: ColorPalette;
  yellow: ColorPalette;
  blue: ColorPalette;
}

// Spacing scale
export type SpacingScale =
  | '0' | 'px' | '0.5' | '1' | '1.5' | '2' | '2.5' | '3' | '3.5' | '4'
  | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12' | '14' | '16'
  | '20' | '24' | '28' | '32' | '36' | '40' | '44' | '48' | '52' | '56'
  | '60' | '64' | '72' | '80' | '96';

// Border radius scale
export type BorderRadiusScale =
  | 'none' | 'sm' | 'default' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'full';

// Shadow scale
export type ShadowScale =
  | 'none' | 'sm' | 'default' | 'md' | 'lg' | 'xl' | '2xl' | 'inner';