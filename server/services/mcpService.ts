import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ALLOWED_MCP_TOOLS, isToolAllowed } from './mcp.js';

export class MCPService {
  private server: McpServer | null = null;
  private transport: StdioServerTransport | null = null;

  async initialize() {
    try {
      this.server = new McpServer({
        name: "AI_Girlfriend_Server",
        version: "1.0.0",
      });

      // Register tools
      this.registerTools();

      // Create transport
      this.transport = new StdioServerTransport();
      await this.server.connect(this.transport);

      console.log("MCP Server initialized successfully");
    } catch (error) {
      console.error("Failed to initialize MCP server:", error);
    }
  }

  private registerTools() {
    if (!this.server) return;

    // Register memory search tool
    this.server.tool(
      "search_memory",
      "在长期记忆中搜索相关内容",
      {
        query: z.string().describe("搜索查询"),
        limit: z.number().optional().describe("结果数量限制，默认为5").default(5)
      },
      async ({ query, limit }) => {
        try {
          // This is a mock implementation - in real implementation,
          // this would connect to a memory database
          const mockResults = [
            { content: `关于"${query}"的记忆片段1`, relevance: 0.8 },
            { content: `关于"${query}"的记忆片段2`, relevance: 0.6 },
          ].slice(0, limit);

          return {
            content: [
              {
                type: "text",
                text: `找到 ${mockResults.length} 条相关记忆:\n${mockResults.map(r => `- ${r.content} (相关性: ${r.relevance})`).join('\n')}`
              }
            ]
          };
        } catch (error) {
          console.error("Memory search failed:", error);
          return {
            content: [
              {
                type: "text",
                text: `搜索失败: ${error instanceof Error ? error.message : '未知错误'}`
              }
            ]
          };
        }
      }
    );

    // Register knowledge query tool
    this.server.tool(
      "search_knowledge",
      "在知识库中查询信息",
      {
        topic: z.string().describe("查询主题"),
        depth: z.enum(["brief", "detailed"]).optional().describe("查询深度").default("brief")
      },
      async ({ topic, depth }) => {
        try {
          // Mock knowledge base response
          const knowledge = depth === "brief"
            ? `关于"${topic}"的简要信息。`
            : `关于"${topic}"的详细信息：\n这是关于${topic}的详细说明，包含多个方面的内容。`;

          return {
            content: [
              {
                type: "text",
                text: knowledge
              }
            ]
          };
        } catch (error) {
          console.error("Knowledge query failed:", error);
          return {
            content: [
              {
                type: "text",
                text: `知识查询失败: ${error instanceof Error ? error.message : '未知错误'}`
              }
            ]
          };
        }
      }
    );

    // Add more tools as needed...
  }

  // Check if a tool can be executed (for security)
  canExecuteTool(toolName: string): boolean {
    return isToolAllowed(toolName);
  }

  async shutdown() {
    if (this.transport) {
      await this.transport.close();
    }
    this.server = null;
    this.transport = null;
    console.log("MCP Server shut down");
  }
}

// Export a singleton instance
export const mcpService = new MCPService();