/**
 * MCP 客户端（v1.82）——让她通过**标准 MCP 协议**调用外部工具。
 *
 * 与项目里已有的 `mcpService.ts` 的区别：
 *   · `mcpService` 是 **MCP server**（对外暴露 mock 工具，供外部客户端连）；
 *   · 本模块是 **MCP client**：读配置 → 启动/连接 stdio MCP server → `tools/list`/`tools/call`
 *     → 把工具以 `mcp__<server>__<tool>` 的名字挂进她的 agent 工具表。
 *
 * 安全边界（第一版只读）：
 *   · 每个 server 必须显式 `enabled: true`；`allowTools` 是**白名单**（不写就只放行只读类工具名）；
 *   · 只跑你配置里写的命令，不自动发现、不自动联网；
 *   · 每次调用写审计账本 `memories/mcp_calls.jsonl`（工具/耗时/成败/入参摘要，不入参全文）；
 *   · 开关 `ENABLE_MCP_CLIENT=true`，默认关。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const MCP_CONFIG_PATH = 'mcp-servers.json';
export const MCP_AUDIT_PATH = join('memories', 'mcp_calls.jsonl');
export const MCP_CALL_TIMEOUT_MS = 15_000;
const AUDIT_MAX_BYTES = 1_000_000;

/** 不写 allowTools 时，只放行名字像"只读"的工具 */
const READONLY_TOOL_PATTERN = /^(read|list|search|get|find|view|stat|query|head|cat|show|describe|fetch|lookup|inspect)/i;

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  allowTools?: string[];
  /** 仅说明用途，不参与执行 */
  note?: string;
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

export function mcpClientEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_MCP_CLIENT === 'true';
}

/** 解析并校验配置（坏条目丢弃，不抛错；用户手写配置不该让服务起不来） */
export function parseMcpConfig(raw: unknown): McpConfig {
  const out: McpConfig = { servers: {} };
  if (!raw || typeof raw !== 'object') return out;
  const servers = (raw as { servers?: unknown }).servers;
  if (!servers || typeof servers !== 'object') return out;
  for (const [name, value] of Object.entries(servers as Record<string, unknown>)) {
    if (!/^[a-z0-9_-]{1,32}$/i.test(name)) continue;
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    if (typeof v.command !== 'string' || !v.command.trim()) continue;
    const cfg: McpServerConfig = { command: v.command.trim() };
    if (Array.isArray(v.args)) cfg.args = v.args.filter(a => typeof a === 'string').slice(0, 32) as string[];
    if (v.env && typeof v.env === 'object') {
      cfg.env = Object.fromEntries(Object.entries(v.env as Record<string, unknown>)
        .filter(([, x]) => typeof x === 'string').slice(0, 32)) as Record<string, string>;
    }
    if (typeof v.enabled === 'boolean') cfg.enabled = v.enabled;
    if (Array.isArray(v.allowTools)) cfg.allowTools = v.allowTools.filter(t => typeof t === 'string').slice(0, 100) as string[];
    if (typeof v.note === 'string') cfg.note = v.note.slice(0, 200);
    out.servers[name] = cfg;
  }
  return out;
}

