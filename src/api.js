import { Preferences } from '@capacitor/preferences';

// ---- storage helpers -------------------------------------------------------
export async function getPref(key, fallback = '') {
  try {
    const { value } = await Preferences.get({ key });
    return value ?? fallback;
  } catch {
    return localStorage.getItem(key) ?? fallback;
  }
}
export async function setPref(key, value) {
  try { await Preferences.set({ key, value }); } catch { localStorage.setItem(key, value); }
}

// Pre-filled on first launch. Fully configurable and editable in Settings.
export const DEFAULTS = {
  url: 'https://jarvis-ukcy.onrender.com',
  url2: 'https://jarviss-eight.vercel.app',
  token: '1debfbd14a5492eb24f884d8ee85c68656f83bd2b9a647bb9221046afa722e3e',
};

export const clean = (u) => (u || '').trim().replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message, status = 0, network = false) {
    super(message); this.status = status; this.network = network;
  }
}

function withTimeout(promise, ms, controller) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => { controller?.abort(); rej(new ApiError('Request timed out', 0, true)); }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function rawFetch(url, opts = {}, ms = 15000) {
  const controller = new AbortController();
  try {
    return await withTimeout(fetch(url, { ...opts, signal: controller.signal }), ms, controller);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('Cannot reach the server. Check your internet connection.', 0, true);
  }
}

async function parse(res) {
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (res.ok) return data ?? {};
  const msg = data?.error;
  switch (res.status) {
    case 401: throw new ApiError(msg || 'Wrong app token. Check Settings.', 401);
    case 413: throw new ApiError(msg || 'File too large. Try a smaller file.', 413);
    case 400: throw new ApiError(msg || 'Bad request.', 400);
    case 503: throw new ApiError(msg || 'Server is busy or waking up. Try again.', 503);
    default: throw new ApiError(msg || `Server error (${res.status}).`, res.status);
  }
}

// ---- client with failover & token auth --------------------------------------
export class Client {
  constructor() {
    this.bases = [];
    this.token = '';
    this.authToken = '';
    this.authUser = null;
    this.active = null;
    this.lastOk = 0;
    this.healthData = null;
  }

  async load() {
    const url = await getPref('backend_url', '__unset__');
    const url2 = await getPref('backend_url2', '__unset__');
    this.bases = [
      clean(url === '__unset__' ? DEFAULTS.url : url),
      clean(url2 === '__unset__' ? DEFAULTS.url2 : url2),
    ].filter(Boolean);

    const savedToken = await getPref('app_token', '__unset__');
    if (savedToken === '__unset__') {
      this.token = DEFAULTS.token;
      await setPref('app_token', DEFAULTS.token);
    } else {
      this.token = savedToken;
    }

    this.authToken = await getPref('auth_jwt', '');
    try {
      const uStr = await getPref('auth_user', '');
      this.authUser = uStr ? JSON.parse(uStr) : null;
    } catch {
      this.authUser = null;
    }

    this.active = this.bases[0] || null;
    // Probe in background on load to quickly route to fastest responding backend
    this.probe(4000).catch(() => {});
  }

  get configured() { return this.bases.length > 0; }
  get isAuthenticated() { return !!this.authToken; }

  // Order to try: active first, then the others.
  ordered() {
    if (!this.active) return [...this.bases];
    return [this.active, ...this.bases.filter((b) => b !== this.active)];
  }

  async health(base, ms = 5000) {
    const res = await rawFetch(`${base}/health`, { method: 'GET' }, ms);
    return parse(res);
  }

