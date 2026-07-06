import express from 'express';
import { ProjectCatalog } from '../server/project-catalog.js';
import { DesignState } from '../server/design-state.js';
import { createApiRouter } from '../server/routes.js';
import { createMcpServer } from '../server/mcp-server.js';
import { attachMcpTransports } from '../server/mcp-transports.js';

console.log('Loading catalog...');
const catalog = ProjectCatalog.load('.');
console.log('Loading state...');
const state = DesignState.load(catalog, './data');
console.log('Creating app...');
const app = express();
app.use(express.json());
app.use('/api', createApiRouter(catalog, state));

console.log('Attaching MCP transports...');
await attachMcpTransports(app, () => createMcpServer(catalog, state));
console.log('MCP attached.');

console.log('Starting server...');
app.listen(3093, () => {
  console.log('Listening on 3093');
});
