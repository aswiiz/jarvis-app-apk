// Dedicated Gmail Assistant Integration for JARVIS
import { audio } from './audio.js';

export class GmailAssistant {
  constructor(client, { toast }) {
    this.client = client;
    this.toast = toast;
    this.activeFolder = 'INBOX';
    this.searchQuery = '';
    this.page = 1;
    this.limit = 12;
    this.messages = [];
    this.selectedMessage = null;
    this.status = { connected: false, email: '' };
    this.composePendingData = null;
  }

  init() {
    this.cacheDom();
    this.bindEvents();
  }

  cacheDom() {
    this.modal = document.getElementById('modal-gmail');
    this.statusBadge = document.getElementById('gmail-status-badge');
    this.btnConnect = document.getElementById('btn-gmail-connect');
    this.btnRefresh = document.getElementById('btn-gmail-refresh');
    this.btnCompose = document.getElementById('btn-gmail-compose');
    this.btnClose = document.getElementById('btn-close-gmail');

    // Search
    this.searchInput = document.getElementById('gmail-search-input');
    this.btnSearch = document.getElementById('btn-gmail-search');

    // Folders
    this.folderTabs = document.querySelectorAll('#modal-gmail .gmail-folder-tab');

    // List & Pagination
    this.listContainer = document.getElementById('gmail-messages-list');
    this.paginationBox = document.getElementById('gmail-pagination-bar');
    this.btnPrevPage = document.getElementById('btn-gmail-prev');
    this.btnNextPage = document.getElementById('btn-gmail-next');
    this.pageLabel = document.getElementById('gmail-page-label');

    // Detail Modal
    this.detailModal = document.getElementById('modal-gmail-detail');
    this.btnCloseDetail = document.getElementById('btn-close-gmail-detail');
    this.detailSender = document.getElementById('gmail-detail-sender');
    this.detailTo = document.getElementById('gmail-detail-to');
    this.detailDate = document.getElementById('gmail-detail-date');
    this.detailSubject = document.getElementById('gmail-detail-subject');
    this.detailBody = document.getElementById('gmail-detail-body');
    this.btnStarDetail = document.getElementById('btn-gmail-star-detail');
    this.btnTrashDetail = document.getElementById('btn-gmail-trash-detail');
    this.btnReplyDetail = document.getElementById('btn-gmail-reply-detail');
    this.btnForwardDetail = document.getElementById('btn-gmail-forward-detail');

    // Compose Modal
    this.composeModal = document.getElementById('modal-gmail-compose');
    this.composeTitle = document.getElementById('gmail-compose-title');
    this.btnCloseCompose = document.getElementById('btn-close-gmail-compose');
    this.composeTo = document.getElementById('gmail-compose-to');
    this.composeSubject = document.getElementById('gmail-compose-subject');
    this.composeBody = document.getElementById('gmail-compose-body');
    this.btnSendCompose = document.getElementById('btn-gmail-send-compose');
    this.btnSaveDraftCompose = document.getElementById('btn-gmail-save-draft');

    // Confirm Send Dialog
    this.confirmModal = document.getElementById('modal-gmail-confirm');
    this.confirmSummary = document.getElementById('gmail-confirm-summary');
    this.btnConfirmSend = document.getElementById('btn-gmail-confirm-send');
    this.btnCancelSend = document.getElementById('btn-gmail-cancel-send');
  }

