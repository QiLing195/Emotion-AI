#!/usr/bin/env node
/**
 * session-start-check.js
 *
 * 对标 ECC 的 session:start — 会话启动时检查项目状态。
 *
 * 检查项：
 * - .env 文件是否存在
 * - 必需的 AI 提供商 API key 是否已配置
 * - 服务端口是否被占用（检测是否有遗留进程）
 * - node_modules 是否存在
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const REQUIRED_ENV_VARS = [
  'PORT',
  // 以下至少一个 AI 提供商密钥必须存在
];

const AI_PROVIDER_KEYS = [
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY'
];

function checkEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  const envExamplePath = path.join(PROJECT_ROOT, '.env.example');

  if (!fs.existsSync(envPath)) {
    console.log('[session-check] ⚠️  .env 文件不存在');
    if (fs.existsSync(envExamplePath)) {
      console.log('[session-check]    可以执行: cp .env.example .env');
    }
    return false;
  }

  // 解析 .env 文件
  const envContent = fs.readFileSync(envPath, 'utf8');
  const envVars = {};
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([A-Z_]+)\s*=\s*(.+)/);
    if (match) {
      envVars[match[1]] = match[2].trim();
    }
  });

  // 检查 AI 提供商密钥
  const configuredKeys = AI_PROVIDER_KEYS.filter(k => envVars[k] && envVars[k] !== 'your_key_here');
  if (configuredKeys.length === 0) {
    console.log('[session-check] ❌ 没有配置任何 AI 提供商 API key');
    console.log('[session-check]    请在 .env 中配置 GEMINI_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY');
    return false;
  }

  console.log(`[session-check] ✅ 已配置 AI 提供商: ${configuredKeys.join(', ')}`);

  // 检查必需的 env var
  for (const v of REQUIRED_ENV_VARS) {
    if (!envVars[v]) {
      console.log(`[session-check] ⚠️  未设置 ${v}，将使用默认值`);
    }
  }

  return true;
}

function checkDependencies() {
  const nodeModules = path.join(PROJECT_ROOT, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    console.log('[session-check] ❌ node_modules 不存在，请运行: npm install');
    return false;
  }
  console.log('[session-check] ✅ node_modules 存在');
  return true;
}

function checkPort() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  let port = '3000';
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/^PORT\s*=\s*(\d+)/m);
    if (match) port = match[1];
  }

  try {
    const result = execSync(`lsof -ti:${port}`, { encoding: 'utf8', timeout: 5000 });
    const pids = result.trim().split('\n').filter(Boolean);
    if (pids.length > 0) {
      console.log(`[session-check] ⚡ 端口 ${port} 已有进程运行 (PID: ${pids.join(', ')})`);
      console.log('[session-check]    旧服务可能仍在运行，新启动可能冲突');
    }
  } catch (e) {
    console.log(`[session-check] ✅ 端口 ${port} 空闲`);
  }
}

function main() {
  console.log('[session-check] 项目状态检查...');
  console.log(`[session-check] 项目路径: ${PROJECT_ROOT}`);

  const envOk = checkEnv();
  const depsOk = checkDependencies();
  checkPort();

  if (!envOk) {
    process.exit(1);
  }
  if (!depsOk) {
    process.exit(1);
  }

  console.log('[session-check] ✅ 就绪');
  process.exit(0);
}

main();
