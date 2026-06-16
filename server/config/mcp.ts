// List of allowed MCP tool names (for security sandboxing)
// Tools not in this list will be blocked from execution
export const ALLOWED_MCP_TOOLS = [
  // Memory-related tools (read-only operations)
  'search_memory',
  'get_memory',
  'list_memories',
  'recall',
  'remember',
  // Knowledge query tools (safe)
  'search_knowledge',
  'query_facts',
  // Add other safe tool names as needed
];

// Check if a tool is allowed to be executed
export function isToolAllowed(toolName: string): boolean {
  // Always allow built-in cold memory search
  if (toolName === 'search_cold_memory') return true;

  // Check against whitelist
  return ALLOWED_MCP_TOOLS.includes(toolName);
}