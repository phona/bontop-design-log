import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

async function main() {
  console.log('START');
  const server = new McpServer({ name: 'test', version: '0.1.0' }, { capabilities: { tools: {} } });
  console.log('DONE');
}
main();
