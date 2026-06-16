# 代码健康标准

## 文件规模

| 指标 | 上限 | 当前超标文件 |
|------|------|-------------|
| 单文件行数 | ≤ 800 | server.ts (6514行), emotionEngine.ts (1484行), eventBus.ts (1170行) |
| 单函数行数 | ≤ 50 | — |
| 嵌套深度 | ≤ 4 层 | — |

## 文件组织

- `src/lib/` — 纯引擎逻辑，无 React 依赖，无 DOM 引用
- `src/curiosity/` — 好奇心引擎，独立模块，可单独测试
- `src/store/` — Zustand 状态管理
- `src/views/` — 页面级组件，大型视图可含子目录
- `src/components/ui/` — 基础 UI 组件
- `src/components/forms/` — 表单组件
- `src/components/overlays/` — 覆盖层组件

## 命名规范

- 变量/函数：camelCase
- 类/组件/接口：PascalCase
- 常量：UPPER_SNAKE
- 文件名/目录名：camelCase（与导出内容一致）
- 测试文件：`*.test.ts`，与被测文件同目录

## 导出规范

- 命名导出优先于默认导出
- 默认导出仅用于页面组件（`src/views/` 和 `App.tsx`）
- 所有公开 API 必须有 TypeScript 类型

## 注释规范

- 核心算法用中文 + JSDoc，注明数学公式
- 情感引擎的公式说明不可删除（关联论文/设计文档）
- 模块连接（`moduleConnections.ts`）的连接定义必须保持注释与代码同步

## 禁止的操作

- `any` 类型（除非有注释说明原因）
- `console.log` 在生产代码中（使用 `metrics.ts` 的 Collector 记录日志）
- 直接 `process.env` 访问（应集中在配置文件）
- 在 `src/lib/` 中导入 React 依赖
- 创建新的全局单例而不在 `moduleConnections.ts` 中注册
