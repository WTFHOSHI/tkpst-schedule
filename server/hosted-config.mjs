export function hostedOptions(env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required for hosted accounts. SQLite is disabled.');
  let url;
  try { url = new URL(env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL); } catch { throw new Error('A fixed HTTPS public origin is required.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid HTTPS public origin.');
  const port = Number(env.PORT || 10000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  return {
    host: '0.0.0.0', port, publicOrigin: url.origin, databaseUrl: env.DATABASE_URL,
    overridesSource: 'https://wtfhoshi.github.io/tkpst-schedule/overrides.json',
  };
}
