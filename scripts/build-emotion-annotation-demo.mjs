#!/usr/bin/env node
/** Build a self-contained, read-only demo from the frozen v0.3 calibration outputs. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = path.join(ROOT, 'artifacts', 'emotion-learning');
const CASES = path.join(DOC, 'emotion-annotation-contrast-cases-v0.3.jsonl');
const RESULTS = path.join(DOC, 'pilot-results-v0.3');
const OUTPUT = path.join(DOC, 'emotion-annotation-demo-v0.1.html');

const examples = fs.readFileSync(CASES, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
const reviewerA = JSON.parse(fs.readFileSync(path.join(RESULTS, 'reviewer-a.json'), 'utf8'));
const reviewerB = JSON.parse(fs.readFileSync(path.join(RESULTS, 'reviewer-b.json'), 'utf8'));
if (reviewerA.annotations.some((x) => x.error || !x.annotation) || reviewerB.annotations.some((x) => x.error || !x.annotation)) {
  throw new Error('demo_requires_complete_valid_review_outputs');
}
const aById = new Map(reviewerA.annotations.map((x) => [x.caseId, x.annotation]));
const bById = new Map(reviewerB.annotations.map((x) => [x.caseId, x.annotation]));
const rows = examples.map((sample) => {
  const a = aById.get(sample.id), b = bById.get(sample.id);
  if (!a || !b) throw new Error(`missing_review_for_${sample.id}`);
  return { ...sample, reviewerA: a, reviewerB: b };
});
const fields = ['subject', 'affectReportKind', 'temporalScope', 'reportedTimeExpressions', 'directedAtAI'];
const metrics = Object.fromEntries(fields.map((field) => [field, rows.filter((row) => JSON.stringify(row.reviewerA[field]) === JSON.stringify(row.reviewerB[field])).length]));
metrics.labelSetExact = rows.filter((row) => {
  const labelsA = row.reviewerA.emotionCandidates.map((x) => x.label).sort();
  const labelsB = row.reviewerB.emotionCandidates.map((x) => x.label).sort();
  return JSON.stringify(labelsA) === JSON.stringify(labelsB);
}).length;
const data = { rows, metrics, reviewers: [reviewerA.evaluation.model, reviewerB.evaluation.model], total: rows.length };
const safeJson = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>双 AI 情绪标注 Demo v0.1</title>
<style>
:root{color-scheme:dark;--bg:#0e1220;--panel:#171d2e;--panel2:#1d2639;--line:#2c3850;--text:#edf2ff;--muted:#aab7cf;--blue:#7cb4ff;--mint:#68dfbd;--amber:#ffd27a;--red:#ff938e}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 20% 0%,#1b2941 0,transparent 40%),var(--bg);color:var(--text);font:15px/1.55 system-ui,"Microsoft YaHei",sans-serif}button,select{font:inherit;color:inherit}button{background:#263650;border:1px solid #435575;border-radius:10px;padding:9px 13px;cursor:pointer}button:hover{background:#304463}button:focus-visible,select:focus-visible{outline:2px solid var(--blue);outline-offset:2px}.wrap{max-width:1180px;margin:auto;padding:28px 20px 56px}.eyebrow{color:var(--mint);font-size:12px;letter-spacing:.1em;text-transform:uppercase}.top{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.top h1{font-size:clamp(25px,4vw,38px);line-height:1.2;margin:7px 0}.sub{color:var(--muted);max-width:770px}.badge{border:1px solid #77602d;background:#322a1e;color:#ffe1a2;border-radius:999px;padding:7px 11px;white-space:nowrap;font-size:12px}.warning{margin:19px 0 22px;padding:12px 15px;background:#28241d;border:1px solid #655130;border-radius:12px;color:#ffe4b4}.metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:18px 0}.metric{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:12px}.metric b{display:block;font-size:22px;color:var(--blue)}.metric span{font-size:12px;color:var(--muted)}.layout{display:grid;grid-template-columns:265px minmax(0,1fr);gap:16px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px}.case-list{max-height:74vh;overflow:auto}.case-list h2,.panel h2{margin:0 0 12px;font-size:16px}.case-btn{display:flex;width:100%;text-align:left;align-items:center;justify-content:space-between;margin:5px 0;background:transparent;border-color:transparent;padding:8px 10px;color:var(--muted)}.case-btn.active{background:#25344d;border-color:#405779;color:var(--text)}.case-btn .dot{font-size:11px;color:var(--mint)}.case-top{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}.case-id{color:var(--blue);font-weight:700}.tag{border:1px solid var(--line);border-radius:999px;padding:3px 9px;color:var(--muted);font-size:12px}.quote{font-size:21px;font-weight:650;margin:13px 0 4px}.context{color:var(--muted);margin:6px 0 16px}.actions{display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:14px}.actions button.primary{background:#2d5a83;border-color:#5182b2}.actions button.warn{border-color:#715a31;background:#31291e}.guided{margin:15px 0 0;background:#141b2b;border:1px solid var(--line);border-radius:12px;padding:13px}.guided-head{display:flex;gap:8px;flex-wrap:wrap}.guide-tab{padding:6px 10px;font-size:13px}.guide-tab.active{border-color:var(--blue);color:var(--blue)}.guide-copy{color:var(--muted);min-height:42px;margin:10px 0}.guide-progress{font-size:12px;color:var(--mint)}.reviewers{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.reviewer{background:var(--panel2);border:1px solid var(--line);border-radius:13px;padding:14px;min-width:0}.reviewer h3{margin:0 0 9px;display:flex;justify-content:space-between;font-size:15px}.hidden{color:var(--muted);padding:10px 0}.field{display:grid;grid-template-columns:135px 1fr;gap:8px;border-top:1px solid #303c53;padding:7px 0}.field .key{color:var(--muted);font-size:13px}.field .val{overflow-wrap:anywhere}.emotion{background:#263a52;border-radius:9px;padding:8px;margin:7px 0}.emotion strong{color:#cce3ff}.evidence{display:block;color:#b7e9d8;font-size:13px;margin-top:4px}.notes{color:var(--muted);font-size:13px;padding-left:18px}.compare{margin-top:14px;background:#111827;border:1px solid var(--line);border-radius:13px;padding:13px}.compare h3{margin:0 0 8px;font-size:15px}.diff{display:grid;grid-template-columns:150px 1fr 1fr;gap:8px;border-top:1px solid #303c53;padding:7px 0;font-size:13px}.diff .name{color:var(--muted)}.equal{color:var(--mint)}.different{color:var(--amber)}.status{padding:9px 11px;border-radius:9px;margin:9px 0;background:#1c2d2a;color:var(--mint)}.status.blocked{background:#30281d;color:var(--amber)}.foot{margin-top:18px;color:var(--muted);font-size:12px}.small{font-size:12px;color:var(--muted)}@media(max-width:850px){.metrics{grid-template-columns:repeat(3,1fr)}.layout{grid-template-columns:1fr}.case-list{max-height:230px}.reviewers{grid-template-columns:1fr}}@media(max-width:520px){.wrap{padding:20px 12px}.top{display:block}.badge{display:inline-block;margin-top:10px}.metrics{grid-template-columns:repeat(2,1fr)}.field{grid-template-columns:100px 1fr}.diff{grid-template-columns:105px 1fr 1fr}}
</style>
</head>
<body>
<script type="application/json" id="demo-data">${safeJson}</script>
<main class="wrap">
  <div class="top"><div><div class="eyebrow">EMOTION ANNOTATION · DEVELOPMENT DEMO</div><h1>双 AI 情绪标注怎么比较</h1><div class="sub">用 v0.3 的 15 条开发校准案例，逐条查看两种模型的原始标注、证据和字段分歧。点按评审揭示和比较，或运行引导情景。</div></div><span class="badge">只演示一致性，不是准确率</span></div>
  <div class="warning"><b>范围说明：</b>案例由协议开发者编写，不是独立盲测；两个模型来自同一供应商，没有人类金标。模型相同结论也可能一起错。此 demo 不连接 AI Friend、不写记忆、不发 API 请求。</div>
  <section class="metrics" id="metrics"></section>
  <div class="layout">
    <aside class="panel case-list"><h2>案例（15）</h2><div id="case-list"></div></aside>
    <section class="panel">
      <div class="case-top"><span class="case-id" id="case-id"></span><span class="tag" id="case-group"></span></div>
      <div class="quote" id="message"></div><div class="context" id="context"></div>
      <div class="actions">
        <button class="primary" id="reveal-a">显示评审 A</button><button class="primary" id="reveal-b">显示评审 B</button>
        <button id="compare">比较两份结果</button><button class="warn" id="reset">收起并重置</button>
      </div>
      <div id="action-status" class="status blocked">先分别显示两位评审，再比较；尝试提前比较会被拦下。</div>
      <div class="guided">
        <div class="guided-head" id="guide-tabs"></div><div class="guide-copy" id="guide-copy"></div>
        <div class="guide-progress" id="guide-progress"></div>
        <button id="guide-next">从这个案例开始</button>
      </div>
      <div class="reviewers">
        <article class="reviewer"><h3><span>评审 A</span><span class="small" id="model-a"></span></h3><div id="review-a" class="hidden">尚未显示。点击上方按钮。</div></article>
        <article class="reviewer"><h3><span>评审 B</span><span class="small" id="model-b"></span></h3><div id="review-b" class="hidden">尚未显示。点击上方按钮。</div></article>
      </div>
      <div class="compare" id="comparison"><h3>逐字段比较</h3><div class="small">显示 A、B 后点击“比较两份结果”。不同值会标出；一致不代表正确。</div></div>
      <div class="foot">本 demo 展示留档的 v0.3 结果，不会现场调用模型。字段与案例内容来自独立保存的原始评审输出。</div>
    </section>
  </div>
</main>
<script>
// Pure comparison module: input is two saved annotations; output is exact field comparison.
function compareAnnotations(a,b){
  const keys=['subject','affectReportKind','temporalScope','reportedTimeExpressions','directedAtAI'];
  const values=keys.map(key=>({key,a:a[key],b:b[key],equal:JSON.stringify(a[key])===JSON.stringify(b[key])}));
  const labelsA=a.emotionCandidates.map(x=>x.label).sort(),labelsB=b.emotionCandidates.map(x=>x.label).sort();
  values.push({key:'情绪候选集合',a:labelsA,b:labelsB,equal:JSON.stringify(labelsA)===JSON.stringify(labelsB)});
  const negA=a.negatedAffectMentions.map(x=>x.label).sort(),negB=b.negatedAffectMentions.map(x=>x.label).sort();
  values.push({key:'被否认的情绪',a:negA,b:negB,equal:JSON.stringify(negA)===JSON.stringify(negB)});
  return {values,allEqual:values.every(x=>x.equal)};
}
const DATA=JSON.parse(document.getElementById('demo-data').textContent);
const state={caseId:DATA.rows[0].id,showA:false,showB:false,comparison:null,status:'先分别显示两位评审，再比较；尝试提前比较会被拦下。',blocked:true,walkthrough:null,step:0};
const guides=[
 {id:'negation',title:'否定与肯定',ids:['NEG-01','NEG-02'],copy:'看“我不是生气”和“我有点生气”如何分开记录。否认词不应变成肯定情绪。'},
 {id:'irony',title:'反讽边界',ids:['IRONY-01','IRONY-02','IRONY-03'],copy:'比较冲突语境、支持字面积极的语境、没有语境三种情况。注意一致和正确不是同一件事。'},
 {id:'time',title:'时间范围',ids:['TIME-01','TIME-02','TIME-03','TIME-04','TIME-05'],copy:'依次看明确时点、没有时间词、区间/变化、持续和重复条件。'},
 {id:'target',title:'情绪对象',ids:['TARGET-01','TARGET-02','TARGET-03'],copy:'对照明确指向 AI、明确指向同事、没有明确对象三类。'},
];
const byId=id=>DATA.rows.find(x=>x.id===id);
const el=id=>document.getElementById(id);
function safeText(v){let s;if(v===undefined)s='（缺失）';else if(v===null)s='（空）';else if(Array.isArray(v))s=v.length?v.join('、'):'（空）';else s=String(v);return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function category(id){return id.split('-')[0];}
function renderMetrics(){
 const names={subject:'主体',affectReportKind:'表达类型',temporalScope:'时间范围',reportedTimeExpressions:'时间表达',directedAtAI:'情绪对象',labelSetExact:'情绪候选集合'};
 el('metrics').innerHTML=Object.entries(DATA.metrics).map(([k,v])=>'<div class="metric"><b>'+v+'/'+DATA.total+'</b><span>'+names[k]+' 完全一致</span></div>').join('');
 el('model-a').textContent=DATA.reviewers[0];el('model-b').textContent=DATA.reviewers[1];
}
function renderCaseList(){el('case-list').innerHTML=DATA.rows.map(row=>'<button class="case-btn '+(row.id===state.caseId?'active':'')+'" data-case="'+row.id+'"><span>'+row.id+'</span><span class="dot">'+category(row.id)+'</span></button>').join('');document.querySelectorAll('[data-case]').forEach(btn=>btn.onclick=()=>selectCase(btn.dataset.case));}
function selectCase(id){state.caseId=id;state.showA=false;state.showB=false;state.comparison=null;state.status='已切换案例。分别显示评审 A、B 后再比较。';state.blocked=true;render();}
function renderAnnotation(annotation){
 const simple=[['情绪主体',annotation.subject],['表达类型',annotation.affectReportKind],['时间范围',annotation.temporalScope],['时间表达',annotation.reportedTimeExpressions],['是否指向 AI',annotation.directedAtAI]];
 let out=simple.map(([k,v])=>'<div class="field"><span class="key">'+k+'</span><span class="val">'+safeText(v)+'</span></div>').join('');
 out+='<div class="field"><span class="key">情绪候选</span><span class="val">'+(annotation.emotionCandidates.length?annotation.emotionCandidates.map(c=>'<div class="emotion"><strong>'+safeText(c.label)+'</strong> · '+(c.isExplicit?'明确表达':'推断')+' · 强度 '+safeText(c.strength)+'<span class="evidence">证据：“'+safeText(c.evidenceQuote)+'”'+(c.supportingEvidence?.length?'<br>推断依据：'+c.supportingEvidence.map(q=>'“'+q+'”').join('；'):'')+'</span></div>').join(''):'（没有肯定的情绪候选）')+'</span></div>';
 out+='<div class="field"><span class="key">否定提及</span><span class="val">'+(annotation.negatedAffectMentions.length?annotation.negatedAffectMentions.map(x=>safeText(x.label)+'（'+safeText(x.evidenceQuote)+'）').join('；'):'（无）')+'</span></div>';
 out+='<div class="field"><span class="key">尚不确定</span><span class="val"><ul class="notes">'+annotation.alternativesOrUnknowns.map(x=>'<li>'+safeText(x)+'</li>').join('')+'</ul></span></div>';
 return out;
}
function renderComparison(){
 if(!state.comparison){el('comparison').innerHTML='<h3>逐字段比较</h3><div class="small">'+(state.blocked?'先显示两份评审结果。':'点击“比较两份结果”查看字段差异。')+'</div>';return;}
 const c=state.comparison;el('comparison').innerHTML='<h3>逐字段比较</h3><div class="status '+(c.allEqual?'':'blocked')+'">'+(c.allEqual?'本案例所列字段完全一致':'存在字段分歧；不自动选边或平均')+'</div>'+c.values.map(x=>'<div class="diff"><span class="name">'+x.key+'</span><span class="'+(x.equal?'equal':'different')+'">A：'+safeText(x.a)+'</span><span class="'+(x.equal?'equal':'different')+'">B：'+safeText(x.b)+'</span></div>').join('');
}
function renderGuide(){
 el('guide-tabs').innerHTML=guides.map(g=>'<button class="guide-tab '+(state.walkthrough===g.id?'active':'')+'" data-guide="'+g.id+'">'+g.title+'</button>').join('');
 document.querySelectorAll('[data-guide]').forEach(btn=>btn.onclick=()=>{state.walkthrough=btn.dataset.guide;state.step=0;const g=guides.find(x=>x.id===state.walkthrough);selectCase(g.ids[0]);state.walkthrough=g.id;state.step=0;renderGuide();});
 const guide=guides.find(g=>g.id===state.walkthrough);el('guide-copy').textContent=guide?guide.copy:'选择一个引导情景，按步骤揭示实际评审结果。';el('guide-progress').textContent=guide?'情景 '+(state.step+1)+' / '+(guide.ids.length*3)+' 步：先选案例，再显示 A、显示 B、比较。':'';el('guide-next').textContent=guide?'执行下一步':'从这个案例开始';
}
function render(){
 const row=byId(state.caseId);renderCaseList();el('case-id').textContent=row.id;el('case-group').textContent='开发对照案例 · '+category(row.id);el('message').textContent='“'+row.message+'”';el('context').textContent='上下文：'+row.context;
 el('review-a').innerHTML=state.showA?renderAnnotation(row.reviewerA):'尚未显示。点击上方按钮。';el('review-b').innerHTML=state.showB?renderAnnotation(row.reviewerB):'尚未显示。点击上方按钮。';
 el('action-status').textContent=state.status;el('action-status').className='status '+(state.blocked?'blocked':'');renderComparison();renderGuide();
}
function reveal(which){if(which==='a')state.showA=true;else state.showB=true;state.status='已显示评审 '+which.toUpperCase()+'。评审结果保持原样。';state.blocked=!(state.showA&&state.showB);state.comparison=null;render();}
function compare(){if(!state.showA||!state.showB){state.status='操作被拦截：需要先分别显示 A 和 B，不能拿单份输出比较或补成共识。';state.blocked=true;render();return;}state.comparison=compareAnnotations(byId(state.caseId).reviewerA,byId(state.caseId).reviewerB);state.status=state.comparison.allEqual?'比较完成：字段相同，但一致不等于正确。':'比较完成：分歧保留，未平均、未自动仲裁。';state.blocked=!state.comparison.allEqual;render();}
function reset(){state.showA=false;state.showB=false;state.comparison=null;state.status='已收起并重置。';state.blocked=true;render();}
el('reveal-a').onclick=()=>reveal('a');el('reveal-b').onclick=()=>reveal('b');el('compare').onclick=compare;el('reset').onclick=reset;
el('guide-next').onclick=()=>{
 let guide=guides.find(g=>g.id===state.walkthrough);
 if(!guide){state.walkthrough=guides[0].id;guide=guides[0];state.step=0;selectCase(guide.ids[0]);renderGuide();return;}
 const per=3,caseIndex=Math.floor(state.step/per),action=state.step%per;
 if(caseIndex>=guide.ids.length){state.status='情景完成。可选另一个情景或自由切换案例。';state.blocked=false;render();return;}
 if(state.caseId!==guide.ids[caseIndex])selectCase(guide.ids[caseIndex]);
 if(action===0){state.status='步骤 1：案例已就位。下一步显示评审 A。';state.blocked=true;}
 if(action===1){state.showA=true;state.status='步骤 2：显示评审 A。下一步显示评审 B。';state.blocked=true;}
 if(action===2){state.showB=true;state.comparison=compareAnnotations(byId(state.caseId).reviewerA,byId(state.caseId).reviewerB);state.status='步骤 3：显示评审 B 并比较；分歧原样保留。';state.blocked=!state.comparison.allEqual;}
 state.step+=1;render();
};
renderMetrics();render();
</script>
</body></html>`;
fs.writeFileSync(OUTPUT, html, 'utf8');
process.stdout.write(`DEMO=${path.relative(ROOT, OUTPUT)}\n`);
