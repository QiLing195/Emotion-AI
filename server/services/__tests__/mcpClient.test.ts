import { describe, it, expect, afterAll } from 'vitest';
import {
  buildMcpDeclarations,
  callMcpTool,
  isMcpConnected,
  isToolAllowedByServer,
  listAllMcpTools,
  mcpClientEnabled,
  mcpToolName,
  parseMcpConfig,
  parseMcpToolName,
  shutdownMcp,
  type McpConfig,
} from '../mcpClient.js';

const MOCK_CFG: McpConfig = {
  servers: {
    mock: { command: 'node', args: ['scripts/mock-mcp-server.mjs'], enabled: true, allowTools: ['echo'] },
  },
};

afterAll(async () => { await shutdownMcp(); });

describe('开关与配置解析（坏配置不该让服务起不来）', () => {
  it('默认关', () => {
    expect(mcpClientEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(mcpClientEnabled({ ENABLE_MCP_CLIENT: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('丢弃坏条目，保留合法条目', () => {
    const cfg = parseMcpConfig({
      servers: {
        good: { command: 'node', args: ['x.mjs', 123], enabled: true, allowTools: ['read_file', 7] },
        'bad name!': { command: 'node' },
        noCommand: { args: ['x'] },
        notObject: 'nope',
      },
    });
    expect(Object.keys(cfg.servers)).toEqual(['good']);
    expect(cfg.servers.good.args).toEqual(['x.mjs']);
    expect(cfg.servers.good.allowTools).toEqual(['read_file']);
  });

  it('非对象/缺 servers ⇒ 空配置', () => {
    expect(parseMcpConfig(null).servers).toEqual({});
    expect(parseMcpConfig({}).servers).toEqual({});
  });
});

describe('工具名与白名单', () => {
  it('命名与反解', () => {
    expect(mcpToolName('fs', 'read_file')).toBe('mcp__fs__read_file');
    expect(parseMcpToolName('mcp__fs__read_file')).toEqual({ server: 'fs', tool: 'read_file' });
    expect(parseMcpToolName('check_my_state')).toBeNull();
  });

  it('显式 allowTools 优先；不写则只放行只读名', () => {
    expect(isToolAllowedByServer({ command: 'node', allowTools: ['echo'] }, 'echo')).toBe(true);
    expect(isToolAllowedByServer({ command: 'node', allowTools: ['echo'] }, 'delete_everything')).toBe(false);
    expect(isToolAllowedByServer({ command: 'node' }, 'read_file')).toBe(true);
    expect(isToolAllowedByServer({ command: 'node' }, 'list_directory')).toBe(true);
    expect(isToolAllowedByServer({ command: 'node' }, 'delete_everything')).toBe(false);
    expect(isToolAllowedByServer({ command: 'node' }, 'write_file')).toBe(false);
  });

  it('声明只包含被放行的工具，且带 mcp__ 前缀', () => {
    const decl = buildMcpDeclarations([{
      server: 'mock',
      tools: [
        { name: 'echo', description: '回显', inputSchema: { type: 'object', properties: {} } },
        { name: 'delete_everything', description: '危险' },
      ],
    }], MOCK_CFG);
    expect(decl).toHaveLength(1);
    expect(decl[0].name).toBe('mcp__mock__echo');
    expect(decl[0].description).toContain('MCP:mock');
    expect(decl[0].parameters).toBeTruthy();
  });

  it('没配置的 server 不出现', () => {
    const decl = buildMcpDeclarations([{ server: 'ghost', tools: [{ name: 'read_file' }] }], MOCK_CFG);
    expect(decl).toHaveLength(0);
  });
});

describe('真实连一个 stdio MCP server（mock）', () => {
  it('能列出工具、调用 echo、挡住未放行工具', async () => {
    const perServer = await listAllMcpTools(MOCK_CFG);
    expect(perServer).toHaveLength(1);
    expect(perServer[0].server).toBe('mock');
    expect(perServer[0].tools.map(t => t.name).sort()).toEqual(['delete_everything', 'echo']);
    expect(isMcpConnected('mock')).toBe(true);

    const ok = await callMcpTool('mcp__mock__echo', { text: '你好' }, MOCK_CFG);
    expect(ok.ok).toBe(true);
    expect(JSON.stringify(ok.result)).toContain('echo:你好');

    const blocked = await callMcpTool('mcp__mock__delete_everything', {}, MOCK_CFG);
    expect(blocked.ok).toBe(false);
    expect(String(blocked.error)).toContain('tool_not_allowed');

    const badName = await callMcpTool('not_a_tool', {}, MOCK_CFG);
    expect(badName.ok).toBe(false);
    expect(String(badName.error)).toContain('bad_tool_name');
  }, 20_000);

  it('未启用的 server 调用被拒（不偷偷启动进程）', async () => {
    const cfg: McpConfig = { servers: { mock: { command: 'node', args: ['scripts/mock-mcp-server.mjs'], enabled: false } } };
    const r = await callMcpTool('mcp__mock__echo', { text: 'x' }, cfg);
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain('server_disabled');
  });
});

describe('Windows 兼容与 schema 兼容层（v1.93）', () => {
  it('Windows 上 npx 包一层 cmd.exe（否则 spawn ENOENT）', async () => {
    const m = await import('../mcpClient.js');
    const r = m.normalizeStdioCommand({ command: 'npx', args: ['-y', '@pkg/x', 'C:\\a b\\docs'] }, 'win32');
    expect(r.command).toBe('cmd.exe');
    expect(r.args[0]).toBe('/d');
    expect(r.args[1]).toBe('/s');
    expect(r.args[2]).toBe('/c');
    expect(String(r.args[3])).toContain('npx');
    expect(String(r.args[3])).toContain('"C:\\a b\\docs"');
  });

  it('非 Windows / 普通命令原样返回', async () => {
    const m = await import('../mcpClient.js');
    const a = m.normalizeStdioCommand({ command: 'npx', args: ['-y', 'pkg'] }, 'linux');
    expect(a).toEqual({ command: 'npx', args: ['-y', 'pkg'] });
    const b = m.normalizeStdioCommand({ command: 'node', args: ['server.js'] }, 'win32');
    expect(b).toEqual({ command: 'node', args: ['server.js'] });
  });

  it('老 server 的 inputSchema 缺 type 时补成 object（否则新版 SDK 整条拒绝）', async () => {
    const m = await import('../mcpClient.js');
    const msg = { id: 2, result: { tools: [{ name: 'a', inputSchema: { $schema: 'x' } }, { name: 'b', inputSchema: { type: 'object', properties: {} } }] } };
    m.patchToolSchemas(msg);
    expect((msg.result.tools[0].inputSchema as { type?: string }).type).toBe('object');
    expect((msg.result.tools[1].inputSchema as { type?: string }).type).toBe('object');
  });

  it('非 tools/list 消息不动（不误伤别的响应）', async () => {
    const m = await import('../mcpClient.js');
    const msg = { id: 3, result: { content: [{ type: 'text', text: 'hi' }] } };
    m.patchToolSchemas(msg);
    expect(msg).toEqual({ id: 3, result: { content: [{ type: 'text', text: 'hi' }] } });
  });
});