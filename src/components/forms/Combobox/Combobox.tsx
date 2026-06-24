import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../../../lib/utils';
import { SelectOption, FormFieldProps } from '../../../types/ui';
import { ChevronDown, Search } from 'lucide-react';

export interface ComboboxProps<T = string>
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>,
    FormFieldProps {
  value?: T;
  onChange?: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  searchable?: boolean;
  emptyMessage?: string;
  loading?: boolean;
  className?: string;
}

function Combobox<T = string>({
  value,
  onChange,
  options,
  label,
  description,
  error,
  required,
  disabled,
  placeholder = '选择...',
  searchable = true,
  emptyMessage = '没有找到选项',
  loading = false,
  className,
  id,
  ...props
}: ComboboxProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const comboboxId = id || `combobox-${crypto.randomUUID()}`;

  // Find the selected option
  const selectedOption = options.find(opt => opt.value === value);

  // Filter options based on search term
  const filteredOptions = searchable
    ? options.filter(opt =>
        opt.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        opt.description?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : options;

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen && searchable && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen, searchable]);

  const handleSelect = (optionValue: T) => {
    if (onChange) {
      onChange(optionValue);
    }
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setSearchTerm(newValue);

    // If not searchable, we still need to trigger onChange for custom values
    if (!searchable && onChange) {
      // This assumes T is string, might need type guard
      onChange(newValue as unknown as T);
    }
  };

  const handleInputFocus = () => {
    if (!disabled) {
      setIsOpen(true);
    }
  };

  const handleToggle = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      {(label || description) && (
        <div className="space-y-1">
          {label && (
            <label
              htmlFor={comboboxId}
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

      <div className={cn('relative', isOpen ? 'z-50' : 'z-10')} ref={wrapperRef}>
        <div className="relative">
          {searchable ? (
            <input
              ref={inputRef}
              id={comboboxId}
              type="text"
              value={isOpen ? searchTerm : selectedOption?.label || ''}
              onChange={handleInputChange}
              onFocus={handleInputFocus}
              placeholder={placeholder}
              disabled={disabled}
              className={cn(
                'w-full px-4 py-2.5 rounded-xl border border-slate-200',
                'focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500',
                'outline-none transition-all text-sm pr-10',
                disabled && 'opacity-50 cursor-not-allowed',
                error && 'border-rose-500 focus:border-rose-500 focus:ring-2 focus:ring-rose-500'
              )}
              {...props}
            />
          ) : (
            <button
              type="button"
              onClick={handleToggle}
              disabled={disabled}
              className={cn(
                'w-full px-4 py-2.5 rounded-xl border border-slate-200',
                'text-left text-sm flex items-center justify-between',
                'focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500',
                'outline-none transition-all',
                disabled && 'opacity-50 cursor-not-allowed',
                error && 'border-rose-500 focus:border-rose-500 focus:ring-2 focus:ring-rose-500'
              )}
            >
              <span className={cn(!selectedOption && 'text-slate-400')}>
                {selectedOption?.label || placeholder}
              </span>
              <ChevronDown
                className={cn(
                  'w-4 h-4 text-slate-400 transition-transform',
                  isOpen && 'rotate-180'
                )}
              />
            </button>
          )}

          {searchable && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
              {isOpen ? (
                <Search className="w-4 h-4 text-slate-400" />
              ) : (
                <button
                  type="button"
                  onClick={handleToggle}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100"
                  disabled={disabled}
                >
                  <ChevronDown
                    className={cn(
                      'w-4 h-4 transition-transform',
                      isOpen && 'rotate-180'
                    )}
                  />
                </button>
              )}
            </div>
          )}
        </div>

        {isOpen && !disabled && (
          <div className="absolute w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto py-1">
            {loading ? (
              <div className="px-4 py-2 text-sm text-slate-500 text-center">
                加载中...
              </div>
            ) : filteredOptions.length === 0 ? (
              <div className="px-4 py-2 text-sm text-slate-500 text-center">
                {emptyMessage}
              </div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={String(option.value)}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(option.value)}
                  className={cn(
                    'w-full text-left px-4 py-2 text-sm hover:bg-indigo-50 hover:text-indigo-700 transition-colors',
                    'flex flex-col gap-0.5',
                    value === option.value
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-slate-700'
                  )}
                >
                  <span className="font-medium">{option.label}</span>
                  {option.description && (
                    <span className="text-xs text-slate-500">
                      {option.description}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-rose-600">{error}</p>
      )}
    </div>
  );
}

export { Combobox };