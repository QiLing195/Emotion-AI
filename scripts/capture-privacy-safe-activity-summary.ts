/**
 * One-shot, opt-in activity validation. Reads a local sampler log only after
 * --capture is supplied and writes category/count summaries, never raw titles.
 *
 * Usage (PowerShell):
 *   $env:ENABLE_ACTIVITY_WATCH='true'
 *   npx tsx scripts/capture-privacy-safe-activity-summary.ts --capture --out artifacts/emotion-learning/dual-loop-causal-review-v0.5/local-activity-summary.json
 *
 * This is not run automatically: a user must explicitly invoke --capture.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { classifyActivity, CONCERN_CATEGORIES, toActivityConcern, understandActivity } from '../server/services/activityUnderstanding.js';
import { ACTIVITY_LOG_PATH, activityWatchEnabled, readRecentActivity } from '../server/services/activityWatcher.js';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function stripBrowserShellSuffix(title: string): string {
  return title.replace(/\s*[-–—|]\s*(?:Google Chrome|Microsoft Edge|Mozilla Firefox|Chrome|Firefox|Edge|Safari)\s*$/iu, '').trim();
}

if (!process.argv.includes('--capture')) {
  console.error('未读取活动记录：需要显式传入 --capture。');
  process.exit(2);
}
if (!activityWatchEnabled()) {
  console.error('活动采样开关未开启；未读取活动记录。请在自愿采样期间设置 ENABLE_ACTIVITY_WATCH=true 后再运行。');
  process.exit(2);
}

const outputArg = option('--out');
if (!outputArg) {
  console.error('请使用 --out 指定脱敏摘要的保存路径。');
  process.exit(2);
}

const logPath = resolve(option('--log') ?? ACTIVITY_LOG_PATH);
const outputPath = resolve(outputArg);
const view = readRecentActivity(20, Date.now(), logPath, false);
const understanding = understandActivity(view);
const concern = toActivityConcern(understanding);
const topCategory = understanding?.categories[0];
const concernDecisionReason = !understanding ? 'no_understanding'
  : understanding.category === 'unknown' ? 'no_classifiable_activity'
    : understanding.vague
      ? (topCategory && topCategory.count < 2 ? 'fewer_than_two_matching_windows'
        : topCategory && topCategory.share < 0.4 ? 'dominant_share_below_40_percent' : 'insufficient_evidence')
      : !CONCERN_CATEGORIES.includes(understanding.category) ? 'category_not_concern_eligible'
        : 'concern_created';
const classificationSources = new Map<string, number>();
const browserTitleDiagnostics = new Map<string, number>();
for (const entry of view.entries) {
  const combined = classifyActivity(entry.title, entry.process);
  if (!combined) continue;
  const titleOnly = classifyActivity(entry.title, '');
  const processOnly = classifyActivity('', entry.process);
  const source = titleOnly === combined && processOnly === combined ? 'title_and_process'
    : titleOnly === combined ? 'title'
      : processOnly === combined ? 'process' : 'combined';
  const key = `${combined}:${source}`;
  classificationSources.set(key, (classificationSources.get(key) ?? 0) + 1);
  if (combined === 'browsing') {
    const titleWithoutBrowserShell = stripBrowserShellSuffix(entry.title);
    const titleContentCategory = classifyActivity(titleWithoutBrowserShell, '');
    const diagnosticKey = titleContentCategory ?? 'unknown';
    browserTitleDiagnostics.set(diagnosticKey, (browserTitleDiagnostics.get(diagnosticKey) ?? 0) + 1);
  }
}

const summary = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  source: 'local_activity_sampler',
  rawTitlesPersisted: false,
  sampleCount: view.entries.length,
  classificationsBySource: [...classificationSources.entries()]
    .map(([key, count]) => {
      const [category, matchedBy] = key.split(':');
      return { category, matchedBy, count };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.matchedBy.localeCompare(b.matchedBy)),
  browserTitleContentAfterShellRemoval: [...browserTitleDiagnostics.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => a.category.localeCompare(b.category)),
  understanding: understanding ? {
    category: understanding.category,
    confidence: understanding.confidence,
    windows: understanding.windows,
    spanMinutes: understanding.spanMinutes,
    vague: understanding.vague,
    categories: understanding.categories.map(({ key, count, share }) => ({ key, count, share })),
  } : null,
  concern: concern ? { category: concern.category, intensity: concern.intensity } : null,
  concernDecisionReason,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
console.log(`已写入不含窗口标题的活动摘要：${outputPath}`);
console.log(`采样条目=${summary.sampleCount}；理解=${understanding?.category ?? 'none'}；concern=${concern?.category ?? 'none'}；原因=${concernDecisionReason}`);
