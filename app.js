'use strict';

// STATE
const state = {
  spreadsheetId:   null,
  clanName:        null,
  mode:            'today',   // 'today' | 'archive'
  players:         [],
  todayLogs:       {},        // {nick: {torg, labirint, pohod}}
  todayDate:       null,
  editedLogs:      {},        // накапливает изменения до нажатия «Сохранить»
  archiveFromDate: null,      // строка дд.мм.гггг
  archiveToDate:   null,      // строка дд.мм.гггг
  archiveData:     [],        // данные одной даты (для режима редактирования)
  archiveGroups:   [],        // [{date, entries}] для диапазонного вида
  archiveEdits:    {},        // {nick: {torg, labirint, pohod}}
  archiveEditMode: false,
  confirmCb:       null,      // коллбэк для модального подтверждения
};

// API
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

// Утилиты
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

// Возвращает массив дат (дд.мм.гггг) от toStr до fromStr включительно (новые первые)
function getDateRange(fromStr, toStr) {
  function parse(str) {
    var p = str.split('.');
    if (p.length !== 3) return null;
    return new Date(+p[2], +p[1] - 1, +p[0]);
  }
  var from = parse(fromStr);
  var to   = parse(toStr);
  if (!from || !to || from > to) return [];
  var dates = [];
  var cur = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cur >= from && dates.length <= 31) {
    var y = cur.getFullYear();
    var m = String(cur.getMonth() + 1).padStart(2, '0');
    var d = String(cur.getDate()).padStart(2, '0');
    dates.push(d + '.' + m + '.' + y);
    cur.setDate(cur.getDate() - 1);
  }
  return dates;
}

// Автосохранение
var autoSaveTimer = null;

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(function() {
    if (state.mode === 'today' && Object.keys(state.editedLogs).length > 0) {
      saveLogs(true);
    }
  }, 3 * 60 * 1000);
}

function cancelAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
}

// Стартовая страница
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

// Загрузка данных
async function loadData() {
  cancelAutoSave();
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

// Рендер приложения
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

// Текущий день - рендер игроков
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

function getMissClass(count) {
  var n = +count || 0;
  if (n >= 3) return ' miss-3';
  if (n === 2) return ' miss-2';
  if (n === 1) return ' miss-1';
  return '';
}

// Предварительный подсчёт пропусков с учётом несохранённых изменений
function getPreviewSkip(player, field) {
  var skipField = field === 'torg' ? 'skipT' : field === 'labirint' ? 'skipL' : 'skipP';
  var base      = state.todayLogs[player.nick]  || {};
  var edits     = state.editedLogs[player.nick] || {};
  var count     = player[skipField] || 0;

  if (field === 'labirint') {
    var baseVal = base.labirint || '';
    var curVal  = edits.labirint !== undefined ? edits.labirint : baseVal;
    if (!baseVal && curVal)  count++;
    if (baseVal  && !curVal) count = Math.max(0, count - 1);
  } else {
    // torg/pohod: true = пропуск, false = присутствовал
    var baseMiss = !!(base[field]);
    var curMiss  = edits[field] !== undefined ? !!(edits[field]) : baseMiss;
    if (!baseMiss && curMiss)  count++;                          // был → пропуск
    if (baseMiss  && !curMiss) count = Math.max(0, count - 1);  // пропуск → был
  }
  return count;
}

// Точечное обновление ячеек пропусков в строке (без перерисовки таблицы)
function updateMissCells(nick) {
  var rows = el('player-list').querySelectorAll('tr[data-nick]');
  var row = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].dataset.nick === nick) { row = rows[i]; break; }
  }
  if (!row) return;

  var player = state.players.find(function(p) { return p.nick === nick; });
  if (!player) return;

  var cells  = row.querySelectorAll('.miss-cell');
  var fields = ['torg', 'labirint', 'pohod'];
  cells.forEach(function(cell, idx) {
    var count = getPreviewSkip(player, fields[idx]);
    cell.textContent = count;
    cell.classList.remove('miss-1', 'miss-2', 'miss-3');
    var cls = getMissClass(count).trim();
    if (cls) cell.classList.add(cls);
  });
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
    rows += '<td class="miss-cell miss-border-l' + getMissClass(player.skipT) + '">' + (player.skipT || 0) + '</td>';
    rows += '<td class="miss-cell' + getMissClass(player.skipL) + '">' + (player.skipL || 0) + '</td>';
    rows += '<td class="miss-cell miss-border-r' + getMissClass(player.skipP) + '">' + (player.skipP || 0) + '</td>';
    rows += '<td class="check-cell"><input type="checkbox" class="torg-cb"' + (log.torg ? ' checked' : '') + disAttr + '></td>';
    rows += '<td class="lab-cell">' + buildLabSelect(log.labirint, disabled) + '</td>';
    rows += '<td class="check-cell"><input type="checkbox" class="pohod-cb"' + (log.pohod ? ' checked' : '') + disAttr + '></td>';
    rows += '<td class="actions-cell">';
    rows += '<button class="icon-btn" data-action="edit"    title="Редактировать">✏️</button>';
    rows += '<button class="icon-btn' + vacClass + '" data-action="vacation" title="Отпуск">🏖️</button>';
    rows += '<button class="icon-btn" data-action="delete"  title="Удалить">❌</button>';
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
    '<th class="miss-th miss-border-l" title="Пропуски торга">Т↓</th>' +
    '<th class="miss-th" title="Пропуски лабиринта">Л↓</th>' +
    '<th class="miss-th miss-border-r" title="Пропуски похода">П↓</th>' +
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
  updateMissCells(nick);
  scheduleAutoSave();
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

