'use strict';

// ============================================================
// STATE
// ============================================================
const state = {
  spreadsheetId:   null,
  clanName:        null,
  mode:            'today',   // 'today' | 'archive'
  players:         [],
  todayLogs:       {},        // {nick: {torg, labirint, pohod}}
  todayDate:       null,
  editedLogs:      {},        // накапливает изменения до нажатия «Сохранить»
  archiveDate:     null,      // строка дд.мм.гггг
  archiveData:     [],
  archiveEdits:    {},        // {nick: {torg, labirint, pohod}}
  archiveEditMode: false,
  confirmCb:       null,      // коллбэк для модального подтверждения
};

// ============================================================
// API
// ============================================================
async function api(action, params) {
  const url = localStorage.getItem('scriptUrl') || CONFIG.SCRIPT_URL;
  const payload = Object.assign({ action, spreadsheetId: state.spreadsheetId }, params || {});

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) throw new Error('HTTP ' + resp.status);

  const json = await resp.json();
  if (!json.success) throw new Error(json.error || 'Ошибка сервера');
  return json.data;
}

// createClan не передаёт spreadsheetId
async function apiCreateClan(clanName, ownerEmail) {
  const url = localStorage.getItem('scriptUrl') || CONFIG.SCRIPT_URL;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: JSON.stringify({ action: 'createClan', clanName, ownerEmail }),
  });

  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const json = await resp.json();
  if (!json.success) throw new Error(json.error || 'Ошибка сервера');
  return json.data;
}

// ============================================================
// УТИЛИТЫ
// ============================================================
function showLoading() { el('loading').classList.remove('hidden'); }
function hideLoading() { el('loading').classList.add('hidden'); }

function showToast(message, type) {
  const toast = el('toast');
  toast.textContent = message;
  toast.className = 'toast toast-' + (type || 'info');
  toast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(function() { toast.classList.add('hidden'); }, 3200);
}

function el(id) { return document.getElementById(id); }

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Конвертирует ISO yyyy-MM-dd → дд.мм.гггг
function isoToDisplay(isoDate) {
  if (!isoDate) return '';
  var parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return parts[2] + '.' + parts[1] + '.' + parts[0];
}

// Конвертирует дд.мм.гггг → yyyy-MM-dd (для date input)
function displayToIso(displayDate) {
  if (!displayDate) return '';
  var parts = displayDate.split('.');
  if (parts.length !== 3) return displayDate;
  return parts[2] + '-' + parts[1] + '-' + parts[0];
}

// ============================================================
// СТАРТОВАЯ СТРАНИЦА
// ============================================================
function showStartPage() {
  el('start-page').classList.remove('hidden');
  el('app-page').classList.add('hidden');
}

function showAppPage() {
  el('start-page').classList.add('hidden');
  el('app-page').classList.remove('hidden');
}

async function connectToSpreadsheet(id) {
  if (!id || !id.trim()) {
    showToast('Введите ID таблицы', 'error');
    return;
  }
  state.spreadsheetId = id.trim();
  localStorage.setItem('spreadsheetId', state.spreadsheetId);
  await loadData();
}

