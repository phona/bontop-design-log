console.log('Before imports');
import { ProjectCatalog } from '../server/project-catalog.js';
console.log('After project-catalog import');
import { DesignState } from '../server/design-state.js';
console.log('After design-state import');
import { createMcpServer } from '../server/mcp-server.js';
console.log('After mcp-server import');
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
console.log('After transport import');
