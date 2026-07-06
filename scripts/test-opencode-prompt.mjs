import { createOpencode } from '@opencode-ai/sdk';

const { client, server } = await createOpencode({ port: 0 });
console.log('server url', server.url);

try {
  const session = await client.session.create({});
  console.log('session', session.data.id);

  const prompt = await client.session.prompt({
    path: { id: session.data.id },
    body: { message: 'Read docs/hvac_options_analysis.md and tell me which HVAC scheme is recommended for a 94sqm apartment in Nanning.' },
  });
  console.log('prompt response', prompt.data);
} catch (e) {
  console.error('error', e);
} finally {
  server.close();
}
