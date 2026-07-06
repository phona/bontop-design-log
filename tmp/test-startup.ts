import express from 'express';
import { ProjectCatalog } from '../server/project-catalog.js';
import { DesignState } from '../server/design-state.js';
import { createApiRouter } from '../server/routes.js';

console.log('Loading catalog...');
const catalog = ProjectCatalog.load('.');
console.log('Loading state...');
const state = DesignState.load(catalog, './data');
console.log('Creating app...');
const app = express();
app.use(express.json());
app.use('/api', createApiRouter(catalog, state));
console.log('Starting server...');
app.listen(3094, () => {
  console.log('Listening on 3094');
});
