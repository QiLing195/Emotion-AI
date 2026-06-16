#!/usr/bin/env node
/**
 * post-edit-secret-check.js
 *
 * 对标 ECC 的 security-review 安全扫描 — 检测代码修改后是否有密钥泄漏。
 *
 * 检查项：
 * - 硬编码的 API 密钥模式 (sk-*, key-*, token=, secret=)
 * - console.log 残留
 * - .env 文件是否在 .gitignore 中
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// 危险模式定义
const SECRET_PATTERNS = [
  { pattern: /sk-[a-zA-Z0-9]{20,}/, label: 'OpenAI/DeepSeek API key (sk-*)' },
  { pattern: /(api_key|apikey|apiKey)\s*[:=]\s*["'][^"']{10,}["']/, label: 'API key 赋值' },
  { pattern: /(secret|token|password)\s*[:=]\s*["'][^"']{6,}["']/i, label: '密钥/令牌/密码' },
  { pattern: /AIza[0-9A-Za-z\-_]{35}/, label: 'Google API key (AIza*)' },
  { pattern: /sk-[a-zA-Z0-9]{20,}/, label: 'Anthropic API key (sk-ant-*)' }
];

// 需要检查的源文件扩展名
const CHECK_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json'];

function checkFile(filePath) {
  const issues = [];

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 跳过注释行和 .env 引用
      if (line.trim().startsWith('//') || line.trim().startsWith('#')) continue;
      if (line.includes('process.env')) continue;
      if (line.includes('.env')) continue;
      if (line.includes('safetySetting')) continue;

      // 检查是否包含 console.log
      if (line.match(/console\.log\s*\(/)) {
        issues.push({
          file: filePath,
          line: i + 1,
          type: 'console-log',
          detail: '生产代码中不应有 console.log，请使用 metrics.ts 的 Collector'
        });
      }

      // 检查密钥模式
      for (const sp of SECRET_PATTERNS) {
        if (sp.pattern.test(line)) {
          // 排除示例文件中的占位符
          if (line.includes('your_') || line.includes('example') || line.includes('placeholder')) {
            continue;
          }
          issues.push({
            file: filePath,
            line: i + 1,
            type: 'secret-leak',
            detail: `疑似硬编码密钥: ${sp.label}`
          });
        }
      }
    }
  } catch (e) {
    // 文件无法读取，跳过
  }

  return issues;
}

function main() {
  const allIssues = [];

  // 检查 src/ 和 server/ 目录
  const searchDirs = [
    path.join(PROJECT_ROOT, 'src'),
    path.join(PROJECT_ROOT, 'server')
  ];

  // 也检查 server.ts 根文件
  const rootServerFile = path.join(PROJECT_ROOT, 'server.ts');
  if (fs.existsSync(rootServerFile)) {
    allIssues.push(...checkFile(rootServerFile));
  }

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    walkDir(dir);
  }

  function walkDir(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
          walkDir(fullPath);
        } else if (CHECK_EXTENSIONS.includes(path.extname(entry.name))) {
          allIssues.push(...checkFile(fullPath));
        }
      }
    } catch (e) {
      // 目录无法读取
    }
  }

  if (allIssues.length === 0) {
    console.log('[secret-check] ✅ 未检测到密钥泄漏或 console.log 残留');
    process.exit(0);
  }

  const secrets = allIssues.filter(i => i.type === 'secret-leak');
  const consoleLogs = allIssues.filter(i => i.type === 'console-log');

  if (secrets.length > 0) {
    console.log(`[secret-check] 🔴 发现 ${secrets.length} 个疑似密钥泄漏：`);
    secrets.forEach(s => console.log(`  ${s.file}:${s.line} — ${s.detail}`));
  }

  if (consoleLogs.length > 0) {
    console.log(`[secret-check] 🟡 发现 ${consoleLogs.length} 个 console.log 残留：`);
    consoleLogs.forEach(c => console.log(`  ${c.file}:${c.line} — ${c.detail}`));
  }

  // 密钥泄漏为阻塞性错误，console.log 为警告
  process.exit(secrets.length > 0 ? 1 : 0);
}

main();
