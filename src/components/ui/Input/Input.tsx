import React from 'react';
import { cn } from '../../../lib/utils';
import { InputVariant, FormFieldProps } from '../../../types/ui';

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    FormFieldProps {
  variant?: InputVariant;
  size?: 'sm' | 'md' | 'lg';
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      variant = 'default',
      size = 'md',
      label,
      description,
      error,
      required,
      disabled,
      leftIcon,
      rightIcon,
      fullWidth = true,
      className,
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || `input-${crypto.randomUUID()}`;

    const variantClasses = {
      default:
        'bg-white border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500',
      filled:
        'bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500',
      outline:
        'bg-transparent border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500',
      ghost:
        'bg-transparent border-0 focus:ring-0 focus:border-0 shadow-none',
    };

    const sizeClasses = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2.5 text-sm',
      lg: 'px-5 py-3 text-base',
    };

    const inputClasses = cn(
      'rounded-xl outline-none transition-all placeholder:text-slate-400',
      variantClasses[variant],
      sizeClasses[size],
      disabled && 'opacity-50 cursor-not-allowed',
      error && 'border-rose-500 focus:border-rose-500 focus:ring-2 focus:ring-rose-500',
      leftIcon && 'pl-10',
      rightIcon && 'pr-10',
      fullWidth && 'w-full',
      className
    );

    return (
      <div className={cn('space-y-2', fullWidth && 'w-full')}>
        {(label || description) && (
          <div className="space-y-1">
            {label && (
              <label
                htmlFor={inputId}
                className="text-sm font-medium text-slate-700"
              >
                {label}
                {required && <span className="text-rose-500 ml-1">*</span>}
              </label>
            )}
            {description && (
              <p className="text-xs text-slate-500">{description}</p>
            )}
          </div>
        )}

        <div className="relative">
          {leftIcon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              {leftIcon}
            </div>
          )}

          <input
            ref={ref}
            id={inputId}
            className={inputClasses}
            disabled={disabled}
            required={required}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : undefined}
            {...props}
          />

          {rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
              {rightIcon}
            </div>
          )}
        </div>

        {error && (
          <p id={`${inputId}-error`} className="text-xs text-rose-600">
            {error}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';

export { Input };