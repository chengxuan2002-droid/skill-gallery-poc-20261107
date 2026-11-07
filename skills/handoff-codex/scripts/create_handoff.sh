#!/usr/bin/env bash
set -euo pipefail

# Usage: create_handoff.sh [project_root]
# Creates a handoff markdown file in <project_root>/handoff/
# Outputs the created file path to stdout.

PROJECT_ROOT="${1:-$(pwd)}"
HANDOFF_DIR="${PROJECT_ROOT}/handoff"
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
FILENAME="handoff-${TIMESTAMP}.md"
FILEPATH="${HANDOFF_DIR}/${FILENAME}"

mkdir -p "${HANDOFF_DIR}"

cat > "${FILEPATH}" << 'TEMPLATE_EOF'
# 交接文档

> 生成时间：PLACEHOLDER_TIMESTAMP

## 1. 现在做什么

<!-- 当前正在进行的任务和上下文 -->

## 2. 已经完成了什么

<!-- 已完成的工作、关键决策、产出物 -->

## 3. 卡在哪里

<!-- 当前的阻塞点、未解决的问题、不确定的地方 -->

## 4. 下一步做什么

<!-- 后续行动计划、优先级、待办事项 -->

## 5. 哪些坑不要再踩

<!-- 已踩过的坑、需要注意的细节、容易出错的地方 -->
TEMPLATE_EOF

# Replace placeholder with actual timestamp
sed -i '' "s/PLACEHOLDER_TIMESTAMP/${TIMESTAMP}/g" "${FILEPATH}"

echo "${FILEPATH}"
