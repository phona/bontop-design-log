console.log('A');
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
console.log('B');
async function main() {
  console.log('C');
  const server = new McpServer({ name: 'test', version: '0.1.0' }, { capabilities: { tools: {} } });
  console.log('D');
}
main();
console.log('E');
