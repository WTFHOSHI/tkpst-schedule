import { createAuthServer } from './http.mjs';
import { createNeonStore } from './neon.mjs';
import { hostedOptions } from './hosted-config.mjs';

try {
  const { port, host, publicOrigin, databaseUrl, overridesSource } = hostedOptions(process.env);
  const app = await createAuthServer({ store: createNeonStore(databaseUrl), publicOrigin, overridesSource });
  app.server.on('error', error => {
    console.error(`Hosted server could not listen: ${error.code || 'unknown error'}`);
    app.close(); process.exitCode = 1;
  });
  app.server.listen(port, host, () => console.log(`TKPST accounts running at ${publicOrigin}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.server.close(() => { app.close(); process.exit(0); }));
} catch {
  console.error('Hosted startup failed. Check DATABASE_URL, PUBLIC_ORIGIN/RENDER_EXTERNAL_URL and PORT.');
  process.exitCode = 1;
}
