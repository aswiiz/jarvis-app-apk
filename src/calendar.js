// Dedicated Google Calendar Integration for JARVIS
import { audio } from './audio.js';

export class CalendarAssistant {
  constructor(client, { toast }) {
    this.client = client;
    this.toast = toast;
    this.events = [];
    this.selectedEvent = null;
    this.eventToDelete = null;
  }

  init() {
    this.cacheDom();
    this.bindEvents();
  }

  cacheDom() {
    this.modal = document.getElementById('modal-calendar');
    this.btnClose = document.getElementById('btn-close-calendar');
    this.btnRefresh = document.getElementById('btn-calendar-refresh');
    this.btnOpenCreate = document.getElementById('btn-calendar-open-create');
    this.eventsList = document.getElementById('calendar-events-list');

    // Create Modal
    this.createModal = document.getElementById('modal-calendar-create');
    this.btnCloseCreate = document.getElementById('btn-close-calendar-create');
    this.inpTitle = document.getElementById('calendar-new-title');
    this.inpStart = document.getElementById('calendar-new-start');
    this.inpEnd = document.getElementById('calendar-new-end');
    this.inpLocation = document.getElementById('calendar-new-location');
    this.inpDesc = document.getElementById('calendar-new-desc');
    this.btnSubmitCreate = document.getElementById('btn-calendar-submit-create');

    // Confirm Delete Modal
    this.deleteModal = document.getElementById('modal-calendar-confirm-delete');
    this.deleteTitle = document.getElementById('calendar-delete-event-title');
    this.btnConfirmDelete = document.getElementById('btn-calendar-confirm-delete');
    this.btnCancelDelete = document.getElementById('btn-calendar-cancel-delete');
  }

  bindEvents() {
    if (this.btnClose) {
      this.btnClose.onclick = () => this.hide();
    }

    if (this.btnRefresh) {
      this.btnRefresh.onclick = () => {
        audio.playChime('click');
        this.loadEvents();
      };
    }

    if (this.btnOpenCreate) {
      this.btnOpenCreate.onclick = () => this.openCreateModal();
    }

    if (this.btnCloseCreate) {
      this.btnCloseCreate.onclick = () => {
        if (this.createModal) this.createModal.classList.add('hidden');
      };
    }

    if (this.btnSubmitCreate) {
      this.btnSubmitCreate.onclick = () => this.handleCreateEvent();
    }

    if (this.btnCancelDelete) {
      this.btnCancelDelete.onclick = () => {
        if (this.deleteModal) this.deleteModal.classList.add('hidden');
      };
    }

    if (this.btnConfirmDelete) {
      this.btnConfirmDelete.onclick = () => this.executeDeleteEvent();
    }
  }

  show() {
    if (this.modal) {
      this.modal.classList.remove('hidden');
      this.loadEvents();
    }
  }

  hide() {
    if (this.modal) this.modal.classList.add('hidden');
    if (this.createModal) this.createModal.classList.add('hidden');
    if (this.deleteModal) this.deleteModal.classList.add('hidden');
  }

  async loadEvents() {
    if (!this.eventsList) return;
    this.eventsList.innerHTML = '<div class="empty-state"><div class="spinner"></div><div>Synchronizing Google Calendar...</div></div>';

    try {
      const res = await this.client.getCalendarEvents();
      this.events = res.events || res.items || (Array.isArray(res) ? res : []);
      this.renderEvents();
    } catch (err) {
      this.eventsList.innerHTML = `
        <div class="empty-state">
          <div style="font-size: 32px; margin-bottom: 8px;">📅</div>
          <div style="font-weight: 600; color: var(--text);">Calendar Schedule Unavailable</div>
          <div style="font-size: 13px; color: var(--text-dim); max-width: 320px; margin: 4px auto 14px;">
            ${err.message || 'Unable to retrieve upcoming events from Google Calendar.'}
          </div>
          <button id="btn-retry-cal" class="btn primary">Retry</button>
        </div>
      `;
      const btn = document.getElementById('btn-retry-cal');
      if (btn) btn.onclick = () => this.loadEvents();
    }
  }