  // Lightweight harmless authentication check against /history/auth-check-ping
  async testAuth(base, token, ms = 12000) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-API-Token'] = token;
    const res = await rawFetch(`${base}/history/auth-check-ping`, { method: 'GET', headers }, ms);
    if (res.status === 401) {
      throw new ApiError('Invalid or missing authentication token', 401);
    }
    return parse(res);
  }

  // Comprehensive test for Settings UI
  async testConnection(primaryUrl, backupUrl, tokenToTest) {
    const targets = [
      { name: 'Primary (Render)', url: clean(primaryUrl) },
      { name: 'Backup (Vercel)', url: clean(backupUrl) },
    ].filter((t) => t.url);

    const results = [];
    for (const target of targets) {
      try {
        const hData = await this.health(target.url, 15000);
        let tokenStatus = 'NOT CONFIGURED';
        let isTokenValid = true;

        if (tokenToTest) {
          try {
            await this.testAuth(target.url, tokenToTest, 12000);
            tokenStatus = 'VALID (HTTP 200)';
          } catch (authErr) {
            if (authErr.status === 401) {
              tokenStatus = 'INVALID TOKEN (HTTP 401)';
              isTokenValid = false;
            } else {
              tokenStatus = `AUTH PING: ${authErr.message}`;
            }
          }
        }

        results.push({
          name: target.name,
          url: target.url,
          online: true,
          statusText: !tokenToTest ? 'CONNECTED (NO TOKEN)' : isTokenValid ? 'CONNECTED (TOKEN VALID)' : 'INVALID TOKEN',
          storage: hData.storage || 'active',
          providers: (hData.llm_providers || []).join(', ') || 'JARVIS Core',
          tokenStatus,
        });
      } catch (err) {
        results.push({
          name: target.name,
          url: target.url,
          online: false,
          statusText: 'SERVER OFFLINE',
          error: err.message || 'Cannot reach server',
        });
      }
    }
    return results;
  }

  // Race all backends; first healthy one wins.
  async probe(ms = 5000) {
    const attempts = this.ordered().map((b) =>
      this.health(b, ms).then((data) => ({ base: b, data })));
    try {
      const winner = await Promise.any(attempts);
      this.active = winner.base;
      this.lastOk = Date.now();
      this.healthData = winner.data || null;
      return winner;
    } catch {
      return null;
    }
  }

  getProviderStatus(providerId) {
    const norm = (providerId || '').toLowerCase();
    const activeList = (this.healthData?.llm_providers || []).map((p) => String(p).toLowerCase());

    if (norm === 'jarvis') {
      return { id: 'jarvis', name: 'JARVIS Core', status: this.active ? 'active' : 'ready', label: 'Default Assistant' };
    }
    if (activeList.includes(norm) || activeList.some((p) => p.includes(norm))) {
      return { id: norm, name: providerId, status: 'ready', label: 'Online on Server' };
    }
    if (['gemini', 'groq', 'mistral', 'openrouter', 'openai', 'llm7', 'pollinations'].includes(norm)) {
      return { id: norm, name: providerId, status: 'server-config', label: 'Server Ready' };
    }
    return { id: norm, name: providerId, status: 'unintegrated', label: 'External' };
  }

  // Wake-up logic: probe now, then every 5s for up to 90s.
  async ensureAwake(onWaking) {
    if (this.active && Date.now() - this.lastOk < 10 * 60 * 1000) return true;
    const started = Date.now();
    let first = true;
    while (Date.now() - started < 90000) {
      const t0 = Date.now();
      const ok = await this.probe(5000);
      if (ok) return true;
      if (first) { onWaking?.(); first = false; }
      const wait = Math.max(0, 5000 - (Date.now() - t0));
      await new Promise((r) => setTimeout(r, wait));
    }
    return false;
  }

  headers(json = true) {
    const h = {};
    if (this.token) h['X-API-Token'] = this.token;
    if (this.authToken) h['Authorization'] = `Bearer ${this.authToken}`;
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  // Fast request with early failover:
  // Starts active backend. If no response within 4s, kicks off the backup backend in parallel.
  // Whichever healthy backend finishes first resolves and becomes the active route!
  async request(path, opts, ms = 45000) {
    const bases = this.ordered();
    if (!bases.length) {
      throw new ApiError('No backend URLs configured.', 0, true);
    }
    if (bases.length === 1) {
      const res = await rawFetch(`${bases[0]}${path}`, { ...opts, headers: this.headers(!!opts?.body) }, ms);
      const data = await parse(res);
      this.active = bases[0];
      this.lastOk = Date.now();
      return data;
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const errors = [];
      const controllers = [];

      const attempt = async (base) => {
        const c = new AbortController();
        controllers.push(c);
        try {
          const res = await withTimeout(
            fetch(`${base}${path}`, { ...opts, headers: this.headers(!!opts?.body), signal: c.signal }),
            ms,
            c
          );
          const data = await parse(res);
          if (!settled) {
            settled = true;
            this.active = base;
            this.lastOk = Date.now();
            controllers.forEach((ctrl) => { if (ctrl !== c) ctrl.abort(); });
            resolve(data);
          }
        } catch (err) {
          if (err.status === 401) {
            settled = true;
            controllers.forEach((ctrl) => ctrl.abort());
            reject(err);
            return;
          }
          errors.push(err);
          if (errors.length >= bases.length && !settled) {
            settled = true;
            reject(errors[0] || new ApiError('All backends failed.', 0, true));
          }
        }
      };

      // Try primary/active backend immediately
      attempt(bases[0]);

      // If active backend takes more than 4000ms (e.g. Render cold start), race backup
      const backupTimer = setTimeout(() => {
        if (!settled && bases[1]) {
          attempt(bases[1]);
        }
      }, 4000);
    });
  }

  chat(message, session_id, files) {
    return this.request('/chat', { method: 'POST', body: JSON.stringify({ message, session_id, files }) }, 60000);
  }

  history(session_id) {
    return this.request(`/history/${encodeURIComponent(session_id)}`, { method: 'GET' }, 20000);
  }

  // ================= User Authentication APIs =================
  async login(email, password) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }, 25000);

    const token = data.token || data.access_token || data.jwt || '';
    const user = data.user || { email, name: data.name || email.split('@')[0] };

    if (token) {
      this.authToken = token;
      this.authUser = user;
      await setPref('auth_jwt', token);
      await setPref('auth_user', JSON.stringify(user));
    }
    return { token, user, data };
  }

  async register(name, email, password) {
    const data = await this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }, 25000);

    const token = data.token || data.access_token || data.jwt || '';
    const user = data.user || { name, email };

    if (token) {
      this.authToken = token;
      this.authUser = user;
      await setPref('auth_jwt', token);
      await setPref('auth_user', JSON.stringify(user));
    }
    return { token, user, data };
  }

  async forgotPassword(email) {
    return this.request('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }, 20000);
  }

  async resetPassword(token, new_password) {
    return this.request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, new_password }),
    }, 20000);
  }

  async verifyEmail(code, email) {
    return this.request('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ code, email }),
    }, 20000);
  }

  async getMe() {
    return this.request('/auth/me', { method: 'GET' }, 15000);
  }

  async logout() {
    this.authToken = '';
    this.authUser = null;
    await setPref('auth_jwt', '');
    await setPref('auth_user', '');
  }

  // ================= Gmail Integration APIs =================
  async getGmailStatus() {
    try {
      return await this.request('/gmail/status', { method: 'GET' }, 15000);
    } catch (e) {
      // Try fallback /gmail/me if /gmail/status is not defined
      try {
        return await this.request('/gmail/me', { method: 'GET' }, 12000);
      } catch {
        throw e;
      }
    }
  }

  async getGmailAuthUrl() {
    return this.request('/gmail/auth/url', { method: 'GET' }, 15000);
  }

  async getGmailMessages({ folder = 'INBOX', q = '', page = 1, limit = 15 } = {}) {
    const params = new URLSearchParams();
    if (folder) params.set('folder', folder);
    if (q) params.set('q', q);
    if (page) params.set('page', page);
    if (limit) params.set('limit', limit);
    return this.request(`/gmail/messages?${params.toString()}`, { method: 'GET' }, 25000);
  }

  async getGmailMessage(id) {
    return this.request(`/gmail/messages/${encodeURIComponent(id)}`, { method: 'GET' }, 20000);
  }

  async sendGmail({ to, subject, body, cc = '', bcc = '' }) {
    return this.request('/gmail/send', {
      method: 'POST',
      body: JSON.stringify({ to, subject, body, cc, bcc }),
    }, 30000);
  }

  async replyGmail({ messageId, threadId, to, subject, body }) {
    return this.request('/gmail/reply', {
      method: 'POST',
      body: JSON.stringify({ messageId, threadId, to, subject, body }),
    }, 30000);
  }

  async toggleStarGmail(messageId, starred = true) {
    return this.request('/gmail/star', {
      method: 'POST',
      body: JSON.stringify({ messageId, starred }),
    }, 15000);
  }

  async trashGmail(messageId) {
    return this.request('/gmail/trash', {
      method: 'POST',
      body: JSON.stringify({ messageId }),
    }, 15000);
  }

  // ================= Google Calendar Integration APIs =================
  async getCalendarEvents() {
    return this.request('/calendar/events', { method: 'GET' }, 20000);
  }

  async createCalendarEvent({ summary, description, start, end, location }) {
    return this.request('/calendar/events/create', {
      method: 'POST',
      body: JSON.stringify({ summary, description, start, end, location }),
    }, 25000);
  }

  async deleteCalendarEvent(id) {
    try {
      return await this.request(`/calendar/events/${encodeURIComponent(id)}`, { method: 'DELETE' }, 20000);
    } catch {
      return await this.request(`/calendar/events/${encodeURIComponent(id)}/delete`, { method: 'POST' }, 20000);
    }
  }
}

export function newSessionId() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const arr = new Uint8Array(20);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join('');
}
