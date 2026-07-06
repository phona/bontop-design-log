console.log('START');
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';

console.log('Creating server');
const server = new McpServer({ name: 'test', version: '0.1.0' }, { capabilities: { tools: {} } });
console.log('Creating transport');
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
console.log('Connecting');
await server.connect(transport);
console.log('DONE');
