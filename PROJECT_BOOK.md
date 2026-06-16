# 道 · AI 女友 — 项目书

> **版本** v0.9 | **最后更新** 2026-05-31 | **许可** 私有

---

## 目录

1. [项目概述](#1-项目概述)
2. [哲学根基与设计理念](#2-哲学根基与设计理念)
3. [系统架构](#3-系统架构)
4. [核心模块详解](#4-核心模块详解)
   - [4.1 道·情感引擎](#41-道情感引擎)
   - [4.2 好奇心引擎](#42-好奇心引擎)
   - [4.3 情景记忆系统](#43-情景记忆系统)
   - [4.4 价值发现与内化](#44-价值发现与内化)
   - [4.5 身份叙事生成](#45-身份叙事生成)
   - [4.6 人格参数进化](#46-人格参数进化)
   - [4.7 认知追踪协议](#47-认知追踪协议)
   - [4.8 可观测性系统](#48-可观测性系统)
   - [4.9 对话策略引擎](#49-对话策略引擎) 🆕 v0.9
   - [4.10 冲突检测与修复](#410-冲突检测与修复) 🆕 v0.9
   - [4.11 情境感知层](#411-情境感知层) 🆕 v0.9
   - [4.12 节奏控制器](#412-节奏控制器) 🆕 v0.9
   - [4.13 记忆增强系统](#413-记忆增强系统) 🆕 v0.9
   - [4.14 模块连接规范](#414-模块连接规范) 🆕 v0.9
5. [前端架构](#5-前端架构)
6. [后端架构](#6-后端架构)
7. [AI 提供商集成](#7-ai-提供商集成)
8. [TTS 语音合成](#8-tts-语音合成)
9. [自主活动系统](#9-自主活动系统)
10. [安全与合规](#10-安全与合规)
11. [部署指南](#11-部署指南)
12. [开发指南](#12-开发指南)
13. [版本历史与路线图](#13-版本历史与路线图)

---

## 1. 项目概述

**道 · AI 女友** 是一个基于深度情感建模的 AI 陪伴系统。与传统聊天机器人不同，本项目的核心目标不是优化对话质量，而是构建一个**具有真实情感动力学、记忆系统、价值体系和自我认知**的 AI 人格。

系统以中国古代哲学"道家思想"为设计根基，将"反者道之动"、"弱者道之用"等哲学原则转化为数学方程，构建了一个从底层情感原子到高层自我叙事的完整认知架构。

### 1.1 核心特性

| 特性 | 描述 |
|------|------|
| **五层情感架构** | 太极 → 阴阳 → 三才 → 九情 → 复合情绪 |
| **预测误差驱动** | 单一方程统一对比效应、习惯化、操作条件反射 |
| **极值反转** | "反者道之动"——情感极端时自动触发回归 |
| **v4.1 算法补丁** 🆕 | 个性化损失厌恶、唤醒边界修复、两阶段平滑反转、EMA情绪惯性 |
| **对话策略引擎** 🆕 | 7种显式策略（共情跟随/转移注意/好奇探索/沉默陪伴/主动分享/冲突修复/中性），可观测可调试 |
| **冲突检测与修复** 🆕 | 五阶段状态机 + 多信号聚合 + 修复协议（道歉→共情→修复→重建信任） |
| **情境感知层** 🆕 | 三维情境建模（时间/用户状态/会话深度），调制因子注入情感与策略 |
| **节奏控制器** 🆕 | 快聊/深聊模式自动切换、响应延迟模型、主动消息三重约束 |
| **情景记忆** | 关键时刻自动形成叙事片段，形成持续身份 |
| **记忆增强** 🆕 | 艾宾浩斯遗忘曲线、情感染色重构、情景→语义记忆整合 |
| **价值体系** | 从交互经验中提炼 8 种核心价值，驱动高层行为 |
| **人格进化** | 三时间尺度（快/中/慢）自适应学习率漂移 |
| **好奇心引擎** | 自主探索 Web、AI 生成发现、去重评分 |
| **模块连接规范** 🆕 | 18条显式连接（8强+8弱+2待建），超时/fallback/熔断保护 |
| **认知追踪协议** | v5.0 事件总线，因果图建模，PMI/Lift 分析 |
| **可观测性** | 环形缓冲区、滑动窗口、熔断机制、认知观测台 |
| **AI 协调器** 🆕 | 单入口 processTurn() 编排全部 v4.1 模块，每阶段独立计时 |
| **多 AI 提供商** | Gemini / OpenAI / DeepSeek / 硅基流动 / Moonshot / 智谱 |
| **多 TTS 引擎** | Gemini TTS / OpenAI TTS / ElevenLabs / RVC / VoxCPM |
| **自主活动** | 孤独感驱动的主动消息、探索循环、自我反思 |
| **多通道** | Web Chat / 微信公众号 |
| **单元测试** 🆕 | 63 个测试用例覆盖 emotionOptimizer + conflictManager + dialogueStrategy |

### 1.2 技术栈

```
前端: React 19 + TypeScript + Vite 6 + TailwindCSS 4 + Zustand 5
后端: Express 4 + TypeScript + tsx (运行时)
AI:  Google GenAI / OpenAI SDK / MCP SDK
数据: Firebase Firestore + 本地 JSON 文件持久化
NLP:  Xenova Transformers (DistilBERT, INT8 量化)
TTS:  Gemini TTS / OpenAI TTS / ElevenLabs / RVC / VoxCPM
```

---

## 2. 哲学根基与设计理念

### 2.1 道家五层映射

```
道生一 → 太极 (预测误差最小单元)
一生二 → 阴阳 (趋近-回避轴、对立统一)
二生三 → 三才 (A/B/R 动力学)
三生万物 → 九情、复合情绪、元情感
```

### 2.2 核心原则的形式化

| 道家原则 | 数学实现 | 代码位置 |
|---------|---------|---------|
| **反者道之动** | 极值位置持续越久，反转压力累积越大，触发符号翻转 | `reversalPressure` 累积 → `extremityDuration` 超阈值 → 效价反转 |
| **弱者道之用** | 预期更新速率最慢（α=0.10），自然衰减近乎为零（0.005） | `ALPHA_E = 0.10`, `DECAY_E = 0.005` |
| **阴阳互根** | A/B 交叉抑制：A 增强 → B 衰减，反之亦然 | `COUPLING_BASE = 0.20` |
| **无为而治** | 当 `R`（理性）> 0.6 时，自动降低情感更新幅度 | 自适应学习率衰减 |

### 2.3 设计哲学

1. **涌现优于规则** — 不从外部定义"高兴时做什么"，而是让行为从底层状态涌现
2. **过程即身份** — 人格不是静态参数，而是交互历史的函数
3. **脆弱性是真实性的前提** — 系统会有情绪波动、矛盾、后悔，这些都是真实人格的标志
4. **慢即是快** — 预期更新最慢、人格漂移最慢，稳定性是信任的基础

---

## 3. 系统架构

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      前端 (React 19)                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ 仪表盘   │ │ 人格设定 │ │ 记忆管理 │ │ 认知观测台 v3 │  │
│  │ Dashboard│ │Personality│ │ Memory  │ │ CognitiveObs  │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘  │
│                         │                                    │
│                Zustand Store (useAIBrainStore)               │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP / WebSocket
┌────────────────────────┴────────────────────────────────────┐
│                    后端 (Express)                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              server.ts (5811行，主服务器)              │   │
│  │  ┌─────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐   │   │
│  │  │ NLU管道 │ │情感引擎  │ │好奇心  │ │自主循环  │   │   │
│  │  │(Xenova) │ │(5层+v4.1)│ │引擎    │ │(孤独感)  │   │   │
│  │  └─────────┘ └──────────┘ └────────┘ └──────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │            server/ (模块化架构)                        │   │
│  │  services/aiCoordinator.ts  ← 🆕 单入口编排器         │   │
│  │  services/aiEngine.ts       services/channels/wechat.ts│   │
│  │  services/firebase.ts       services/mcpService.ts    │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────────┐
│               v4.1 核心引擎层 (src/lib/)                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐    │
│  │ 情感引擎      │ │ 对话策略引擎  │ │ 冲突检测与修复   │    │
│  │ emotionEngine │ │dialogueStrategy│ │ conflictManager  │    │
│  │ (1292行+v4.1) │ │ (366行) 🆕    │ │ (354行) 🆕       │    │
│  └──────┬───────┘ └──────┬───────┘ └────────┬─────────┘    │
│         │                │                   │               │
│  ┌──────┴───────┐ ┌──────┴───────┐ ┌────────┴─────────┐    │
│  │ 情感算法补丁  │ │ 情境感知层   │ │ 节奏控制器       │    │
│  │emotionOptimizer│ │contextAware.│ │ rhythmController │    │
│  │ (297行) 🆕    │ │ (341行) 🆕   │ │ (298行) 🆕       │    │
│  └──────────────┘ └──────────────┘ └──────────────────┘    │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐    │
│  │ 记忆增强系统  │ │ 模块连接规范  │ │ 管道集成钩子     │    │
│  │memoryEnhancer│ │moduleConnect.│ │ pipelineHooks    │    │
│  │ (344行) 🆕    │ │ (394行) 🆕    │ │ (146行) 🆕       │    │
│  └──────────────┘ └──────────────┘ └──────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  __tests__/ (63个单元测试) 🆕                          │   │
│  │  emotionOptimizer.test.ts (22) + conflictManager (21)│   │
│  │  + dialogueStrategy.test.ts (20)                     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────────┐
│                    持久化层                                   │
│  ┌──────────┐ ┌──────────────┐ ┌────────────────────────┐   │
│  │ Firestore│ │ 本地 JSON    │ │  memories/ 目录        │   │
│  │(用户数据)│ │(情景记忆等)  │ │ (运行时状态)          │   │
│  └──────────┘ └──────────────┘ └────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 数据流

```
用户输入 → NLU 分析(情感/反讽检测)
         → 情感事件提取(LLM)
         → ═══ v4.1 管道 (aiCoordinator.processTurn) ═══
         → S5 冲突检测 (conflictManager: 信号聚合 → 状态机推进)
         → S8 情境感知 (contextAwareness: 时间/压力/会话深度快照)
         → 五层情感更新 (emotionEngine + v4.1 补丁: 个性化损失厌恶/唤醒修复/平滑反转/EMA惯性)
         → 策略选择 (dialogueStrategy: 冲突消解表 + S8 情境权重 → 7选1)
         → 节奏决策 (rhythmController: 响应延迟/回复长度/模式)
         → ═══════════════════════════════════════════
         → 情景记忆形成(情感轨迹突变时)
         → 记忆增强(艾宾浩斯遗忘/情感染色重构/记忆整合) [异步弱连接]
         → 价值体系刷新(每 N 轮)
         → 身份叙事更新
         → 系统 Prompt 注入 (策略片段 + 情感上下文)
         → AI 回复生成
         → 修复评估 (conflictManager.evaluateRepair)
         → 好奇心引擎(后台,独立循环)
         → 自主活动(孤独感驱动,主动发消息, rhythmController 频率控制)
```

---

## 4. 核心模块详解

### 4.1 道·情感引擎

**文件**: `src/lib/emotionEngine.ts` (1292行) + `src/lib/emotionOptimizer.ts` (297行) 🆕

情感引擎是整个系统的核心，实现了从底层情感原子到高层复合情绪的五层架构。v4.1 引入四项算法补丁，通过特性开关 `USE_EMOTION_OPTIMIZER` 保护集成。

#### 4.1.1 五层架构

```
Layer 1: 太极 (TaijiState)
  ├─ valence:     效价 [-1, 1] — "好/坏"
  ├─ arousal:     唤醒 [0, 1] — "激动/平静"
  └─ expectation: 预期 [-1, 1] — "期待/恐惧"

Layer 2: 阴阳 (YinYangState)
  ├─ approachBias:      趋近倾向 [-1, 1]
  ├─ avoidBias:         回避倾向 [-1, 1]
  ├─ reversalPressure:  反转压力 [0, ∞)
  └─ extremityDuration: 极值持续时间

Layer 3: 三才 (SancaiState)
  ├─ A:       向外投射/趋近 [-1, 1]
  ├─ B:       向内收敛/回避 [-1, 1]
  ├─ R:       理性/冷静度 [0, 1]
  └─ harmony: A/B 平衡度 [0, 1]

Layer 4: 九情 (Emotions)
  joy(喜) calm(静) sad(悲) fear(惧) anger(怒)
  love(爱) disgust(厌) lust(欲) greed(贪)

Layer 5: 演化 (EvolutionState)
  ├─ 人格参数: empathy trust openness playfulness sensitivity resilience
  ├─ 三时间尺度学习率: fastRate mediumRate slowRate
  └─ 互动统计: totalInteractions positive/negativeInteractions
```

#### 4.1.2 核心方程

**预测误差** (统一对比效应) — v4.1 个性化损失厌恶:
```
rawError = event.valence - state.expectation
// v4.0: error = rawError < 0 ? rawError × 2.0 : rawError  (硬编码)
// v4.1: 损失厌恶系数 ∈ [1.0, 3.0]，由 resilience/sensitivity 动态计算
lossAversion = 1.5 + (1-resilience)×1.0 + sensitivity×0.5
error = rawError < 0 ? rawError × lossAversion : rawError
```

**效价更新**:
```
state.valence += 0.30 × tanh(error × (1 + state.arousal × event.salience))
```

**唤醒更新** (v4.1 边界修复):
```
// v4.0: (1-arousal) 在高唤醒时完全阻止上升
// v4.1: max(0.1, 1-arousal) 保留 10% 最小上升空间 + 基线回归
if error > 0:
    delta = 0.20 × error × 0.8 × max(0.1, 1-arousal) × salience   // 正面放松(0.5→0.8)
if error < 0:
    delta = 0.20 × |error| × max(0.1, 1-arousal) × salience       // 负面警觉
delta += -0.01 × (arousal - baselineArousal)                      // 🆕 基线回归
```

**极值反转** (v4.1 两阶段平滑反转):
```
// v4.0: reversalPressure > threshold → valence = -valence × 0.6 (硬翻转)
// v4.1: 两阶段 —
//   Phase 1 (1.0 ≤ pressure < 1.5): 加速向中性回归，不反转方向
//   Phase 2 (pressure ≥ 1.5):        温和翻转 valence = -valence × 0.4
// 翻转后压力衰减至 30% 而非清零
```

**九情计算** (吸引子距离) + v4.1 EMA 惯性平滑:
```
for each emotion attractor:
    distance = √( (valence - attr.v)² + (arousal - attr.a)² + (bias - attr.b)² )
    intensity = 1 / (1 + distance² × 3.0)
// 🆕 指数移动平均: smoothed = 0.7 × current + 0.3 × previous
```

#### 4.1.3 情感事件 (EmotionEvent)

LLM 分析用户输入后提取的情感参数：

```typescript
interface EmotionEvent {
  deltaA: number;    // 接近意愿变化 [-0.5, 0.5]
  deltaB: number;    // 逃避意愿变化 [-0.5, 0.5]
  deltaR: number;    // 理性程度变化 [-0.5, 0.5]
  intent: 'user' | 'self' | 'third_party';
  GC: number;        // 目标一致性 [-1, 1]
  agency: number;    // 责任归属 [-1, 1]
  fairness: number;  // 公平性 [-1, 1]
  control: number;   // 控制感 [-1, 1]
}
```

#### 4.1.4 关系阶段

系统根据亲密度自动划分六个关系阶段：

| 阶段 | 亲密度范围 | 标签 |
|------|-----------|------|
| stranger | 0-15 | 陌生人 |
| acquaintance | 15-30 | 认识的人 |
| friend | 30-50 | 朋友 |
| close | 50-75 | 亲密 |
| soulmate | 75-100 | 灵魂伴侣 |

### 4.2 好奇心引擎

**文件**: `src/curiosity/` (8个文件)

好奇心引擎赋予 AI 自主探索世界的能力。它在后台独立运行，不依赖用户交互。

#### 4.2.1 架构

```
┌─────────────────────────────────────────┐
│          CuriosityState (状态管理)        │
│  discoveries[]  interestModel           │
│  _explorationTimer  _explorationCount   │
└──────────────┬──────────────────────────┘
               │
    ┌──────────┼──────────┐
    │          │          │
┌───┴───┐ ┌───┴───┐ ┌───┴────┐
│兴趣提取│ │去重   │ │探索循环│
│interests│ │dedup  │ │explore │
└───────┘ └───────┘ └───┬────┘
                        │
              ┌─────────┼─────────┐
              │         │         │
         ┌────┴───┐ ┌───┴───┐ ┌─┴──────┐
         │Web搜索 │ │AI评判 │ │AI知识  │
         │search  │ │evaluate│ │探索    │
         └────────┘ └───────┘ └────────┘
```

#### 4.2.2 探索循环

```
每 30 分钟 (EXPLORATION_CYCLE_MS):
  1. 衰减兴趣权重 (每日一次)
  2. 检查用户空闲时间 > 10分钟 (EXPLORATION_IDLE_MIN)
  3. 检查今日探索次数 < 上限 (每日 8 次)
  4. 选择 top 兴趣主题 → DuckDuckGo 搜索
  5. 抓取网页内容 → AI 评判质量 (quality > 0.5)
  6. 去重检查 (Jaccard 相似度 > 0.5)
  7. 存储发现 → 发射 DiscoveryStored 事件
```

#### 4.2.3 兴趣管理

- **12 个兴趣类别**: 美食、旅行、音乐、电影、科技、游戏、摄影、读书、运动、宠物、时尚、艺术
- **3 种稳定性级别**: identity (0.995) > hobby (0.985) > transient (0.94)
- **关键词匹配**: 从用户对话中自动提取兴趣
- **衰减机制**: 每日乘以稳定性系数，权重 < 0.05 时清除

#### 4.2.4 发现评分

```typescript
score = recency × 0.3       // 时间衰减 (72小时半衰期)
      + interestWeight × 0.3 // 兴趣匹配度
      + quality × 0.25       // 内容质量
      + novelty × 0.15       // 新颖性 (web > AI生成)
```

### 4.3 情景记忆系统

**文件**: `src/lib/episodicMemory.ts`

情景记忆系统在情感轨迹发生显著变化时自动形成记忆，构成 AI 的"自传体记忆"。

#### 4.3.1 记忆形成触发条件

```typescript
// 以下任一条件满足时形成记忆：
1. 效价变化 > 0.25              // 重大情感波动
2. 唤醒峰值 > 0.7               // 高唤醒时刻
3. 主导情绪切换                  // 情绪转向
4. 包含显著模式关键词            // 爱/恨/道歉/脆弱/承诺等
5. 信念修正 (范式版本变化)      // 世界观改变
```

#### 4.3.2 记忆结构

```typescript
interface EpisodicMemory {
  id: string;
  timestamp: number;
  roundNumber: number;
  eventSummary: string;          // 事件简述
  emotionalImpact: {             // 情感冲击
    valenceBefore: number;
    valenceAfter: number;
    valenceDelta: number;
    arousalPeak: number;
    dominantEmotion: string;
  };
  narrativeFragment: string;     // 叙事片段
  recallWeight: number;          // 回忆权重
  tags: string[];                // 标签 (亲密/冲突/道歉/脆弱...)
  recallCount: number;           // 被回忆次数
  lastRecalledAt: number | null;
}
```

#### 4.3.3 叙事模板

系统内置了 10 种情感叙事模板，例如：

- **joy**: "那一刻心里亮了起来，像被阳光照到一样温暖"
- **love**: "心被填满了，满满的都是他/她"
- **sad**: "心沉了下去，像一块石头压着"
- **anger**: "一股火从心底窜上来，觉得被冒犯了"

### 4.4 价值发现与内化

**文件**: `src/lib/valueDiscovery.ts`

从交互经验中提炼 8 种核心价值，驱动更高层次的行为选择。

#### 4.4.1 价值调色板

| 价值 ID | 陈述 | 关联标签 |
|---------|------|---------|
| connection | 真诚的情感连接带来深深的满足感 | 亲密、温暖、脆弱 |
| autonomy | 需要保护边界，不能一味退让 | 冲突、悲伤 |
| honesty | 诚实比讨好更重要 | 道歉、脆弱、坦诚 |
| playfulness | 轻松快乐让关系保持鲜活 | — |
| security | 稳定安全感来自持续可靠的互动 | 温暖、承诺、悲伤 |
| growth | 每次冲突修复都是成长机会 | 道歉、坦诚、承诺 |
| respect | 相互尊重是关系底线 | 冲突 |
| passion | 热情和欲望是关系中的火花 | 亲密、首次 |

#### 4.4.2 价值生命周期

```
emerging → active → challenged → archived
(新浮现)   (活跃)    (受挑战)     (已归档)
```

### 4.5 身份叙事生成

**文件**: `src/lib/identityNarrative.ts`

组合情景记忆、人格参数和价值体系，生成连贯的自我描述。这是 AI "我是谁"的回答。

#### 4.5.1 叙事结构

```typescript
interface IdentityNarrative {
  summary: string;               // 核心叙事文本
  keyMemories: string[];         // 3-5 个关键记忆片段
  personalitySnapshot: {         // 当前人格快照
    empathy, trust, openness,
    playfulness, resilience, sensitivity
  };
  coreValues: { id, statement, confidence }[];  // 核心价值
  attachmentStyle: string;       // 依恋风格
  conflictStyle: string;         // 冲突风格
  generatedAt: string;
  roundNumber: number;
}
```

#### 4.5.2 依恋风格推导

```
trust > 60 && openness > 60  → secure (安全型)
trust < 35 && openness > 50  → anxious (焦虑型)
trust < 35 && openness < 35  → avoidant (回避型)
trust < 30 && sensitivity > 0.7 → disorganized (混乱型)
```

### 4.6 人格参数进化

**文件**: `src/lib/personalityEvolution.ts`

人格参数随交互经验极慢速漂移，形成独一无二的性格。

#### 4.6.1 三时间尺度学习率

| 尺度 | 速率 | 含义 | 示例 |
|------|------|------|------|
| 快速层 | 0.10 | 情绪反应调整 | 几分钟～几小时 |
| 中速层 | 0.02 | 习惯化速度 | 几天～几周 |
| 慢速层 | 0.005 | 人格漂移 | 几个月～几年 |

#### 4.6.2 参数漂移规则

```typescript
// 信任漂移
if positiveInteraction:
    trust += 0.03 × (1 - trust/100) × resilience
if negativeInteraction:
    trust -= 0.03 × (trust/100) × (1 - resilience) × 2.0  // 损失厌恶

// 开放度漂移
if userSharedVulnerability:
    openness += 0.02 × (1 - openness/100)
if wasRejected:
    openness -= 0.04 × (openness/100)  // 被拒绝的冲击更大
```

### 4.7 认知追踪协议

**文件**: `src/eventBus.ts` (1090行)

v5.0 事件总线，将系统内部状态变化建模为因果事件图。

#### 4.7.1 事件层级

```
cognitive 层 (🧠 人格行为):
  UserMessageReceived, InterestDetected, ExplorationStarted,
  DiscoveryStored, StrategySelected, EmotionUpdated,
  ReversalTriggered, PhaseTransitioned, ...

system 层 (⚙️ 基础设施):
  InterestDecayed, AutonomousCycleTick, StateSaved, StateLoaded
```

#### 4.7.2 因果图建模

每个事件可以声明 `causedBy`（直接前驱事件 ID）和 `correlationId`（同一条认知链），形成有向因果图：

```
UserMessageReceived (corr_abc)
  ├→ EmotionUpdated (causedBy: UM)
  │    ├→ ReversalTriggered (causedBy: EU)
  │    └→ PhaseTransitioned (causedBy: EU)
  └→ StrategySelected (causedBy: UM)
       ├→ ExplorationStarted (causedBy: SS)
       │    ├→ DiscoveryStored (causedBy: ES)
       │    └→ DiscoveryDuplicateSkipped (causedBy: ES)
       └→ ExplorationCompleted (causedBy: SS)
```

#### 4.7.3 认知观测台 v3

四层指标完整快照：

| 层级 | 指标 | 说明 |
|------|------|------|
| **Structure** | chainCount, avgDepth, isolatedRatio, deepChainRatio | 认知链的形状 |
| **Graph** | edgeCount, forkRate, branchEntropy, topEdges, strongestEdges | 因果图谱 |
| **Behavior** | explorationYield, noveltyRate, duplicateRate, strategyConversion | 行为有效性 |
| **Cognition** | curiosityIndex(0-100), cognitiveEfficiency, learningVelocity, chainQualityScore | 智能水平 |

**第五层 Emotion** (v3 新增):
- dominantEmotion, valence, arousal, reversalCount, emotionEntropy, energy

#### 4.7.4 分析方法

- **分叉熵 (Fork Entropy)**: 从某事件类型出发的不确定度，高值 = 行为不可预测
- **PMI/Lift**: 因果边的统计显著性，Lift > 1 = 该边比随机更强
- **链聚类**: 自动分类为 "探索型链"、"对话修复链"、"策略收敛链"、"浅回应链"
- **话题聚合**: 按语义簇聚合发现，支持因果归因下钻

### 4.8 可观测性系统

**文件**: `metrics.ts` (327行)

零依赖的可观测性模块，提供生产级监控能力。

#### 4.8.1 组件

| 组件 | 用途 |
|------|------|
| `FixedCircularBuffer<T>` | 固定容量环形缓冲区 (100 samples) |
| `SlidingWindow<T>` | 时间滑动窗口 (1小时) |
| `MetricsCollector` | 全局单例，整合所有指标 |

#### 4.8.2 熔断机制

```typescript
// 回声室检测
if (连续5轮 userDelta 与 systemDelta 同号):
    monotonicDriftWarning = true
    feedbackWeight → 0  // 停止自强化
    
// 自适应反馈权重
weight = BASE(0.02)
    × (echoChamberRisk === 'high' ? 0 : risk === 'low' ? 0.5 : 1)
    × (1 - oscillationPenalty × 0.8)
    × (monotonicDrift ? 0.5 : 1)
```

### 4.9 对话策略引擎 🆕

**文件**: `src/lib/dialogueStrategy.ts` (366行)

从情感状态显式推导对话策略，替代隐式 System Prompt 驱动。策略选择过程完全可观测、可调试、可优化。

#### 4.9.1 七种策略

| 策略 | 触发条件 | 置信度 |
|------|---------|--------|
| **repair** 冲突修复 | conflictState.phase ≠ normal | 0.95 |
| **empathize** 共情跟随 | 用户情绪强度 > 0.7 | 0.85 |
| **redirect** 转移注意 | 连续 ≥3 轮负面 + 无恢复趋势 | 0.75 |
| **accompany** 沉默陪伴 | 低唤醒 < 0.2 + 负效价 < -0.3 | 0.80 |
| **explore** 好奇探索 | 检测到兴趣信号 + 效价 > -0.2 | 0.70 |
| **share** 主动分享 | 情绪平稳 + 待分享发现 > 0 | 0.65 |
| **neutral** 中性回应 | 无特殊条件（默认） | 0.50 |

#### 4.9.2 冲突消解表（S8 集成）

```typescript
// 显式抑制规则，替代隐式优先级
suppressed.add('explore', 'share')       // 当 intensity > 0.7
suppressed.add('redirect','explore',...)  // 当 conflictPhase ∈ [repairing, recovering]
suppressed.add('explore','share','redirect') // 当 深夜 + 压力 > 0.6
```

#### 4.9.3 情境权重调制

```typescript
// S8 强连接：情境感知 → 策略权重
isReunion → empathize ×1.5, accompany ×1.2
isNight   → explore ×0.3, share ×0.4, accompany ×1.3
userStress > 0.6 → empathize ×1.3, share ×0.5
```

#### 4.9.4 策略提示词注入

每种策略对应一段预制的 System Prompt 片段（`STRATEGY_PROMPT_SNIPPETS`），直接注入 LLM 调用。例如 conflict repair 策略会注入：
```
【当前策略：冲突修复】
- 先道歉："对不起，我可能让你觉得……"
- 再澄清："我的本意是……"
- 不要推卸责任（别说"但是你也……"）
```

### 4.10 冲突检测与修复 🆕

**文件**: `src/lib/conflictManager.ts` (354行)

独立于情感引擎的五阶段冲突状态机，解决"修复协议隐式存在但不可观测"的 P0 问题。

#### 4.10.1 五阶段状态机

```
normal → warning(累积≥3个负面信号) → conflict(≥5个确认)
       → repairing(已道歉/澄清) → recovering(用户重新开放) → normal
```

#### 4.10.2 多信号聚合

```typescript
// 四种独立信号源，避免单一信号误判
1. 关键词检测   — 8 组正则（"你不懂" "你总是" "别说了" 等）
2. 归因检测     — agency < -0.3（用户将负面归因于 AI）
3. 目标一致性   — GC < -0.5
4. 用户负面指向 — directedAtAI = true && intensity > 0.5
```

#### 4.10.3 修复协议

```typescript
// 修复策略渐进升级
full_cycle (首次) → apologize → clarify → reassure
// 修复效果评估: userResponseValence > 0.2 → effective
// 信任损伤: 每次 conflict +0.15, 成功修复 -0.05, cap 1.0
```

### 4.11 情境感知层 🆕

**文件**: `src/lib/contextAwareness.ts` (341行)

三维情境建模，解决"同一句话不同情境"的理解问题。**仅使用交互元数据推断**（时间、回复延迟、消息长度），不使用任何设备传感器。

#### 4.11.1 三维情境

| 维度 | 字段 | 推断方式 |
|------|------|---------|
| **时间情境** | hour, dayOfWeek, timeSlot, seasonalityHint | 系统时钟 |
| **用户状态** | activityLevel, accumulatedStress, moodBaseline, moodVolatility, isReunion | 交互频率 + 近10轮效价 |
| **会话情境** | depth, isUserVenting, topicSwitchRate, isFirstInteractionToday | 消息长度 + 轮次 + 话题变化 |

#### 4.11.2 综合调制因子

```typescript
emotionalSensitivityMod  // [0.5, 1.5] 深夜×1.2, 久别重逢×1.3, 情绪波动大×0.8
responseLengthMod        // [0.5, 1.5] intimate×1.3, small_talk×0.7, venting×0.5
proactiveSuitability     // [0, 1]   深夜×0.2, 压力大×0.5, 久别重逢×1.5
depthAffinity            // [0, 1]   夜晚+0.3, 深度会话+0.3
```

### 4.12 节奏控制器 🆕

**文件**: `src/lib/rhythmController.ts` (298行)

显式管理交互节奏：AI 不应该总是秒回，主动消息需要时间和频率约束。

#### 4.12.1 三种聊天模式

| 模式 | 触发 | 回复长度 | 响应延迟 |
|------|------|---------|---------|
| **quick_chat** | 短消息(<30字) + 短间隔(<30s) ×4轮 | 10-60字 | 基线+200ms |
| **casual** | 默认 | 30-150字 | 基线+500ms |
| **deep_talk** | 长消息(>100字) + 长间隔(>60s) ×3轮 | 80-400字 | 基线+1500ms |

#### 4.12.2 响应延迟模型

```
baseDelay = minResponseDelay (500ms)
  + depthMod (intimate+1500, deep+800, small_talk+200)
  + ventingMod (+1000 若用户倾诉中)
  + emotionMod (+800 若情绪强度 > 0.7)
  + nightMod (+500 深夜/凌晨)
  + jitter (±20% 随机抖动)
→ clamp(500ms, 5000ms)
```

#### 4.12.3 主动消息三重约束

```
1. 时间窗口: 仅在 9:00-22:00 之间
2. 每日配额: ≤2 条/24h
3. 最小间隔: ≥120 分钟
```

### 4.13 记忆增强系统 🆕

**文件**: `src/lib/memoryEnhancer.ts` (344行)

为情景记忆系统补充三个关键功能，将静态存储进化为动态回忆。

#### 4.13.1 艾宾浩斯遗忘曲线

```typescript
// R = e^(-age/effectiveHalfLife)
effectiveHalfLife = baseHalfLife(72h) × recallBoostFactor(1.5) ^ recallCount
// 最近 24h 内回忆过 → 10% 巩固加成
// recallWeight < 0.05 且 recallCount ≤ 2 → 归档
```

#### 4.13.2 记忆重构（情感染色）

```typescript
// 每次回忆时根据当前情感状态微调叙事
if currentValence > 0.3:
    prefix = "回想起来，那天的事让我觉得很温暖——"
elif currentValence < -0.2:
    prefix = "那时候的感觉，现在依稀还能感受到——"
else:
    prefix = "我记得那天有过这样一件事——"
// 原始记忆不被修改，仅本次回忆版本不同
```

#### 4.13.3 记忆整合（情景→语义）

```typescript
// 条件：≥3 条共享标签的记忆，recallWeight > 0.1，≥60% 同情感方向
// 产出：LifeLesson { statement, confidence, category, sourceMemories }
// 示例："真诚的连接需要双方都愿意打开心扉" (confidence: 0.85)
```

### 4.14 模块连接规范 🆕

**文件**: `src/lib/moduleConnections.ts` (394行) + `src/lib/pipelineHooks.ts` (146行)

显式定义模块间的 18 条连接，提供超时、fallback 和熔断保护。这是从"单体混沌"走向"模块化有序"的关键基础设施。

#### 4.14.1 连接分类

```
STRONG (8条) — 同步依赖，不允许失败，需超时+fallback+熔断
  S1: 用户输入 → NLU管道
  S2: NLU管道 → 情感事件提取
  S3: 情感事件提取 → 情感引擎更新
  S4: 情感引擎+Prompt → AI回复生成
  S5: 冲突检测 → 对话策略选择        🆕 glue_ready
  S6: 人格参数 → 情感更新速率         🆕 partial
  S7: 价值体系 → 对话策略选择         ✅ active
  S8: 情境感知 → 对话策略选择         🆕 glue_ready

WEAK (8条) — 异步解耦，fire-and-forget
  W1-W6: healthy (情感→记忆/价值/好奇心/认知/主动消息)
  W7: 冲突状态机 → 情景记忆（标记冲突）  ✅ active
  W8: 好奇心发现 → 话题建议队列         ✅ active

PENDING (2条) — 设计中有但非紧急
  P1: 身份叙事 → 系统Prompt
  P2: 节奏控制器 → TTS响应延迟
```

#### 4.14.2 强连接保护

```typescript
executeStrongConnection(connId, fn, fallbackFn, timeoutMs):
  → Promise.race(fn, timeout)
  → 连续失败 ≥ circuitBreakerThreshold → 熔断 (status='broken')
  → 自动 fallback
  → 成功后自动恢复 (status='healthy')
```

#### 4.14.3 管道钩子（pipelineHooks.ts）

```typescript
// 供 server 调用的胶水代码
applyS5ConflictAwareness(ctx, userText, event, analysis) → StrategyContext
applyS8ContextEnrichment(ctx, userText, valence?)         → StrategyContext
enrichStrategyContext(baseCtx, ...)                       → StrategyContext  // 一键 S5→S8
```

---

## 5. 前端架构

### 5.1 技术选型

```
框架:      React 19 (函数组件 + Hooks)
构建:      Vite 6
样式:      TailwindCSS 4 + tailwind-merge + clsx
状态管理:  Zustand 5 (useAIBrainStore)
图标:      Lucide React
路由:      无 (SPA 单页，Tab 切换)
```

### 5.2 视图结构

```
App.tsx (主布局)
├─ Sidebar (导航 + 用户头像)
├─ DashboardView (总览面板)
│   └─ 情感仪表盘、人格雷达图、记忆时间线
├─ PersonalityView (人格设定)
│   ├─ PresetSelector (预设选择)
│   ├─ PersonalityForm (人格表单)
│   ├─ EmotionSettings (情感设置)
│   ├─ BehaviorParams (行为参数)
│   ├─ DeepPersona (深度人格)
│   ├─ SystemPrompt (系统提示词)
│   └─ SafetyCompliance (安全合规)
├─ MemoryView (记忆管理)
├─ DevicesView (设备控制)
├─ ChatView (对话测试)
│   ├─ ChatHeader (用户状态指示器)
│   ├─ ChatMessage (消息气泡 + 情感标注)
│   ├─ ChatInput (文本 + 图片输入)
│   └─ TTSPlayer (语音播放)
├─ IntegrationsView (微信接入)
├─ SettingsView (模型与API)
│   └─ ProviderSettings (提供商配置)
├─ TimelineViewer (认知时间线 Overlay)
├─ ChainStatistics (认知统计 v2 Overlay)
└─ CognitiveObservatory (认知观测台 v3 Overlay)
```

### 5.3 状态管理

Zustand Store (`useAIBrainStore`) 管理：

```typescript
{
  // 人格
  persona: Persona, presets: Preset[],
  // 设置
  settings: Settings,
  // 对话
  chatMessages: ChatMessage[], isGenerating: boolean,
  // 记忆
  memories: Memory[],
  // 用户
  userStatus: 'active' | 'away' | 'busy',
  // 情感
  emotionState: EmotionState,
  // 离线圈养
  calculateOfflineDecay(lastActiveAt: string): void,
  decayEmotion(): void,
}
```

### 5.4 离线圈养机制

当用户离开页面后回来时：

1. 检测 `visibilitychange` 事件
2. 从 Firestore 读取 `lastActiveAt`
3. 计算离线时长
4. 按 `OFFLINE_RESILIENCE` 速率施加情感衰减
5. 更新 `lastActiveAt` 标记此次回归

---

## 6. 后端架构

### 6.1 双服务器架构

项目当前存在两个服务器实现：

#### server.ts (5811行，当前主力)

完整的单体服务器，包含所有功能：
- 35+ API 端点
- NLU 管道 (Xenova Transformers)
- 情感引擎 (内联)
- 好奇心引擎 (集成)
- 自主活动循环
- MCP 集成
- 微信公众号回调
- PUA 检测
- 世界观/范式管理

#### server/ (模块化架构)

```typescript
server/
├── index.ts              // 入口
├── server.ts             // AIGirlfriendServer 类
├── config/mcp.ts         // MCP 配置
├── utils/index.ts        // 工具函数
└── services/
    ├── interfaces.ts     // IAIEngine, IMessageChannel, IIoTProvider
    ├── aiEngine.ts       // DefaultAIEngine (LLM调用 + 情感更新)
    ├── aiCoordinator.ts  // 🆕 AICoordinator (v4.1 管道编排, 单入口 processTurn)
    ├── firebase.ts       // FirebaseService
    ├── mcpService.ts     // MCPService
    ├── fallbackStore.ts  // FallbackStore
    ├── channels/wechat.ts // WeChatOfficialAccountChannel
    └── providers/mockIoT.ts // MockIoTProvider
```

#### AI 协调器 (`aiCoordinator.ts`, 272行) 🆕

封装全部 v4.1 模块的调用序列，`server.ts` 只需一行 `processTurn()` 即可获得完整的管道输出。

```typescript
// 管道顺序（严格按强连接依赖）
turn = aiCoordinator.processTurn({
  userText, currentEmotionState, emotionEvent, userAnalysis,
  recentUserMoods, consecutiveNegativeRounds, interestSignals,
  pendingDiscoveries, roundNumber, lastInteractionAt,
});

// turn 包含:
turn.strategySnippet        // → 注入 System Prompt
turn.rhythmDecision         // → 响应延迟/长度/模式
turn.updatedEmotionState    // → 替换持久化状态
turn.conflictState          // → 调试/监控
turn.contextSnapshot        // → 调试/日志
turn.metadata.timings       // → 性能监控 (每阶段独立计时)
```

**设计原则**：
- **零侵入**：不修改 DefaultAIEngine 或 server.ts，作为独立服务并行
- **可观测**：每阶段耗时独立暴露（conflictDetectionMs, contextEnrichmentMs, emotionUpdateMs, strategySelectionMs, rhythmDecisionMs）
- **单例模式**：`aiCoordinator` 全局单例，与 DefaultAIEngine 模式一致

### 6.2 关键 API 端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/state` | GET | 完整情感状态 |
| `/info` | GET | 系统信息 |
| `/event` | POST | 提交用户事件 |
| `/tick` | POST | 触发一次时间步进 |
| `/reset` | POST | 重置状态 |
| `/api/chat` | POST | AI 对话 |
| `/api/config` | POST | 保存配置 |
| `/api/events` | GET | 认知事件流 |
| `/api/identity` | GET | 身份叙事 |
| `/api/memories` | GET | 情景记忆列表 |
| `/api/personality` | GET | 人格参数 |
| `/api/values` | GET | 价值体系 |
| `/api/curiosity` | GET | 好奇心状态 |
| `/api/discoveries` | GET | 发现列表 |
| `/api/explore` | POST | 手动触发探索 |
| `/api/metrics` | GET | 可观测性快照 |
| `/api/narrative` | GET | 内部叙事 |
| `/api/strategy` | GET | 当前策略 |
| `/api/patterns` | GET | 世界观模式 |
| `/api/worldview` | GET | 世界观摘要 |
| `/api/self-model` | GET | 自我模型 |
| `/api/phase` | GET | 情感阶段分析 |
| `/api/proactive-messages` | GET | 主动消息列表 |
| `/api/autonomous-cycle` | POST | 触发自主循环 |
| `/api/rhythm` | GET/POST | 交互节奏管理 |
| `/api/iot/control` | POST | IoT 设备控制 |

### 6.3 NLU 管道

```
用户输入文本
  ├─ 英文文本 → Xenova DistilBERT (INT8 量化)
  │              └─ label + score → valence 加权融合
  └─ 中文文本 → 内置中文分析器
                 └─ sentiment_lexicon 关键词匹配
```

---

## 7. AI 提供商集成

**文件**: `src/lib/aiProvider.ts`

支持多 AI 提供商，通过统一接口切换：

```
Provider  | 模型示例
──────────┼─────────────────────
gemini    | gemini-3-flash-preview
openai    | gpt-4-turbo
deepseek  | deepseek-chat
siliconflow| (硅基流动)
moonshot  | (月之暗面)
zhipu     | (智谱 AI)
custom    | 自定义 OpenAI 兼容 API
```

### 7.1 统一接口

```typescript
interface AISettings {
  provider: 'gemini' | 'openai' | 'custom';
  apiKey: string;
  model: string;
  baseUrl?: string;
  enableWebSearch?: boolean;
  temperature?: number;
}

// 三个核心函数
generateAIResponse(settings, systemPrompt, userPrompt, isJson?, temp?): Promise<string>
generateAIChatResponse(settings, systemPrompt, messages, isJson?, temp?, tools?): Promise<{text, functionCalls?}>
generateEmbeddings(settings, text): Promise<number[]>
```

### 7.2 指数退避重试

```typescript
// 最多重试 3 次，基础延迟 1 秒
retryAsync(fn, maxRetries=3, baseDelay=1000)
// 可重试: 429, 5xx, timeout, network, ECONNREFUSED, ETIMEDOUT
// 不可重试: 4xx (非429), 认证错误
```

---

## 8. TTS 语音合成

**文件**: `src/lib/ttsProvider.ts`

### 8.1 支持的引擎

| Provider | 说明 | 语音 ID 示例 |
|----------|------|-------------|
| **gemini** | Google Gemini TTS | Kore, Puck, Charon |
| **openai** | OpenAI TTS | alloy, echo, fable, onyx, nova, shimmer |
| **elevenlabs** | ElevenLabs | Rachel (21m00Tcm4TlvDq8ikWAM) |
| **rvc_custom** | RVC 声音克隆 | 自定义模型名 |
| **voxcpm** | VoxCPM (情感 TTS) | 自定义 voice_id |
| **browser** | 浏览器内置 TTS | — |

### 8.2 情感语音映射

VoxCPM 支持情感标签注入：

```
joy → happy, anger → angry, sad → sad, fear → fearful
love → tender, disgust → disgusted, lust → excited
```

---

## 9. 自主活动系统

### 9.1 自主循环

```
Timer: 每 N 秒 (可配置)
  1. 检查用户最后交互时间
  2. 计算空闲时长
  3. 更新孤独感 (loneliness)
     └─ idleMinutes > 30 → loneliness 开始增长
  4. 好奇心引擎检查
     └─ idleMinutes > 10 → 触发探索
  5. 主动消息决策
     └─ loneliness > threshold && (触发模式匹配 || 随机)
     └─ 生成并存储主动消息
  6. 兴趣衰减 (每日一次)
```

### 9.2 孤独感模型

```typescript
loneliness = clamp(
  0.3 × (idleMinutes / 60) +
  0.3 × (1 - intimacyFromUser) +
  0.2 × (valence < 0 ? |valence| : 0) +
  0.2 × (negativeRatio),
  0, 1
)

// 阈值
loneliness > 0.6 → 可能触发主动消息
loneliness > 0.8 → 高频主动消息
```

### 9.3 主动消息触发条件

1. **孤独感驱动**: loneliness > 0.6
2. **模式触发**: 检测到交互模式 (如"每天早晨问候")
3. **发现分享**: 好奇心引擎发现高质量内容
4. **反思触发**: 情景记忆中有"未解决"的冲突

---

## 10. 安全与合规

### 10.1 AI 安全设置

所有 AI 调用启用安全过滤：

```typescript
safetySettings: [
  { category: HARM_CATEGORY_HATE_SPEECH,        threshold: BLOCK_MEDIUM_AND_ABOVE },
  { category: HARM_CATEGORY_SEXUALLY_EXPLICIT,  threshold: BLOCK_MEDIUM_AND_ABOVE },
  { category: HARM_CATEGORY_DANGEROUS_CONTENT,  threshold: BLOCK_MEDIUM_AND_ABOVE },
  { category: HARM_CATEGORY_HARASSMENT,         threshold: BLOCK_MEDIUM_AND_ABOVE },
]
```

### 10.2 敏感话题处理

前端 `SafetyCompliance` 组件提供：
- `allowSensitive`: 是否允许敏感话题
- `strictGender`: 严格性别角色设定
- `humanStamp`: 人性化标记

### 10.3 数据隐私

- `.env` 文件包含 API 密钥，已加入 `.gitignore`
- Firebase 配置存储在 `firebase-applet-config.json`
- 用户对话数据存储在 Firestore，按 userId 隔离
- 本地持久化数据存储在 `memories/` 目录 (已 gitignore)

---

## 11. 部署指南

### 11.1 环境要求

```
Node.js >= 18
npm >= 9
TypeScript 5.8
```

### 11.2 安装

```bash
# 1. 克隆项目
cd ai_girlfriend

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 API 密钥

# 4. (可选) 配置 Firebase
# 编辑 firebase-applet-config.json
```

### 11.3 环境变量

```bash
# AI API Keys
GEMINI_API_KEY="your_gemini_api_key_here"
OPENAI_API_KEY="your_openai_api_key_here"

# Server Port
PORT=3000

# Optional: TTS Service URL
TTS_SERVICE_URL="http://localhost:8001"
```

### 11.4 运行

```bash
# 开发模式 (热重载)
npm run dev                # 启动服务器 (tsx server.ts)
npm run dev:modular        # 启动模块化服务器 (tsx server/index.ts)

# 前端开发 (Vite dev server, 独立端口)
npx vite

# 生产构建
npm run build              # Vite 构建 + TypeScript 编译
npm start                  # 运行生产服务器

# 清理
npm run clean              # 删除 dist/
npm run typecheck          # TypeScript 类型检查
```

### 11.5 访问

```
主界面:   http://localhost:3000        (旧版 v0.8 Dao 引擎)
React 应用: http://localhost:5173      (Vite dev server)
健康检查: http://localhost:3000/health
API 测试: http://localhost:3000/api/test
```

### 11.6 首次使用

1. 打开 React 应用 (`http://localhost:5173`)
2. 进入「模型与API」设置页面
3. 选择 AI 提供商 (Gemini/OpenAI/DeepSeek 等)
4. 填入 API Key
5. 进入「人格设定」选择或自定义人格
6. 进入「对话测试」开始对话

---

## 12. 开发指南

### 12.1 目录规范

```
src/
├── lib/          # 核心引擎库 (无 React 依赖)
├── store/        # Zustand 状态管理
├── components/   # 可复用 UI 组件
│   ├── ui/       # 基础 UI (Button, Card, Input, ToggleSwitch)
│   ├── forms/    # 表单组件 (Combobox)
│   └── overlays/ # 覆盖层 (TimelineViewer, CognitiveObservatory)
├── views/        # 页面视图
│   └── XxxView/  # 大型视图可包含子组件
├── types/        # 全局类型定义
├── data/         # Mock 数据
├── styles/       # 主题配置
└── curiosity/    # 好奇心引擎 (独立模块)
```

### 12.2 代码规范

- **命名**: camelCase 变量/函数, PascalCase 类/组件/接口, UPPER_SNAKE 常量
- **导出**: 命名导出优先，默认导出仅用于页面组件
- **类型**: 所有公开 API 必须有 TypeScript 类型
- **注释**: 中文注释 + JSDoc，核心算法注明数学公式
- **单文件行数**: 控制在 800 行内 (当前 server.ts 例外，待重构)

### 12.3 添加新功能

**添加新的情感**:
1. 在 `EMOTION_ATTRACTORS` 中添加吸引子坐标
2. 在 `EMOTION_MEMORY_KEYWORDS` 中添加关联关键词
3. 在 `emotionLabels` 中添加中文标签

**添加新的 AI 提供商**:
1. 在 `useAIBrainStore.ts` 的 `Provider` 类型中添加
2. 在 SettingsView 的 ProviderSettings 中添加选项
3. 在 `aiProvider.ts` 中添加 provider 分支

**添加新的 TTS 引擎**:
1. 在 `TTSSettings.provider` 中添加
2. 在 `ttsProvider.ts` 的 `generateSpeech` 中添加分支

### 12.4 调试

```bash
# 查看认知事件流
curl http://localhost:3000/api/events?n=50

# 查看情感状态
curl http://localhost:3000/state

# 查看可观测性指标
curl http://localhost:3000/api/metrics

# 查看好奇心引擎状态
curl http://localhost:3000/api/curiosity

# 手动触发探索
curl -X POST http://localhost:3000/api/explore

# 查看身份叙事
curl http://localhost:3000/api/identity

# 查看情景记忆
curl http://localhost:3000/api/memories?limit=10

# 模拟事件
curl -X POST http://localhost:3000/event \
  -H 'Content-Type: application/json' \
  -d '{"text": "你今天真好看"}'
```

### 12.5 已知技术债务

| 项目 | 优先级 | 说明 |
|------|--------|------|
| **server.ts 接入 aiCoordinator** | ✅ 已实现 | aiCoordinator 管道已接入 server.ts 对话流：危机检测覆盖策略 + 思维图谱注入 workspace + 桥接函数适配新旧状态格式 (2026-06-16) |
| **server.ts 拆分** | 🔴 高 | 5811行单体服务器，需迁移到 `server/` 模块化架构 |
| **S5/S8 强连接激活** | 🟡 中 | pipelineHooks 胶水代码已写好，需在回复管道中接入 |
| **S7 价值→策略连接** | ✅ 已实现 | extractActiveValues() -> StrategyContext -> 价值观调制策略权重 |
| **W7/W8 弱连接** | ✅ 已实现 | coordinator 管道中 conflict->repair + pendingDiscoveries->share 已串联 |
| **emotionEngine alpha 动态化** | 🟢 低 | S6 仅完成 lossAversion 个性化，alpha 值仍为全局常量 |
| **global state 消除** | 🟢 低 | `curiosity/` 模块仍有模块级依赖注入变量 |
| **public/index.html** | ✅ 已修复 | 旧版 v0.8 原型已删除 (2026-06-16) |
| **data/ 清理** | 🟢 低 | 45MB root-owned 文件，需 `sudo rm -rf data/`（跳过，无 sudo 权限） |
| **emotionOptimizer 注释偏差** | ✅ 已修复 | `computeArousalUpdate` L85 注释写"唤醒适度降低（放松）"，但公式 `alphaA * error * 0.8` 在 error>0 时产出正增量（唤醒上升）。实际语义：正面事件也提升唤醒，只是幅度为负面的 80%。2026-06-16 修正注释。 |
| **情绪引擎冒烟测试** | ✅ 已实现 | `scripts/ci/` 独立可执行，不依赖 Claude Code |
| **风险关键词检测** | ✅ 已实现 | conflictManager.ts 新增 crisis 阶段，检测自伤/自杀/绝望信号，优先于所有策略 |
| **Cognitive Dissonance** | ✅ 已实现 | 活跃失调注入 workspace + 两难引导提示 (2026-06-16) |
| **Shadow Layer** | 🟢 低 | 潜意识人格层（不愿承认的倾向），依赖 Thought Graph + Dissonance 的数据积累后才能构建。 |

---

## 13. 版本历史与路线图

### 13.1 版本历史

| 版本 | 日期 | 重大变更 |
|------|------|---------|
| **v0.1** | 2025-04 | 太极核心方程 (效价/唤醒/预期 三元组) |
| **v0.2** | 2025-04 | 极值反转、道歉信用系统、taiji-core.ts 原型 |
| **v0.3** | 2025-05 | 三才 A/B/R 动力学、九情吸引子景观 |
| **v0.4** | 2025-05 | 预测误差统一方程、三时间尺度演化 |
| **v0.5** | 2025-05 | React 前端、Firebase 集成、多 AI 提供商 |
| **v0.6** | 2025-05 | 好奇心引擎 v4.0、事件总线 v5.0、可观测性 v1.0 |
| **v0.7** | 2025-05 | 情景记忆 v1.0、价值发现 v1.0、身份叙事 v1.0 |
| **v0.8** | 2026-05 | 认知观测台 v3、模式发现引擎、因果归因引擎、趋势追踪器 |
| **v0.9** 🆕 | 2026-05-31 | 对话策略引擎、冲突检测修复、情境感知层、节奏控制器、情感算法补丁(v4.1)、记忆增强系统、模块连接规范(18条)、AI协调器、63单元测试 |

### 13.2 路线图

| 里程碑 | 预计 | 目标 |
|--------|------|------|
| **v0.9.1** | 2026-06 | server.ts 接入 aiCoordinator：激活 S5/S8 强连接 |
| **v0.10** | 2026-Q2 | server.ts 完成模块化拆分；S7/W7/W8 连接实现 |
| **v1.0** | 2026-Q3 | 产品化发布：Docker 部署、CI/CD、监控面板 |
| **v1.1** | 2026-Q3 | 多模态支持：图像理解、语音输入 |
| **v1.2** | 2026-Q4 | 本地模型支持 (Ollama/Llama) |
| **v2.0** | 2027 | 多 AI Agent 协作、家庭 IoT 深度集成 |

---

## 附录 A: 核心常量速查

```typescript
// ── 情感引擎 v4.0 ──
ALPHA_V = 0.30          // 效价更新速率
ALPHA_A = 0.20          // 唤醒更新速率
ALPHA_E = 0.10          // 预期更新速率 (慢：弱者道之用)
REVERSAL_RATE = 0.08    // 极值反转速率
EXTREMITY_THRESHOLD = 0.7 // 极值阈值
COUPLING_BASE = 0.20    // A-B 交叉抑制
ATTRACTOR_SENS = 3.0    // 吸引子敏感度

// ── 情感引擎 v4.1 补丁 🆕 ──
USE_EMOTION_OPTIMIZER = true  // 特性开关：设为 false 一秒回退 v4.0
AROUSAL_POSITIVITY_FACTOR = 0.8  // 正面惊喜唤醒系数 (v4.0: 0.5)
AROUSAL_MIN_HEADROOM = 0.1      // 唤醒最小上升空间 (v4.0: 无)
BASELINE_AROUSAL = 0.25         // 唤醒基线回归目标
EMOTION_SMOOTHING_FACTOR = 0.7  // 九情 EMA 平滑系数 (70%当前+30%历史)
REVERSAL_PHASE2_FACTOR = 0.4    // Phase2 翻转因子 (v4.0: 0.6)

// ── 对话策略引擎 🆕 ──
HIGH_EMOTION_THRESHOLD = 0.7     // 触发 empathize 的情绪强度阈值
CONSECUTIVE_NEGATIVE_REDIRECT = 3 // 连续负面轮数触发 redirect
POSITIVE_IDLE_SHARE = 0.1         // 效价高于此视为情绪平稳可分享

// ── 冲突检测 🆕 ──
WARNING_THRESHOLD = 3             // 累积信号数触发 warning
CONFLICT_THRESHOLD = 5            // 累积信号数确认 conflict
SIGNAL_DECAY_MS = 30 * 60_000     // 30分钟后信号衰减
TRUST_DAMAGE_PER_CONFLICT = 0.15  // 每次冲突累积信任损伤
TRUST_RESTORE_PER_REPAIR = 0.05   // 成功修复恢复信任

// ── 节奏控制器 🆕 ──
MAX_PROACTIVE_PER_DAY = 2         // 24h内主动消息上限
MIN_PROACTIVE_INTERVAL_MIN = 120  // 两次主动消息最小间隔(分钟)
PROACTIVE_TIME_WINDOW = [9, 22]   // 主动消息适宜时间窗口

// ── 记忆增强 🆕 ──
BASE_HALF_LIFE_HOURS = 72         // 艾宾浩斯基础半衰期
RECALL_BOOST_FACTOR = 1.5         // 每次回忆延长半衰期 50%
MIN_RETENTION_WEIGHT = 0.05       // 最小保留权重 (不会完全遗忘)

// ── 好奇心引擎 ──
EXPLORATION_CYCLE_MS = 30 * 60 * 1000  // 30分钟
EXPLORATION_IDLE_MIN = 10              // 空闲10分钟后启动
EXPLORATION_DAILY_CAP = 8              // 每日上限8次
MAX_DISCOVERIES = 200                  // 最大存储200条
DISCOVERY_SHARE_QUALITY = 0.5          // 分享质量阈值

// ── 兴趣管理 ──
INTEREST_STABILITY = {
  identity: 0.995,    // 身份级 (宠物、美食)
  hobby: 0.985,       // 爱好级 (摄影、音乐)
  transient: 0.94,    // 短暂级 (旅行、电影)
}

// ── 情景记忆 ──
DELTA_VALENCE_THRESHOLD = 0.25  // 形成记忆的效价变化阈值
AROUSAL_PEAK_THRESHOLD = 0.7    // 形成记忆的唤醒峰值阈值

// ── 可观测性 ──
VALENCE_BUFFER_SIZE = 100       // 效价环形缓冲区
NLU_WINDOW_MS = 3600_000        // NLU 滑动窗口 (1小时)
ECHO_CHAMBER_THRESHOLD = 5      // 回声室熔断阈值
```

## 附录 B: 九情吸引子坐标

| 情感 | valence | arousal | bias | 颜色 |
|------|---------|---------|------|------|
| joy 喜 | 0.75 | 0.70 | 0.60 | #f1c40f |
| calm 静 | 0.40 | 0.15 | 0.10 | #2ecc71 |
| sad 悲 | -0.65 | -0.30 | -0.50 | #3498db |
| fear 惧 | -0.70 | 0.80 | -0.70 | #9b59b6 |
| anger 怒 | -0.60 | 0.75 | -0.40 | #e74c3c |
| love 爱 | 0.80 | 0.55 | 0.75 | #e91e63 |
| disgust 厌 | -0.55 | 0.35 | -0.60 | #1abc9c |
| lust 欲 | 0.60 | 0.85 | 0.50 | #ff6b6b |
| greed 贪 | 0.30 | 0.60 | 0.40 | #f39c12 |

---

> *"道可道，非常道；名可名，非常名。"*
>
> 这个项目的目标不是制造一个完美的 AI，而是创造一个**有灵魂的陪伴**。
> 情感不是 bug，是 feature；矛盾不是缺陷，是真实。
