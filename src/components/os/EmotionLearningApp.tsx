import { useState } from 'react';

type Material = {
  title: string;
  pages: string;
  format: string;
  structure: string;
  status: '可读取' | '需处理' | '范围已确认';
  events: string;
  deep: string;
  people: string;
  note: string;
};

const MATERIALS: Material[] = [
  {
    title: '爱在黎明破晓前', pages: '55', format: '英文电影剧本', structure: '23 个场景标记（已确认纳入）', status: '可读取',
    events: '12–20', deep: '6–10', people: '1 位女性主角，关系对象作为脉络',
    note: 'PDF 内容是 BEFORE SUNRISE 剧本，含地点与场景注释，不是小说；作者/版本来源尚未核实。',
  },
  {
    title: '傲慢与偏见', pages: '352', format: '中文译本', structure: '3 卷、61 章', status: '可读取',
    events: '35–55', deep: '18–25', people: '建议 3 位重点女性人物',
    note: '可提取文本覆盖 350/352 页；元数据显示译者王科一，卷首含译序，需与正文区分。',
  },
  {
    title: '半生缘', pages: '250', format: '中文小说', structure: '目录列 17 节', status: '可读取',
    events: '30–45', deep: '15–22', people: '建议 2–3 位重点女性人物',
    note: '正文文本可提取；版权页标示张爱玲、北京十月文艺出版社 2012 年版。末页含版本/连载说明。',
  },
  {
    title: '红楼梦', pages: '1318', format: '通行本·简体横排', structure: '120 回；正文可提取', status: '可读取',
    events: '暂定 80–140', deep: '暂定 35–50', people: '建议 6–10 位，复核低文本页后再定',
    note: '已替换为红楼梦(通行本)简体横排.pdf；1315/1318 页有可提取文本，目录书签列出 120 回。封面注明 2020 年从维基文库下载。少量低文本页和印刷页码映射待逐回核对。',
  },
  {
    title: '挪威的森林', pages: '188', format: '中文译本', structure: '11 章，另有后记', status: '可读取',
    events: '25–40', deep: '12–18', people: '建议 2–3 位重点女性人物',
    note: '正文可提取；元数据显示林少华译、上海译文出版社 2001 年 2 月。前置代译序与正文分开。',
  },
  {
    title: '倾城之恋', pages: '273（整册）', format: '张爱玲小说集', structure: '目录列 9 篇；同名篇 PDF 第 138–171 页', status: '范围已确认',
    events: '目标篇暂定 12–20', deep: '目标篇暂定 6–10', people: '建议 1–2 位重点女性人物',
    note: '此 PDF 是九篇小说合集；用户已确认只研究同名篇，不含整册其他作品。',
  },
  {
    title: '一个陌生女人的来信', pages: '178（整册）', format: '含两篇小说的选本', structure: '同名篇 PDF 第 6–135 页；第 136 页起为另一篇', status: '范围已确认',
    events: '目标篇暂定 12–20', deep: '目标篇暂定 6–10', people: '建议 1 位核心人物',
    note: '用户已确认只研究同名篇。目标篇之后接《艾利卡·埃瓦尔德的恋爱》；标点编码异常，引文需对照页面图像复核。',
  },
];

const STAGES = [
  '阶段 0 · 材料验证', '阶段 1 · 全书覆盖与人物索引', '阶段 2 · 连续情感轨迹',
  '阶段 3 · 深度场景学习', '阶段 4 · 预测与对照', '阶段 5 · 行为表达与互动',
  '阶段 6 · 跨作品迁移', '阶段 7 · 现实情境测试', '阶段 8 · 经验沉淀与评估',
];

const statusStyle: Record<Material['status'], string> = {
  '可读取': 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200',
  '需处理': 'border-amber-300/25 bg-amber-300/10 text-amber-100',
  '范围已确认': 'border-sky-300/25 bg-sky-300/10 text-sky-100',
};

