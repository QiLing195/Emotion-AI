// ==================== MetricsCollector: 零依赖可观测性模块 ====================

// ─── 环形缓冲区 ───
class FixedCircularBuffer<T> {
    private buf: T[];
    private ptr = 0;
    private _size = 0;
    constructor(private capacity: number) { this.buf = new Array(capacity); }

    push(item: T): void {
        this.buf[this.ptr] = item;
        this.ptr = (this.ptr + 1) % this.capacity;
        if (this._size < this.capacity) this._size++;
    }

    getAll(): T[] {
        if (this._size < this.capacity) return this.buf.slice(0, this._size);
        const result: T[] = [];
        for (let i = 0; i < this.capacity; i++) {
            result.push(this.buf[(this.ptr + i) % this.capacity]);
        }
        return result;
    }

    get size(): number { return this._size; }
    get last(): T | undefined { return this._size > 0 ? this.buf[(this.ptr - 1 + this.capacity) % this.capacity] : undefined; }
}

// ─── 时间滑动窗口 ───
class SlidingWindow<T extends { timestamp: number }> {
    private events: T[] = [];
    constructor(private windowMs: number) {}

    push(event: T): void {
        this.events.push(event);
        this.prune();
    }

    getAll(): T[] { this.prune(); return [...this.events]; }
    count(): number { this.prune(); return this.events.length; }

    private prune(): void {
        const cutoff = Date.now() - this.windowMs;
        while (this.events.length > 0 && this.events[0].timestamp < cutoff) {
            this.events.shift();
        }
    }
}

// ─── 事件类型 ───
interface NLUEvent { timestamp: number; src: 'llm' | 'transformer' | 'chinese_lexicon'; isSarcasm: boolean; }
interface FeedbackEvent { timestamp: number; delta: number; userDelta: number; }
interface SarcasmSample { text: string; valence: number; arousal: number; timestamp: number; }
interface EchoChamberEvent { timestamp: number; rounds: number; finalValence: number; }

// ─── 响应类型 ───
export interface MetricsSnapshot {
    timestamp: string;
    uptime_seconds: number;
    session: {
        valence: number;
        arousal: number;
        dominant_emotion: string;
        valence_trajectory: number[];
        oscillation_count_10min: number;
        echo_chamber_risk: 'none' | 'low' | 'high';
        consecutive_self_reinforce_rounds: number;
    };
    nlu: {
        llm_ratio_1h: number;
        fallback_count_1h: number;
        sarcasm_trigger_count_1h: number;
        total_nlu_calls_1h: number;
    };
    feedback: {
        feedback_weight_current: number;
        total_feedback_applied_1h: number;
        max_single_feedback_delta_1h: number;
        monotonic_drift_warning: boolean;
    };
    recent_sarcasm_samples: { text: string; valence: number; arousal: number; timestamp: string }[];
    recent_echo_chamber_events: { timestamp: string; rounds: number; finalValence: number }[];
}

// ─── MetricsCollector ───
export class MetricsCollector {
    // 启动时间
    readonly startTime = Date.now();

    // 环形缓冲区
    private valenceBuffer = new FixedCircularBuffer<{ v: number; ts: number }>(100);
    private sarcasmSamples = new FixedCircularBuffer<SarcasmSample>(20);
    private echoChamberEvents: EchoChamberEvent[] = [];

    // 滑动窗口
    private nluWindow = new SlidingWindow<NLUEvent>(3600_000);
    private feedbackWindow = new SlidingWindow<FeedbackEvent>(3600_000);

    // 回声室状态机
    private selfReinforceCounter = 0;

    // 熔断状态
    monotonicDriftWarning = false;
    feedbackWeightCurrent = 0.02;

    // 上一次效价采样时间
    private lastValenceSampleTime = 0;

    // ─── 记录方法 ───

