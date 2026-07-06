import express from 'express';
import { ProjectCatalog } from './project-catalog.js';
import { DesignState } from './design-state.js';
import { createApiRouter } from './routes.js';
import { createMcpServer } from './mcp-server.js';
import { attachMcpTransports } from './mcp-transports.js';

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? './data';

const catalog = ProjectCatalog.load('.');
const state = DesignState.load(catalog, DATA_DIR);

const app = express();
app.use(express.json());
app.use('/api', createApiRouter(catalog, state));

await attachMcpTransports(app, () => createMcpServer(catalog, state));

app.listen(PORT, () => {
  console.log(`Bontop design server listening on http://localhost:${PORT}`);
});