export function loadMcpConfig(path = MCP_CONFIG_PATH): McpConfig {
  if (!existsSync(path)) return { servers: {} };
  try {
    return parseMcpConfig(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  } catch (e) {
    console.warn(`[MCP] 配置解析失败（按空处理）：${(e as Error).message}`);
    return { servers: {} };
  }
}

/** 工具是否被该 server 的配置允许 */
export function isToolAllowedByServer(cfg: McpServerConfig, toolName: string): boolean {
  const t = String(toolName ?? '');
  if (!t) return false;
  if (cfg.allowTools && cfg.allowTools.length > 0) return cfg.allowTools.includes(t);
  return READONLY_TOOL_PATTERN.test(t);
}

export function mcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

export function parseMcpToolName(full: string): { server: string; tool: string } | null {
  const m = /^mcp__([a-z0-9_-]{1,32})__(.+)$/i.exec(String(full ?? ''));
  return m ? { server: m[1], tool: m[2] } : null;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** MCP 工具 → agent 工具声明（Gemini functionDeclarations 形状，与内置工具一致） */
export function buildMcpDeclarations(
  perServer: Array<{ server: string; tools: McpToolInfo[] }>,
  cfg: McpConfig,
): Array<{ name: string; description: string; parameters: unknown }> {
  const out: Array<{ name: string; description: string; parameters: unknown }> = [];
  for (const { server, tools } of perServer) {
    const s = cfg.servers[server];
    if (!s) continue;
    for (const t of tools) {
      if (!isToolAllowedByServer(s, t.name)) continue;
      const schema = (t.inputSchema && typeof t.inputSchema === 'object')
        ? t.inputSchema
        : { type: 'object', properties: {}, required: [] };
      out.push({
        name: mcpToolName(server, t.name),
        description: `[MCP:${server}] ${t.description ?? t.name}`.slice(0, 400),
        parameters: schema,
      });
    }
  }
  return out;
}

type AnyClient = {
  connect: (t: unknown) => Promise<void>;
  listTools: () => Promise<{ tools?: McpToolInfo[] }>;
  callTool: (p: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
  close: () => Promise<void>;
};

interface Conn { client: AnyClient; tools: McpToolInfo[] }

const conns = new Map<string, Conn>();

function audit(row: Record<string, unknown>): void {
  try {
    if (existsSync(MCP_AUDIT_PATH) && statSync(MCP_AUDIT_PATH).size > AUDIT_MAX_BYTES) {
      renameSync(MCP_AUDIT_PATH, `${MCP_AUDIT_PATH}.1`);
    }
    const dir = dirname(MCP_AUDIT_PATH);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(MCP_AUDIT_PATH, JSON.stringify(row) + '\n', 'utf8');
  } catch { /* 审计失败不影响调用 */ }
}

/**
 * Windows 上 npx/npm 其实是 .cmd 批处理，Node 的 spawn 不能直接执行（ENOENT），
 * 必须包一层 cmd.exe。其他平台/命令原样返回。
 */
export function normalizeStdioCommand(cfg: McpServerConfig, platform: string = process.platform): { command: string; args: string[] } {
  const cmd = String(cfg.command ?? '').trim();
  const args = Array.isArray(cfg.args) ? cfg.args.slice() : [];
  if (platform === 'win32' && /^(npx|npm|pnpm|yarn|bunx)$/i.test(cmd)) {
    const parts = [cmd, ...args].map(a => (/[\s"]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : String(a)));
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', parts.join(' ')] };
  }
  return { command: cmd, args };
}

/**
 * 兼容层（v1.93）：老版本官方 server（如 filesystem@2025.8.18 / 0.6.2）的
 * `tools/list` 返回的 `inputSchema` 只有 `$schema`、**没有 `type:"object"`**，
 * 而新版 SDK 会按严格 schema 校验并整条拒绝（错误信息："expected object"）。
 * 这里在 transport 收到 JSON-RPC 消息、SDK 解析之前，给缺 `type` 的 inputSchema 补上。
 */
export function patchToolSchemas(message: unknown): void {
  const m = message as { result?: { tools?: unknown } } | null;
  const tools = m?.result?.tools;
  if (!Array.isArray(tools)) return;
  for (const t of tools) {
    if (!t || typeof t !== 'object') continue;
    const tool = t as { inputSchema?: unknown };
    if (tool.inputSchema && typeof tool.inputSchema === 'object') {
      const schema = tool.inputSchema as { type?: unknown };
      if (typeof schema.type !== 'string') schema.type = 'object';
    }
  }
}

function withSchemaCompat(inner: Transport): Transport {
  const wrapper = {
    onmessage: undefined as ((m: unknown) => void) | undefined,
    onclose: undefined as (() => void) | undefined,
    onerror: undefined as ((e: Error) => void) | undefined,
    async start(): Promise<void> {
      inner.onmessage = (m: unknown) => {
        try { patchToolSchemas(m); } catch { /* 补不动就原样交给 SDK */ }
        wrapper.onmessage?.(m);
      };
      inner.onclose = () => wrapper.onclose?.();
      inner.onerror = (e: Error) => wrapper.onerror?.(e);
      await inner.start();
    },
    async close(): Promise<void> { await inner.close(); },
    async send(m: unknown): Promise<void> { await inner.send(m as Parameters<Transport['send']>[0]); },
  };
  return wrapper as unknown as Transport;
}

async function connectServer(server: string, cfg: McpServerConfig): Promise<Conn> {
  const existing = conns.get(server);
  if (existing) return existing;
  const spawnSpec = normalizeStdioCommand(cfg);
  const transport = withSchemaCompat(new StdioClientTransport({
    command: spawnSpec.command,
    args: spawnSpec.args,
    env: { ...process.env as Record<string, string>, ...(cfg.env ?? {}) },
    stderr: 'ignore',
  }));
  const client = new Client({ name: 'ai-girlfriend-mcp-client', version: '1.0.0' }, { capabilities: {} }) as unknown as AnyClient;
  await client.connect(transport);
  const listed = await client.listTools();
  const tools = Array.isArray(listed?.tools) ? listed.tools : [];
  const conn: Conn = { client, tools };
  conns.set(server, conn);
  console.log(`[MCP] 已连接 ${server}（${tools.length} 个工具）`);
  return conn;
}

/** 列出所有启用 server 的工具（懒连接；单个 server 失败不影响其它；errors 用于观测失败原因） */
export async function listAllMcpTools(
  cfg: McpConfig = loadMcpConfig(),
  errors?: Array<{ server: string; error: string }>,
): Promise<Array<{ server: string; tools: McpToolInfo[] }>> {
  const out: Array<{ server: string; tools: McpToolInfo[] }> = [];
  for (const [server, s] of Object.entries(cfg.servers)) {
    if (s.enabled !== true) continue;
    try {
      const conn = await connectServer(server, s);
      out.push({ server, tools: conn.tools });
    } catch (e) {
      const msg = (e as Error).message;
      console.warn(`[MCP] 连接 ${server} 失败：${msg}`);
      if (errors) errors.push({ server, error: msg });
    }
  }
  return out;
}

/** 给 agentLoop 的额外工具声明（异步；失败返回空数组） */
export async function getMcpToolDeclarations(): Promise<Array<{ name: string; description: string; parameters: unknown }>> {
  if (!mcpClientEnabled()) return [];
  const cfg = loadMcpConfig();
  const perServer = await listAllMcpTools(cfg);
  return buildMcpDeclarations(perServer, cfg);
}

/** 调用一个 mcp__ 工具；永不抛错（错误当结果回灌给她） */
export async function callMcpTool(
  fullName: string,
  args: Record<string, unknown> = {},
  cfg: McpConfig = loadMcpConfig(),
): Promise<{ ok: boolean; result?: unknown; error?: string; ms: number }> {
  const t0 = Date.now();
  const parsed = parseMcpToolName(fullName);
  if (!parsed) return { ok: false, error: 'bad_tool_name（不是 mcp__<server>__<tool>）', ms: Date.now() - t0 };
  const s = cfg.servers[parsed.server];
  if (!s || s.enabled !== true) {
    return { ok: false, error: `server_disabled（${parsed.server} 未启用）`, ms: Date.now() - t0 };
  }
  if (!isToolAllowedByServer(s, parsed.tool)) {
    return { ok: false, error: `tool_not_allowed（${parsed.tool} 不在该 server 的 allowTools/只读白名单里）`, ms: Date.now() - t0 };
  }
  try {
    const conn = await connectServer(parsed.server, s);
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('mcp_call_timeout')), MCP_CALL_TIMEOUT_MS));
    const raw = await Promise.race([conn.client.callTool({ name: parsed.tool, arguments: args }), timeout]);
    const ok = !(raw as { isError?: boolean })?.isError;
    audit({
      ts: Date.now(), server: parsed.server, tool: parsed.tool, ok,
      ms: Date.now() - t0, argsPreview: JSON.stringify(args).slice(0, 200),
    });
    return { ok, result: raw, ms: Date.now() - t0 };
  } catch (e) {
    const error = (e as Error).message;
    audit({ ts: Date.now(), server: parsed.server, tool: parsed.tool, ok: false, ms: Date.now() - t0, error });
    return { ok: false, error, ms: Date.now() - t0 };
  }
}

export async function shutdownMcp(): Promise<void> {
  for (const [server, conn] of conns) {
    try { await conn.client.close(); } catch { /* ignore */ }
    console.log(`[MCP] 已断开 ${server}`);
  }
  conns.clear();
}

/** 仅测试用：清空连接（不关闭底层进程会泄漏，测试里应配合 shutdownMcp） */
export function resetMcpStateForTests(): void {
  conns.clear();
}

export function isMcpConnected(server: string): boolean {
  return conns.has(server);
}
