// @ts-nocheck
// Info + State + Events + Event 路由 (从 server.ts 抽取, 416行)

import type { Express } from 'express';

export function registerCoreRoutes(
  app: Express,
  core: any,
  layer2: any,
  buildFullResponse: any,
  bus: any,
  episodicStore: any,
  internalLogEntries: any[],
  nluAnalyze: any,
  updateMemory: any,
  readToneState: any,
  _recentValences: number[],
): void {
app.get('/info', (req, res) => {
    const silence = checkSilence(timeState, phaseState.currentPhase);
    res.json({
        name: `道·情感引擎 v${VERSION}`, version: VERSION, status: 'running',
        architecture: 'layered_emergence + world_model + causal_inference + self_model + internal_narrative + strategy_generator',
        layers: ['Layer1_core', 'Layer2_dynamics', 'Layer3_emergence', 'Layer4_meta_cognition', 'WorldModel', 'PhaseAware', 'SelfModel', 'StrategyGenerator'],
        endpoints: ['/', '/info', '/state', '/event', '/tick', '/reset', '/api/phase', '/api/friend-phase', '/api/curiosity', '/api/hypotheses', '/api/experiments', '/api/patterns', '/api/abort-experiments', '/api/worldview', '/api/paradigm-history', '/api/paradigm/shift', '/api/self-model', '/api/narrative', '/api/strategy', '/api/internal-log', '/api/proactive-messages', '/api/mark-proactive-read', '/api/rhythm', '/api/discoveries', '/api/interests', '/api/explore', '/api/metrics'],
        nlu: !!nluAnalyze, semanticMemory: semanticMemory.size,
        relationshipPhase: phaseState.currentPhase,
        phaseConfidence: phaseState.confidence,
        silenceHours: silence.hours,
        totalMessages: phaseState.totalMessages,
        friendPhase: friendState.currentPhase,
        friendConfidence: friendState.confidence,
        friendSinceDays: friendState.friendSinceDate > 0
            ? Math.floor((Date.now() - friendState.friendSinceDate) / 86400000) : 0,
        worldview: {
            paradigmVersion: worldModel.paradigmVersion,
            activeBeliefs: worldModel.beliefs.filter(b => b.status === 'active').length,
            challengedBeliefs: worldModel.beliefs.filter(b => b.status === 'challenged').length,
            totalBeliefs: worldModel.beliefs.length,
            paradigmFreezeRemaining: _paradigmFreezeRemaining,
        },
        autonomy: {
            active: _autonomyTimer !== null,
            idleMinutes: Math.round((Date.now() - lastInteractionTime) / 60000),
            loneliness: Math.round(internalState.loneliness * 1000) / 1000,
            boredom: Math.round(internalState.boredom * 1000) / 1000,
            ignoredStreak: internalState.ignoredStreak,
            currentThreshold: Math.round(getCurrentThreshold() * 1000) / 1000,
            todaySent: internalState.dailyMsgCounts[getDayKey(Date.now())] || 0,
            dailyCap: CONTACT_DAILY_CAP,
            pendingUnread: proactiveMessages.filter(m => !m.read).length,
            maxPendingUnread: MAX_PENDING_UNREAD,
            closureActive: lastClosureTs > 0 && (Date.now() - lastClosureTs) < CLOSURE_GRACE_MIN * 60000,
            closureRemainMin: lastClosureTs > 0 ? Math.max(0, Math.round((CLOSURE_GRACE_MIN * 60000 - (Date.now() - lastClosureTs)) / 60000)) : 0,
            internalLogEntries: internalLog.length,
            // v3.0: 好奇心引擎
            exploration: {
                active: getExplorationTimer() !== null,
                discoveries: discoveries.length,
                unshared: discoveries.filter(d => !d.shared).length,
                interests: interestModel.interests.length,
                exploredToday: getExplorationCountToday(),
                dailyCap: EXPLORATION_DAILY_CAP,
                lastExploration: interestModel.lastExploration,
            },
        },
    });
});

app.get('/state', (req, res) => res.json(buildFullResponse(core, layer2)));

// v4.0: 事件时间线 API — 供前端 Timeline Viewer 消费
app.get('/api/events', (req, res) => {
    const n = Math.min(Number(req.query.n) || 100, 500);
    res.json(bus.recentEvents(n));
});

app.post('/event', async (req, res) => {
    try {
    let { text, valence: rawValence, salience: rawSalience, safetySignal: rawSafety } = req.body;

    // Autonomy v1.3: 用户交互时重置空闲计时和忽略连击
    lastInteractionTime = Date.now();
    bus.emit('UserInteractionReset', { idleMinutes: 0 });
    internalState.loneliness = 0;
    internalState.boredom = 0;
    internalState.ignoredStreak = 0;
    newSignificantPattern = null;
    // v1.4: 检测对话结束语
    if (text && detectClosure(text)) lastClosureTs = Date.now();

    // ━━━ v1.1 输入验证层 ━━━
    if (text !== undefined) {
        if (typeof text !== 'string' || text.trim().length === 0) {
            return res.status(400).json({ error: '文本为空' });
        }
        text = text.trim().substring(0, 500);
        const meaningfulChars = text.match(/[一-鿿㐀-䶿\w]/g);
        if (!meaningfulChars || meaningfulChars.length < 2) {
            text = '（中性内容）';
        }
    }

    // 直接模式（测试用）
    if (typeof rawValence === 'number' && typeof rawSalience === 'number') {
        const ev = clamp(rawValence, -0.95, 0.95);
        const es = clamp(rawSalience, 0.05, 1.0);

        // 追踪最近效价序列（供模式检测和因果推理使用）
        _recentValences.push(ev);
        if (_recentValences.length > 100) _recentValences.shift();

        // v0.8: 因果推理
        const inference = causalInference(_recentValences, worldModel.beliefs);
        _currentInference = inference;
        if (inference.matchedBelief) {
            core.expectation = clamp(core.expectation + inference.preemptiveAdjustment, -0.8, 0.8);
        }

        core = updateCore(core, ev, es, 0, rawSafety === true, layer2);
        processReversal(core);
        processGrowth(core, layer2);
        layer2.tick++;
        metrics.recordValenceSample(core.valence);

        // v0.8: 自我分析（每 20 tick）
        if (layer2.tick > 0 && layer2.tick % 20 === 0) {
            const newPatterns = selfAnalysis(core, layer2);
            for (const np of newPatterns) {
                const existing = selfModel.patterns.find(p => p.id === np.id);
                if (existing) {
                    existing.frequency = np.frequency;
                    existing.confidence = Math.max(existing.confidence, np.confidence);
                    existing.description = np.description;
                } else {
                    selfModel.patterns.push(np);
                    if (np.confidence >= 0.5) newSignificantPattern = np;
                }
            }
            for (const p of selfModel.patterns) {
                if (p.frequency >= 2 && p.confidence >= 0.5) {
                    const mbId = `meta_${p.id}`;
                    const exists = selfModel.metaBeliefs.some(mb => mb.id === mbId);
                    if (!exists) {
                        selfModel.metaBeliefs.push({
                            id: mbId, antecedent: p.trigger, consequent: p.description,
                            confidence: p.confidence, supportingCases: p.frequency,
                            counterCases: 0, status: 'active',
                            evidence: [], contradictions: [],
                            createdAt: Date.now(), lastUpdated: Date.now(),
                        });
                    }
                }
            }
            selfModel.lastAnalyzed = layer2.tick;
            saveSelfModel();
        }

        // 世界模型
        detectPatterns(core);
        extractBeliefsFromPatterns();
        updateBeliefs();
        checkParadigmShift(core);
        if (_paradigmFreezeRemaining > 0) _paradigmFreezeRemaining--;

        // 持久化
        saveLayer4State();
        appendInteractionLog(core, layer2);

        const resp = buildFullResponse(core, layer2) as any;
        resp._paradigmShift = null;  // 直接模式不通知范式革命
        return res.json(resp);
    }

    // NLU 模式
    if (!text || typeof text !== 'string') return res.status(400).json({ error: '需要 { text } 或 { valence, salience }' });

    const isApology = /对不起|抱歉|是我的错|我错了|原谅我|sorry|别生气|消消气|冷静一下|都是我不好/i.test(text);
    const safetySignal = isApology;
    const phase = getPhase(layer2.tick);
    let valence: number, salience: number, dominance: number = 0, src: string, sarcasmProb: number = 0;

    if (canSelfUnderstand(text, layer2.tick)) {
        const self = selfUnderstand(text)!;
        valence = self.valence; salience = self.salience; src = 'self';
        sarcasmProb = 0;
    } else {
        const hasChinese = /[一-鿿]/.test(text);
        // 无中文 → 触发 NLU 懒加载（启动时不预加载，节省资源）
        if (!hasChinese && !nluAnalyze && !_nluLoading) ensureNLU().catch(() => {});

        // v2.0: 优先 LLM 情感标注，超时/失败降级到规则引擎
        const envAI = readAISettings();
        const useLLM = !!(envAI?.apiKey) && process.env.DISABLE_LLM_NLU !== 'true';
        sarcasmProb = 0;
        if (useLLM) {
            try {
                const llmResult = await Promise.race([
                    analyzeSentimentViaLLM(text, { provider: envAI!.provider, apiKey: envAI!.apiKey, model: envAI!.model, baseUrl: envAI!.baseUrl }),
                    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('LLM_NLU_TIMEOUT')), 3000)),
                ]);
                valence = llmResult.valence; salience = llmResult.salience; dominance = llmResult.dominance; src = 'llm';
                sarcasmProb = llmResult.sarcasmProbability;
            } catch {
                const tutorResult = (nluAnalyze && !hasChinese) ? await nluAnalyze(text) : analyzeText(text);
                valence = tutorResult.valence; salience = tutorResult.salience; dominance = tutorResult.dominance; src = 'tutor';
                sarcasmProb = tutorResult.sarcasmProbability;
            }
        } else {
            const tutorResult = (nluAnalyze && !hasChinese) ? await nluAnalyze(text) : analyzeText(text);
            valence = tutorResult.valence; salience = tutorResult.salience; dominance = tutorResult.dominance; src = 'tutor';
            sarcasmProb = tutorResult.sarcasmProbability;
        }
    }

    // v2.1: NLU 事件记录 + 反讽采样
    const isSarcasmEvent = sarcasmProb > 0.5;
    metrics.recordNLUEvent({ timestamp: Date.now(), src: src as 'llm' | 'transformer' | 'chinese_lexicon', isSarcasm: isSarcasmEvent });
    if (isSarcasmEvent) {
        metrics.recordSarcasmSample(text, valence, salience);
    }

    if (isApology) valence = 0.15;
    updateMemory(text, valence);

    // Layer 4: 实验反馈 — 用当前事件的效价更新活跃实验的假设置信度
    feedbackExperiment(valence);

    const { modulatedValence, modulatedSalience } = applyEngineModulation(valence, salience, core, text);
    const { selfValence, selfSalience } = selfAnalyze();
    const combinedValence = modulatedValence + selfValence;
    const combinedSalience = Math.min(1, modulatedSalience + selfSalience);

    // ─── 阶段感知 & 时间状态跟踪 ───
    _recentValences.push(combinedValence);
    if (_recentValences.length > 100) _recentValences.shift();
    for (const keyword of Object.keys(PHASE_KEY_EVENTS)) {
        if (text.includes(keyword) && !phaseState.phaseKeyEvents.includes(keyword)) {
            phaseState.phaseKeyEvents.push(keyword);
            if (phaseState.phaseKeyEvents.length > 20) phaseState.phaseKeyEvents.shift();
        }
    }
    phaseState.totalMessages++;
    let _phaseChanged = false;
    if (phaseState.totalMessages % 10 === 0) {
        const inferred = inferPhase(phaseState, _recentValences);
        if (inferred.phase !== phaseState.currentPhase) bus.emit('PhaseTransitioned', { from: phaseState.currentPhase, to: inferred.phase });
        if (inferred.phase !== phaseState.currentPhase && inferred.confidence > 0.6) {
            _phaseChanged = true;
            phaseState.currentPhase = inferred.phase;
            phaseState.confidence = inferred.confidence;
            phaseState.lastPhaseTransition = Date.now();
            phaseState.phaseHistory.push({ phase: inferred.phase, timestamp: Date.now() });
        } else {
            phaseState.confidence = Math.max(phaseState.confidence, inferred.confidence);
        }
    }
    if (phaseState.relationshipStartDate === 0 && (
        phaseState.phaseKeyEvents.includes('在一起') ||
        (phaseState.currentPhase !== 'R1' && phaseState.confidence > 0.6)
    )) {
        phaseState.relationshipStartDate = Date.now() - 86400000;
    }
    updateTimeState(timeState);

    // ─── 友谊状态追踪（并行于亲密关系） ───
    _recentMessages.push(text);
    if (_recentMessages.length > 20) _recentMessages.shift();
    for (const keyword of Object.keys(FRIEND_PHASE_EVENTS)) {
        if (text.includes(keyword) && !friendState.keyFriendEvents.includes(keyword)) {
            friendState.keyFriendEvents.push(keyword);
            if (friendState.keyFriendEvents.length > 20) friendState.keyFriendEvents.shift();
        }
    }
    friendState.totalMessages++;
    // 双向性追踪：检测是否为发起方
    const isHelpRequest = /帮(我|忙|个忙)|借.*钱|陪.*(我|去)|救急|能不能.*(帮|陪)/.test(text);
    if (isHelpRequest) friendState.theirHelpRequestCount++;
    friendState.myInitCount++; // event 的消息来自"对方"，即用户输入的对方，所以对方在发言
    // 互损检测计数
    const banter = detectBanter(text);
    if (banter.isBanter) friendState.recentBanterCount++;
    // 阶段性推断
    if (friendState.totalMessages % 10 === 0) {
        const inferredFriend = inferFriendPhase(friendState);
        if (inferredFriend.phase !== friendState.currentPhase && inferredFriend.confidence > 0.6) {
            friendState.currentPhase = inferredFriend.phase;
            friendState.confidence = inferredFriend.confidence;
            friendState.lastPhaseTransition = Date.now();
            friendState.phaseHistory.push({ phase: inferredFriend.phase, timestamp: Date.now() });
        } else {
            friendState.confidence = Math.max(friendState.confidence, inferredFriend.confidence);
        }
    }
    if (friendState.friendSinceDate === 0 && (text.includes('交个朋友') || text.includes('做个朋友'))) {
        friendState.friendSinceDate = Date.now() - 86400000;
    }
    // 检测友谊伤害（并行）
    const friendHarm = detectFriendHarm(text, friendState.currentPhase);

    const puaResult = detectPUA(text, phaseState.currentPhase, timeState);
    // PUA 惩罚：将操控检测直接叠加到输入效价
    const puaPenalty = (puaResult.strategies.length > 0 && puaResult.intensity > 0)
        ? -puaResult.intensity * 0.25 : 0;
    const finalValence = clamp(combinedValence + puaPenalty, -0.95, 0.95);
    const finalSalience = puaPenalty < 0
        ? Math.min(1, combinedSalience + 0.1) : combinedSalience;

    // v0.8: 因果推理——信念匹配时预调整期望，平滑情绪反应
    const inference = causalInference(_recentValences, worldModel.beliefs);
    _currentInference = inference;
    if (inference.matchedBelief) {
        core.expectation = clamp(core.expectation + inference.preemptiveAdjustment, -0.8, 0.8);
    }

    // Layer 1: 核心更新（含 PUA 惩罚）
    core = updateCore(core, finalValence, finalSalience, dominance, safetySignal, layer2);
    metrics.recordValenceSample(core.valence);
    // PUA 直接创伤：检测到操控时额外打击核心（不经过预测误差稀释）
    if (puaPenalty < 0) {
        core.valence = clamp(core.valence + puaPenalty, -0.95, 0.95);
        core.arousal = Math.min(0.95, core.arousal + 0.05);
    }
    // Layer 2: 极值反转 + 成长
    processReversal(core);
    processGrowth(core, layer2);
    layer2.tick++;

    // v0.8: 自我分析——每 20 tick 分析交互日志，发现自我模式
    if (layer2.tick > 0 && layer2.tick % 20 === 0) {
        const newPatterns = selfAnalysis(core, layer2);
        for (const np of newPatterns) {
            const existing = selfModel.patterns.find(p => p.id === np.id);
            if (existing) {
                existing.frequency = np.frequency;
                existing.confidence = Math.max(existing.confidence, np.confidence);
                existing.description = np.description;
            } else {
                selfModel.patterns.push(np);
            }
        }
        // 高频 + 高置信度模式 → 转化为元信念
        for (const p of selfModel.patterns) {
            if (p.frequency >= 2 && p.confidence >= 0.5) {
                const mbId = `meta_${p.id}`;
                const exists = selfModel.metaBeliefs.some(mb => mb.id === mbId);
                if (!exists) {
                    selfModel.metaBeliefs.push({
                        id: mbId,
                        antecedent: p.trigger,
                        consequent: p.description,
                        confidence: p.confidence,
                        supportingCases: p.frequency,
                        counterCases: 0,
                        status: 'active',
                        evidence: [], contradictions: [],
                        createdAt: Date.now(),
                        lastUpdated: Date.now(),
                    });
                }
            }
        }
        selfModel.lastAnalyzed = layer2.tick;
        saveSelfModel();
    }

    // Layer 4: 元认知层 — 好奇驱动、假设置信度更新、张力调节
    updateCuriosity(core, layer2);
    updateTensionRegulator(core, layer2);
    updateHypotheses(finalValence);

    // 检查是否需要生成新假设
    const newHyp = generateHypothesis(core, layer2, puaResult, _phaseChanged);
    if (newHyp) {
        hypotheses.push(newHyp);
        // 新假设的好奇心足够时自动设计实验
        if (curiosityState.intensity > P.EXPERIMENT_DESIGN_THRESHOLD) {
            const exp = designExperiment(newHyp, core);
            if (exp) experiments.push(exp);
        }
    }

    // 为已成熟但无实验的假设补设计实验
    if (curiosityState.intensity > P.EXPERIMENT_DESIGN_THRESHOLD && experiments.filter(e => e.state === 'pending' || e.state === 'active').length === 0) {
        const untestedHyp = hypotheses.find(h => h.active && h.status !== 'rejected' && h.confidence >= 0.3 && h.trials === 0
            && !experiments.some(e => e.hypothesisId === h.id));
        if (untestedHyp) {
            const exp = designExperiment(untestedHyp, core);
            if (exp) experiments.push(exp);
        }
    }

    // 世界模型：交互模式检测
    detectPatterns(core);

    // v0.7 + TMS: 信念提炼、证据记录、范式革命
    extractBeliefsFromPatterns();
    updateBeliefs();
    const _paradigmJustShifted = checkParadigmShift(core);
    // 范革冻结期衰减
    if (_paradigmFreezeRemaining > 0) _paradigmFreezeRemaining--;

    // Layer 4 持久化（每次事件后保存）
    saveLayer4State();
    appendInteractionLog(core, layer2);

    const resp = buildFullResponse(core, layer2) as any;
    resp._phase = phase;
    resp._src = src;
    resp._pua = puaResult;
    resp._relationshipPhase = phaseState.currentPhase;
    resp._relationshipConfidence = phaseState.confidence;
    resp._silenceHours = timeState.consecutiveSilenceHours;
    resp._friendPhase = friendState.currentPhase;
    resp._friendConfidence = friendState.confidence;
    resp._friendHarm = friendHarm;
    resp._paradigmShift = _paradigmJustShifted ? {
        version: worldModel.paradigmVersion,
        reason: worldModel.shiftHistory[worldModel.shiftHistory.length - 1]?.reason || '未知',
        freezeRemaining: _paradigmFreezeRemaining,
    } : null;
    res.json(resp);

    // 对话历史 + 异步 LLM 分析（不阻塞响应）
    conversationHistory.push({ role: '用户', text });
    if (conversationHistory.length > MAX_HISTORY) conversationHistory.shift();
    const aiSettings = readAISettings();
    analyzeSpeechAct(text, [...conversationHistory], layer2.tick, aiSettings).catch(() => {});
    } catch (e: any) {
        console.error('[Event] 未捕获异常:', e?.message || e);
        if (!res.headersSent) res.status(500).json({ error: 'internal_error', detail: e?.message || 'unknown' });
    }
});


}
