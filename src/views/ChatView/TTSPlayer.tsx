import React from 'react';
import { VolumeX } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface TTSPlayerProps {
  audioBlocked: boolean;
  onResumeAudio: () => void;
  className?: string;
}

const TTSPlayer: React.FC<TTSPlayerProps> = ({
  audioBlocked,
  onResumeAudio,
  className,
}) => {
  if (!audioBlocked) return null;

  return (
    <div
      onClick={onResumeAudio}
      className={cn(
        'absolute top-4 left-1/2 -translate-x-1/2 z-10',
        'bg-red-500 text-white px-4 py-2 rounded-full shadow-lg',
        'flex items-center justify-center gap-2 cursor-pointer font-medium text-sm',
        'animate-bounce hover:bg-red-600 transition-colors',
        className
      )}
    >
      <VolumeX className="w-4 h-4" />
      浏览器拦截了自动播放，点击此处播放语音
    </div>
  );
};

export default TTSPlayer;
