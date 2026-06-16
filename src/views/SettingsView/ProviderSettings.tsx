import React, { useState } from 'react';
import { Key, Link2, Cpu, Sliders, Server, Eye, EyeOff } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Provider, Settings as SettingsType } from '../../store/useAIBrainStore';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Combobox } from '../../components/forms/Combobox';
import { ToggleSwitch } from '../../components/ui/ToggleSwitch';
import { Card, CardBody } from '../../components/ui/Card';

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

// Convert string arrays to SelectOption arrays for Combobox
const getUrlOptions = (provider: string) => {
  const urls = PROVIDER_URLS[provider] || [];
  return urls.map(url => ({ value: url, label: url }));
};

const getModelOptions = (provider: string) => {
  const models = PROVIDER_MODELS[provider] || [];
  return models.map(model => ({ value: model, label: model }));
};


export interface ProviderSettingsProps {
  settings: SettingsType;
  setSettings: (settings: Partial<SettingsType>) => void;
}

const ProviderSettings: React.FC<ProviderSettingsProps> = ({
  settings,
  setSettings,
}) => {
  const [showKey, setShowKey] = useState(false);

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

  return (
    <Card rounded="2xl" shadow="md" border={true}>
      <CardBody padding="lg" className="space-y-8">
        {/* Provider Selection */}
        <div className="space-y-3">
          <label className="text-sm font-semibold text-slate-800">选择模型服务商</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(['openai', 'gemini', 'anthropic', 'deepseek', 'siliconflow', 'moonshot', 'zhipu', 'custom'] as Provider[]).map((p) => {
              const getLabel = () => {
                if (p === 'openai') return 'OpenAI';
                if (p === 'gemini') return 'Google Gemini';
                if (p === 'anthropic') return 'Anthropic';
                if (p === 'deepseek') return 'DeepSeek';
                if (p === 'siliconflow') return '硅基流动';
                if (p === 'moonshot') return 'Kimi (月之暗面)';
                if (p === 'zhipu') return '智谱清言';
                return '自定义 / 代理';
              };

              return (
                <Button
                  key={p}
                  onClick={() => handleProviderChange(p)}
                  variant={settings.provider === p ? 'primary' : 'outline'}
                  size="lg"
                  icon={<Server className="w-5 h-5" />}
                  iconPosition="top"
                  className="h-auto py-3 flex flex-col items-center gap-2"
                >
                  {getLabel()}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* API Key */}
          <div className="space-y-2 md:col-span-2">
            <Input
              label={
                <span className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-slate-400" />
                  API Key (密钥)
                </span>
              }
              type={showKey ? "text" : "password"}
              value={settings.apiKey || ''}
              onChange={e => setSettings({ apiKey: e.target.value })}
              placeholder={settings.provider === 'custom' ? "如果不需要可留空" : "sk-..."}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
              className="font-mono"
            />
            <p className="text-xs text-slate-500">您的密钥仅保存在本地浏览器中，不会上传至任何第三方服务器。</p>
          </div>

          {/* Base URL */}
          <Combobox
            label={
              <span className="flex items-center gap-2">
                <Link2 className="w-4 h-4 text-slate-400" />
                Base URL (接口地址)
              </span>
            }
            value={settings.baseUrl || ''}
            onChange={(val) => setSettings({ baseUrl: val })}
            options={getUrlOptions(settings.provider)}
            placeholder="https://api.openai.com/v1"
            searchable={true}
            description="支持配置国内代理地址或 OneAPI 聚合接口。"
          />

          {/* Model Name */}
          <Combobox
            label={
              <span className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-slate-400" />
                Model (模型名称)
              </span>
            }
            value={settings.model || ''}
            onChange={(val) => setSettings({ model: val })}
            options={getModelOptions(settings.provider)}
            placeholder="gpt-4-turbo"
            searchable={true}
          />
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
              <ToggleSwitch
                label="允许 AI 联网搜索 (Web Search)"
                description="开启后，AI 将能够使用 Google Search 获取最新信息。"
                checked={settings.enableWebSearch}
                onChange={(checked) => setSettings({ enableWebSearch: checked })}
              />
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
};

export default ProviderSettings;