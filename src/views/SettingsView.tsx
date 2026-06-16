import React, { useState, useRef, useEffect } from 'react';
import { Settings, Key, Link2, Cpu, CheckCircle2, AlertCircle, Save, Sliders, Server, Eye, EyeOff, Mic, Volume2, ChevronDown, Paperclip } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAIBrainStore, Provider, TTSSettings } from '../store/useAIBrainStore';
import { Button } from '../components/ui/Button';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ['gpt-4-turbo', 'gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
  gemini: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'],
  anthropic: ['claude-3-5-sonnet-20240620', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
  deepseek: ['deepseek-chat', 'deepseek-coder'],
  siliconflow: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-72B-Instruct'],
  moonshot: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  zhipu: ['glm-4', 'glm-4-air', 'glm-4-flash', 'glm-3-turbo'],
};

const PROVIDER_URLS: Record<string, string[]> = {
  openai: ['https://api.openai.com/v1', 'https://api.chatanywhere.tech/v1'],
  gemini: ['https://generativelanguage.googleapis.com/v1beta'],
  anthropic: ['https://api.anthropic.com/v1'],
  deepseek: ['https://api.deepseek.com/v1'],
  siliconflow: ['https://api.siliconflow.cn/v1'],
  moonshot: ['https://api.moonshot.cn/v1'],
  zhipu: ['https://open.bigmodel.cn/api/paas/v4'],
};

function Combobox({ 
  value, 
  onChange, 
  options, 
  placeholder 
}: { 
  value: string; 
  onChange: (val: string) => void; 
  options: string[]; 
  placeholder: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={cn("relative", isOpen ? "z-50" : "z-10")} ref={wrapperRef}>
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono text-sm pr-10"
        />
        {options.length > 0 && (
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        )}
      </div>
      
      {isOpen && options.length > 0 && (
        <div className="absolute w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto py-1">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(opt);
                setIsOpen(false);
              }}
              className={cn(
                "w-full text-left px-4 py-2 text-sm font-mono hover:bg-indigo-50 hover:text-indigo-700 transition-colors",
                value === opt ? "bg-indigo-50 text-indigo-700" : "text-slate-700"
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SettingsView() {
  const { settings, setSettings } = useAIBrainStore();
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  const handleProviderChange = (p: Provider) => {
    if (p === 'openai') {
      setSettings({ provider: p, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4-turbo' });
    } else if (p === 'gemini') {
      setSettings({ provider: p, baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.1-pro-preview' });
    } else if (p === 'anthropic') {
      setSettings({ provider: p, baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-opus-20240229' });
    } else if (p === 'deepseek') {
      setSettings({ provider: p, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' });
    } else if (p === 'siliconflow') {
      setSettings({ provider: p, baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' });
    } else if (p === 'moonshot') {
      setSettings({ provider: p, baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' });
    } else if (p === 'zhipu') {
      setSettings({ provider: p, baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4' });
    } else {
      setSettings({ provider: p, baseUrl: '', model: '' });
    }
  };

  const handleTTSProviderChange = (p: 'gemini' | 'openai' | 'elevenlabs' | 'rvc_custom' | 'browser' | 'voxcpm') => {
    setSettings({ 
      tts: { 
        ...settings.tts, 
        provider: p,
        enabled: settings.tts?.enabled ?? false,
        voiceId: settings.tts?.voiceId || '',
        apiUrl: settings.tts?.apiUrl || ''
      } 
    });
  };

  const handleSaveAndTest = async () => {
    if (!settings.apiKey && settings.provider !== 'custom') {
      setTestResult('error');
      return;
    }
    
    setIsTesting(true);
    setTestResult(null);
    
    try {
      if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: settings.apiKey || 'dummy' });
        await ai.models.generateContent({
          model: settings.model || 'gemini-3-flash-preview',
          contents: 'hello',
        });
      } else {
        const openai = new OpenAI({
          apiKey: settings.apiKey || 'dummy',
          baseURL: settings.baseUrl || undefined,
          dangerouslyAllowBrowser: true
        });
        await openai.chat.completions.create({
          model: settings.model || 'gpt-4-turbo',
          messages: [{ role: 'user', content: 'hello' }],
          max_tokens: 5,
        });
      }
      setTestResult('success');
    } catch (error) {
      console.error('Test connection failed:', error);
      setTestResult('error');
    } finally {
      setIsTesting(false);
      setTimeout(() => setTestResult(null), 3000);
    }
  };

  return (
    <div className="h-full flex flex-col space-y-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <Settings className="w-6 h-6 text-indigo-500" />
          模型与 API 设置
        </h2>
        <p className="text-sm text-slate-500 mt-1">自主配置底层驱动家庭管家的大语言模型 (LLM) 及其 API 参数。</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="p-6 space-y-8">
          
          {/* Provider Selection */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-slate-800">选择模型服务商</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(['openai', 'gemini', 'anthropic', 'deepseek', 'siliconflow', 'moonshot', 'zhipu', 'custom'] as Provider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => handleProviderChange(p)}
                  className={cn(
                    "px-4 py-3 rounded-xl border text-sm font-medium transition-all flex flex-col items-center gap-2",
                    settings.provider === p 
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-500" 
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <Server className={cn("w-5 h-5", settings.provider === p ? "text-indigo-600" : "text-slate-400")} />
                  {p === 'openai' && 'OpenAI'}
                  {p === 'gemini' && 'Google Gemini'}
                  {p === 'anthropic' && 'Anthropic'}
                  {p === 'deepseek' && 'DeepSeek'}
                  {p === 'siliconflow' && '硅基流动'}
                  {p === 'moonshot' && 'Kimi (月之暗面)'}
                  {p === 'zhipu' && '智谱清言'}
                  {p === 'custom' && '自定义 / 代理'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* API Key */}
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Key className="w-4 h-4 text-slate-400" />
                API Key (密钥)
              </label>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={settings.apiKey}
                  onChange={e => setSettings({ apiKey: e.target.value })}
                  placeholder={settings.provider === 'custom' ? "如果不需要可留空" : "sk-..."}
                  className="w-full pl-4 pr-12 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono text-sm"
                />
                <button 
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-slate-500">您的密钥仅保存在本地浏览器中，不会上传至任何第三方服务器。</p>
            </div>

            {/* Base URL */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-slate-400" />
                Base URL (接口地址)
              </label>
              <Combobox
                value={settings.baseUrl}
                onChange={(val) => setSettings({ baseUrl: val })}
                options={PROVIDER_URLS[settings.provider] || []}
                placeholder="https://api.openai.com/v1"
              />
              <p className="text-xs text-slate-500">支持配置国内代理地址或 OneAPI 聚合接口。</p>
            </div>

            {/* Model Name */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-slate-400" />
                Model (模型名称)
              </label>
              <Combobox
                value={settings.model}
                onChange={(val) => setSettings({ model: val })}
                options={PROVIDER_MODELS[settings.provider] || []}
                placeholder="gpt-4-turbo"
              />
            </div>
          </div>

          {/* Advanced Settings */}
          <div className="pt-6 border-t border-slate-100 space-y-4">
            <label className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-slate-400" />
              高级参数
            </label>
            
            <div className="space-y-3 max-w-md">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">Temperature (发散度)</span>
                <span className="text-sm font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{settings.temperature}</span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={settings.temperature}
                onChange={e => setSettings({ temperature: parseFloat(e.target.value) })}
                className="w-full accent-indigo-600"
              />
              <p className="text-xs text-slate-500">值越大，AI 的回复越具创造性和随机性；值越小，回复越严谨和确定。</p>
            </div>

            {settings.provider === 'gemini' && (
              <div className="pt-4 space-y-3 max-w-md">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <label className="text-sm font-medium text-slate-800">允许 AI 联网搜索 (Web Search)</label>
                    <p className="text-xs text-slate-500">开启后，AI 将能够使用 Google Search 获取最新信息。</p>
                  </div>
                  <button
                    onClick={() => setSettings({ enableWebSearch: !settings.enableWebSearch })}
                    className={cn(
                      "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2",
                      settings.enableWebSearch ? "bg-indigo-600" : "bg-slate-200"
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                        settings.enableWebSearch ? "translate-x-5" : "translate-x-0"
                      )}
                    />
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Footer Actions */}
        <div className="bg-slate-50 p-6 border-t border-slate-200 flex items-center justify-between">
          <div className="text-sm text-slate-500">
            配置将立即生效并应用于全局对话和记忆生成。
          </div>
          <Button
            onClick={handleSaveAndTest}
            disabled={isTesting}
            loading={isTesting}
            icon={<Save className="w-4 h-4" />}
          >
            {isTesting ? '测试中...' : '保存并测试连接'}
          </Button>
        </div>
      </div>

      {/* TTS Settings Section */}
      <div>
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2 mt-8">
          <Mic className="w-6 h-6 text-indigo-500" />
          语音与音色克隆 (TTS)
        </h2>
        <p className="text-sm text-slate-500 mt-1">配置 AI 语音合成服务，支持接入 RVC 克隆音色或第三方 TTS 接口。</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="p-6 space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">启用语音合成</h3>
              <p className="text-xs text-slate-500 mt-1">开启后，AI 回复将支持语音播放。</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer"
                checked={settings.tts?.enabled || false}
                onChange={(e) => setSettings({ tts: { ...settings.tts, enabled: e.target.checked, provider: settings.tts?.provider || 'rvc_custom', voiceId: settings.tts?.voiceId || '' } })}
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>

          {settings.tts?.enabled && (
            <>
              <div className="space-y-3">
                <label className="text-sm font-semibold text-slate-800">选择语音服务商</label>
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                  {(['browser', 'voxcpm', 'rvc_custom', 'gemini', 'openai', 'elevenlabs'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => handleTTSProviderChange(p)}
                      className={`px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                        settings.tts?.provider === p
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm'
                          : 'border-slate-200 text-slate-600 hover:border-indigo-300 hover:bg-slate-50'
                      }`}
                    >
                      {p === 'browser' && '浏览器内置'}
                      {p === 'voxcpm' && 'VoxCPM (内置)'}
                      {p === 'rvc_custom' && 'RVC / 自定义'}
                      {p === 'gemini' && 'Gemini TTS'}
                      {p === 'openai' && 'OpenAI TTS'}
                      {p === 'elevenlabs' && 'ElevenLabs'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-slate-400" />
                    音色模型 / Voice ID
                  </label>
                  <input
                    type="text"
                    value={settings.tts?.voiceId || ''}
                    onChange={e => setSettings({ tts: { ...(settings.tts as TTSSettings), voiceId: e.target.value } })}
                    placeholder={settings.tts?.provider === 'voxcpm' ? "例如: default" : settings.tts?.provider === 'rvc_custom' ? "例如: my_cloned_voice_v1" : "例如: alloy, Kore, 或 ElevenLabs ID"}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono text-sm"
                  />
                  <p className="text-xs text-slate-500">
                    {settings.tts?.provider === 'voxcpm' ? 'VoxCPM 预设音色名称。' : settings.tts?.provider === 'rvc_custom' ? '填写 RVC 后端对应的模型权重名称。' : '填写对应服务商的音色 ID。'}
                  </p>
                </div>

                {settings.tts?.provider === 'voxcpm' && (
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Mic className="w-4 h-4 text-slate-400" />
                      参考音色 (Reference Audio)
                    </label>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => document.getElementById('ref-audio-upload')?.click()}
                        className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-sm font-medium flex items-center gap-2"
                      >
                        <Paperclip className="w-4 h-4" />
                        {settings.tts?.refAudio ? '已上传音色' : '上传参考音频'}
                      </button>
                      {settings.tts?.refAudio && (
                        <button 
                          onClick={() => setSettings({ tts: { ...(settings.tts as TTSSettings), refAudio: undefined } })}
                          className="text-red-500 hover:text-red-600 text-xs"
                        >
                          清除
                        </button>
                      )}
                      <input 
                        id="ref-audio-upload"
                        type="file" 
                        accept="audio/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              setSettings({ tts: { ...(settings.tts as TTSSettings), refAudio: reader.result as string } });
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                    </div>
                    <p className="text-xs text-slate-500">上传一段 5-10 秒的清晰人声录音，VoxCPM 将模拟该音色。</p>
                  </div>
                )}

                {settings.tts?.provider !== 'browser' && settings.tts?.provider !== 'voxcpm' && (
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Link2 className="w-4 h-4 text-slate-400" />
                      {settings.tts?.provider === 'rvc_custom' ? 'RVC / 自定义接口地址' : 'TTS 代理接口地址 (可选)'}
                    </label>
                    <input
                      type="text"
                      value={settings.tts?.apiUrl || ''}
                      onChange={e => setSettings({ tts: { ...(settings.tts as TTSSettings), apiUrl: e.target.value } })}
                      placeholder={settings.tts?.provider === 'rvc_custom' ? "http://localhost:8000/tts" : "例如: https://api.openai.com/v1"}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono text-sm"
                    />
                    <p className="text-xs text-slate-500">
                      {settings.tts?.provider === 'rvc_custom' ? '指向您的本地或远程 RVC 推理服务器 API。' : '如果需要使用代理，请在此填写 Base URL。'}
                    </p>
                  </div>
                )}

                {settings.tts?.provider !== 'rvc_custom' && settings.tts?.provider !== 'browser' && (
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Key className="w-4 h-4 text-slate-400" />
                      TTS API Key (可选)
                    </label>
                    <input
                      type="password"
                      value={settings.tts?.apiKey || ''}
                      onChange={e => setSettings({ tts: { ...(settings.tts as TTSSettings), apiKey: e.target.value } })}
                      placeholder="留空则使用全局 API Key"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono text-sm"
                    />
                    <p className="text-xs text-slate-500">如果 TTS 服务商与全局不同，请在此填写对应的 API Key。</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {testResult === 'success' && (
        <div className="p-4 bg-green-50 text-green-700 rounded-xl border border-green-200 flex items-center gap-3 text-sm font-medium animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <div>
            <p>连接成功！</p>
            <p className="text-green-600 text-xs mt-0.5 font-normal">家庭管家已成功响应，当前配置可用。</p>
          </div>
        </div>
      )}
      {testResult === 'error' && (
        <div className="p-4 bg-rose-50 text-rose-700 rounded-xl border border-rose-200 flex items-center gap-3 text-sm font-medium animate-in fade-in slide-in-from-bottom-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <div>
            <p>连接失败</p>
            <p className="text-rose-600 text-xs mt-0.5 font-normal">请检查 API Key 是否填写正确，或 Base URL 是否可访问。</p>
          </div>
        </div>
      )}
    </div>
  );
}
