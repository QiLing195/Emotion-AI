import React from 'react';
import { cn } from '../../../lib/utils';
import { CardVariant } from '../../../types/ui';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  shadow?: 'none' | 'sm' | 'md' | 'lg';
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  border?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export interface CardBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg';
  className?: string;
  children?: React.ReactNode;
}

export interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      variant = 'default',
      padding = 'md',
      shadow = 'md',
      rounded = '2xl',
      border = true,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const variantClasses = {
      default: 'glass',
      elevated: 'glass-strong shadow-float border-0',
      outline: 'bg-transparent border border-surface-300',
      ghost: 'bg-transparent border-0 shadow-none',
    };

    const paddingClasses = {
      none: '',
      sm: 'p-4',
      md: 'p-6',
      lg: 'p-8',
    };

    const shadowClasses = {
      none: '',
      sm: 'shadow-sm',
      md: 'shadow-md',
      lg: 'shadow-lg',
    };

    const roundedClasses = {
      none: 'rounded-none',
      sm: 'rounded-sm',
      md: 'rounded-md',
      lg: 'rounded-lg',
      xl: 'rounded-xl',
      '2xl': 'rounded-2xl',
      full: 'rounded-full',
    };

    const borderClass = border ? 'border border-surface-300' : '';

    return (
      <div
        ref={ref}
        className={cn(
          variantClasses[variant],
          paddingClasses[padding],
          shadowClasses[shadow],
          roundedClasses[rounded],
          borderClass,
          'overflow-hidden',
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ title, description, action, className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'px-6 py-4 border-b divider-soft bg-surface-50/50',
          className
        )}
        {...props}
      >
        {(title || description) && (
          <div className="flex items-center justify-between">
            <div>
              {title && (
                <h3 className="text-lg font-semibold text-moon-800">
                  {title}
                </h3>
              )}
              {description && (
                <p className="text-sm text-moon-400 mt-1">{description}</p>
              )}
            </div>
            {action && <div>{action}</div>}
          </div>
        )}
        {children}
      </div>
    );
  }
);
CardHeader.displayName = 'CardHeader';

const CardBody = React.forwardRef<HTMLDivElement, CardBodyProps>(
  ({ padding = 'md', className, children, ...props }, ref) => {
    const paddingClasses = {
      none: '',
      sm: 'p-4',
      md: 'p-6',
      lg: 'p-8',
    };

    return (
      <div
        ref={ref}
        className={cn(paddingClasses[padding], className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);
CardBody.displayName = 'CardBody';

const CardFooter = React.forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'px-6 py-4 border-t divider-soft bg-surface-50/50',
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardBody, CardFooter };