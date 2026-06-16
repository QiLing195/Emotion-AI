#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
# AI 女友 · 全量检查（独立可执行版）
# ════════════════════════════════════════════════════════════════
#
# 依次运行所有检查脚本，聚合结果。
# 适合 CI/CD 流水线或 pre-push hook 使用。
#
# 用法:
#   bash scripts/ci/all.sh
#   bash scripts/ci/all.sh --skip-smoke   # 跳过需要服务运行的检查
#   bash scripts/ci/all.sh --ci           # CI 模式：严格 + 输出 JUnit 兼容格式
# ════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/../.."

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

FAILED_SCRIPTS=()
PASSED_SCRIPTS=()

run_check() {
  local name="$1"
  local script="$2"
  echo ""
  echo "╔══════════════════════════════════════════╗"
  echo "║  $name"
  echo "╚══════════════════════════════════════════╝"
  if bash "$script"; then
    PASSED_SCRIPTS+=("$name")
    echo -e "${GREEN}✅ $name 通过${NC}"
  else
    FAILED_SCRIPTS+=("$name")
    echo -e "${RED}❌ $name 失败${NC}"
  fi
}

# ── 核心检查（始终运行） ──
run_check "安全扫描" "scripts/ci/safety-check.sh"
run_check "情感引擎一致性" "scripts/ci/emotion-check.sh"

# ── 全量质量门控 ──
run_check "质量门控" "scripts/ci/quality-gate.sh"

# ── 汇总 ──
echo ""
echo "═══════════════════════════════════════════"
echo "  检查汇总"
echo "═══════════════════════════════════════════"
echo "通过: ${#PASSED_SCRIPTS[@]}"
for s in "${PASSED_SCRIPTS[@]}"; do
  echo -e "  ${GREEN}✅${NC} $s"
done
if [ ${#FAILED_SCRIPTS[@]} -gt 0 ]; then
  echo "失败: ${#FAILED_SCRIPTS[@]}"
  for s in "${FAILED_SCRIPTS[@]}"; do
    echo -e "  ${RED}❌${NC} $s"
  done
  echo ""
  echo -e "${RED}❌ 全量检查未通过${NC}"
  exit 1
else
  echo ""
  echo -e "${GREEN}✅ 全量检查通过${NC}"
  exit 0
fi