// Текущий день - сохранение
async function saveLogs(isAuto) {
  cancelAutoSave();
  if (Object.keys(state.editedLogs).length === 0) {
    if (!isAuto) showToast('Нет несохранённых изменений', 'info');
    return;
  }
  showLoading();
  try {
    await api('saveLogs', { logs: state.editedLogs });
    state.editedLogs = {};
    showToast(isAuto ? 'Автосохранение ✓' : 'Сохранено ✓', 'success');
    await loadData();
  } catch (err) {
    showToast('Ошибка сохранения: ' + err.message, 'error');
    hideLoading();
  }
}

// Добавление игрока
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

// Редактирование игрока
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

// Удаление игрока
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

// Отпуск
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

  // Оптимистичное обновление — сразу отображаем в таблице
  var playerIdx = state.players.findIndex(function(p) { return p.nick === nick; });
  var prevPlayer = playerIdx >= 0 ? Object.assign({}, state.players[playerIdx]) : null;
  if (playerIdx >= 0) {
    state.players[playerIdx].onVacation = active;
    state.players[playerIdx].returnDate = active ? isoToDisplay(returnDate) : '';
  }
  closeModal();
  renderPlayers();

  showLoading();
  try {
    if (active) {
      await api('setVacation', { nick, returnDate });
    } else {
      await api('cancelVacation', { nick });
    }
    showToast('Отпуск обновлён', 'success');
    await loadData();
  } catch (err) {
    // Откатываем оптимистичное обновление
    if (playerIdx >= 0 && prevPlayer) {
      state.players[playerIdx] = prevPlayer;
      renderPlayers();
    }
    showToast('Ошибка: ' + err.message, 'error');
    hideLoading();
  }
}

// Завершить день
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

// Режим архива
function enterArchiveMode() {
  state.mode            = 'archive';
  state.archiveEditMode = false;
  state.archiveEdits    = {};
  state.archiveGroups   = [];

  el('btn-edit-archive').classList.add('hidden');
  el('btn-save-archive').classList.add('hidden');
  el('btn-cancel-archive').classList.add('hidden');

  renderApp();

  // По умолчанию — последние 7 дней
  var today = new Date();
  var toDate   = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  var fromDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);

  function localIso(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  var todayIso = localIso(today);
  el('archive-date-from').max   = todayIso;
  el('archive-date-to').max     = todayIso;
  el('archive-date-from').value = localIso(fromDate);
  el('archive-date-to').value   = localIso(toDate);

  state.archiveFromDate = isoToDisplay(localIso(fromDate));
  state.archiveToDate   = isoToDisplay(localIso(toDate));

  loadArchiveRange(state.archiveFromDate, state.archiveToDate);
}

