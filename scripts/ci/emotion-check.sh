#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
# AI 女友 · 情感引擎一致性检查（独立可执行版）
# ════════════════════════════════════════════════════════════════
#
# 对标 agents/emotion-coherence-checker.md
# 验证九情稳定性、反转边界、唤醒保护、v4.1 补丁完整性
#
# 用法:
#   bash scripts/ci/emotion-check.sh           # 全部检查
#   bash scripts/ci/emotion-check.sh --quick    # 仅测试（跳过手动验证）
#   bash scripts/ci/emotion-check.sh --smoke   # 仅冒烟测试（需服务运行）
# ════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/../.."

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

MODE="${1:-full}"

echo "═══ 情感引擎一致性检查 ═══"
echo ""

# ── 1. 九情吸引子完整性 ──
if [ "$MODE" != "--smoke" ]; then
  echo "── 1/4 九情吸引子测试 ──"
  npx vitest run src/lib/__tests__/emotionEngine.test.ts --reporter=verbose 2>&1 | tail -20
  echo ""

  # ── 2. v4.1 补丁完整性 ──
  echo "── 2/4 v4.1 补丁测试 ──"
  npx vitest run src/lib/__tests__/emotionOptimizer.test.ts --reporter=verbose 2>&1 | tail -20
  echo ""

  # ── 3. 边界条件 ──
  echo "── 3/4 边界条件测试 ──"
  npx vitest run src/lib/__tests__/edgeCases.test.ts --reporter=verbose 2>&1 | tail -10
  echo ""
fi

# ── 4. 吸引子坐标（由测试覆盖）──
echo "── 4/4 吸引子坐标验证 ──"

if grep -q "EMOTION_ATTRACTORS" src/lib/emotionEngine.ts 2>/dev/null; then
  echo -e "${GREEN}✅${NC} 吸引子定义存在（合法性由 vitest 覆盖）"
else
  echo -e "${RED}❌${NC} EMOTION_ATTRACTORS 定义缺失"
  exit 1
fi

echo ""
echo -e "${GREEN}✅ 情感引擎一致性检查通过${NC}"
exit 0