  renderEvents() {
    if (!this.eventsList) return;
    this.eventsList.innerHTML = '';

    if (!this.events.length) {
      this.eventsList.innerHTML = `
        <div class="empty-state">
          <div style="font-size: 28px; margin-bottom: 6px;">☕</div>
          <div style="font-weight: 600;">No Upcoming Events</div>
          <div>Your schedule is completely clear.</div>
        </div>
      `;
      return;
    }

    this.events.forEach((ev) => {
      const card = document.createElement('div');
      card.className = 'calendar-event-card';

      const start = ev.start?.dateTime || ev.start?.date || ev.start;
      const end = ev.end?.dateTime || ev.end?.date || ev.end;
      const dateStr = start ? new Date(start).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : 'Today';
      const timeStr = start && start.includes('T')
        ? `${new Date(start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${end ? new Date(end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}`
        : 'All Day';

      card.innerHTML = `
        <div class="cal-event-header">
          <span class="cal-date-badge">${dateStr}</span>
          <span class="cal-time-badge">${timeStr}</span>
        </div>
        <div class="cal-title">${ev.summary || ev.title || '(Untitled Event)'}</div>
        ${ev.location ? `<div class="cal-location">📍 ${ev.location}</div>` : ''}
        ${ev.description ? `<div class="cal-desc">${ev.description}</div>` : ''}
        <div class="cal-actions">
          <button class="cal-btn-del" title="Delete event">🗑️ Delete</button>
        </div>
      `;

      const delBtn = card.querySelector('.cal-btn-del');
      if (delBtn) {
        delBtn.onclick = (e) => {
          e.stopPropagation();
          this.promptDeleteEvent(ev);
        };
      }

      this.eventsList.appendChild(card);
    });
  }

  openCreateModal() {
    if (!this.createModal) return;
    this.createModal.classList.remove('hidden');

    const now = new Date();
    const nowStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const endStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000 + 3600000).toISOString().slice(0, 16);

    if (this.inpTitle) this.inpTitle.value = '';
    if (this.inpStart) this.inpStart.value = nowStr;
    if (this.inpEnd) this.inpEnd.value = endStr;
    if (this.inpLocation) this.inpLocation.value = '';
    if (this.inpDesc) this.inpDesc.value = '';
  }

  async handleCreateEvent() {
    const summary = (this.inpTitle?.value || '').trim();
    const start = this.inpStart?.value || '';
    const end = this.inpEnd?.value || '';
    const location = (this.inpLocation?.value || '').trim();
    const description = (this.inpDesc?.value || '').trim();

    if (!summary) {
      this.toast('Event title is required.', 'error');
      return;
    }
    if (!start) {
      this.toast('Start time is required.', 'error');
      return;
    }

    if (this.btnSubmitCreate) {
      this.btnSubmitCreate.disabled = true;
      this.btnSubmitCreate.textContent = 'Scheduling with JARVIS...';
    }

    try {
      await this.client.createCalendarEvent({
        summary,
        start,
        end: end || start,
        location,
        description,
      });

      this.toast('Event scheduled on Google Calendar.', 'success');
      audio.playChime('complete');
      if (this.createModal) this.createModal.classList.add('hidden');
      this.loadEvents();
    } catch (err) {
      this.toast('Failed to schedule event: ' + err.message, 'error');
    } finally {
      if (this.btnSubmitCreate) {
        this.btnSubmitCreate.disabled = false;
        this.btnSubmitCreate.textContent = 'Schedule Event';
      }
    }
  }

  promptDeleteEvent(ev) {
    this.eventToDelete = ev;
    if (this.deleteTitle) {
      this.deleteTitle.textContent = ev.summary || ev.title || 'Selected Event';
    }
    if (this.deleteModal) {
      this.deleteModal.classList.remove('hidden');
    }
  }

  async executeDeleteEvent() {
    if (!this.eventToDelete) return;
    const id = this.eventToDelete.id;

    if (this.btnConfirmDelete) {
      this.btnConfirmDelete.disabled = true;
      this.btnConfirmDelete.textContent = 'Removing...';
    }

    try {
      await this.client.deleteCalendarEvent(id);
      this.toast('Event removed from Calendar.', 'info');
      audio.playChime('click');
      if (this.deleteModal) this.deleteModal.classList.add('hidden');
      this.loadEvents();
    } catch (err) {
      this.toast('Failed to delete event: ' + err.message, 'error');
    } finally {
      if (this.btnConfirmDelete) {
        this.btnConfirmDelete.disabled = false;
        this.btnConfirmDelete.textContent = 'Confirm Delete';
      }
    }
  }
}