async function createClan(name, email) {
  if (!name || !name.trim()) {
    showToast('Введите название клана', 'error');
    return;
  }
  showLoading();
  try {
    var result = await apiCreateClan(name.trim(), (email || '').trim());
    state.spreadsheetId = result.spreadsheetId;
    state.clanName = result.clanName;
    localStorage.setItem('spreadsheetId', result.spreadsheetId);
    localStorage.setItem('clanName', result.clanName);
    updateUrlParam(result.spreadsheetId);
    await loadData();
    showToast('Клан создан!', 'success');
  } catch (err) {
    showToast('Ошибка создания клана: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

function updateUrlParam(tableId) {
  var url = new URL(location.href);
  url.searchParams.set('table', tableId);
  history.replaceState({}, '', url.toString());
}

// ============================================================
// ЗАГРУЗКА ДАННЫХ
// ============================================================
async function loadData() {
  showLoading();
  try {
    var results = await Promise.all([
      api('getPlayers'),
      api('getTodayLogs'),
    ]);

    var playersResult = results[0];
    var logsResult    = results[1];

    state.players    = playersResult.players || [];
    state.clanName   = playersResult.clanName || 'Клан';
    state.todayDate  = logsResult.date || '';
    state.todayLogs  = logsResult.logs || {};
    state.editedLogs = {};
    state.mode       = 'today';

    localStorage.setItem('clanName', state.clanName);
    updateUrlParam(state.spreadsheetId);

    showAppPage();
    renderApp();
  } catch (err) {
    showToast('Ошибка загрузки: ' + err.message, 'error');
    // Если таблица недоступна — вернуть на стартовую
    if (!state.clanName) showStartPage();
  } finally {
    hideLoading();
  }
}

// ============================================================
// РЕНДЕР ПРИЛОЖЕНИЯ
// ============================================================
function renderApp() {
  el('clan-name-display').textContent = state.clanName || 'Клан';
  el('date-display').textContent      = state.todayDate || '';

  if (state.mode === 'today') {
    el('today-controls').classList.remove('hidden');
    el('archive-controls').classList.add('hidden');
    el('btn-archive').classList.remove('hidden');
    el('btn-today').classList.add('hidden');
    renderPlayers();
  } else {
    el('today-controls').classList.add('hidden');
    el('archive-controls').classList.remove('hidden');
    el('btn-archive').classList.add('hidden');
    el('btn-today').classList.remove('hidden');
    renderArchive();
  }
}

// ============================================================
// ТЕКУЩИЙ ДЕНЬ — РЕНДЕР ИГРОКОВ
// ============================================================
function sortPlayers(players) {
  return players.slice().sort(function(a, b) {
    var aD = a.role === 'Заместитель';
    var bD = b.role === 'Заместитель';
    if (aD !== bD) return aD ? -1 : 1;
    return a.nick.localeCompare(b.nick, 'ru');
  });
}

function getRowBg(player) {
  if (player.isTemp)      return 'var(--row-temp)';
  if (player.onVacation)  return 'var(--row-vacation)';
  if (player.joinDate) {
    var joinDate = new Date(player.joinDate);
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 2);
    cutoff.setHours(0, 0, 0, 0);
    if (!isNaN(joinDate.getTime()) && joinDate >= cutoff) return 'var(--row-new)';
  }
  return '';
}

var LAB_OPTIONS = ['', '0', '1', '2', 'отбил не те'];
var LAB_LABELS  = { '': '—', '0': '0', '1': '1', '2': '2', 'отбил не те': 'отбил не те' };

function buildLabSelect(currentVal, disabled) {
  var disAttr = disabled ? ' disabled' : '';
  var html = '<select class="lab-select"' + disAttr + '>';
  LAB_OPTIONS.forEach(function(v) {
    var sel = currentVal === v ? ' selected' : '';
    html += '<option value="' + esc(v) + '"' + sel + '>' + esc(LAB_LABELS[v]) + '</option>';
  });
  html += '</select>';
  return html;
}

function renderPlayers() {
  var sorted = sortPlayers(state.players);
  var rows   = '';

  sorted.forEach(function(player) {
    // Мёрджим сохранённые и несохранённые изменения
    var base    = state.todayLogs[player.nick]  || {};
    var edits   = state.editedLogs[player.nick] || {};
    var log = {
      torg:     edits.torg     !== undefined ? edits.torg     : (base.torg     || false),
      labirint: edits.labirint !== undefined ? edits.labirint : (base.labirint || ''),
      pohod:    edits.pohod    !== undefined ? edits.pohod    : (base.pohod    || false),
    };

    var bg       = getRowBg(player);
    var bgStyle  = bg ? ' style="background:' + bg + '"' : '';
    var disabled = player.onVacation;
    var disAttr  = disabled ? ' disabled' : '';
    var roleBadge = player.role === 'Заместитель'
      ? '<span class="role-badge">Зам</span>'
      : '';
    var vacClass = player.onVacation ? ' vacation-active' : '';

    rows += '<tr data-nick="' + esc(player.nick) + '"' + bgStyle + '>';
    rows += '<td class="nick-cell">' + roleBadge + '<span class="nick-text">' + esc(player.nick) + '</span></td>';
    rows += '<td class="miss-cell">' + (player.skipT || 0) + '</td>';
    rows += '<td class="miss-cell">' + (player.skipL || 0) + '</td>';
    rows += '<td class="miss-cell">' + (player.skipP || 0) + '</td>';
    rows += '<td class="check-cell"><input type="checkbox" class="torg-cb"' + (log.torg ? ' checked' : '') + disAttr + '></td>';
    rows += '<td class="lab-cell">' + buildLabSelect(log.labirint, disabled) + '</td>';
    rows += '<td class="check-cell"><input type="checkbox" class="pohod-cb"' + (log.pohod ? ' checked' : '') + disAttr + '></td>';
    rows += '<td class="actions-cell">';
    rows += '<button class="icon-btn" data-action="edit"    title="Редактировать">✏️</button>';
    rows += '<button class="icon-btn" data-action="delete"  title="Удалить">❌</button>';
    rows += '<button class="icon-btn' + vacClass + '" data-action="vacation" title="Отпуск">🏖️</button>';
    rows += '</td>';
    rows += '</tr>';
  });

  if (!rows) {
    rows = '<tr><td colspan="8" class="empty-state">Нет игроков. Добавьте первого участника.</td></tr>';
  }

  var html =
    '<div class="table-wrapper"><table class="player-table">' +
    '<thead><tr>' +
    '<th class="nick-th">Игрок</th>' +
    '<th class="miss-th" title="Пропуски торга">Т↓</th>' +
    '<th class="miss-th" title="Пропуски лабиринта">Л↓</th>' +
    '<th class="miss-th" title="Пропуски похода">П↓</th>' +
    '<th class="check-th">Торг</th>' +
    '<th class="lab-th">Лабиринт</th>' +
    '<th class="check-th">Поход</th>' +
    '<th class="actions-th"></th>' +
    '</tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table></div>';

  el('player-list').innerHTML = html;

  // Делегирование событий
  var tbody = el('player-list').querySelector('tbody');
  if (tbody) {
    tbody.addEventListener('change', onTodayChange);
    tbody.addEventListener('click',  onTodayClick);
  }
}

function onTodayChange(e) {
  var row  = e.target.closest('tr');
  if (!row) return;
  var nick = row.dataset.nick;
  if (!nick) return;

  var base = state.todayLogs[nick] || {};
  if (!state.editedLogs[nick]) {
    state.editedLogs[nick] = {
      torg:     base.torg     || false,
      labirint: base.labirint || '',
      pohod:    base.pohod    || false,
    };
  }

  if (e.target.classList.contains('torg-cb')) {
    state.editedLogs[nick].torg = e.target.checked;
  } else if (e.target.classList.contains('lab-select')) {
    state.editedLogs[nick].labirint = e.target.value;
  } else if (e.target.classList.contains('pohod-cb')) {
    state.editedLogs[nick].pohod = e.target.checked;
  }
}

function onTodayClick(e) {
  var btn = e.target.closest('[data-action]');
  if (!btn) return;
  var row    = btn.closest('tr');
  var nick   = row && row.dataset.nick;
  if (!nick) return;
  var action = btn.dataset.action;
  if (action === 'edit')     openEditModal(nick);
  if (action === 'delete')   openDeleteConfirm(nick);
  if (action === 'vacation') openVacationModal(nick);
}

// ============================================================
// ТЕКУЩИЙ ДЕНЬ — СОХРАНЕНИЕ
// ============================================================
async function saveLogs() {
  if (Object.keys(state.editedLogs).length === 0) {
    showToast('Нет несохранённых изменений', 'info');
    return;
  }
  showLoading();
  try {
    await api('saveLogs', { logs: state.editedLogs });
    // Применяем изменения к todayLogs
    Object.keys(state.editedLogs).forEach(function(nick) {
      state.todayLogs[nick] = Object.assign({}, state.todayLogs[nick] || {}, state.editedLogs[nick]);
    });
    state.editedLogs = {};
    showToast('Сохранено ✓', 'success');
  } catch (err) {
    showToast('Ошибка сохранения: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

// ============================================================
// ДОБАВЛЕНИЕ ИГРОКА
// ============================================================
function openAddModal() {
  el('add-nick').value = '';
  document.querySelector('input[name="add-role"][value=""]').checked = true;
  el('add-is-temp').checked = false;
  showModal('modal-add');
  el('add-nick').focus();
}

async function submitAddPlayer() {
  var nick   = el('add-nick').value.trim();
  if (!nick) { showToast('Введите ник', 'error'); return; }
  var role   = document.querySelector('input[name="add-role"]:checked').value;
  var isTemp = el('add-is-temp').checked;

  closeModal();
  showLoading();
  try {
    await api('addPlayer', { nick, role, isTemp });
    await loadData();
    showToast('Игрок добавлен', 'success');
  } catch (err) {
    showToast('Ошибка: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

// ============================================================
// РЕДАКТИРОВАНИЕ ИГРОКА
// ============================================================
function openEditModal(nick) {
  var player = state.players.find(function(p) { return p.nick === nick; });
  if (!player) return;

  el('edit-old-nick').value = nick;
  el('edit-nick').value     = nick;
  el('edit-is-temp').checked = player.isTemp;

  var roleVal = player.role === 'Заместитель' ? 'Заместитель' : '';
  var radios  = document.querySelectorAll('input[name="edit-role"]');
  radios.forEach(function(r) { r.checked = (r.value === roleVal); });

  showModal('modal-edit');
  el('edit-nick').focus();
}

async function submitEditPlayer() {
  var oldNick = el('edit-old-nick').value;
  var newNick = el('edit-nick').value.trim();
  if (!newNick) { showToast('Введите ник', 'error'); return; }
  var role   = document.querySelector('input[name="edit-role"]:checked').value;
  var isTemp = el('edit-is-temp').checked;

  closeModal();
  showLoading();
  try {
    await api('updatePlayer', { oldNick, newNick, role, isTemp });
    await loadData();
    showToast('Изменения сохранены', 'success');
  } catch (err) {
    showToast('Ошибка: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

// ============================================================
// УДАЛЕНИЕ ИГРОКА
// ============================================================
function openDeleteConfirm(nick) {
  el('confirm-title').textContent   = 'Удалить игрока';
  el('confirm-message').textContent =
    'Удалить игрока «' + nick + '»? Данные в архиве сохранятся.';

  state.confirmCb = async function() {
    showLoading();
    try {
      await api('deletePlayer', { nick });
      await loadData();
      showToast('Игрок удалён', 'success');
    } catch (err) {
      showToast('Ошибка: ' + err.message, 'error');
    } finally {
      hideLoading();
    }
  };
  showModal('modal-confirm');
}

// ============================================================
// ОТПУСК
// ============================================================
function openVacationModal(nick) {
  var player = state.players.find(function(p) { return p.nick === nick; });
  if (!player) return;

  el('vacation-nick').value         = nick;
  el('vacation-active').checked     = player.onVacation;
  el('vacation-return-date').value  = player.returnDate ? displayToIso(player.returnDate) : '';
  el('vacation-return-date').disabled = !player.onVacation;

  showModal('modal-vacation');
}

async function submitVacation() {
  var nick       = el('vacation-nick').value;
  var active     = el('vacation-active').checked;
  var returnDate = el('vacation-return-date').value; // ISO format

  closeModal();
  showLoading();
  try {
    if (active) {
      await api('setVacation', { nick, returnDate });
    } else {
      await api('cancelVacation', { nick });
    }
    await loadData();
    showToast('Отпуск обновлён', 'success');
  } catch (err) {
    showToast('Ошибка: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

// ============================================================
// ЗАВЕРШИТЬ ДЕНЬ
// ============================================================
function openEndDayConfirm() {
  el('confirm-title').textContent   = 'Завершить день';
  el('confirm-message').textContent =
    'Все отметки будут перенесены в архив, дата сдвинется на следующий день. ' +
    'Это действие нельзя отменить. Продолжить?';

  state.confirmCb = async function() {
    showLoading();
    try {
      var result = await api('runArchive');
      await loadData();
      showToast('День завершён. Архивировано записей: ' + (result.archived || 0), 'success');
    } catch (err) {
      showToast('Ошибка: ' + err.message, 'error');
    } finally {
      hideLoading();
    }
  };
  showModal('modal-confirm');
}

// ============================================================
// РЕЖИМ АРХИВА
// ============================================================
function enterArchiveMode() {
  state.mode           = 'archive';
  state.archiveEditMode = false;
  state.archiveEdits   = {};

  // Сбрасываем кнопки архива
  el('btn-edit-archive').classList.remove('hidden');
  el('btn-save-archive').classList.add('hidden');
  el('btn-cancel-archive').classList.add('hidden');

  renderApp();

  // Устанавливаем дату по умолчанию — вчера
  var yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  var isoYesterday = yesterday.toISOString().split('T')[0];

  var picker = el('archive-date-picker');
  picker.max   = new Date().toISOString().split('T')[0];
  picker.value = isoYesterday;

  state.archiveDate = isoToDisplay(isoYesterday);
  loadArchive(state.archiveDate);
}

async function loadArchive(dateStr) {
  showLoading();
  try {
    var data = await api('getArchive', { date: dateStr });
    state.archiveData  = data || [];
    state.archiveEdits = {};
    renderArchive();
  } catch (err) {
    showToast('Ошибка загрузки архива: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

function renderArchive() {
  var container = el('player-list');

  if (!state.archiveData || state.archiveData.length === 0) {
    container.innerHTML = '<p class="empty-state">Нет записей за выбранную дату</p>';
    return;
  }

  var edit = state.archiveEditMode;
  var rows = '';

  state.archiveData.forEach(function(entry) {
    var e = Object.assign({}, entry, state.archiveEdits[entry.nick] || {});

    rows += '<tr data-nick="' + esc(entry.nick) + '">';
    rows += '<td class="nick-cell"><span class="nick-text">' + esc(entry.nick) + '</span></td>';

    if (edit) {
      rows += '<td class="check-cell"><input type="checkbox" class="torg-cb"' + (e.torg ? ' checked' : '') + '></td>';
      rows += '<td class="lab-cell">' + buildLabSelect(e.labirint, false) + '</td>';
      rows += '<td class="check-cell"><input type="checkbox" class="pohod-cb"' + (e.pohod ? ' checked' : '') + '></td>';
    } else {
      rows += '<td class="check-cell archive-icon">' + (entry.torg ? '✔️' : '❌') + '</td>';
      rows += '<td class="lab-cell">' + esc(entry.labirint || '—') + '</td>';
      rows += '<td class="check-cell archive-icon">' + (entry.pohod ? '✔️' : '❌') + '</td>';
    }

    rows += '</tr>';
  });

  var html =
    '<div class="table-wrapper"><table class="player-table archive-table">' +
    '<thead><tr>' +
    '<th class="nick-th">Игрок</th>' +
    '<th class="check-th">Торг</th>' +
    '<th class="lab-th">Лабиринт</th>' +
    '<th class="check-th">Поход</th>' +
    '</tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table></div>';

  container.innerHTML = html;

  if (edit) {
    var tbody = container.querySelector('tbody');
    if (tbody) tbody.addEventListener('change', onArchiveChange);
  }
}

function onArchiveChange(e) {
  var row  = e.target.closest('tr');
  if (!row) return;
  var nick = row.dataset.nick;
  if (!nick) return;

  var original = state.archiveData.find(function(x) { return x.nick === nick; }) || {};
  if (!state.archiveEdits[nick]) {
    state.archiveEdits[nick] = Object.assign({}, original);
  }

  if (e.target.classList.contains('torg-cb')) {
    state.archiveEdits[nick].torg = e.target.checked;
  } else if (e.target.classList.contains('lab-select')) {
    state.archiveEdits[nick].labirint = e.target.value;
  } else if (e.target.classList.contains('pohod-cb')) {
    state.archiveEdits[nick].pohod = e.target.checked;
  }
}

function enterArchiveEditMode() {
  state.archiveEditMode = true;
  state.archiveEdits    = {};
  el('btn-edit-archive').classList.add('hidden');
  el('btn-save-archive').classList.remove('hidden');
  el('btn-cancel-archive').classList.remove('hidden');
  renderArchive();
}

function cancelArchiveEdit() {
  state.archiveEditMode = false;
  state.archiveEdits    = {};
  el('btn-edit-archive').classList.remove('hidden');
  el('btn-save-archive').classList.add('hidden');
  el('btn-cancel-archive').classList.add('hidden');
  renderArchive();
}

async function saveArchiveChanges() {
  var nicks = Object.keys(state.archiveEdits);
  if (nicks.length === 0) {
    showToast('Нет изменений', 'info');
    cancelArchiveEdit();
    return;
  }

  showLoading();
  try {
    for (var i = 0; i < nicks.length; i++) {
      var nick = nicks[i];
      var vals = state.archiveEdits[nick];
      await api('updateArchive', {
        date:     state.archiveDate,
        nick:     nick,
        torg:     vals.torg,
        labirint: vals.labirint,
        pohod:    vals.pohod,
      });
    }

    // Применяем изменения к локальным данным
    state.archiveData = state.archiveData.map(function(entry) {
      return state.archiveEdits[entry.nick]
        ? Object.assign({}, entry, state.archiveEdits[entry.nick])
        : entry;
    });

    cancelArchiveEdit();
    showToast('Архив обновлён ✓', 'success');
  } catch (err) {
    showToast('Ошибка: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

// ============================================================
// МОДАЛЬНЫЕ ОКНА
// ============================================================
function showModal(id) {
  // Скрываем все модальные окна, показываем нужное
  document.querySelectorAll('.modal').forEach(function(m) { m.classList.add('hidden'); });
  el(id).classList.remove('hidden');
  el('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  el('modal-overlay').classList.add('hidden');
  document.querySelectorAll('.modal').forEach(function(m) { m.classList.add('hidden'); });
}

// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================
document.addEventListener('DOMContentLoaded', function() {

  // --- Восстанавливаем сессию ---
  var urlParams = new URLSearchParams(location.search);
  var tableId   = urlParams.get('table') || localStorage.getItem('spreadsheetId');

  if (tableId) {
    state.spreadsheetId = tableId;
    loadData();
  } else {
    showStartPage();
  }

  // --------------------------------------------------------
  // СТАРТОВАЯ СТРАНИЦА
  // --------------------------------------------------------
  el('btn-connect').addEventListener('click', function() {
    connectToSpreadsheet(el('spreadsheet-id-input').value);
  });

  el('spreadsheet-id-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') connectToSpreadsheet(el('spreadsheet-id-input').value);
  });

  el('btn-create-clan').addEventListener('click', function() {
    createClan(el('clan-name-input').value, el('owner-email-input').value);
  });

  // --------------------------------------------------------
  // ШАПКА
  // --------------------------------------------------------
  el('btn-archive').addEventListener('click', enterArchiveMode);

  el('btn-today').addEventListener('click', function() {
    state.mode = 'today';
    loadData();
  });

  el('btn-leave').addEventListener('click', function() {
    localStorage.removeItem('spreadsheetId');
    localStorage.removeItem('clanName');
    state.spreadsheetId = null;
    state.clanName      = null;
    history.replaceState({}, '', location.pathname);
    showStartPage();
  });

  // --------------------------------------------------------
  // ПАНЕЛЬ ТЕКУЩЕГО ДНЯ
  // --------------------------------------------------------
  el('btn-add-player').addEventListener('click', openAddModal);
  el('btn-save').addEventListener('click',       saveLogs);
  el('btn-end-day').addEventListener('click',    openEndDayConfirm);
  el('btn-refresh').addEventListener('click',    loadData);

  // --------------------------------------------------------
  // ПАНЕЛЬ АРХИВА
  // --------------------------------------------------------
  el('archive-date-picker').addEventListener('change', function(e) {
    state.archiveDate    = isoToDisplay(e.target.value);
    state.archiveEditMode = false;
    state.archiveEdits   = {};
    el('btn-edit-archive').classList.remove('hidden');
    el('btn-save-archive').classList.add('hidden');
    el('btn-cancel-archive').classList.add('hidden');
    loadArchive(state.archiveDate);
  });

  el('btn-edit-archive').addEventListener('click',   enterArchiveEditMode);
  el('btn-save-archive').addEventListener('click',   saveArchiveChanges);
  el('btn-cancel-archive').addEventListener('click', cancelArchiveEdit);

  // --------------------------------------------------------
  // МОДАЛЬНЫЕ ОКНА — общие
  // --------------------------------------------------------
  el('modal-overlay').addEventListener('click', function(e) {
    if (e.target === el('modal-overlay')) closeModal();
  });

  document.querySelectorAll('.modal-close').forEach(function(btn) {
    btn.addEventListener('click', closeModal);
  });

  // --------------------------------------------------------
  // МОДАЛЬНОЕ ОКНО — Добавить игрока
  // --------------------------------------------------------
  el('btn-add-cancel').addEventListener('click', closeModal);
  el('btn-add-submit').addEventListener('click', submitAddPlayer);

  el('add-nick').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') submitAddPlayer();
  });

  // --------------------------------------------------------
  // МОДАЛЬНОЕ ОКНО — Редактировать игрока
  // --------------------------------------------------------
  el('btn-edit-cancel').addEventListener('click', closeModal);
  el('btn-edit-submit').addEventListener('click', submitEditPlayer);

  el('edit-nick').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') submitEditPlayer();
  });

  // --------------------------------------------------------
  // МОДАЛЬНОЕ ОКНО — Отпуск
  // --------------------------------------------------------
  el('btn-vacation-cancel').addEventListener('click', closeModal);
  el('btn-vacation-submit').addEventListener('click', submitVacation);

  el('vacation-active').addEventListener('change', function(e) {
    el('vacation-return-date').disabled = !e.target.checked;
    if (!e.target.checked) el('vacation-return-date').value = '';
  });

  // --------------------------------------------------------
  // МОДАЛЬНОЕ ОКНО — Подтверждение
  // --------------------------------------------------------
  el('btn-confirm-cancel').addEventListener('click', function() {
    closeModal();
    state.confirmCb = null;
  });

  el('btn-confirm-ok').addEventListener('click', function() {
    closeModal();
    var cb = state.confirmCb;
    state.confirmCb = null;
    if (cb) cb();
  });

});
