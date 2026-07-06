import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

async function main() {
  console.log('START');
  const server = new McpServer({ name: 'test', version: '0.1.0' }, { capabilities: { tools: {} } });
  console.log('Server created');
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => 'test-id' });
  console.log('Transport created');
  await server.connect(transport);
  console.log('DONE');
}
main().catch(e => console.error(e));