    recordValenceSample(v: number, now: number = Date.now()): void {
        // 至少间隔 30 秒
        if (now - this.lastValenceSampleTime < 30_000) return;
        this.lastValenceSampleTime = now;
        this.valenceBuffer.push({ v, ts: now });

        // 更新振荡检测
        this.checkOscillation();
        // 更新单调漂移检测
        this.checkMonotonicDrift();
        // 根据最新指标更新自适应反馈权重
        this.feedbackWeightCurrent = this.computeAdaptiveWeight();
    }

    recordNLUEvent(event: NLUEvent): void {
        this.nluWindow.push(event);

        // 反讽样本收集
        if (event.isSarcasm) {
            // 注：原文由外部调用 recordSarcasmSample 单独传入
        }
    }

    recordFeedback(delta: number, userDelta: number): void {
        const now = Date.now();
        this.feedbackWindow.push({ timestamp: now, delta, userDelta });

        // 回声室状态机
        if (Math.sign(delta) === Math.sign(userDelta) && userDelta !== 0) {
            this.selfReinforceCounter++;
        } else {
            this.selfReinforceCounter = 0;
        }

        // 回声室熔断：触发后使用自适应权重（高风险 → 0）
        if (this.selfReinforceCounter >= 5) {
            this.monotonicDriftWarning = true;
            this.feedbackWeightCurrent = this.computeAdaptiveWeight();
            this.echoChamberEvents.push({
                timestamp: now,
                rounds: this.selfReinforceCounter,
                finalValence: this.valenceBuffer.last?.v ?? 0,
            });
            if (this.echoChamberEvents.length > 5) this.echoChamberEvents.shift();
        }
    }

    recordSarcasmSample(text: string, valence: number, arousal: number): void {
        this.sarcasmSamples.push({ text, valence, arousal, timestamp: Date.now() });
    }

    /** 重置回声室计数器（用户输入打破循环） */
    resetSelfReinforceCounter(): void {
        if (this.selfReinforceCounter > 0) {
            this.selfReinforceCounter = 0;
        }
        // 用户交互后重新计算权重（从零恢复到自适应值）
        if (this.monotonicDriftWarning) {
            this.monotonicDriftWarning = false;
        }
        this.feedbackWeightCurrent = this.computeAdaptiveWeight();
    }

    /** 自适应反馈权重：综合回声室风险 + 振荡强度 + 单调漂移 */
    computeAdaptiveWeight(): number {
        const BASE = 0.02;

        // 1) 回声室风险折扣
        const risk = this.detectEchoChamberRisk();
        let weight = risk === 'high' ? 0 : risk === 'low' ? BASE * 0.5 : BASE;

        // 2) 振荡折扣：symbol 摆动 > 3 次则逐步衰减
        const osc = this.detectOscillation();
        if (osc > 3) {
            const oscPenalty = Math.min(1, (osc - 3) / 10); // osc=13 → penalty=1.0
            weight *= (1 - oscPenalty * 0.8);
        }

        // 3) 单调漂移折扣：单一方向漂移时减半
        if (this.monotonicDriftWarning) {
            weight *= 0.5;
        }

        return Math.max(0, Math.round(weight * 10000) / 10000);
    }

    // ─── 检测方法 ───

    /** 振荡检测：最近 20 个采样点中效价符号变化次数 */
    detectOscillation(): number {
        const samples = this.valenceBuffer.getAll();
        if (samples.length < 2) return 0;

        // 取最近 20 个
        const recent = samples.slice(-20);
        let count = 0;
        for (let i = 1; i < recent.length; i++) {
            const prevSign = Math.sign(recent[i - 1].v);
            const currSign = Math.sign(recent[i].v);
            if (prevSign !== 0 && currSign !== 0 && prevSign !== currSign) {
                count++;
            }
        }
        return count;
    }

    private checkOscillation(): void {
        const osc = this.detectOscillation();
        if (osc > 5) {
            console.warn(JSON.stringify({
                type: 'EMOTION_OSCILLATION',
                oscillationCount: osc,
                threshold: 5,
                sessionValence: this.valenceBuffer.last?.v,
                timestamp: new Date().toISOString(),
            }));
        }
    }

