import React from 'react';
import { Cpu, Wifi, WifiOff, Laptop } from 'lucide-react';

const DevicesView: React.FC = () => {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">设备控制</h1>
      <p className="text-slate-600">管理和控制已连接的智能设备。</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <Wifi className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="font-semibold text-slate-800">Mock IoT 模拟</p>
                <p className="text-xs text-slate-500">模拟设备</p>
              </div>
            </div>
            <span className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
              已连接
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center py-2 px-3 bg-slate-50 rounded-lg">
              <span className="text-sm text-slate-600">客厅灯</span>
              <span className="text-xs text-slate-400">离线</span>
            </div>
            <div className="flex justify-between items-center py-2 px-3 bg-slate-50 rounded-lg">
              <span className="text-sm text-slate-600">卧室灯</span>
              <span className="text-xs text-slate-400">离线</span>
            </div>
            <div className="flex justify-between items-center py-2 px-3 bg-slate-50 rounded-lg">
              <span className="text-sm text-slate-600">空调</span>
              <span className="text-xs text-slate-400">离线</span>
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-4">通过对话或以下按钮控制设备。</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm md:col-span-2">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <Laptop className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <p className="font-semibold text-slate-800">集成平台</p>
              <p className="text-xs text-slate-500">HomeAssistant / 米家等第三方平台集成（开发中）</p>
            </div>
          </div>
          <div className="p-6 bg-slate-50 rounded-xl text-center">
            <Cpu className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">智能设备集成功能正在开发中</p>
            <p className="text-xs text-slate-400 mt-1">敬请期待</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DevicesView;