async function loadArchiveRange(fromDate, toDate) {
  var dates = getDateRange(fromDate, toDate);
  if (dates.length === 0) return;

  showLoading();
  try {
    var results = await Promise.all(dates.map(function(d) {
      return api('getArchive', { date: d }).catch(function() { return []; });
    }));

    state.archiveGroups = dates.map(function(d, i) {
      return { date: d, entries: results[i] || [] };
    }).filter(function(g) { return g.entries.length > 0; });

    state.archiveEdits = {};

    // Для режима редактирования (только одна дата)
    if (dates.length === 1) {
      state.archiveData = results[0] || [];
    } else {
      state.archiveData = [];
    }

    // Для режима редактирования: данные самой свежей даты (toDate = dates[0])
    state.archiveData = results[0] || [];

    if (!state.archiveEditMode) {
      el('btn-edit-archive').classList.remove('hidden');
    }

    renderArchive();
  } catch (err) {
    showToast('Ошибка загрузки архива: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

function buildArchiveTable(entries, edit) {
  var rows = '';
  entries.forEach(function(entry) {
    var e = Object.assign({}, entry, state.archiveEdits[entry.nick] || {});

    rows += '<tr data-nick="' + esc(entry.nick) + '">';
    rows += '<td class="nick-cell"><span class="nick-text">' + esc(entry.nick) + '</span></td>';

    if (edit) {
      rows += '<td class="check-cell"><input type="checkbox" class="torg-cb"' + (e.torg ? ' checked' : '') + '></td>';
      rows += '<td class="lab-cell">' + buildLabSelect(e.labirint, false) + '</td>';
      rows += '<td class="check-cell"><input type="checkbox" class="pohod-cb"' + (e.pohod ? ' checked' : '') + '></td>';
    } else {
      // 8.2: torg/pohod: true=пропуск→красный+❌, false=присутствовал→пусто
      rows += '<td class="check-cell' + (entry.torg  ? ' arch-miss' : '') + '">' + (entry.torg  ? '❌' : '') + '</td>';
      rows += '<td class="lab-cell'   + (entry.labirint ? ' arch-miss' : '') + '">' + esc(entry.labirint || '') + '</td>';
      rows += '<td class="check-cell' + (entry.pohod ? ' arch-miss' : '') + '">' + (entry.pohod ? '❌' : '') + '</td>';
    }

    rows += '</tr>';
  });

  return '<div class="table-wrapper"><table class="player-table archive-table">' +
    '<thead><tr>' +
    '<th class="nick-th">Игрок</th>' +
    '<th class="check-th">Торг</th>' +
    '<th class="lab-th">Лабиринт</th>' +
    '<th class="check-th">Поход</th>' +
    '</tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table></div>';
}

function renderArchive() {
  var container = el('player-list');

  if (!state.archiveGroups || state.archiveGroups.length === 0) {
    container.innerHTML = '<p class="empty-state">Нет записей за выбранный период</p>';
    return;
  }

  var isSingle = getDateRange(state.archiveFromDate, state.archiveToDate).length === 1;

  if (isSingle && state.archiveEditMode) {
    // Режим редактирования одной даты
    container.innerHTML = buildArchiveTable(state.archiveData, true);
    var tbody = container.querySelector('tbody');
    if (tbody) tbody.addEventListener('change', onArchiveChange);
    return;
  }

  if (isSingle) {
    // Одна дата — читаем
    container.innerHTML = buildArchiveTable(state.archiveGroups[0].entries, false);
    return;
  }

  // Диапазон — группы по датам (8.1)
  var html = '';
  state.archiveGroups.forEach(function(group) {
    html += '<div class="archive-group">';
    html += '<div class="archive-group-header">' + esc(group.date) + '</div>';
    html += buildArchiveTable(group.entries, false);
    html += '</div>';
  });
  container.innerHTML = html;
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
  // В диапазонном режиме схлопываемся на самую свежую дату (archiveToDate)
  if (state.archiveFromDate !== state.archiveToDate) {
    state._editFromDateSaved = state.archiveFromDate; // запомним для отмены
    state.archiveFromDate = state.archiveToDate;
    el('archive-date-from').value = displayToIso(state.archiveToDate);
  }

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

  // Восстанавливаем диапазон, если схлопывали
  if (state._editFromDateSaved) {
    state.archiveFromDate = state._editFromDateSaved;
    el('archive-date-from').value = displayToIso(state._editFromDateSaved);
    state._editFromDateSaved = null;
  }

  loadArchiveRange(state.archiveFromDate, state.archiveToDate);
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
        date:     state.archiveFromDate,
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
    if (state.archiveGroups.length > 0) {
      state.archiveGroups[0].entries = state.archiveData.slice();
    }

    cancelArchiveEdit();
    showToast('Архив обновлён ✓', 'success');
  } catch (err) {
    showToast('Ошибка: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

// Модальные окна
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

// ТЁмная тема
function initTheme() {
  if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-theme');
    el('btn-theme').textContent = '☀️';
    el('btn-theme').title = 'Светлая тема';
  }
}

function toggleTheme() {
  var dark = document.body.classList.toggle('dark-theme');
  localStorage.setItem('theme', dark ? 'dark' : 'light');
  el('btn-theme').textContent = dark ? '☀️' : '🌙';
  el('btn-theme').title = dark ? 'Светлая тема' : 'Тёмная тема';
}

// Инициализация
document.addEventListener('DOMContentLoaded', function() {

  initTheme();
  el('btn-theme').addEventListener('click', toggleTheme);

  // --- Восстанавливаем сессию ---
  var urlParams = new URLSearchParams(location.search);
  var tableId   = urlParams.get('table') || localStorage.getItem('spreadsheetId');

  if (tableId) {
    state.spreadsheetId = tableId;
    loadData();
  } else {
    showStartPage();
  }

  // Стартовая страница
  el('btn-connect').addEventListener('click', function() {
    connectToSpreadsheet(el('spreadsheet-id-input').value);
  });

  el('spreadsheet-id-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') connectToSpreadsheet(el('spreadsheet-id-input').value);
  });

  el('btn-create-clan').addEventListener('click', function() {
    createClan(el('clan-name-input').value, el('owner-email-input').value);
  });

  // Шапка
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

  // Панель текущего дня
  el('btn-add-player').addEventListener('click', openAddModal);
  el('btn-save').addEventListener('click',       saveLogs);
  el('btn-refresh').addEventListener('click',    loadData);

  // Панель архива
  function onArchiveDateChange() {
    state.archiveEditMode = false;
    state.archiveEdits    = {};
    el('btn-edit-archive').classList.add('hidden');
    el('btn-save-archive').classList.add('hidden');
    el('btn-cancel-archive').classList.add('hidden');
    loadArchiveRange(state.archiveFromDate, state.archiveToDate);
  }

  el('archive-date-from').addEventListener('change', function(e) {
    state.archiveFromDate = isoToDisplay(e.target.value);
    onArchiveDateChange();
  });

  el('archive-date-to').addEventListener('change', function(e) {
    state.archiveToDate = isoToDisplay(e.target.value);
    onArchiveDateChange();
  });

  el('btn-edit-archive').addEventListener('click',   enterArchiveEditMode);
  el('btn-save-archive').addEventListener('click',   saveArchiveChanges);
  el('btn-cancel-archive').addEventListener('click', cancelArchiveEdit);

  // Модальные окна - общие
  el('modal-overlay').addEventListener('click', function(e) {
    if (e.target === el('modal-overlay')) closeModal();
  });

  document.querySelectorAll('.modal-close').forEach(function(btn) {
    btn.addEventListener('click', closeModal);
  });

  // Модальное окно - добавить игрока
  el('btn-add-cancel').addEventListener('click', closeModal);
  el('btn-add-submit').addEventListener('click', submitAddPlayer);

  el('add-nick').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') submitAddPlayer();
  });

  // Модальное окно - редактировать игрока
  el('btn-edit-cancel').addEventListener('click', closeModal);
  el('btn-edit-submit').addEventListener('click', submitEditPlayer);

  el('edit-nick').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') submitEditPlayer();
  });

  // Модальное окно - отпуск
  el('btn-vacation-cancel').addEventListener('click', closeModal);
  el('btn-vacation-submit').addEventListener('click', submitVacation);

  el('vacation-active').addEventListener('change', function(e) {
    el('vacation-return-date').disabled = !e.target.checked;
    if (!e.target.checked) el('vacation-return-date').value = '';
  });

  // Модальное окно - подтверждение
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
