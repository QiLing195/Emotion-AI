import React from 'react';
import { cn } from '../../../lib/utils';
import { ButtonVariant, ButtonSize } from '../../../types/ui';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      icon,
      iconPosition = 'left',
      fullWidth = false,
      className,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const variantClasses = {
      primary:
        'bg-gradient-to-br from-coral-400 to-rose-500 text-white hover:from-coral-500 hover:to-rose-600 shadow-[0_2px_12px_rgba(244,63,110,0.3)] hover:shadow-[0_4px_18px_rgba(244,63,110,0.4)] hover:-translate-y-0.5 focus:ring-4 focus:ring-coral-400/20 border border-transparent',
      secondary:
        'bg-white text-moon-700 hover:bg-moon-50 focus:ring-4 focus:ring-coral-400/20 border border-surface-300 shadow-sm',
      outline:
        'bg-transparent text-rose-600 hover:bg-rose-50 focus:ring-4 focus:ring-rose-300/20 border border-rose-200',
      ghost:
        'bg-transparent text-moon-500 hover:bg-moon-100 hover:text-moon-700 focus:ring-4 focus:ring-moon-300/20 border border-transparent',
      danger:
        'bg-gradient-to-br from-rose-500 to-rose-600 text-white hover:from-rose-600 hover:to-rose-700 focus:ring-4 focus:ring-rose-400/20 border border-transparent shadow-sm',
      success:
        'bg-gradient-to-br from-teal-400 to-teal-500 text-white hover:from-teal-500 hover:to-teal-600 focus:ring-4 focus:ring-teal-400/20 border border-transparent shadow-sm',
    };

    const sizeClasses = {
      xs: 'px-2.5 py-1.5 text-xs',
      sm: 'px-3 py-2 text-sm',
      md: 'px-4 py-2.5 text-sm',
      lg: 'px-5 py-3 text-base',
      xl: 'px-6 py-3.5 text-base',
    };

    const loadingSpinner = (
      <svg
        className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    );

    const content = (
      <>
        {loading && iconPosition === 'left' && loadingSpinner}
        {!loading && icon && iconPosition === 'left' && (
          <span className="mr-2">{icon}</span>
        )}
        {children}
        {!loading && icon && iconPosition === 'right' && (
          <span className="ml-2">{icon}</span>
        )}
        {loading && iconPosition === 'right' && loadingSpinner}
      </>
    );

    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0',
          variantClasses[variant],
          sizeClasses[size],
          fullWidth && 'w-full',
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {content}
      </button>
    );
  }
);
Button.displayName = 'Button';

export { Button };