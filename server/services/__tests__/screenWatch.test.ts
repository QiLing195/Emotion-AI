import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_SCREEN_POLICY,
  SCREEN_POLICIES,
  autoIntervalMs,
  decideCapture,
  loadPetSettings,
  savePetSettings,
  grantScreenSession,
  revokeScreenSession,
} from '../screenWatch.js';
import { compactOcrText } from '../ocr.js';

// 这些测试直接读写仓库的 memories/pet_settings.json + screen_captures.jsonl，
// 所以每个用例前后都备份/恢复，避免污染真实状态。
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { SCREEN_SETTINGS_PATH, SCREEN_AUDIT_PATH } from '../screenWatch.js';

let settingsBak: string | null = null;
let auditBak: string | null = null;

beforeEach(() => {
  settingsBak = existsSync(SCREEN_SETTINGS_PATH) ? readFileSync(SCREEN_SETTINGS_PATH, 'utf8') : null;
  auditBak = existsSync(SCREEN_AUDIT_PATH) ? readFileSync(SCREEN_AUDIT_PATH, 'utf8') : null;
  try { if (existsSync(SCREEN_SETTINGS_PATH)) unlinkSync(SCREEN_SETTINGS_PATH); } catch { /* ignore */ }
  try { if (existsSync(SCREEN_AUDIT_PATH)) unlinkSync(SCREEN_AUDIT_PATH); } catch { /* ignore */ }
  delete process.env.ENABLE_ACTIVITY_WATCH;
});

afterEach(() => {
  if (settingsBak !== null) writeFileSync(SCREEN_SETTINGS_PATH, settingsBak, 'utf8');
  else { try { if (existsSync(SCREEN_SETTINGS_PATH)) unlinkSync(SCREEN_SETTINGS_PATH); } catch { /* ignore */ } }
  if (auditBak !== null) writeFileSync(SCREEN_AUDIT_PATH, auditBak, 'utf8');
  else { try { if (existsSync(SCREEN_AUDIT_PATH)) unlinkSync(SCREEN_AUDIT_PATH); } catch { /* ignore */ } }
});

describe('设置：四种模式', () => {
  it('默认 on_demand_10', () => {
    expect(loadPetSettings().screenPolicy).toBe(DEFAULT_SCREEN_POLICY);
    expect(SCREEN_POLICIES).toHaveLength(4);
  });

  it('保存合法模式；非法模式被忽略并保留原值', () => {
    savePetSettings({ screenPolicy: 'explicit_only' });
    expect(loadPetSettings().screenPolicy).toBe('explicit_only');
    savePetSettings({ screenPolicy: 'nonsense' as never });
    expect(loadPetSettings().screenPolicy).toBe('explicit_only');
  });

  it('定时频率：10 / 5 / 不允许她主动', () => {
    expect(autoIntervalMs('on_demand_10')).toBe(10 * 60_000);
    expect(autoIntervalMs('on_demand_5')).toBe(5 * 60_000);
    expect(autoIntervalMs('explicit_only')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('是否允许截屏（策略 + 限频 + 授权）', () => {
  it('用户明确要求 ⇒ 允许（不需要授权）', () => {
    revokeScreenSession();
    const d = decideCapture('user');
    expect(d.allowed).toBe(true);
    expect(d.needsApproval).toBe(false);
  });

  it('explicit_only ⇒ 她自己不能主动看', () => {
    savePetSettings({ screenPolicy: 'explicit_only' });
    const d = decideCapture('her');
    expect(d.allowed).toBe(false);
    expect(String(d.reason)).toContain('只在你明确说的时候');
  });

  it('auto_no_prompt ⇒ 她自己可以直接看（仍受限频）', () => {
    savePetSettings({ screenPolicy: 'auto_no_prompt' });
    const d = decideCapture('her');
    expect(d.allowed).toBe(true);
  });

  it('on_demand_10 未授权 ⇒ 需要授权（needsApproval）', () => {
    savePetSettings({ screenPolicy: 'on_demand_10', screenGrantAt: 0 });
    const d = decideCapture('her');
    expect(d.allowed).toBe(false);
    expect(d.needsApproval).toBe(true);
  });

  it('批准后 15 分钟内 ⇒ 允许', () => {
    savePetSettings({ screenPolicy: 'on_demand_10' });
    grantScreenSession();
    const d = decideCapture('her');
    expect(d.allowed).toBe(true);
    expect(d.needsApproval).toBe(false);
  });

  it('刚截过 ⇒ 被限频（1 分钟内拒绝）', () => {
    savePetSettings({ screenPolicy: 'auto_no_prompt' });
    // 伪造一条刚成功的审计记录
    writeFileSync(SCREEN_AUDIT_PATH, JSON.stringify({ ts: Date.now() - 5_000, trigger: 'user', ok: true }) + '\n', 'utf8');
    const d = decideCapture('her');
    expect(d.allowed).toBe(false);
    expect(String(d.reason)).toContain('太频繁');
  });
});

describe('OCR 文本压缩', () => {
  it('压掉中文逐字空格与多余空行', () => {
    expect(compactOcrText('你 好 世 界\n\n\n第 二 行').replace(/\n/g, '|')).toBe('你 好 世 界|第 二 行');
  });

  it('空文本安全', () => {
    expect(compactOcrText('')).toBe('');
    expect(compactOcrText(undefined as unknown as string)).toBe('');
  });
});
