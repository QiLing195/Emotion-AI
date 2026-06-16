import React, { useState } from 'react';
import { Bell, MessageCircle, Webhook, QrCode, Copy, Check, RefreshCw } from 'lucide-react';

const IntegrationsView: React.FC = () => {
  const [token, setToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const callbackUrl = `${window.location.protocol}//${window.location.hostname}:3000/api/channel/wechat/callback`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(callbackUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTestConnection = async () => {
    try {
      const resp = await fetch('/api/info', { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        setTestResult('服务器回调接口正常运行');
      } else {
        setTestResult('接口响应异常: ' + resp.status);
      }
    } catch {
      setTestResult('无法连接服务器，请确认服务已启动');
    }
    setTimeout(() => setTestResult(null), 4000);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">微信接入</h1>
      <p className="text-slate-600">配置微信公众号 / 企业微信接入，实现微信聊天与设备控制。</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 微信公众号 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-200 bg-slate-50/50">
            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-green-500" />
              微信公众号
            </h3>
            <p className="text-sm text-slate-500 mt-1">通过微信公众号与 AI 进行对话</p>
          </div>
          <div className="p-6 space-y-4">
            {/* Token 配置 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Token（签名验证）</label>
              <input
                type="text"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none"
                placeholder="输入微信公众号后台配置的 Token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <p className="text-xs text-slate-400 mt-1">需与微信公众号后台「开发 → 基本配置」中的 Token 一致</p>
            </div>

            {/* 回调地址 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">回调地址</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 text-xs bg-slate-50 rounded-lg border border-slate-200 text-slate-600 break-all font-mono">
                  {callbackUrl}
                </code>
                <button
                  onClick={handleCopy}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
                  title="复制回调地址"
                >
                  {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* 连接测试 */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleTestConnection}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors border border-green-200"
              >
                <RefreshCw className="w-4 h-4" />
                测试连接
              </button>
              {testResult && (
                <span className={`text-xs ${testResult.includes('正常') ? 'text-green-600' : 'text-amber-600'}`}>
                  {testResult}
                </span>
              )}
            </div>

            <div className="p-4 bg-amber-50 text-amber-700 rounded-xl text-sm flex items-start gap-3 border border-amber-100">
              <Bell className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">服务器回调接口已在运行</p>
                <p className="text-xs mt-1 opacity-80">
                  在微信公众号后台「开发 → 基本配置」中填写以上回调地址和 Token，提交验证后即可启用。
                  仅开发环境可用，生产环境需部署到公网服务器。
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 企业微信 / 其他 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-200 bg-slate-50/50">
            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <QrCode className="w-5 h-5 text-indigo-500" />
              企业微信 / 个人微信
            </h3>
            <p className="text-sm text-slate-500 mt-1">其他微信接入方式</p>
          </div>
          <div className="p-6 space-y-4">
            {/* 企业微信 Webhook */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex items-center gap-3 mb-2">
                <Webhook className="w-5 h-5 text-indigo-400" />
                <span className="text-sm font-medium text-slate-700">企业微信 Webhook</span>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                通过企业微信机器人 Webhook 接收群消息并转发至 AI 处理。
              </p>
              <input
                type="text"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
              />
            </div>

            {/* 个人微信 */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex items-center gap-3 mb-2">
                <MessageCircle className="w-5 h-5 text-slate-400" />
                <span className="text-sm font-medium text-slate-700">个人微信</span>
              </div>
              <p className="text-xs text-slate-400">
                个人微信接入需要通过第三方合规服务（如 WeChaty、PadLocal）实现，
                需自行部署消息网关。参考文档配置 WebSocket 连接。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IntegrationsView;
