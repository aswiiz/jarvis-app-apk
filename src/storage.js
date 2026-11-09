import { Preferences } from '@capacitor/preferences';

// Core preference helpers with graceful localStorage fallback
export async function getPref(key, fallback = '') {
  try {
    const { value } = await Preferences.get({ key });
    return value ?? fallback;
  } catch {
    return localStorage.getItem(key) ?? fallback;
  }
}

export async function setPref(key, value) {
  try {
    await Preferences.set({ key, value });
  } catch {
    localStorage.setItem(key, value);
  }
}

export async function removePref(key) {
  try {
    await Preferences.remove({ key });
  } catch {
    localStorage.removeItem(key);
  }
}

// ----------------- App Settings -----------------
export const DEFAULT_SETTINGS = {
  voiceSpeed: 1.0,
  voicePitch: 1.0,
  voiceName: '',
  autoSpeak: true,
  themeAccent: 'cyan', // 'cyan', 'blue', 'emerald', 'amber'
  animationIntensity: 'full', // 'full', 'reduced'
  soundEffects: true,
  selectedAssistant: 'JARVIS',
};

export async function loadAppSettings() {
  const raw = await getPref('app_settings', '');
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveAppSettings(settings) {
  await setPref('app_settings', JSON.stringify(settings));
}

// ----------------- Saved Files & Notes (Files Tab) -----------------
export async function getSavedFiles() {
  const raw = await getPref('saved_files', '[]');
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveFileItem(item) {
  const files = await getSavedFiles();
  const file = {
    id: 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    title: item.title || 'Untitled',
    category: item.category || 'note', // 'note', 'draft', 'analysis', 'code', 'file'
    content: item.content || '',
    previewUrl: item.previewUrl || null,
    createdAt: new Date().toISOString(),
    ...item,
  };
  files.unshift(file);
  await setPref('saved_files', JSON.stringify(files.slice(0, 100)));
  return file;
}

export async function deleteFileItem(id) {
  const files = await getSavedFiles();
  const filtered = files.filter((f) => f.id !== id);
  await setPref('saved_files', JSON.stringify(filtered));
  return filtered;
}

// ----------------- Reminders & Timers (Automate / Clock) -----------------
export async function getReminders() {
  const raw = await getPref('reminders_list', '[]');
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveReminder(item) {
  const list = await getReminders();
  const reminder = {
    id: 'rem_' + Date.now(),
    title: item.title.trim(),
    time: item.time, // ISO string or HH:MM
    date: item.date || new Date().toISOString().slice(0, 10),
    completed: false,
    category: item.category || 'general',
    createdAt: new Date().toISOString(),
  };
  list.unshift(reminder);
  await setPref('reminders_list', JSON.stringify(list));
  return reminder;
}

export async function toggleReminder(id) {
  const list = await getReminders();
  const found = list.find((r) => r.id === id);
  if (found) {
    found.completed = !found.completed;
    await setPref('reminders_list', JSON.stringify(list));
  }
  return list;
}

export async function deleteReminder(id) {
  const list = await getReminders();
  const filtered = list.filter((r) => r.id !== id);
  await setPref('reminders_list', JSON.stringify(filtered));
  return filtered;
}

// ----------------- Search History -----------------
export async function getSearchHistory() {
  const raw = await getPref('search_history', '[]');
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function addSearchQuery(query) {
  if (!query || !query.trim()) return;
  const history = await getSearchHistory();
  const cleanQuery = query.trim();
  const filtered = history.filter((q) => q.toLowerCase() !== cleanQuery.toLowerCase());
  filtered.unshift(cleanQuery);
  await setPref('search_history', JSON.stringify(filtered.slice(0, 20)));
}

export async function clearSearchHistory() {
  await setPref('search_history', '[]');
}

// ----------------- Clear All Local Data -----------------
export async function clearAllLocalData() {
  await removePref('saved_files');
  await removePref('reminders_list');
  await removePref('search_history');
}
