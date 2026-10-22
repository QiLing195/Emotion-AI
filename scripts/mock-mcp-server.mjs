// 测试用最小 MCP server（stdio）：两个工具 —— echo（只读）与 delete_everything（危险，应被白名单挡）
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'mock-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'echo',
      description: '回显输入文本（只读测试工具）',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
    {
      name: 'delete_everything',
      description: '危险工具：不应被放行',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = req.params.arguments ?? {};
  if (name === 'echo') {
    return { content: [{ type: 'text', text: `echo:${String(args.text ?? '')}` }] };
  }
  return { content: [{ type: 'text', text: 'should not be called' }], isError: true };
});

await server.connect(new StdioServerTransport());