  bindEvents() {
    if (this.btnClose) {
      this.btnClose.onclick = () => this.hide();
    }

    if (this.btnConnect) {
      this.btnConnect.onclick = () => this.handleConnectGoogle();
    }

    if (this.btnRefresh) {
      this.btnRefresh.onclick = () => {
        audio.playChime('click');
        this.loadMessages();
      };
    }

    if (this.btnCompose) {
      this.btnCompose.onclick = () => this.openCompose();
    }

    if (this.btnSearch && this.searchInput) {
      this.btnSearch.onclick = () => {
        this.searchQuery = this.searchInput.value.trim();
        this.page = 1;
        this.loadMessages();
      };
      this.searchInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          this.btnSearch.click();
        }
      };
    }

    // Folder tab switching
    this.folderTabs.forEach((tab) => {
      tab.onclick = () => {
        this.folderTabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeFolder = tab.dataset.folder || 'INBOX';
        this.page = 1;
        this.searchQuery = '';
        if (this.searchInput) this.searchInput.value = '';
        audio.playChime('click');
        this.loadMessages();
      };
    });

    // Pagination
    if (this.btnPrevPage) {
      this.btnPrevPage.onclick = () => {
        if (this.page > 1) {
          this.page--;
          this.loadMessages();
        }
      };
    }
    if (this.btnNextPage) {
      this.btnNextPage.onclick = () => {
        this.page++;
        this.loadMessages();
      };
    }

    // Detail handlers
    if (this.btnCloseDetail) {
      this.btnCloseDetail.onclick = () => {
        if (this.detailModal) this.detailModal.classList.add('hidden');
      };
    }

    if (this.btnStarDetail) {
      this.btnStarDetail.onclick = async () => {
        if (!this.selectedMessage) return;
        const newStar = !this.selectedMessage.isStarred;
        try {
          await this.client.toggleStarGmail(this.selectedMessage.id, newStar);
          this.selectedMessage.isStarred = newStar;
          this.btnStarDetail.textContent = newStar ? '★ Starred' : '☆ Star';
          this.toast(newStar ? 'Email marked as starred.' : 'Star removed.', 'info');
          this.renderList();
        } catch (err) {
          this.toast('Failed to update star: ' + err.message, 'error');
        }
      };
    }

    if (this.btnTrashDetail) {
      this.btnTrashDetail.onclick = async () => {
        if (!this.selectedMessage) return;
        try {
          await this.client.trashGmail(this.selectedMessage.id);
          this.toast('Message moved to Trash.', 'success');
          if (this.detailModal) this.detailModal.classList.add('hidden');
          this.loadMessages();
        } catch (err) {
          this.toast('Failed to trash email: ' + err.message, 'error');
        }
      };
    }

    if (this.btnReplyDetail) {
      this.btnReplyDetail.onclick = () => {
        if (!this.selectedMessage) return;
        this.openCompose({
          to: this.selectedMessage.from || '',
          subject: (this.selectedMessage.subject || '').startsWith('Re:') ? this.selectedMessage.subject : `Re: ${this.selectedMessage.subject}`,
          body: `\n\n--- On ${this.selectedMessage.date || 'prior date'}, ${this.selectedMessage.from} wrote ---\n> ${(this.selectedMessage.snippet || '').slice(0, 300)}`,
          messageId: this.selectedMessage.id,
          threadId: this.selectedMessage.threadId,
        });
      };
    }

    if (this.btnForwardDetail) {
      this.btnForwardDetail.onclick = () => {
        if (!this.selectedMessage) return;
        this.openCompose({
          to: '',
          subject: `Fwd: ${this.selectedMessage.subject || ''}`,
          body: `\n\n--- Forwarded message ---\nFrom: ${this.selectedMessage.from}\nDate: ${this.selectedMessage.date}\nSubject: ${this.selectedMessage.subject}\n\n${this.selectedMessage.bodyText || this.selectedMessage.snippet || ''}`,
        });
      };
    }

    // Compose Handlers
    if (this.btnCloseCompose) {
      this.btnCloseCompose.onclick = () => {
        if (this.composeModal) this.composeModal.classList.add('hidden');
      };
    }

    if (this.btnSendCompose) {
      this.btnSendCompose.onclick = () => this.handlePreSendValidation();
    }

    if (this.btnSaveDraftCompose) {
      this.btnSaveDraftCompose.onclick = () => {
        const to = this.composeTo?.value || '';
        const subj = this.composeSubject?.value || '';
        const body = this.composeBody?.value || '';
        this.toast('Email draft stored locally.', 'success');
        if (this.composeModal) this.composeModal.classList.add('hidden');
      };
    }

    // Confirmation Handlers
    if (this.btnCancelSend) {
      this.btnCancelSend.onclick = () => {
        if (this.confirmModal) this.confirmModal.classList.add('hidden');
      };
    }

    if (this.btnConfirmSend) {
      this.btnConfirmSend.onclick = () => this.executeSendEmail();
    }
  }

  show() {
    if (this.modal) {
      this.modal.classList.remove('hidden');
      this.checkStatus();
      this.loadMessages();
    }
  }

  hide() {
    if (this.modal) this.modal.classList.add('hidden');
    if (this.detailModal) this.detailModal.classList.add('hidden');
    if (this.composeModal) this.composeModal.classList.add('hidden');
    if (this.confirmModal) this.confirmModal.classList.add('hidden');
  }

  async checkStatus() {
    try {
      const data = await this.client.getGmailStatus();
      this.status = {
        connected: !!(data && (data.connected || data.email)),
        email: data.email || data.user || '',
      };
      this.updateStatusUI();
    } catch {
      this.status = { connected: false, email: '' };
      this.updateStatusUI();
    }
  }

  updateStatusUI() {
    if (!this.statusBadge) return;
    if (this.status.connected) {
      this.statusBadge.textContent = `Connected: ${this.status.email}`;
      this.statusBadge.className = 'status-badge online';
      if (this.btnConnect) this.btnConnect.textContent = 'Switch Account';
    } else {
      this.statusBadge.textContent = 'Google Account Not Linked';
      this.statusBadge.className = 'status-badge offline';
      if (this.btnConnect) this.btnConnect.textContent = 'Connect Google';
    }
  }

  async handleConnectGoogle() {
    audio.playChime('click');
    try {
      const res = await this.client.getGmailAuthUrl();
      const url = res?.url || res?.auth_url;
      if (url) {
        this.toast('Opening Google Authorization...', 'info');
        const win = window.open(url, '_blank');
        if (!win) {
          window.location.href = url;
        }
      } else {
        this.toast('OAuth link could not be generated by backend.', 'error');
      }
    } catch (err) {
      this.toast('Gmail OAuth error: ' + err.message, 'error');
    }
  }

  async loadMessages() {
    if (!this.listContainer) return;
    this.listContainer.innerHTML = '<div class="empty-state"><div class="spinner"></div><div>Syncing messages with Gmail...</div></div>';

    try {
      const res = await this.client.getGmailMessages({
        folder: this.activeFolder,
        q: this.searchQuery,
        page: this.page,
        limit: this.limit,
      });

      this.messages = res.messages || res.items || (Array.isArray(res) ? res : []);
      this.renderList();
      this.renderPagination(res.totalPages || Math.ceil((res.total || this.messages.length) / this.limit));
    } catch (err) {
      const notLinked = (err.message || '').includes('auth') || (err.message || '').includes('401') || (err.message || '').includes('token');
      this.listContainer.innerHTML = `
        <div class="empty-state">
          <div style="font-size: 32px; margin-bottom: 8px;">✉️</div>
          <div style="font-weight: 600; color: var(--text);">${notLinked ? 'Gmail Account Required' : 'Failed to Sync Messages'}</div>
          <div style="font-size: 13px; color: var(--text-dim); max-width: 320px; margin: 4px auto 14px;">
            ${notLinked ? 'Authorize JARVIS with your Google account to read, search, and send emails.' : err.message}
          </div>
          <button id="btn-empty-connect" class="btn primary">${notLinked ? 'Connect Google Account' : 'Retry'}</button>
        </div>
      `;
      const btn = document.getElementById('btn-empty-connect');
      if (btn) {
        btn.onclick = () => notLinked ? this.handleConnectGoogle() : this.loadMessages();
      }
    }
  }

  renderList() {
    if (!this.listContainer) return;
    this.listContainer.innerHTML = '';

    if (!this.messages.length) {
      this.listContainer.innerHTML = `
        <div class="empty-state">
          <div style="font-size: 28px; margin-bottom: 6px;">📭</div>
          <div style="font-weight: 600;">No emails in ${this.activeFolder}</div>
          <div>Your mailbox is currently clear.</div>
        </div>
      `;
      return;
    }

    this.messages.forEach((msg) => {
      const item = document.createElement('div');
      item.className = `gmail-msg-item ${msg.isUnread ? 'unread' : ''}`;

      const starIcon = msg.isStarred ? '★' : '☆';
      const sender = msg.from ? msg.from.replace(/<[^>]+>/g, '').trim() : 'Unknown';
      const dateStr = msg.date ? new Date(msg.date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';

      item.innerHTML = `
        <div class="gmail-msg-meta">
          <button class="btn-star-inline ${msg.isStarred ? 'starred' : ''}" title="Star message">${starIcon}</button>
          <span class="gmail-sender ${msg.isUnread ? 'font-bold' : ''}">${sender}</span>
          <span class="gmail-date">${dateStr}</span>
        </div>
        <div class="gmail-subject ${msg.isUnread ? 'font-bold' : ''}">${msg.subject || '(No Subject)'}</div>
        <div class="gmail-snippet">${msg.snippet || ''}</div>
      `;

      // Star toggle click
      const starBtn = item.querySelector('.btn-star-inline');
      if (starBtn) {
        starBtn.onclick = async (e) => {
          e.stopPropagation();
          const targetStar = !msg.isStarred;
          try {
            await this.client.toggleStarGmail(msg.id, targetStar);
            msg.isStarred = targetStar;
            starBtn.textContent = targetStar ? '★' : '☆';
            starBtn.classList.toggle('starred', targetStar);
          } catch {
            this.toast('Failed to update star', 'error');
          }
        };
      }

      // Card click opens detail
      item.onclick = () => this.openMessageDetail(msg);

      this.listContainer.appendChild(item);
    });
  }

  renderPagination(totalPages = 1) {
    if (!this.paginationBox) return;
    if (this.messages.length < this.limit && this.page === 1) {
      this.paginationBox.classList.add('hidden');
      return;
    }
    this.paginationBox.classList.remove('hidden');
    if (this.pageLabel) this.pageLabel.textContent = `Page ${this.page}`;
    if (this.btnPrevPage) this.btnPrevPage.disabled = this.page <= 1;
    if (this.btnNextPage) this.btnNextPage.disabled = this.messages.length < this.limit;
  }

  async openMessageDetail(summary) {
    if (!this.detailModal) return;
    this.selectedMessage = summary;
    this.detailModal.classList.remove('hidden');

    if (this.detailSender) this.detailSender.textContent = summary.from || 'Unknown';
    if (this.detailTo) this.detailTo.textContent = summary.to || 'Me';
    if (this.detailDate) this.detailDate.textContent = summary.date || '';
    if (this.detailSubject) this.detailSubject.textContent = summary.subject || '(No Subject)';
    if (this.btnStarDetail) this.btnStarDetail.textContent = summary.isStarred ? '★ Starred' : '☆ Star';

    if (this.detailBody) {
      this.detailBody.innerHTML = '<div class="spinner"></div> Loading full email body...';
    }

    try {
      const full = await this.client.getGmailMessage(summary.id);
      this.selectedMessage = { ...summary, ...full };
      if (this.detailBody) {
        if (full.bodyHtml) {
          this.detailBody.innerHTML = full.bodyHtml;
        } else {
          this.detailBody.textContent = full.bodyText || summary.snippet || '(No content)';
        }
      }
    } catch {
      if (this.detailBody) {
        this.detailBody.textContent = summary.snippet || 'Body could not be loaded.';
      }
    }
  }

  openCompose(draft = {}) {
    if (!this.composeModal) return;
    this.composeModal.classList.remove('hidden');
    if (this.composeTitle) this.composeTitle.textContent = draft.messageId ? 'Reply Transmission' : 'New Email Transmission';
    if (this.composeTo) this.composeTo.value = draft.to || '';
    if (this.composeSubject) this.composeSubject.value = draft.subject || '';
    if (this.composeBody) this.composeBody.value = draft.body || '';

    this.composePendingData = {
      messageId: draft.messageId || null,
      threadId: draft.threadId || null,
    };
  }

  handlePreSendValidation() {
    const to = (this.composeTo?.value || '').trim();
    const subject = (this.composeSubject?.value || '').trim();
    const body = (this.composeBody?.value || '').trim();

    if (!to) {
      this.toast('Recipient email address is required.', 'error');
      return;
    }
    if (!subject) {
      this.toast('Subject line is required.', 'error');
      return;
    }

    // Open explicit confirmation dialog before sending
    this.composePendingData = {
      ...this.composePendingData,
      to,
      subject,
      body,
    };

    if (this.confirmSummary) {
      this.confirmSummary.innerHTML = `
        <div style="margin-bottom: 8px;"><b>Recipient:</b> ${to}</div>
        <div style="margin-bottom: 8px;"><b>Subject:</b> ${subject}</div>
        <div style="font-size: 12px; color: var(--text-dim); max-height: 80px; overflow-y: auto;">
          ${body.slice(0, 150)}${body.length > 150 ? '...' : ''}
        </div>
      `;
    }

    if (this.confirmModal) {
      this.confirmModal.classList.remove('hidden');
    }
  }

  async executeSendEmail() {
    if (!this.composePendingData) return;
    if (this.btnConfirmSend) {
      this.btnConfirmSend.disabled = true;
      this.btnConfirmSend.textContent = 'Transmitting...';
    }

    try {
      if (this.composePendingData.messageId) {
        await this.client.replyGmail({
          messageId: this.composePendingData.messageId,
          threadId: this.composePendingData.threadId,
          to: this.composePendingData.to,
          subject: this.composePendingData.subject,
          body: this.composePendingData.body,
        });
        this.toast('Reply sent successfully via Gmail.', 'success');
      } else {
        await this.client.sendGmail({
          to: this.composePendingData.to,
          subject: this.composePendingData.subject,
          body: this.composePendingData.body,
        });
        this.toast('Email transmitted successfully via Gmail.', 'success');
      }

      audio.playChime('complete');
      if (this.confirmModal) this.confirmModal.classList.add('hidden');
      if (this.composeModal) this.composeModal.classList.add('hidden');
      this.loadMessages();
    } catch (err) {
      this.toast('Transmission failed: ' + err.message, 'error');
    } finally {
      if (this.btnConfirmSend) {
        this.btnConfirmSend.disabled = false;
        this.btnConfirmSend.textContent = 'Confirm & Send';
      }
    }
  }
}
