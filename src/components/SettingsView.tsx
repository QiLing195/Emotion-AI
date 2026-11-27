import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import {
  CheckCircle2,
  Cloud,
  CloudUpload,
  Download,
  Loader2,
  LogIn,
  LogOut,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { EmotionEngineMode } from '../dual-loop/contracts';

export type DeepSeekModelId = 'deepseek-chat' | 'deepseek-reasoner';
export type DefaultExtractorSource =
  | 'hybrid_fast_slow'
  | 'local_rules'
  | 'server_llm';

export interface AppSettings {
  readonly deepseekModel: DeepSeekModelId;
  readonly defaultExtractorSource: DefaultExtractorSource;
  readonly defaultEngineMode: EmotionEngineMode;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  deepseekModel: 'deepseek-chat',
  defaultExtractorSource: 'hybrid_fast_slow',
  defaultEngineMode: 'shadow_only',
};

interface SettingsViewProps {
  readonly settings: AppSettings;
  readonly cloudUser: User | null;
  readonly isAuthBusy: boolean;
  readonly authReady: boolean;
  readonly isMigratingLocal: boolean;
  readonly migrationFeedback: {
    readonly type: 'success' | 'error';
    readonly message: string;
  } | null;
  readonly annotationCount: number;
  readonly onChangeSettings: (next: AppSettings) => void;
  readonly onSignIn: () => void;
  readonly onSignOut: () => void;
  readonly onMigrateLocalWorkspace: () => void;
  readonly onExportJson: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  cloudUser,
  isAuthBusy,
  authReady,
  isMigratingLocal,
  migrationFeedback,
  annotationCount,
  onChangeSettings,
  onSignIn,
  onSignOut,
  onMigrateLocalWorkspace,
  onExportJson,
}) => {
  const [isTestingApi, setIsTestingApi] = useState(false);
  const [apiTestResult, setApiTestResult] = useState<{
    readonly ok: boolean;
    readonly message: string;
  } | null>(null);

  const handleTestDeepSeek = async () => {
    setIsTestingApi(true);
    setApiTestResult(null);
    try {
      const response = await fetch('/api/deepseek/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: settings.deepseekModel }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        model?: string;
        latencyMs?: number;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        setApiTestResult({
          ok: false,
          message: payload.error || 'DeepSeek 接口连通性检测失败。',
        });
        return;
      }
      setApiTestResult({
        ok: true,
        message: `DeepSeek 接口连接正常（模型：${payload.model ?? settings.deepseekModel}，响应耗时 ${payload.latencyMs ?? 0} ms）。`,
      });
    } catch {
      setApiTestResult({
        ok: false,
        message: '无法连接本地服务端接口，请检查服务是否运行。',
      });
    } finally {
      setIsTestingApi(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* 1. DeepSeek 模型与连通性设置 */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
        <div className="pb-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">
            DeepSeek 模型配置
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            选择情绪分析、双环语义提取、受控流式回复与异步反思所使用的 DeepSeek 模型。
          </p>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-medium text-slate-700">当前推理模型</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(
              [
                {
                  id: 'deepseek-chat',
                  title: 'deepseek-chat',
                  desc: '通用高速模型，响应快，适合日常情绪标注、流式回复与实时对话。',
                },
                {
                  id: 'deepseek-reasoner',
                  title: 'deepseek-reasoner',
                  desc: '深度推理模型，适合复杂反讽、长语境理解与多轮反思提炼（耗时较长）。',
                },
              ] as const
            ).map((item) => {
              const active = settings.deepseekModel === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onChangeSettings({ ...settings, deepseekModel: item.id });
                    setApiTestResult(null);
                  }}
                  className={`text-left p-3.5 rounded-md border transition-colors ${
                    active
                      ? 'border-blue-600 bg-blue-50/40'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold font-mono text-slate-900">
                      {item.title}
                    </span>
                    {active && (
                      <CheckCircle2
                        className="w-4 h-4 text-blue-600 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                    {item.desc}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-800 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              <span>服务端密钥安全托管</span>
            </p>
            <p className="text-xs text-slate-500 leading-relaxed">
              为防止密钥泄露，页面不提供 API Key 输入框；<span className="font-mono text-slate-700">DEEPSEEK_API_KEY</span> 由托管平台的环境变量（Secrets）在服务端安全读取。
            </p>
          </div>
          <button
            type="button"
            onClick={handleTestDeepSeek}
            disabled={isTestingApi}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-45 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            {isTestingApi ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Zap className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>{isTestingApi ? '检测中…' : '测试 API 连通性'}</span>
          </button>
        </div>

        {apiTestResult && (
          <div
            role={apiTestResult.ok ? 'status' : 'alert'}
            className={`px-3.5 py-2.5 text-xs rounded-md border ${
              apiTestResult.ok
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            {apiTestResult.message}
          </div>
        )}
      </section>

      {/* 2. 双环实验台默认参数 */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="pb-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">
            双环实验台默认偏好
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            进入双环实验台时自动套用的默认语义提取通道与角色状态机模式。
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label
              htmlFor="settings-default-extractor"
              className="block text-xs font-medium text-slate-700"
            >
              默认提取通道
            </label>
            <select
              id="settings-default-extractor"
              value={settings.defaultExtractorSource}
              onChange={(event) =>
                onChangeSettings({
                  ...settings,
                  defaultExtractorSource: event.target
                    .value as DefaultExtractorSource,
                })
              }
              className="w-full px-3 py-2 text-xs text-slate-900 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-blue-600 focus:outline-none"
            >
              <option value="hybrid_fast_slow">快慢分级（推荐）</option>
              <option value="local_rules">本地规则（零延迟离线）</option>
              <option value="server_llm">服务端 DeepSeek（全量语义）</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="settings-default-mode"
              className="block text-xs font-medium text-slate-700"
            >
              默认状态机模式
            </label>
            <select
              id="settings-default-mode"
              value={settings.defaultEngineMode}
              onChange={(event) =>
                onChangeSettings({
                  ...settings,
                  defaultEngineMode: event.target.value as EmotionEngineMode,
                })
              }
              className="w-full px-3 py-2 text-xs text-slate-900 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-blue-600 focus:outline-none"
            >
              <option value="shadow_only">只读影子（delta=0）</option>
              <option value="bounded_live">有界放量（bounded）</option>
            </select>
          </div>
        </div>
      </section>

      {/* 3. 账号与数据同步 */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="pb-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">
            账号与云端存储
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            管理个人 Google 账号登录状态及当前 {annotationCount} 条标注数据的备份导出。
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-slate-600 space-y-0.5">
            {cloudUser ? (
              <>
                <p className="font-medium text-slate-900 flex items-center gap-1.5">
                  <Cloud className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                  <span>
                    已登录：{cloudUser.displayName || cloudUser.email || '已登录用户'}
                  </span>
                </p>
                <p>标注记录、动态关切与人格成长状态已按个人账号隔离同步至云端。</p>
              </>
            ) : (
              <>
                <p className="font-medium text-slate-900">当前为本机浏览器存储模式</p>
                <p>登录 Google 账号后可实现跨设备实时同步与个人数据隔离。</p>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onExportJson}
              disabled={annotationCount === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-45 rounded-md transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>备份 JSON</span>
            </button>

            {cloudUser && (
              <button
                type="button"
                onClick={onMigrateLocalWorkspace}
                disabled={isMigratingLocal}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-45 rounded-md transition-colors whitespace-nowrap"
              >
                {isMigratingLocal ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <CloudUpload className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{isMigratingLocal ? '同步中…' : '同步本地数据至云端'}</span>
              </button>
            )}

            {cloudUser ? (
              <button
                type="button"
                onClick={onSignOut}
                disabled={isAuthBusy}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-45 rounded-md transition-colors whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span>退出登录</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignIn}
                disabled={isAuthBusy || !authReady}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-45 rounded-md transition-colors whitespace-nowrap"
              >
                <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Google 登录</span>
              </button>
            )}
          </div>
        </div>

        {migrationFeedback && (
          <div
            role={migrationFeedback.type === 'error' ? 'alert' : 'status'}
            className={`px-3.5 py-2.5 text-xs rounded-md border ${
              migrationFeedback.type === 'error'
                ? 'bg-rose-50 text-rose-800 border-rose-200'
                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
            }`}
          >
            {migrationFeedback.message}
          </div>
        )}
      </section>
    </div>
  );
};
