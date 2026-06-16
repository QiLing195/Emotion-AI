import React, { useRef } from 'react';
import { Send, Mic, Paperclip, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/Button';

export interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  selectedImage: string | null;
  clearSelectedImage: () => void;
  isTyping: boolean;
  className?: string;
}

const ChatInput: React.FC<ChatInputProps> = ({
  value,
  onChange,
  onSend,
  onImageUpload,
  selectedImage,
  clearSelectedImage,
  isTyping,
  className,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handleImageClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className={cn('space-y-4', className)}>
      {selectedImage && (
        <div className="mb-3 relative inline-block">
          <img
            src={selectedImage}
            alt="Preview"
            className="h-20 w-auto rounded-lg border border-slate-200 object-cover"
          />
          <button
            onClick={clearSelectedImage}
            className="absolute -top-2 -right-2 p-1 bg-white rounded-full border border-slate-200 text-slate-500 hover:text-rose-500 shadow-sm"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="file"
          accept="image/*"
          className="hidden"
          ref={fileInputRef}
          onChange={onImageUpload}
        />
        <button
          onClick={handleImageClick}
          className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
        >
          <Paperclip className="w-5 h-5" />
        </button>

        <div className="flex-1 relative">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入测试指令，例如：打开客厅灯、今天天气怎么样..."
            className="w-full pl-4 pr-12 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all text-sm bg-slate-50 focus:bg-white"
            disabled={isTyping}
          />
          <button className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors">
            <Mic className="w-4 h-4" />
          </button>
        </div>

        <Button
          onClick={onSend}
          disabled={!value.trim() || isTyping}
          className="p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          <Send className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[10px]">
              Enter
            </kbd>{' '}
            发送
          </span>
          <span>支持多轮对话与上下文记忆测试</span>
        </div>
      </div>
    </div>
  );
};

export default ChatInput;