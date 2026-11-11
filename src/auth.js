// Authentication Management for JARVIS
import { audio } from './audio.js';

export class AuthManager {
  constructor(client, { onLoginSuccess, onLogout }) {
    this.client = client;
    this.onLoginSuccess = onLoginSuccess;
    this.onLogout = onLogout;
    this.activeView = 'login'; // 'login' | 'register' | 'forgot' | 'reset' | 'verify'
    this.user = null;
  }

  init() {
    this.cacheDom();
    this.bindEvents();
    this.checkSession();
  }

  cacheDom() {
    this.overlay = document.getElementById('auth-overlay');
    this.errorBanner = document.getElementById('auth-error-banner');
    this.errorText = document.getElementById('auth-error-text');

    // Forms
    this.viewLogin = document.getElementById('auth-view-login');
    this.viewRegister = document.getElementById('auth-view-register');
    this.viewForgot = document.getElementById('auth-view-forgot');
    this.viewReset = document.getElementById('auth-view-reset');
    this.viewVerify = document.getElementById('auth-view-verify');

    // Login inputs
    this.loginEmail = document.getElementById('auth-login-email');
    this.loginPass = document.getElementById('auth-login-pass');
    this.loginRemember = document.getElementById('auth-login-remember');
    this.btnLogin = document.getElementById('btn-auth-login');
    this.btnToggleLoginPass = document.getElementById('btn-toggle-login-pass');

    // Register inputs
    this.regName = document.getElementById('auth-reg-name');
    this.regEmail = document.getElementById('auth-reg-email');
    this.regPass = document.getElementById('auth-reg-pass');
    this.regPassConfirm = document.getElementById('auth-reg-pass-confirm');
    this.btnRegister = document.getElementById('btn-auth-register');
    this.btnToggleRegPass = document.getElementById('btn-toggle-reg-pass');

    // Forgot & Reset inputs
    this.forgotEmail = document.getElementById('auth-forgot-email');
    this.btnForgot = document.getElementById('btn-auth-forgot');
    this.resetToken = document.getElementById('auth-reset-token');
    this.resetPass = document.getElementById('auth-reset-pass');
    this.resetPassConfirm = document.getElementById('auth-reset-pass-confirm');
    this.btnReset = document.getElementById('btn-auth-reset');

    // Verify inputs
    this.verifyEmailDisplay = document.getElementById('auth-verify-email-display');
    this.verifyCode = document.getElementById('auth-verify-code');
    this.btnVerify = document.getElementById('btn-auth-verify');

    // Links for switching views
    this.linkToRegister = document.getElementById('link-to-register');
    this.linkToLogin = document.getElementById('link-to-login');
    this.linkToForgot = document.getElementById('link-to-forgot');
    this.linkForgotToLogin = document.getElementById('link-forgot-to-login');
    this.linkToReset = document.getElementById('link-to-reset');
    this.linkResetToLogin = document.getElementById('link-reset-to-login');
    this.linkVerifyToLogin = document.getElementById('link-verify-to-login');
  }

  showError(msg) {
    if (!this.errorBanner || !this.errorText) return;
    this.errorText.textContent = msg;
    this.errorBanner.classList.remove('hidden');
    audio.playChime('alert');
  }

  clearError() {
    if (!this.errorBanner) return;
    this.errorBanner.classList.add('hidden');
  }

  switchView(viewName) {
    this.activeView = viewName;
    this.clearError();

    const views = [
      { name: 'login', el: this.viewLogin },
      { name: 'register', el: this.viewRegister },
      { name: 'forgot', el: this.viewForgot },
      { name: 'reset', el: this.viewReset },
      { name: 'verify', el: this.viewVerify },
    ];

    views.forEach((v) => {
      if (v.el) {
        v.el.classList.toggle('hidden', v.name !== viewName);
      }
    });

    audio.playChime('click');
  }

