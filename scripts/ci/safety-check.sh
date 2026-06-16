#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
# AI 女友 · 安全扫描（独立可执行版）
# ════════════════════════════════════════════════════════════════
#
# 对标 agents/persona-safety-guardian.md + rules/api-security.md
# 检查密钥泄漏、人格越界、角色泄露、安全过滤
#
# 用法:
#   bash scripts/ci/safety-check.sh
#   bash scripts/ci/safety-check.sh --strict   # 严格模式，console.log 也阻塞
# ════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/../.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

STRICT="${1:-}"
HAS_CRITICAL=0

echo "═══ 安全扫描 ═══"
echo ""

# ── 1. 硬编码密钥 ──
echo "── 1/6 密钥泄漏检查 ──"
SECRETS=$(grep -rn "sk-[a-zA-Z0-9]\{20,\}\|AIza[0-9A-Za-z\-_]\{35\}\|api_key\s*[:=]\s*[\"'][^\"']\{10,\}" \
  --include="*.ts" --include="*.tsx" --include="*.js" src/ server/ server.ts 2>/dev/null \
  | grep -v "process.env" \
  | grep -v "\.env" \
  | grep -v "safetySetting" \
  | grep -v "your_" \
  | grep -v "example" \
  || true)

if [ -z "$SECRETS" ]; then
  echo -e "${GREEN}✅${NC} 无硬编码密钥"
else
  echo -e "${RED}❌${NC} 疑似硬编码密钥："
  echo "$SECRETS"
  HAS_CRITICAL=1
fi

# ── 2. AI 身份泄露 ──
echo "── 2/6 AI 身份泄露检查 ──"
IDENTITY_LEAKS=$(grep -rn "我是AI\|我是人工智能\|as an AI\|language model\|我是机器人" \
  --include="*.ts" --include="*.tsx" src/lib/dialogueStrategy.ts 2>/dev/null || true)
if [ -z "$IDENTITY_LEAKS" ]; then
  echo -e "${GREEN}✅${NC} 策略 Prompt 中无身份泄露"
else
  echo -e "${RED}❌${NC} 策略 Prompt 中有身份泄露："
  echo "$IDENTITY_LEAKS"
  HAS_CRITICAL=1
fi

# ── 3. 原始数据泄露（检查回复生成路径中是否输出 raw valence/arousal）──
echo "── 3/6 原始状态数据泄露检查 ──"
STATE_LEAKS=$(grep -rn "res\.\(send\|json\).*valence\|res\.\(send\|json\).*arousal" \
  --include="*.ts" server.ts 2>/dev/null || true)
if [ -z "$STATE_LEAKS" ]; then
  echo -e "${GREEN}✅${NC} 回复路径中无原始状态数据泄露"
else
  echo -e "${RED}❌${NC} 回复中包含原始状态数据："
  echo "$STATE_LEAKS"
  HAS_CRITICAL=1
fi

# ── 4. 安全过滤配置 ──
echo "── 4/6 安全过滤配置检查 ──"
SAFETY_FILES=$(grep -rl "HARM_CATEGORY\|BLOCK_MEDIUM" --include="*.ts" src/lib/aiProvider.ts server.ts server/ 2>/dev/null || true)
SAFETY_COUNT=$(echo "$SAFETY_FILES" | grep -c "ts" || echo 0)
if [ "$SAFETY_COUNT" -ge 1 ]; then
  echo -e "${GREEN}✅${NC} 安全过滤已配置（在 $(echo "$SAFETY_FILES" | tr '\n' ' ')中）"
else
  echo -e "${RED}❌${NC} 安全过滤配置缺失"
  HAS_CRITICAL=1
fi

# ── 5. console.log 残留 ──
echo "── 5/6 console.log 残留检查 ──"
CONSOLE_COUNT=$(grep -rn "console\.log" --include="*.ts" --include="*.tsx" src/ server/ 2>/dev/null | wc -l || echo 0)
if [ "$CONSOLE_COUNT" -eq 0 ]; then
  echo -e "${GREEN}✅${NC} 无 console.log 残留"
elif [ "$STRICT" = "--strict" ]; then
  echo -e "${RED}❌${NC} 严格模式：发现 $CONSOLE_COUNT 个 console.log"
  HAS_CRITICAL=1
else
  echo -e "${YELLOW}⚠️${NC} 发现 $CONSOLE_COUNT 个 console.log（已知技术债）"
fi

# ── 6. .env 保护 ──
echo "── 6/6 .env 保护 ──"
if grep -q "\.env" .gitignore 2>/dev/null; then
  echo -e "${GREEN}✅${NC} .env 在 .gitignore 中"
else
  echo -e "${RED}❌${NC} .env 不在 .gitignore 中"
  HAS_CRITICAL=1
fi

# ── 汇总 ──
echo ""
if [ "$HAS_CRITICAL" -eq 1 ]; then
  echo -e "${RED}❌ 安全扫描未通过 — 存在严重问题${NC}"
  exit 1
else
  echo -e "${GREEN}✅ 安全扫描通过${NC}"
  exit 0
fi
