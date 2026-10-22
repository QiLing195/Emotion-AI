import { useEffect, useState } from 'react';

/**
 * 唤醒词设置页（v1.90）——桌宠右键菜单「唤醒词设置…」打开这个窗口。
 * 保存后服务端会重启语音识别进程，立即生效（不用重启桌宠）。
 */
interface Cfg {
  wakeWords: string[];
  wakeMinConfidence: number;
}

export default function PetSettingsApp() {
  const [words, setWords] = useState('');
  const [conf, setConf] = useState(0.93);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/api/pet/voice/config');
        const d = await r.json() as Cfg;
        setWords((d.wakeWords ?? ['二丫']).join('、'));
        setConf(Number(d.wakeMinConfidence ?? 0.93));
        setLoaded(true);
      } catch {
        setMsg('连不上服务端');
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg('');
    try {
      const r = await fetch('/api/pet/voice/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wakeWords: words.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean),
          wakeMinConfidence: conf,
        }),
      });
      const d = await r.json() as Cfg & { ok?: boolean; error?: string };
      if (!d.ok) { setMsg('保存失败：' + (d.error ?? '未知错误')); return; }
      setWords((d.wakeWords ?? []).join('、'));
      setConf(Number(d.wakeMinConfidence ?? conf));
      setMsg('已保存。新的唤醒词立刻生效 —— 试着喊一声试试。');
    } catch (e) {
      setMsg('保存失败：' + (e instanceof Error ? e.message : '网络错误'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#12141f] px-6 py-5 text-slate-200">
      <h1 className="text-[15px] font-semibold text-rose-200">唤醒词设置</h1>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
        喊任意一个词就能唤醒她。多个词用逗号/顿号隔开（最多 6 个）。
        推荐 2~4 个字的专有词，别用「你好」这种日常词。
      </p>

      <label className="mt-4 block text-[12px] text-slate-300">唤醒词</label>
      <input
        value={words}
        onChange={e => setWords(e.target.value)}
        disabled={!loaded}
        placeholder="二丫、小丫"
        className="mt-1 w-full rounded-lg border border-white/15 bg-[#1a1d2e] px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-rose-400/60"
      />

      <label className="mt-4 block text-[12px] text-slate-300">
        唤醒置信度门槛：<span className="text-rose-200">{conf.toFixed(2)}</span>
      </label>
      <input
        type="range"
        min={0.5}
        max={0.99}
        step={0.01}
        value={conf}
        onChange={e => setConf(Number(e.target.value))}
        disabled={!loaded}
        className="mt-1 w-full accent-rose-400"
      />
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        <span>0.85 容易唤醒</span>
        <span>0.95 不容易误唤醒</span>
      </div>

      <button
        onClick={() => void save()}
        disabled={!loaded || saving}
        className="mt-5 w-full rounded-lg bg-rose-500/90 py-2 text-[13px] font-medium text-white disabled:opacity-50"
      >
        {saving ? '保存中…' : '保存并生效'}
      </button>

      {msg && <div className="mt-3 rounded-lg bg-white/5 px-3 py-2 text-[11px] text-amber-200">{msg}</div>}

      <div className="mt-5 rounded-lg bg-white/5 p-3 text-[10px] leading-relaxed text-slate-400">
        说明：识别用的是 Windows 自带的离线中文识别（不联网、不下载模型）。
        保存后她会在 1 秒内换用新唤醒词。如果喊了没反应，把上面的门槛往左调；如果被别的话误唤醒，往右调。
      </div>
    </div>
  );
}
