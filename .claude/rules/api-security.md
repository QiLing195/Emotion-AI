# API 安全规范

> 每次修改 `server.ts` 或 `server/` 目录下的文件时必须遵循。

## 密钥管理

### 绝对禁止
```typescript
const apiKey = "sk-xxxxx"  // ❌ 硬编码密钥
const dbPassword = "mypass" // ❌ 明文密码
```

### 正确做法
```typescript
const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) throw new Error('GEMINI_API_KEY not configured')
```

### 启动时检查
所有必需的环境变量必须在 server.ts 启动时验证：
- `GEMINI_API_KEY` 或 `OPENAI_API_KEY`（至少一个 AI 提供商）
- `PORT`（默认 3000）

## API 端点规范

### 输入验证
- 所有 `/api/*` 端点的用户输入必须验证
- 使用 Zod schema 或手动类型守卫
- 不允许 `as any` 绕过类型检查

### Rate Limiting（待实现）
- `/api/chat`：每分钟最多 20 次
- `/api/explore`：每分钟最多 5 次
- 超限返回 429 + `Retry-After` 头

### 错误响应格式
```typescript
{
  success: false,
  error: {
    code: "RATE_LIMITED" | "INVALID_INPUT" | "AI_PROVIDER_ERROR",
    message: "用户可读的错误描述"
  }
}
// 不得在 error.message 中暴露：
// - 堆栈跟踪
// - API 密钥片段
// - 内部文件路径
// - Firestore 集合名称
```

## 数据隔离

- Firestore 读写必须通过 `src/lib/firestore-error.ts` 的错误包装
- `.env` 文件已在 `.gitignore` 中
- `memories/` 目录已在 `.gitignore` 中
- `firebase-applet-config.json` 不得包含生产凭证

## 修改 server.ts / server/ 后必须验证

```bash
# 类型检查
npx tsc --noEmit 2>&1 | head -20

# 启动测试
curl -s http://localhost:3000/health

# 检查无密钥泄漏
grep -rn "sk-\|api_key\|apiKey\|secret" --include="*.ts" src/ server/ \
  | grep -v "process.env" \
  | grep -v "\.env" \
  | grep -v "safetySettings"
```
