# AI Friend

一个以本地单用户为主的 AI 桌宠与情感陪伴实验项目。应用将对话、情绪状态、记忆、角色活动和桌宠界面组合在一起，重点是让行为有可检查的来源，并通过固定场景、回放和消融评估改动。

项目中的“情感”指软件内部状态模型和角色表达策略，不代表系统具有主观体验。情绪判断是对用户状态的推断，允许不确定或未知；角色状态与用户情绪需要分开记录和验证。

## 当前状态

- 桌面端使用 Electron，界面使用 React，后端使用本地 Node.js 服务。
- 支持接入模型服务；API 密钥应保存在本机 `.env` 或应用设置中，不要提交到仓库。
- 双环情感模型已有离线 demo、回放和影子评估工具。当前评估路径不等同于已验证的生产情感机制，也不能据此声称 AI 拥有真实情感。
- 项目仍在开发中。桌宠动作、Windows 发布验证、情感评估的独立留出集和公开材料清理仍有未完成项。

## 双环情感实验 Demo

[打开双环情感模型 Demo v0.7](artifacts/emotion-learning/dual-loop-emotion-demo-v0.7.html)。这是用于说明现有写入路径、影子桥和未决边界的交互演示，不调用模型 API，也不证明模型质量或双环带来的效果提升。旁证见同目录的[当前写入链审计](artifacts/emotion-learning/current-emotion-write-path-audit-v1.md)、[验证记录](artifacts/emotion-learning/current-emotion-write-path-verification-v1.md)和[架构设计稿](artifacts/emotion-learning/dual-loop-emotion-architecture-v1.md)。

## 本地开发

需要安装 Node.js 和 npm。首次运行：

```powershell
npm install
Copy-Item .env.example .env
```

在 `.env` 中按需填写模型服务配置。密钥不要放进源码、截图、测试结果或 Git 提交。

启动本地服务：

```powershell
npm run dev
```

桌宠开发入口：

```powershell
npm run desktop:pet
```

完整质量检查：

```powershell
npm run quality:gate
```

Windows 便携包构建：

```powershell
npm run package:win:portable
```

目前发布配置不包含代码签名证书；Windows 可能显示未知发布者提示。

## 目录

- `src/` — React 界面、情感与记忆逻辑
- `server/` — 本地 API、对话编排、持久化和工具服务
- `desktop/` — Electron 桌宠主进程与窗口控制
- `scripts/` — 评估、数据治理、安全检查和打包脚本
- `docs/` — 设计、审查和项目记录
- `artifacts/` — 分阶段实验材料；公开前只应加入已审查的汇总和可复用夹具

## 隐私与公开边界

仓库是公开的。不要提交 `.env`、本机记忆、窗口/活动记录、用户原话、同意参与者的原始数据、盲评答案键或未审阅的模型输出。提交前运行 `git status --short` 并检查暂存区：

```powershell
git diff --cached --stat
git diff --cached --name-only
```

API 密钥、运行时数据和盲评答案键不属于项目源码。