  bindEvents() {
    // Show/Hide password toggles
    if (this.btnToggleLoginPass && this.loginPass) {
      this.btnToggleLoginPass.onclick = () => {
        const isPass = this.loginPass.type === 'password';
        this.loginPass.type = isPass ? 'text' : 'password';
        this.btnToggleLoginPass.textContent = isPass ? '🔒' : '👁️';
      };
    }

    if (this.btnToggleRegPass && this.regPass) {
      this.btnToggleRegPass.onclick = () => {
        const isPass = this.regPass.type === 'password';
        this.regPass.type = isPass ? 'text' : 'password';
        if (this.regPassConfirm) this.regPassConfirm.type = isPass ? 'text' : 'password';
        this.btnToggleRegPass.textContent = isPass ? '🔒' : '👁️';
      };
    }

    // View navigation links
    if (this.linkToRegister) this.linkToRegister.onclick = () => this.switchView('register');
    if (this.linkToLogin) this.linkToLogin.onclick = () => this.switchView('login');
    if (this.linkToForgot) this.linkToForgot.onclick = () => this.switchView('forgot');
    if (this.linkForgotToLogin) this.linkForgotToLogin.onclick = () => this.switchView('login');
    if (this.linkToReset) this.linkToReset.onclick = () => this.switchView('reset');
    if (this.linkResetToLogin) this.linkResetToLogin.onclick = () => this.switchView('login');
    if (this.linkVerifyToLogin) this.linkVerifyToLogin.onclick = () => this.switchView('login');

    // Login action
    if (this.btnLogin) {
      this.btnLogin.onclick = () => this.handleLogin();
    }
    if (this.loginPass) {
      this.loginPass.onkeydown = (e) => {
        if (e.key === 'Enter') this.handleLogin();
      };
    }

    // Register action
    if (this.btnRegister) {
      this.btnRegister.onclick = () => this.handleRegister();
    }

    // Forgot Password action
    if (this.btnForgot) {
      this.btnForgot.onclick = () => this.handleForgot();
    }

    // Reset Password action
    if (this.btnReset) {
      this.btnReset.onclick = () => this.handleReset();
    }

    // Verify Email action
    if (this.btnVerify) {
      this.btnVerify.onclick = () => this.handleVerify();
    }
  }

  async checkSession() {
    if (this.client.isAuthenticated && this.client.authUser) {
      this.user = this.client.authUser;
      this.hideOverlay();
      this.onLoginSuccess?.(this.user);
      return;
    }

    // Attempt to validate token with /auth/me in background
    if (this.client.authToken) {
      try {
        const res = await this.client.getMe();
        if (res && res.user) {
          this.user = res.user;
          this.hideOverlay();
          this.onLoginSuccess?.(this.user);
          return;
        }
      } catch (err) {
        if (err.status === 401) {
          await this.client.logout();
        }
      }
    }

    // Show auth overlay as the mandatory first screen
    this.showOverlay();
  }

  showOverlay() {
    if (this.overlay) {
      this.overlay.classList.remove('hidden', 'fade-out');
      this.switchView('login');
    }
  }

  hideOverlay() {
    if (this.overlay) {
      this.overlay.classList.add('fade-out');
      setTimeout(() => {
        this.overlay.classList.add('hidden');
      }, 350);
    }
  }

  async handleLogin() {
    const email = (this.loginEmail?.value || '').trim();
    const pass = this.loginPass?.value || '';

    if (!email || !pass) {
      this.showError('Please enter both email address and password.');
      return;
    }

    this.clearError();
    this.setBtnLoading(this.btnLogin, true, 'AUTHENTICATING...');

    try {
      const { user } = await this.client.login(email, pass);
      this.user = user || { email, name: email.split('@')[0] };
      audio.playChime('startup');
      this.hideOverlay();
      this.onLoginSuccess?.(this.user);
    } catch (err) {
      this.showError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      this.setBtnLoading(this.btnLogin, false, 'Sign In to JARVIS');
    }
  }

