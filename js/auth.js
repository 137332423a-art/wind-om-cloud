/* ============================================================
 * 云端登录：Supabase Auth REST + 前端会话管理
 * 只保存 access_token / refresh_token，不保存用户密码。
 * ============================================================ */

const AUTH_STORAGE_KEY = 'wind-om-cloud-session';

const Auth = {
  _bound: false,

  config() {
    const cfg = window.CLOUD_CONFIG || {};
    return {
      url: String(cfg.supabaseUrl || '').replace(/\/+$/, ''),
      anonKey: String(cfg.supabaseAnonKey || ''),
      photoBucket: cfg.photoBucket || 'defect-photos'
    };
  },

  configured() {
    const cfg = this.config();
    const validUrl = /^https:\/\/.+/i.test(cfg.url) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(cfg.url);
    return validUrl && cfg.anonKey.length > 20 &&
      !cfg.anonKey.includes('YOUR_');
  },

  session() {
    try {
      const value = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null');
      return value && value.access_token ? value : null;
    } catch {
      return null;
    }
  },

  _saveSession(result) {
    const session = {
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_at: Date.now() + Math.max(30, Number(result.expires_in || 3600) - 60) * 1000,
      user: result.user || null
    };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    return session;
  },

  clearSession() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  },

  async login(email, password) {
    if (!this.configured()) throw this._error('请先填写 Supabase 项目配置', 'CONFIG_REQUIRED');
    const cfg = this.config();
    const response = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'apikey': cfg.anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
    const body = await this._responseJSON(response);
    if (!response.ok) throw this._error(this._authError(body), 'LOGIN_FAILED');
    return this._saveSession(body);
  },

  async refresh() {
    const old = this.session();
    if (!old || !old.refresh_token) throw this._error('登录已过期，请重新登录', 'AUTH_REQUIRED');
    const cfg = this.config();
    const response = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'apikey': cfg.anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refresh_token: old.refresh_token })
    });
    const body = await this._responseJSON(response);
    if (!response.ok) {
      this.clearSession();
      throw this._error('登录已过期，请重新登录', 'AUTH_REQUIRED');
    }
    return this._saveSession(body);
  },

  async ensureSession() {
    if (!this.configured()) throw this._error('请先配置云端项目地址和公开密钥', 'CONFIG_REQUIRED');
    let session = this.session();
    if (!session) throw this._error('请先登录', 'AUTH_REQUIRED');
    if (!session.expires_at || session.expires_at <= Date.now()) {
      session = await this.refresh();
    }
    return session;
  },

  async logout() {
    const session = this.session();
    const cfg = this.config();
    if (session && cfg.url) {
      try {
        await fetch(`${cfg.url}/auth/v1/logout`, {
          method: 'POST',
          headers: {
            'apikey': cfg.anonKey,
            'Authorization': `Bearer ${session.access_token}`
          }
        });
      } catch {
        /* Local logout still succeeds when the network is unavailable. */
      }
    }
    this.clearSession();
  },

  async api(path, options = {}) {
    const cfg = this.config();
    const session = await this.ensureSession();
    const headers = new Headers(options.headers || {});
    headers.set('apikey', cfg.anonKey);
    headers.set('Authorization', `Bearer ${session.access_token}`);
    const response = await fetch(`${cfg.url}${path}`, { ...options, headers });
    if (response.status === 401 || response.status === 403) {
      this.clearSession();
      this.showLogin('登录已过期，请重新登录');
    }
    return response;
  },

  async _responseJSON(response) {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  },

  _authError(body) {
    const code = body.error_code || body.code || '';
    if (code === 'invalid_credentials' || body.error === 'invalid_grant') {
      return '邮箱或密码不正确';
    }
    if (code === 'email_not_confirmed') return '账号邮箱尚未确认';
    return body.message || body.msg || body.error_description || body.error || '登录失败';
  },

  _error(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  },

  showSetup() {
    const screen = document.getElementById('authScreen');
    const form = document.getElementById('loginForm');
    const setup = document.getElementById('authSetup');
    if (!screen) return;
    screen.classList.remove('hidden');
    form.classList.add('hidden');
    setup.classList.remove('hidden');
    this.setError('');
  },

  showLogin(message = '') {
    const screen = document.getElementById('authScreen');
    const form = document.getElementById('loginForm');
    const setup = document.getElementById('authSetup');
    if (!screen) return;
    screen.classList.remove('hidden');
    form.classList.remove('hidden');
    setup.classList.add('hidden');
    this.setError(message);
    setTimeout(() => document.getElementById('authEmail')?.focus(), 50);
  },

  hide() {
    document.getElementById('authScreen')?.classList.add('hidden');
    this.setError('');
  },

  setError(message) {
    const element = document.getElementById('authError');
    if (!element) return;
    element.textContent = message || '';
    element.classList.toggle('hidden', !message);
  },

  bindUI() {
    if (this._bound) return;
    this._bound = true;
    document.getElementById('loginForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const button = document.getElementById('loginBtn');
      const email = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value;
      if (!email || !password) return this.setError('请输入邮箱和密码');
      button.disabled = true;
      button.textContent = '登录中...';
      this.setError('');
      try {
        await this.login(email, password);
        this.hide();
        await startCloudApp();
      } catch (error) {
        this.setError(error.message || '登录失败');
      } finally {
        button.disabled = false;
        button.textContent = '登录';
      }
    });
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await this.logout();
      location.reload();
    });
  }
};
