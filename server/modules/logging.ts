// @ts-nocheck
// 日志管理 + 记忆更新 (从 server.ts L239-346 抽取)

import type { ServerContext } from './context.js';
import fs from 'fs';
import { LOG_DIR } from './constants.js';

export function updateMemory(ctx: ServerContext, phrase: string, valence: number): void {
    const cleanPhrase = phrase.replace(/[^\u4e00-\u9fff\w]/g, '').toLowerCase();
    if (!cleanPhrase || cleanPhrase.length < 2) return;
    const existing = ctx.semanticMemory.get(cleanPhrase);
    if (existing) {
        existing.totalValence += valence;
        existing.occurrences++;
        existing.lastSeen = Date.now();
    } else {
        ctx.semanticMemory.set(cleanPhrase, { totalValence: valence, occurrences: 1, lastSeen: Date.now() });
    }
}

export function getLogFileName(): string {
    const today = new Date().toISOString().slice(0, 10);
    return `${LOG_DIR}/interaction-${today}.log`;
}

export function appendInteractionLog(ctx: ServerContext, core: any, layer2: any): void {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        const entry = {
            t: layer2.tick, ts: Date.now(),
            v: Math.round(core.valence * 10000) / 10000,
            a: Math.round(core.arousal * 10000) / 10000,
            e: Math.round(core.expectation * 10000) / 10000,
            ci: Math.round(ctx.curiosityState.intensity * 1000) / 1000,
            cd: Math.round(ctx.curiosityState.drive * 1000) / 1000,
            ha: ctx.hypotheses.filter((h: any) => h.active && h.status === 'active').length,
            hv: ctx.hypotheses.filter((h: any) => h.status === 'verified').length,
            hr: ctx.hypotheses.filter((h: any) => h.status === 'rejected').length,
            ep: ctx.experiments.filter((e: any) => e.state === 'pending').length,
            ea: ctx.experiments.filter((e: any) => e.state === 'active').length,
            ec: ctx.experiments.filter((e: any) => e.state === 'completed').length,
            avm: Math.round(ctx.tensionRegulator.alphaVMultiplier * 1000) / 1000,
            aem: Math.round(ctx.tensionRegulator.alphaEMultiplier * 1000) / 1000,
            fam: Math.round(ctx.tensionRegulator.familiarity * 1000) / 1000,
            vol: Math.round(ctx.tensionRegulator.volatility * 1000) / 1000,
        };
        fs.appendFileSync(getLogFileName(), JSON.stringify(entry) + '\n', 'utf-8');
    } catch (e) {
        console.error('[日志] 写入失败:', e);
    }
}

export function cleanOldLogs(): void {
    try {
        if (!fs.existsSync(LOG_DIR)) return;
        const files = fs.readdirSync(LOG_DIR).filter(f => f.startsWith('interaction-') && f.endsWith('.log'));
        const now = Date.now();
        for (const f of files) {
            const match = f.match(/interaction-(\d{4}-\d{2}-\d{2})\.log/);
            if (!match) continue;
            const fileDate = new Date(match[1]).getTime();
            if (now - fileDate > 7 * 86400000) {
                fs.unlinkSync(`${LOG_DIR}/${f}`);
            }
        }
    } catch (e) {}
}

export function readTodayInteractionLogs(): { t: number; v: number; a: number; e: number; ts: number }[] {
    try {
        const f = getLogFileName();
        if (!fs.existsSync(f)) return [];
        const raw = fs.readFileSync(f, 'utf-8');
        return raw.trim().split('\n').map(line => JSON.parse(line));
    } catch (e) {
        return [];
    }
}
