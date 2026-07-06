import { ProjectCatalog } from '../server/project-catalog.js';
import { DesignState } from '../server/design-state.js';
import { createMcpServer } from '../server/mcp-server.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';

console.log('Loading catalog...');
const catalog = ProjectCatalog.load('.');
console.log('Loading state...');
const state = DesignState.load(catalog, './data');
console.log('Creating MCP server...');
const mcp = createMcpServer(catalog, state);
console.log('Creating transport...');
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
console.log('Connecting...');
await mcp.connect(transport);
console.log('Connected!');
