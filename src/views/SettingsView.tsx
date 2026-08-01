import React, { useState } from 'react';
import { useAIBrainStore, Provider, TTSSettings } from '../store/useAIBrainStore';

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

/* ── Apple-Style Row ───────────────────────────────── */
function SettingRow({ icon, label, children, last }: {
  icon: string; label: string; children: React.ReactNode; last?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${last ? '' : 'border-b border-slate-100'}`}>
      <span className="text-lg w-7 text-center shrink-0">{icon}</span>
      <span className="text-sm font-medium text-slate-800 w-28 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function SettingGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="px-1 text-xs font-medium text-slate-400 uppercase tracking-wide">{title}</h3>
      <div className="bg-white rounded-xl border border-slate-200/60 shadow-sm overflow-hidden">
        {children}
      </div>
    </div>
  );
}

/* ── Provider Chip ─────────────────────────────────── */
function ProviderChip({ provider, active, onClick }: {
  provider: Provider; active: boolean; onClick: () => void;
}) {
  const labels: Record<string, string> = {
    openai: 'OpenAI', gemini: 'Gemini', anthropic: 'Anthropic',
    deepseek: 'DeepSeek', siliconflow: '硅基流动', moonshot: 'Kimi',
    zhipu: '智谱', custom: '自定义',
  };
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
        active
          ? 'bg-indigo-500 text-white shadow-sm'
          : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200/60'
      }`}
    >
      {labels[provider] || provider}
    </button>
  );
}

