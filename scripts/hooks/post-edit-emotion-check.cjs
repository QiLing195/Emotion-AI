#!/usr/bin/env node
/**
 * post-edit-emotion-check.js
 *
 * 对标 ECC 的 post:edit:accumulator — 检测本次修改的文件并自动运行对应测试。
 *
 * 逻辑：
 * - 读取 stdin（Claude Code Stop hook 传入的会话摘要 JSON）
 * - 检查最近的编辑操作涉及哪些文件
 * - 根据文件路径匹配对应的测试套件
 * - 自动运行相关测试并输出结果
 */

const { execSync } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// 文件路径 → 测试套件映射
const TEST_MAP = [
  {
    pattern: /src\/lib\/emotion(Engine|Optimizer)\.ts/,
    tests: ['src/lib/__tests__/emotionEngine.test.ts', 'src/lib/__tests__/emotionOptimizer.test.ts'],
    label: '情感引擎测试'
  },
  {
    pattern: /src\/lib\/dialogueStrategy\.ts/,
    tests: ['src/lib/__tests__/dialogueStrategy.test.ts'],
    label: '对话策略测试'
  },
  {
    pattern: /src\/lib\/conflictManager\.ts/,
    tests: ['src/lib/__tests__/conflictManager.test.ts'],
    label: '冲突管理测试'
  },
  {
    pattern: /src\/lib\/contextAwareness\.ts/,
    tests: ['src/lib/__tests__/contextAwareness.test.ts'],
    label: '情境感知测试'
  },
  {
    pattern: /src\/lib\/rhythmController\.ts/,
    tests: ['src/lib/__tests__/rhythmController.test.ts'],
    label: '节奏控制测试'
  },
  {
    pattern: /src\/lib\/episodicMemory\.ts/,
    tests: ['src/lib/__tests__/episodicMemory.test.ts'],
    label: '情景记忆测试'
  },
  {
    pattern: /src\/lib\/moduleConnections\.ts/,
    tests: ['src/lib/__tests__/emotionEngine.test.ts', 'src/lib/__tests__/emotionOptimizer.test.ts',
            'src/lib/__tests__/dialogueStrategy.test.ts', 'src/lib/__tests__/conflictManager.test.ts'],
    label: '模块连接全量测试'
  },
  {
    pattern: /server\.ts/,
    tests: null, // server.ts 没有单元测试，改用类型检查
    label: '服务器类型检查',
    typecheck: true
  },
  {
    pattern: /src\/curiosity\//,
    tests: ['src/curiosity/__tests__/funnel.test.ts', 'src/curiosity/__tests__/insights.test.ts',
            'src/curiosity/__tests__/patterns.test.ts'],
    label: '好奇心引擎测试'
  }
];

function main() {
  let changedFiles = [];

  // 尝试从 stdin 读取会话数据
  try {
    const raw = require('fs').readFileSync(0, 'utf8');
    if (raw && raw.trim()) {
      const sessionData = JSON.parse(raw);
      // Claude Code Stop hook 可能包含 changed_files 或 edited_files
      if (sessionData.changed_files) {
        changedFiles = sessionData.changed_files;
      } else if (sessionData.edited_files) {
        changedFiles = sessionData.edited_files;
      }
    }
  } catch (e) {
    // 无法读取 stdin 就做无操作——不是阻塞性钩子
    console.log('[emotion-check] 无会话数据，跳过');
    process.exit(0);
  }

  if (!changedFiles.length) {
    process.exit(0);
  }

  const matchedTests = new Set();
  let hasTypecheck = false;
  const matchedLabels = [];

  for (const file of changedFiles) {
    for (const entry of TEST_MAP) {
      if (entry.pattern.test(file)) {
        if (entry.typecheck) {
          hasTypecheck = true;
        } else if (entry.tests) {
          entry.tests.forEach(t => matchedTests.add(t));
        }
        if (!matchedLabels.includes(entry.label)) {
          matchedLabels.push(entry.label);
        }
      }
    }
  }

  if (matchedTests.size === 0 && !hasTypecheck) {
    console.log('[emotion-check] 修改的文件不在检查范围内，跳过');
    process.exit(0);
  }

  console.log(`[emotion-check] 检测到修改: ${matchedLabels.join(', ')}`);

  if (hasTypecheck) {
    console.log('[emotion-check] 运行 TypeScript 类型检查...');
    try {
      execSync('npx tsc --noEmit', {
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
        timeout: 60000
      });
      console.log('[emotion-check] ✅ 类型检查通过');
    } catch (e) {
      const output = e.stdout ? e.stdout.toString() : (e.stderr ? e.stderr.toString() : '');
      console.log(`[emotion-check] ❌ 类型检查失败:\n${output.slice(-500)}`);
    }
  }

  if (matchedTests.size > 0) {
    const testFiles = Array.from(matchedTests).join(' ');
    console.log(`[emotion-check] 运行测试: ${testFiles}`);
    try {
      execSync(`npx vitest run ${testFiles} --reporter=verbose`, {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
        timeout: 120000
      });
    } catch (e) {
      console.log('[emotion-check] ⚠️ 部分测试未通过，请检查输出');
    }
  }
}

main();
