console.log('1. Starting');
import { ProjectCatalog } from '../server/project-catalog.js';
import { DesignState } from '../server/design-state.js';
import { createMcpServer } from '../server/mcp-server.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';

console.log('2. Loading catalog');
const catalog = ProjectCatalog.load('.');
console.log('3. Loading state');
const state = DesignState.load(catalog, './data');
console.log('4. Creating MCP server');
const mcp = createMcpServer(catalog, state);
console.log('5. Creating transport');
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
console.log('6. Connecting...');
try {
  await mcp.connect(transport);
  console.log('7. Connected!');
} catch (err) {
  console.error('Connect error:', err);
}
console.log('8. Done');