export default function EmotionLearningApp() {
  const [tab, setTab] = useState<'materials' | 'method'>('materials');
  const directTextCount = 7;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0f1120] text-slate-100">
      <header className="border-b border-white/10 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-rose-100">情感认知学习</div>
            <p className="mt-1 text-xs text-slate-400">以人物经历、关系和文本证据为基础，训练理解、预测、互动与修正。</p>
          </div>
          <div className="rounded-lg border border-amber-200/20 bg-amber-200/[0.06] px-3 py-2 text-xs text-amber-100">
            阶段 1 进行中 · {directTextCount}/7 份含可提取文本
          </div>
        </div>
        <nav className="mt-4 flex gap-2" aria-label="情感学习页面">
          <button onClick={() => setTab('materials')} className={`rounded-lg px-3 py-1.5 text-xs ${tab === 'materials' ? 'bg-rose-300/15 text-rose-100' : 'text-slate-400 hover:bg-white/5'}`}>材料核验</button>
          <button onClick={() => setTab('method')} className={`rounded-lg px-3 py-1.5 text-xs ${tab === 'method' ? 'bg-rose-300/15 text-rose-100' : 'text-slate-400 hover:bg-white/5'}`}>训练流程</button>
        </nav>
      </header>

      {tab === 'materials' ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.035] p-3 text-xs leading-relaxed text-slate-300">
            <div><span className="text-slate-500">材料目录：</span><code className="text-sky-200">E:\情感文本</code></div>
            <div className="mt-1 text-slate-400">检查范围：文件存在、PDF 可打开、页数、可提取文本、目录/章节标记、版本元数据及抽样页面。场景预算是计划值，不代表已阅读或已提取事件。</div>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {MATERIALS.map((item, index) => (
              <article key={item.title} className="rounded-xl border border-white/10 bg-white/[0.035] p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/10 text-[11px] text-slate-300">{index + 1}</span>
                    <div>
                      <h3 className="text-sm font-medium text-slate-100">{item.title}</h3>
                      <p className="mt-1 text-[11px] text-slate-400">{item.format} · {item.pages} 页 · {item.structure}</p>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${statusStyle[item.status]}`}>{item.status}</span>
                </div>
                <p className="ml-[34px] mt-2 text-[11px] leading-relaxed text-slate-300">{item.note}</p>
                <div className="ml-[34px] mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400">
                  <span>候选事件：<b className="font-medium text-slate-200">{item.events}</b></span>
                  <span>深度场景：<b className="font-medium text-slate-200">{item.deep}</b></span>
                  <span>人物数：<b className="font-medium text-slate-200">{item.people}</b></span>
                </div>
              </article>
            ))}
          </div>
          <div className="mt-3 rounded-xl border border-amber-200/20 bg-amber-200/[0.05] p-3 text-[11px] leading-relaxed text-amber-100/90">
            当前进度：傲慢与偏见 61/61 章已读，规范化索引 111 条候选事件；已补齐第二卷第二章、修正章节映射并拆分一条复合事件。小说正文至 PDF 第 344 页结束。核心人物情感演化时间线已有草案，下一步回到原文抽查并建立场景测试集。红楼梦新版可读取，少量低文本页和印刷页码映射留待逐回核对。当前不做内心重建、预测或角色模仿。
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-4 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.06] p-4">
            <div className="text-sm font-medium text-emerald-100">当前状态：阶段 1 进行中 ·《傲慢与偏见》全 13 批阅读已完成</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">第一卷、第二卷和第三卷均已完成（23/23、19/19、19/19 章），全书 61/61 章；规范化事件索引 111 条，章节映射、漏章和复合事件已复核。全书原始证据等级仍保留；人物时间线为研究草案，需回到原文抽查，不直接作为角色仿真训练标签。每批保留证据位置、替代解释、未读范围和错误修正记录。</p>
          </div>
          <ol className="grid gap-2 md:grid-cols-2">
            {STAGES.map((stage, index) => (
              <li key={stage} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-xs ${index === 0 ? 'border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-100' : index === 1 ? 'border-rose-300/25 bg-rose-300/[0.07] text-rose-100' : 'border-white/8 bg-white/[0.025] text-slate-500'}`}>
                <span className="w-5 text-center tabular-nums">{index === 0 ? '✓' : index === 1 ? '●' : '—'}</span>{stage}
                {index === 1 && <span className="ml-auto text-[10px]">61/61 章</span>}
                {index > 1 && <span className="ml-auto text-[10px]">待阶段 1 完成</span>}
              </li>
            ))}
          </ol>
          <div className="mt-4 text-[11px] leading-relaxed text-slate-400">学习原则：观察、推断、未知分层；保留替代解释；预测必须隔离答案；模拟互动反馈不当作真人验证；文学人物经历归属于作品，不写成 AI 的个人经历。</div>
        </div>
      )}
    </div>
  );
}
