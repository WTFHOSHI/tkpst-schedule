export class AuthError extends Error {
  constructor(message, status = 0, field) { super(message); this.status = status; this.field = field; }
}

// Session tokens are HttpOnly cookies. No passwords or tokens go into web storage.
export function createAuthClient(fetcher = globalThis.fetch.bind(globalThis)) {
  let user = null, status = 'loading', revision = 0, mutating = false;
  const state = () => ({ user, status, mutating });
  async function request(path, body) {
    let response;
    try {
      response = await fetcher('/api/' + path, {
        // Legacy service workers cached every successful GET. POST keeps private
        // reads out of those caches even during the worker upgrade window.
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new AuthError('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.'); }
    if (response.status === 204) return null;
    let data;
    try { data = await response.json(); } catch { throw new AuthError('Сервис входа временно недоступен. Попробуйте позже.'); }
    if (!response.ok) throw new AuthError(data.error || 'Не удалось выполнить запрос.', response.status, data.field);
    return data;
  }
  return {
    state,
    async restore() {
      if (mutating) return state();
      const version = ++revision;
      try {
        const data = await request('auth/session');
        if (version === revision) { user = data.user || null; status = 'ready'; }
      } catch { if (version === revision) { user = null; status = 'unavailable'; } }
      return state();
    },
    async authenticate(action, body) {
      if (!['login', 'register'].includes(action)) throw new AuthError('Неизвестное действие.');
      if (mutating) throw new AuthError('Подождите завершения предыдущего запроса.');
      ++revision; mutating = true;
      try { const data = await request('auth/' + action, body); user = data.user; status = 'ready'; return state(); }
      finally { mutating = false; }
    },
    async logout() {
      if (mutating) throw new AuthError('Подождите завершения предыдущего запроса.');
      ++revision; mutating = true;
      try { await request('auth/logout', {}); user = null; status = 'ready'; }
      finally { mutating = false; }
    },
    async grades() {
      const version = revision;
      try { return await request('grades'); }
      catch (error) { if (error.status === 401 && version === revision && !mutating) { ++revision; user = null; status = 'ready'; } throw error; }
    },
    async attendance(month) {
      const version = revision;
      try { return await request('attendance', { month }); }
      catch (error) { if (error.status === 401 && version === revision && !mutating) { ++revision; user = null; status = 'ready'; } throw error; }
    },
  };
}
export const auth = createAuthClient();