/* ═════════════════════════════════════════════════════ */
export default function SettingsView() {
  const { settings, setSettings } = useAIBrainStore();
  const [showTestResult, setShowTestResult] = useState<'success' | 'error' | null>(null);

  const handleProviderChange = (p: Provider) => {
    const defaults: Record<string, Partial<typeof settings>> = {
      openai: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4-turbo' },
      gemini: { provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.1-pro-preview' },
      anthropic: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-opus-20240229' },
      deepseek: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      siliconflow: { provider: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
      moonshot: { provider: 'moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
      zhipu: { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4' },
      custom: { provider: 'custom', baseUrl: '', model: '' },
    };
    setSettings(defaults[p] || { provider: p });
  };

  const handleTestConnection = async () => {
    if (!settings.apiKey && !settings.serverConfigured) {
      setShowTestResult('error');
      setTimeout(() => setShowTestResult(null), 3000);
      return;
    }
    try {
      const response = await fetch('/api/ai-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      const data = await response.json().catch(() => ({ success: false }));
      setShowTestResult(response.ok && data.success ? 'success' : 'error');
    } catch {
      setShowTestResult('error');
    }
    setTimeout(() => setShowTestResult(null), 3000);
  };

  return (
    <div className="px-6 py-6 space-y-5 bg-[#f2f2f7] min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">设置</h2>
          <p className="text-xs text-slate-400 mt-0.5">模型与 API 配置</p>
        </div>
        <div className="flex items-center gap-2">
          {showTestResult === 'success' && (
            <span className="text-xs font-medium text-green-600 bg-green-50 px-2.5 py-1 rounded-full">✓ 连接成功</span>
          )}
          {showTestResult === 'error' && (
            <span className="text-xs font-medium text-red-600 bg-red-50 px-2.5 py-1 rounded-full">✗ 连接失败</span>
          )}
          <button
            onClick={handleTestConnection}
            className="px-4 py-1.5 bg-indigo-500 text-white text-xs font-medium rounded-lg hover:bg-indigo-600 transition-colors"
          >
            测试连接
          </button>
        </div>
      </div>

      {/* ── Model Provider ── */}
      <SettingGroup title="模型服务商">
        <div className="px-4 py-3">
          <div className="flex flex-wrap gap-2 mb-3">
            {(Object.keys(PROVIDER_MODELS) as Provider[]).concat('custom').map(p => (
              <React.Fragment key={p}>
                <ProviderChip provider={p} active={settings.provider === p} onClick={() => handleProviderChange(p)} />
              </React.Fragment>
            ))}
          </div>
          <p className="text-xs text-slate-400">选择用于驱动对话的大语言模型服务商</p>
        </div>
      </SettingGroup>

      {/* ── API Key & Connection ── */}
      <SettingGroup title="连接凭证">
        <SettingRow icon="🔑" label="API Key">
          <input
            type="password"
            value={settings.apiKey}
            onChange={e => setSettings({ apiKey: e.target.value })}
            placeholder="sk-..."
            className="w-full text-sm font-mono bg-transparent outline-none placeholder:text-slate-300 text-slate-700"
          />
        </SettingRow>
        <SettingRow icon="🔗" label="Base URL" last>
          <input
            type="text"
            value={settings.baseUrl}
            onChange={e => setSettings({ baseUrl: e.target.value })}
            placeholder="https://api.openai.com/v1"
            className="w-full text-sm font-mono bg-transparent outline-none placeholder:text-slate-300 text-slate-700"
          />
        </SettingRow>
      </SettingGroup>

      {/* ── Model ── */}
      <SettingGroup title="模型参数">
        <SettingRow icon="🧠" label="模型">
          <select
            value={settings.model}
            onChange={e => setSettings({ model: e.target.value })}
            className="w-full text-sm bg-transparent outline-none text-slate-700 cursor-pointer"
          >
            {(PROVIDER_MODELS[settings.provider] || []).map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
            {!PROVIDER_MODELS[settings.provider]?.includes(settings.model) && settings.model && (
              <option value={settings.model}>{settings.model}</option>
            )}
          </select>
        </SettingRow>
        <SettingRow icon="🌡️" label="发散度" last>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0" max="2" step="0.1"
              value={settings.temperature}
              onChange={e => setSettings({ temperature: parseFloat(e.target.value) })}
              className="flex-1 accent-indigo-500 h-1"
            />
            <span className="text-sm font-mono text-slate-500 w-7 text-right">{settings.temperature.toFixed(1)}</span>
          </div>
        </SettingRow>
      </SettingGroup>

      {/* ── TTS ── */}
      <SettingGroup title="语音合成 (TTS)">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg">🎙️</span>
            <span className="text-sm font-medium text-slate-800">启用语音</span>
          </div>
          <button
            onClick={() => setSettings({ tts: { ...settings.tts, enabled: !settings.tts?.enabled, provider: settings.tts?.provider || 'rvc_custom', voiceId: settings.tts?.voiceId || '' } })}
            className={`relative w-10 h-6 rounded-full transition-colors ${settings.tts?.enabled ? 'bg-indigo-500' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.tts?.enabled ? 'translate-x-4' : ''}`} />
          </button>
        </div>
      </SettingGroup>

      {settings.tts?.enabled && (
        <SettingGroup title="TTS 服务商">
          <div className="px-4 py-3">
            <div className="flex flex-wrap gap-2">
              {(['browser', 'voxcpm', 'rvc_custom', 'gemini', 'openai', 'elevenlabs'] as const).map(p => {
                const labels: Record<string, string> = {
                  browser: '浏览器', voxcpm: 'VoxCPM', rvc_custom: 'RVC',
                  gemini: 'Gemini', openai: 'OpenAI', elevenlabs: 'ElevenLabs',
                };
                return (
                  <button
                    key={p}
                    onClick={() => setSettings({ tts: { ...settings.tts as TTSSettings, provider: p } })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      settings.tts?.provider === p
                        ? 'bg-indigo-500 text-white shadow-sm'
                        : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200/60'
                    }`}
                  >
                    {labels[p]}
                  </button>
                );
              })}
            </div>
          </div>
          <SettingRow icon="🎵" label="音色 ID" last>
            <input
              type="text"
              value={settings.tts?.voiceId || ''}
              onChange={e => setSettings({ tts: { ...(settings.tts as TTSSettings), voiceId: e.target.value } })}
              placeholder={settings.tts?.provider === 'rvc_custom' ? 'my_voice_v1' : 'alloy'}
              className="w-full text-sm font-mono bg-transparent outline-none placeholder:text-slate-300 text-slate-700"
            />
          </SettingRow>
        </SettingGroup>
      )}

      {/* Footer */}
      <p className="text-center text-xs text-slate-300 pt-2">
        配置自动保存 · 仅存储在本地浏览器
      </p>
    </div>
  );
}