  async handleRegister() {
    const name = (this.regName?.value || '').trim();
    const email = (this.regEmail?.value || '').trim();
    const pass = this.regPass?.value || '';
    const passConfirm = this.regPassConfirm?.value || '';

    if (!name || !email || !pass) {
      this.showError('All registration fields are required.');
      return;
    }

    if (pass.length < 6) {
      this.showError('Password must contain at least 6 characters.');
      return;
    }

    if (pass !== passConfirm) {
      this.showError('Passwords do not match. Please verify.');
      return;
    }

    this.clearError();
    this.setBtnLoading(this.btnRegister, true, 'CREATING ACCOUNT...');

    try {
      const { user, data } = await this.client.register(name, email, pass);
      if (data && data.requires_verification) {
        if (this.verifyEmailDisplay) this.verifyEmailDisplay.textContent = email;
        this.switchView('verify');
        audio.playChime('complete');
      } else {
        this.user = user || { name, email };
        audio.playChime('startup');
        this.hideOverlay();
        this.onLoginSuccess?.(this.user);
      }
    } catch (err) {
      this.showError(err.message || 'Registration failed. Email may already be registered.');
    } finally {
      this.setBtnLoading(this.btnRegister, false, 'Create Account');
    }
  }

  async handleForgot() {
    const email = (this.forgotEmail?.value || '').trim();
    if (!email) {
      this.showError('Please enter the email address for password reset.');
      return;
    }

    this.clearError();
    this.setBtnLoading(this.btnForgot, true, 'SENDING...');

    try {
      await this.client.forgotPassword(email);
      audio.playChime('complete');
      this.showError('Reset instructions dispatched. Please check your inbox or spam folder.');
      setTimeout(() => {
        this.switchView('reset');
      }, 2000);
    } catch (err) {
      this.showError(err.message || 'Failed to dispatch reset instructions.');
    } finally {
      this.setBtnLoading(this.btnForgot, false, 'Send Reset Instructions');
    }
  }

  async handleReset() {
    const token = (this.resetToken?.value || '').trim();
    const newPass = this.resetPass?.value || '';
    const newPassConfirm = this.resetPassConfirm?.value || '';

    if (!token || !newPass) {
      this.showError('Please enter both the reset token and your new password.');
      return;
    }

    if (newPass !== newPassConfirm) {
      this.showError('Passwords do not match.');
      return;
    }

    this.clearError();
    this.setBtnLoading(this.btnReset, true, 'RESETTING...');

    try {
      await this.client.resetPassword(token, newPass);
      audio.playChime('complete');
      this.showError('Password successfully updated. You may now sign in.');
      setTimeout(() => {
        this.switchView('login');
      }, 1500);
    } catch (err) {
      this.showError(err.message || 'Failed to reset password. Check your token.');
    } finally {
      this.setBtnLoading(this.btnReset, false, 'Update Password');
    }
  }

  async handleVerify() {
    const email = (this.regEmail?.value || this.loginEmail?.value || '').trim();
    const code = (this.verifyCode?.value || '').trim();

    if (!code) {
      this.showError('Please enter the 6-digit verification code.');
      return;
    }

    this.clearError();
    this.setBtnLoading(this.btnVerify, true, 'VERIFYING...');

    try {
      await this.client.verifyEmail(code, email);
      audio.playChime('complete');
      this.showError('Account successfully verified! Please log in.');
      setTimeout(() => {
        this.switchView('login');
      }, 1500);
    } catch (err) {
      this.showError(err.message || 'Verification code invalid or expired.');
    } finally {
      this.setBtnLoading(this.btnVerify, false, 'Verify Account');
    }
  }

  async logout() {
    await this.client.logout();
    this.user = null;
    this.showOverlay();
    this.onLogout?.();
    audio.playChime('click');
  }

  setBtnLoading(btn, isLoading, text) {
    if (!btn) return;
    btn.disabled = isLoading;
    btn.textContent = text;
  }
}
