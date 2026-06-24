import React from 'react';
import { cn } from '../../../lib/utils';
import { ToggleSize, FormFieldProps } from '../../../types/ui';

export interface ToggleSwitchProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    FormFieldProps {
  size?: ToggleSize;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}

const ToggleSwitch = React.forwardRef<HTMLInputElement, ToggleSwitchProps>(
  (
    {
      size = 'md',
      label,
      description,
      error,
      required,
      disabled,
      checked,
      onChange,
      className,
      id,
      ...props
    },
    ref
  ) => {
    const toggleId = id || `toggle-${crypto.randomUUID()}`;

    const sizeClasses = {
      sm: 'h-4 w-7',
      md: 'h-6 w-11',
      lg: 'h-8 w-16',
    };

    const knobSizeClasses = {
      sm: 'h-3 w-3',
      md: 'h-5 w-5',
      lg: 'h-7 w-7',
    };

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (onChange) {
        onChange(event.target.checked);
      }
    };

    return (
      <div className={cn('space-y-2', className)}>
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            {label && (
              <label
                htmlFor={toggleId}
                className="text-sm font-medium text-slate-700"
              >
                {label}
                {required && <span className="text-rose-500 ml-1">*</span>}
              </label>
            )}
            {description && (
              <p className="text-xs text-slate-500 mt-1">{description}</p>
            )}
          </div>

          <label className="relative inline-flex items-center cursor-pointer">
            <input
              ref={ref}
              id={toggleId}
              type="checkbox"
              className="sr-only peer"
              checked={checked}
              onChange={handleChange}
              disabled={disabled}
              aria-invalid={!!error}
              aria-describedby={error ? `${toggleId}-error` : undefined}
              {...props}
            />
            <div
              className={cn(
                'bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[""] after:absolute after:bg-white after:border-slate-300 after:border after:rounded-full after:transition-all',
                sizeClasses[size],
                checked
                  ? 'peer-checked:bg-indigo-600'
                  : 'peer-checked:bg-slate-200',
                disabled && 'opacity-50 cursor-not-allowed'
              )}
              style={
                size === 'sm'
                  ? { top: '2px', left: '2px' }
                  : size === 'md'
                  ? { top: '2px', left: '2px' }
                  : { top: '4px', left: '4px' }
              }
            >
              <div
                className={cn(
                  'absolute rounded-full transition-transform duration-200 ease-in-out',
                  knobSizeClasses[size],
                  checked
                    ? size === 'sm'
                      ? 'translate-x-3'
                      : size === 'md'
                      ? 'translate-x-5'
                      : 'translate-x-8'
                    : 'translate-x-0'
                )}
              />
            </div>
          </label>
        </div>

        {error && (
          <p id={`${toggleId}-error`} className="text-xs text-rose-600">
            {error}
          </p>
        )}
      </div>
    );
  }
);
ToggleSwitch.displayName = 'ToggleSwitch';

export { ToggleSwitch };