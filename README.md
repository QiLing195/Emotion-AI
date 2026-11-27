# Emotion-AI

基于罗素效价—唤醒度环形模型（Russell's Circumplex Model of Affect）的交互式情绪映射、AI 情绪分析与双环影子门控实验工作台。

> **核心工程与设计手册**：
> - **双环情感模型设计蓝图（交由 Codex 编码专用，飞机维修手册体例）**：[docs/DUAL-LOOP-EMOTION-DESIGN-MANUAL.md](docs/DUAL-LOOP-EMOTION-DESIGN-MANUAL.md)
> - **当前工作台运维手册（AMM）**：[docs/EMOTION-AI-AMM.md](docs/EMOTION-AI-AMM.md)

## 核心功能

- **效价—唤醒度环形平面**：支持鼠标点击、拖拽及键盘方向键定位 `[-1.00, +1.00]` 情绪坐标，实时显示象限、强度与最近词库锚点。
- **服务端 AI 情绪分析**：经由 Express 服务端 `POST /api/analyze-emotion` 调用 `@google/genai`（`gemini-4-hydrogen`）返回结构化效价、唤醒度、中文情绪标签与判断依据。
- **完整数据集管理**：支持标注新建、编辑、删除、搜索、按象限筛选、重置示例，以及中英文表头兼容的 CSV / JSON 导入导出。
- **双环契约与影子门控（v2.0）**：在 `src/data/dualLoopContract.ts` 中实现了含危机短路、拒绝优先、主体/报告者隔离、角色宪章校验与幂等纠正的纯函数影子判定门（`proposedStateDelta = 0`）。

## 快速启动

1. 安装依赖：
   ```bash
   npm install
   ```
2. 配置服务端环境变量（参见 `.env.example`）：
   ```bash
   GEMINI_API_KEY=your_api_key
   ```
3. 启动全栈开发服务器（监听 `0.0.0.0:3000`）：
   ```bash
   npm run dev
   ```

## 常用维护命令

- `npm run dev` — 启动 Express + Vite 开发服务（`0.0.0.0:3000`）
- `npm run build` — 编译生产前端资源至 `dist/`
- `npm run start` — 以生产模式启动 Node 服务
- `npm run lint` — 执行全仓 TypeScript 严格类型检查
- `npm test` — 运行 Vitest 单元测试套件（词库运算 + 导入导出 + 双环门控）