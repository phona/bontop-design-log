import { createOpencode } from '@opencode-ai/sdk';

const { client, server } = await createOpencode({ port: 0 });
console.log('server url', server.url);

try {
  const project = await client.project.current();
  console.log('project', project.data);

  const sessions = await client.session.list();
  console.log('sessions count', sessions.data?.length);

  const session = await client.session.create({ body: { message: 'hello from sdk' } });
  console.log('session', session.data);
} catch (e) {
  console.error('error', e);
} finally {
  server.close();
}