    /** 回声室风险等级 */
    detectEchoChamberRisk(): 'none' | 'low' | 'high' {
        if (this.selfReinforceCounter === 0) return 'none';
        if (this.selfReinforceCounter <= 4) return 'low';
        return 'high';
    }

    /** 单调漂移检测：最近 20 个采样点一阶差分符号是否一致 */
    private checkMonotonicDrift(): void {
        const samples = this.valenceBuffer.getAll().slice(-20);
        if (samples.length < 5) return;

        const diffs: number[] = [];
        for (let i = 1; i < samples.length; i++) {
            diffs.push(samples[i].v - samples[i - 1].v);
        }

        // 过滤掉接近零的差分
        const significant = diffs.filter(d => Math.abs(d) > 0.01);
        if (significant.length < 3) return;

        const signs = significant.map(d => Math.sign(d));
        const allSameSign = signs.every(s => s === signs[0] && s !== 0);

        if (allSameSign) {
            console.warn(JSON.stringify({
                type: 'MONOTONIC_DRIFT',
                direction: signs[0] > 0 ? 'increasing' : 'decreasing',
                sampleCount: significant.length,
                sessionValence: this.valenceBuffer.last?.v,
                timestamp: new Date().toISOString(),
            }));
            this.monotonicDriftWarning = true;
        }
    }

    // ─── 快照生成 ───

    getSnapshot(currentValence: number, currentArousal: number, dominantEmotion: string): MetricsSnapshot {
        const now = Date.now();
        const nluEvents = this.nluWindow.getAll();
        const totalNLU = nluEvents.length;
        const llmCount = nluEvents.filter(e => e.src === 'llm').length;
        const sarcasmCount = nluEvents.filter(e => e.isSarcasm).length;
        const fallbackCount = nluEvents.filter(e => e.src !== 'llm').length;

        const fbEvents = this.feedbackWindow.getAll();
        const maxDelta = fbEvents.length > 0
            ? Math.max(...fbEvents.map(e => Math.abs(e.delta)))
            : 0;

        return {
            timestamp: new Date(now).toISOString(),
            uptime_seconds: Math.floor((now - this.startTime) / 1000),

            session: {
                valence: Math.round(currentValence * 10000) / 10000,
                arousal: Math.round(currentArousal * 10000) / 10000,
                dominant_emotion: dominantEmotion,
                valence_trajectory: this.valenceBuffer.getAll().map(s => Math.round(s.v * 10000) / 10000),
                oscillation_count_10min: this.detectOscillation(),
                echo_chamber_risk: this.detectEchoChamberRisk(),
                consecutive_self_reinforce_rounds: this.selfReinforceCounter,
            },

            nlu: {
                llm_ratio_1h: totalNLU > 0 ? Math.round((llmCount / totalNLU) * 1000) / 1000 : 0,
                fallback_count_1h: fallbackCount,
                sarcasm_trigger_count_1h: sarcasmCount,
                total_nlu_calls_1h: totalNLU,
            },

            feedback: {
                feedback_weight_current: this.feedbackWeightCurrent,
                total_feedback_applied_1h: fbEvents.length,
                max_single_feedback_delta_1h: Math.round(maxDelta * 10000) / 10000,
                monotonic_drift_warning: this.monotonicDriftWarning,
            },

            recent_sarcasm_samples: this.sarcasmSamples.getAll().map(s => ({
                text: s.text.substring(0, 100),
                valence: Math.round(s.valence * 1000) / 1000,
                arousal: Math.round(s.arousal * 1000) / 1000,
                timestamp: new Date(s.timestamp).toISOString(),
            })),

            recent_echo_chamber_events: this.echoChamberEvents.map(e => ({
                timestamp: new Date(e.timestamp).toISOString(),
                rounds: e.rounds,
                finalValence: Math.round(e.finalValence * 1000) / 1000,
            })),
        };
    }
}

// 全局单例
export const metrics = new MetricsCollector();
