#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
# AI 女友 · 质量门控（独立可执行版）
# ════════════════════════════════════════════════════════════════
#
# 对标 .claude/skills/ai-girlfriend-quality-gate/SKILL.md
# 不依赖 Claude Code，可在任何环境运行：
#   - CI/CD 流水线
#   - pre-commit / pre-push hook
#   - 手动执行：bash scripts/ci/quality-gate.sh
#
# 退出码 0 = 全部通过，非 0 = 有失败项
# ════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/../.."

PASS=0
FAIL=0
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅ PASS${NC} $*"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}❌ FAIL${NC} $*"; FAIL=$((FAIL+1)); }
warn() { echo -e "${YELLOW}⚠️  WARN${NC} $*"; }
section() { echo ""; echo "━━━ $* ━━━"; }

# ════════════════════════════════════════════════════════════════
# Phase 1: TypeScript 类型检查
# ════════════════════════════════════════════════════════════════
section "Phase 1: TypeScript 类型检查"

if npx tsc --noEmit 2>&1; then
  pass "类型检查通过"
else
  fail "类型检查有错误"
fi

# ════════════════════════════════════════════════════════════════
# Phase 2: 测试套件
# ════════════════════════════════════════════════════════════════
section "Phase 2: 测试套件"

if npx vitest run --reporter=verbose 2>&1; then
  pass "全部测试通过"
else
  fail "部分测试未通过"
fi

# ════════════════════════════════════════════════════════════════
# Phase 3: 安全扫描
# ════════════════════════════════════════════════════════════════
section "Phase 3: 安全扫描"

# 3a: 硬编码密钥检查
SECRET_COUNT=$(grep -rn "sk-\|AIza[0-9A-Za-z\-_]\{20,\}" --include="*.ts" --include="*.tsx" src/ server/ server.ts 2>/dev/null \
  | grep -v "process.env" \
  | grep -v "\.env" \
  | grep -v "safetySetting" \
  | grep -v "your_" \
  | wc -l)

if [ "$SECRET_COUNT" -eq 0 ]; then
  pass "无硬编码密钥"
else
  fail "发现 $SECRET_COUNT 处疑似硬编码密钥"
  grep -rn "sk-\|AIza[0-9A-Za-z\-_]\{20,\}" --include="*.ts" --include="*.tsx" src/ server/ server.ts 2>/dev/null \
    | grep -v "process.env" \
    | grep -v "\.env" \
    | grep -v "safetySetting" \
    | grep -v "your_"
fi

# 3b: .env 在 .gitignore 中
if grep -q "\.env" .gitignore 2>/dev/null; then
  pass ".env 在 .gitignore 中"
else
  fail ".env 不在 .gitignore 中"
fi

# 3c: console.log 统计（仅计数，不阻塞）
CONSOLE_COUNT=$(grep -rn "console\.log" --include="*.ts" --include="*.tsx" src/ server/ 2>/dev/null | wc -l || echo 0)
if [ "$CONSOLE_COUNT" -gt 0 ]; then
  warn "发现 $CONSOLE_COUNT 个 console.log 残留（已知技术债，不阻塞）"
else
  pass "无 console.log 残留"
fi

# ════════════════════════════════════════════════════════════════
# Phase 4: 情感引擎冒烟测试（需要服务在运行）
# ════════════════════════════════════════════════════════════════
section "Phase 4: 情感引擎冒烟测试"

HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null || echo "000")
if [ "$HEALTH" = "200" ]; then
  STATE=$(curl -s http://localhost:3000/state 2>/dev/null)
  if [ -n "$STATE" ]; then
    VALENCE=$(echo "$STATE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['valence'])" 2>/dev/null)
    AROUSAL=$(echo "$STATE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['arousal'])" 2>/dev/null)
    if [ -n "$VALENCE" ] && [ -n "$AROUSAL" ]; then
      VALID=$(python3 -c "
v=float('$VALENCE'); a=float('$AROUSAL')
ok = (-1 <= v <= 1) and (0 <= a <= 1)
print('ok' if ok else 'invalid')
")
      if [ "$VALID" = "ok" ]; then
        pass "情感状态合法 (valence=$VALENCE, arousal=$AROUSAL)"
      else
        fail "情感状态越界 (valence=$VALENCE, arousal=$AROUSAL)"
      fi
    else
      warn "无法解析 /state 响应，服务可能未就绪"
    fi
  fi
else
  warn "服务未运行 (port 3000)，跳过冒烟测试"
  echo "   启动方式: npm run dev"
fi

# ════════════════════════════════════════════════════════════════
# Phase 5: 模块连接健康检查
# ════════════════════════════════════════════════════════════════
section "Phase 5: 模块连接健康检查"

if [ "$HEALTH" = "200" ]; then
  METRICS=$(curl -s http://localhost:3000/api/metrics 2>/dev/null)
  if [ -n "$METRICS" ]; then
    pass "可观测性端点正常"
  else
    warn "无法获取 metrics"
  fi

  STRATEGY=$(curl -s http://localhost:3000/api/strategy 2>/dev/null)
  if [ -n "$STRATEGY" ]; then
    pass "策略端点正常"
  else
    warn "无法获取 strategy"
  fi
else
  warn "服务未运行，跳过模块连接检查"
fi

# ════════════════════════════════════════════════════════════════
# 结果汇总
# ════════════════════════════════════════════════════════════════
section "结果汇总"

echo "通过: $PASS  失败: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo -e "${RED}❌ 质量门控未通过 — $FAIL 项失败${NC}"
  exit 1
else
  echo ""
  echo -e "${GREEN}✅ 质量门控全部通过${NC}"
  exit 0
fi
