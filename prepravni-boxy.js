(async function () {
  'use strict';

  const HISTORY_PAGE_SIZE = 10;
  const BASE = window.KVE_BOX_BASE_DATA || { frames: [], history: [] };
  const $ = id => document.getElementById(id);
  const page = $('boxesPage');
  if (!page) return;

  const cardsRoot = $('boxCards');
  const kanbanRoot = $('boxKanban');
  const listRoot = $('boxList');
  const summaryRoot = $('boxSummary');
  const historyBody = $('boxHistoryBody');
  const historyPager = $('boxHistoryPager');
  const historyCount = $('boxHistoryCount');
  const addBtn = $('addBoxBtn');
  const viewButtons = Array.from(document.querySelectorAll('[data-box-view]'));

  const modal = $('boxModal');
  const modalTitle = $('boxModalTitle');
  const modalCode = $('boxModalCode');
  const manipInput = $('boxManipUnit');
  const noteInput = $('boxNote');
  const stateMenuBtn = $('boxStateMenuBtn');
  const stateMenu = $('boxStateMenu');
  const setUnknownBtn = $('boxSetUnknownBtn');
  const archiveBtn = $('boxArchiveBtn');
  const saveManipBtn = $('boxSaveManipBtn');
  const returnHomeBtn = $('boxReturnHomeBtn');
  const saveNoteBtn = $('boxSaveNoteBtn');
  const archivedInfo = $('boxArchivedInfo');

  const addModal = $('boxAddModal');
  const addForm = $('boxAddForm');
  const addCode = $('boxAddCode');
  const addName = $('boxAddName');

  let frames = [];
  let history = [];
  let currentView = 'cards';
  let historyPage = 1;
  let selectedCode = null;
  let summaryFilter = 'all';
  let dragCode = null;

  let framesRef = null;
  let historyRef = null;
  let firestoreDoc = null;
  let firestoreSetDoc = null;
  let firestoreAddDoc = null;

  function normalizeCode(value) { return String(value ?? '').trim().replace(/\s+/g, '').toUpperCase(); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }

  function findFrame(code) { return frames.find(frame => frame.frame_code === normalizeCode(code)) || null; }
  function activeFrames() { return frames.filter(frame => !frame.archived); }
  function visibleFrames() {
    if (summaryFilter === 'archive') return frames.filter(frame => frame.archived);
    const active = frames.filter(frame => !frame.archived);
    if (summaryFilter === 'all') return active;
    return active.filter(frame => frame.status === summaryFilter);
  }

  function statusLabel(status) { return status === 'assigned' ? 'Přiřazeno' : status === 'unknown' ? 'Neznámý' : 'Doma'; }
  function statusClass(status) { return status === 'assigned' ? 'box-status-assigned' : status === 'unknown' ? 'box-status-unknown' : 'box-status-home'; }
  function actionLabel(action) {
    if (action === 'assign') return 'Přiřazení';
    if (action === 'return_home') return 'Vrácení Domů';
    if (action === 'set_unknown') return 'Nastavení Neznámý';
    if (action === 'note_update') return 'Úprava poznámky';
    if (action === 'create') return 'Přidání obalu';
    if (action === 'archive') return 'Archivace obalu';
    if (action === 'restore') return 'Obnovení obalu';
    return action || 'Změna';
  }

  function formatDate(value, withTime = false) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const options = withTime
      ? { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }
      : { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric' };
    return new Intl.DateTimeFormat('cs-CZ', options).format(date);
  }

  function newestAssignFor(code) {
    return history.find(row => normalizeCode(row.frame_code) === code && row.action_type === 'assign') || null;
  }

  function sortedFrames(source = visibleFrames()) {
    return [...source].sort((a, b) => String(a.name || a.frame_code).localeCompare(String(b.name || b.frame_code), 'cs', { numeric: true }));
  }

  async function writeHistory(frame, action) {
    const now = new Date().toISOString();
    const actor = await window.KVEAudit?.ensureActor?.('Přepravní boxy');
    await firestoreAddDoc(historyRef, {
      frame_code: frame.frame_code,
      frame_name: frame.name,
      action_type: action,
      manip_unit_code: frame.manip_unit_code || null,
      note: frame.note || '',
      status: frame.status,
      created_at: now,
      actor_name: actor?.name || 'Neznámý uživatel',
      actor_email: actor?.email || null
    });
    historyPage = 1;
  }

  async function writeFrame(frame) {
    frame.updated_at = new Date().toISOString();
    await firestoreSetDoc(firestoreDoc(framesRef, frame.frame_code), frame);
  }

  function frameCardHtml(frame, draggable = false) {
    const assign = frame.status === 'assigned' ? newestAssignFor(frame.frame_code) : null;
    const assignedMeta = frame.status === 'assigned'
      ? `<div class="box-card-meta">Přiřazeno: ${escapeHtml(formatDate(assign?.created_at || frame.updated_at))}</div><div class="box-card-meta">Přiřadil: ${escapeHtml(assign?.actor_name || assign?.actor_email || 'Neznámý uživatel')}</div>`
      : '';
    const note = frame.note ? escapeHtml(frame.note).replace(/\n/g, '<br>') : 'Bez poznámky';
    const archived = frame.archived ? '<span class="box-archive-pill">Archiv</span>' : '';
    return `<button class="box-card ${statusClass(frame.status)}${frame.archived ? ' is-archived' : ''}" type="button" data-box-code="${escapeHtml(frame.frame_code)}" ${draggable ? 'draggable="true"' : ''}>
      <div class="box-card-head"><div><div class="box-card-name">${escapeHtml(frame.name || frame.frame_code)}</div><div class="box-card-code">${escapeHtml(frame.frame_code)}</div></div><div class="box-card-badges"><span class="box-status-pill ${statusClass(frame.status)}">${escapeHtml(statusLabel(frame.status))}</span>${archived}</div></div>
      <div class="box-card-line"><strong>MJ:</strong> ${escapeHtml(frame.manip_unit_code || '—')}</div>
      ${assignedMeta}
      <div class="box-card-note">${note}</div>
    </button>`;
  }

  function renderSummary() {
    const active = activeFrames();
    const counts = { home: 0, assigned: 0, unknown: 0 };
    for (const frame of active) counts[frame.status] = (counts[frame.status] || 0) + 1;
    const archived = frames.length - active.length;
    summaryRoot.innerHTML = `
      <button type="button" class="box-summary-chip box-summary-total${summaryFilter === 'all' ? ' active' : ''}" data-box-summary="all">Celkem: <strong>${active.length}</strong></button>
      <button type="button" class="box-summary-chip box-summary-home${summaryFilter === 'home' ? ' active' : ''}" data-box-summary="home">Doma: <strong>${counts.home || 0}</strong></button>
      <button type="button" class="box-summary-chip box-summary-assigned${summaryFilter === 'assigned' ? ' active' : ''}" data-box-summary="assigned">Přiřazeno: <strong>${counts.assigned || 0}</strong></button>
      <button type="button" class="box-summary-chip box-summary-unknown${summaryFilter === 'unknown' ? ' active' : ''}" data-box-summary="unknown">Neznámý: <strong>${counts.unknown || 0}</strong></button>
      <button type="button" class="box-summary-chip box-summary-archive${summaryFilter === 'archive' ? ' active' : ''}" data-box-summary="archive">Archiv: <strong>${archived}</strong></button>`;
  }

  function renderCards() { cardsRoot.innerHTML = sortedFrames().map(frame => frameCardHtml(frame)).join(''); }

  function renderKanban() {
    if (summaryFilter === 'archive') {
      kanbanRoot.innerHTML = `<section class="box-kanban-column box-archive-column"><div class="box-kanban-title">Archiv<span>${visibleFrames().length}</span></div><div class="box-kanban-items">${sortedFrames().map(frame => frameCardHtml(frame)).join('')}</div></section>`;
      return;
    }
    const groups = [
      ['home', 'Doma'], ['assigned', 'Přiřazeno'], ['unknown', 'Neznámý']
    ];
    kanbanRoot.innerHTML = groups.map(([status, label]) => {
      const rows = sortedFrames(visibleFrames().filter(frame => frame.status === status));
      return `<section class="box-kanban-column ${statusClass(status)}" data-box-drop-status="${status}"><div class="box-kanban-title">${label}<span>${rows.length}</span></div><div class="box-kanban-items">${rows.map(frame => frameCardHtml(frame, true)).join('')}</div></section>`;
    }).join('');
  }

  function renderList() {
    const rows = sortedFrames().map(frame => `<tr data-box-code="${escapeHtml(frame.frame_code)}">
      <td><button type="button" class="box-list-open" data-box-code="${escapeHtml(frame.frame_code)}">${escapeHtml(frame.name || frame.frame_code)}</button></td>
      <td>${escapeHtml(frame.frame_code)}</td>
      <td><span class="box-status-pill ${statusClass(frame.status)}">${escapeHtml(statusLabel(frame.status))}</span>${frame.archived ? ' <span class="box-archive-pill">Archiv</span>' : ''}</td>
      <td>${escapeHtml(frame.manip_unit_code || '—')}</td>
      <td class="box-list-note">${escapeHtml(frame.note || '—')}</td>
      <td>${escapeHtml(formatDate(frame.updated_at, true))}</td>
    </tr>`).join('');
    listRoot.innerHTML = `<div class="box-list-wrap"><table class="box-list-table"><thead><tr><th>Název rámu</th><th>Kód</th><th>Stav</th><th>Manip. jednotka</th><th>Poznámka</th><th>Aktualizace</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function renderView() {
    cardsRoot.hidden = currentView !== 'cards';
    kanbanRoot.hidden = currentView !== 'kanban';
    listRoot.hidden = currentView !== 'list';
    viewButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.boxView === currentView));
    renderCards();
    renderKanban();
    renderList();
  }

  function renderHistory() {
    const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
    historyPage = Math.min(historyPage, totalPages);
    const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
    const rows = history.slice(start, start + HISTORY_PAGE_SIZE);
    historyBody.innerHTML = rows.map(row => {
      const frame = findFrame(row.frame_code);
      return `<tr>
        <td>${escapeHtml(frame?.name || row.frame_name || row.frame_code)}</td>
        <td>${escapeHtml(row.frame_code)}</td>
        <td>${escapeHtml(actionLabel(row.action_type))}</td>
        <td><span class="box-status-pill ${statusClass(row.status)}">${escapeHtml(statusLabel(row.status))}</span></td>
        <td>${escapeHtml(row.manip_unit_code || '—')}</td>
        <td class="box-history-note">${escapeHtml(row.note || '—')}</td>
        <td>${escapeHtml(row.actor_name || row.actor_email || 'Neznámý uživatel')}</td>
        <td>${escapeHtml(formatDate(row.created_at, true))}</td>
      </tr>`;
    }).join('');
    historyCount.textContent = `${history.length} záznamů`;
    let html = `<button type="button" data-history-page="${Math.max(1, historyPage - 1)}" ${historyPage === 1 ? 'disabled' : ''}>‹</button>`;
    for (let p = 1; p <= totalPages; p++) html += `<button type="button" data-history-page="${p}" class="${p === historyPage ? 'active' : ''}">${p}</button>`;
    html += `<button type="button" data-history-page="${Math.min(totalPages, historyPage + 1)}" ${historyPage === totalPages ? 'disabled' : ''}>›</button>`;
    historyPager.innerHTML = html;
  }

  function renderAll() { renderSummary(); renderView(); renderHistory(); }

  function openFrame(code) {
    const frame = findFrame(code);
    if (!frame) return;
    selectedCode = frame.frame_code;
    modalTitle.textContent = frame.name || 'Vybraný rám';
    modalCode.textContent = `Kód rámu: ${frame.frame_code}`;
    manipInput.value = frame.manip_unit_code || '';
    noteInput.value = frame.note || '';
    stateMenu.hidden = true;
    const archived = Boolean(frame.archived);
    archivedInfo.hidden = !archived;
    manipInput.disabled = archived;
    noteInput.disabled = archived;
    saveManipBtn.disabled = archived;
    returnHomeBtn.disabled = archived;
    saveNoteBtn.disabled = archived;
    setUnknownBtn.disabled = archived;
    archiveBtn.textContent = archived ? 'Vrátit z archivu' : 'Archivovat obal';
    archiveBtn.classList.toggle('restore', archived);
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('box-modal-open');
    if (!archived) setTimeout(() => manipInput.focus(), 0);
  }

  function closeFrameModal() {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    stateMenu.hidden = true;
    document.body.classList.remove('box-modal-open');
    selectedCode = null;
  }

  function openAddModal() {
    addForm.reset();
    addModal.hidden = false;
    addModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('box-modal-open');
    setTimeout(() => addCode.focus(), 0);
  }

  function closeAddModal() {
    addModal.hidden = true;
    addModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('box-modal-open');
    addForm.reset();
  }

  async function saveManip() {
    const frame = findFrame(selectedCode);
    if (!frame || frame.archived) return;
    const manip = manipInput.value.trim();
    if (!manip) { manipInput.focus(); return; }
    frame.manip_unit_code = manip;
    frame.note = noteInput.value.trim();
    frame.status = 'assigned';
    await writeFrame(frame);
    await writeHistory(frame, 'assign');
    closeFrameModal();
  }

  async function returnHome() {
    const frame = findFrame(selectedCode);
    if (!frame || frame.archived) return;
    frame.status = 'home';
    frame.manip_unit_code = null;
    frame.note = '';
    await writeFrame(frame);
    await writeHistory(frame, 'return_home');
    closeFrameModal();
  }

  async function saveNote() {
    const frame = findFrame(selectedCode);
    if (!frame || frame.archived) return;
    frame.note = noteInput.value.trim();
    await writeFrame(frame);
    await writeHistory(frame, 'note_update');
  }

  async function setUnknown() {
    const frame = findFrame(selectedCode);
    if (!frame || frame.archived) return;
    frame.status = 'unknown';
    frame.manip_unit_code = null;
    frame.note = noteInput.value.trim();
    await writeFrame(frame);
    await writeHistory(frame, 'set_unknown');
    closeFrameModal();
  }

  async function toggleArchive() {
    const frame = findFrame(selectedCode);
    if (!frame) return;
    frame.archived = !frame.archived;
    await writeFrame(frame);
    await writeHistory(frame, frame.archived ? 'archive' : 'restore');
    closeFrameModal();
  }

  async function changeStatusFromKanban(code, targetStatus) {
    const frame = findFrame(code);
    if (!frame || frame.archived || frame.status === targetStatus) return;
    if (targetStatus === 'assigned' && frame.status !== 'assigned') {
      openFrame(frame.frame_code);
      return;
    }
    if (targetStatus === 'home') {
      frame.status = 'home'; frame.manip_unit_code = null; frame.note = '';
      await writeFrame(frame);
      await writeHistory(frame, 'return_home');
    } else if (targetStatus === 'unknown') {
      frame.status = 'unknown'; frame.manip_unit_code = null;
      await writeFrame(frame);
      await writeHistory(frame, 'set_unknown');
    }
  }

  addForm.addEventListener('submit', async event => {
    event.preventDefault();
    const code = normalizeCode(addCode.value);
    const name = addName.value.trim();
    if (!code) { addCode.focus(); return; }
    if (!name) { addName.focus(); return; }
    if (findFrame(code)) { alert(`Obal s kódem ${code} už existuje.`); addCode.focus(); return; }
    const frame = { frame_code: code, name, manip_unit_code: null, note: '', status: 'home', updated_at: new Date().toISOString(), archived: false };
    await writeFrame(frame);
    await writeHistory(frame, 'create');
    closeAddModal();
  });

  addBtn.addEventListener('click', openAddModal);
  saveManipBtn.addEventListener('click', saveManip);
  returnHomeBtn.addEventListener('click', returnHome);
  saveNoteBtn.addEventListener('click', saveNote);
  setUnknownBtn.addEventListener('click', setUnknown);
  archiveBtn.addEventListener('click', toggleArchive);
  stateMenuBtn.addEventListener('click', event => { event.stopPropagation(); stateMenu.hidden = !stateMenu.hidden; });

  summaryRoot.addEventListener('click', event => {
    const btn = event.target.closest('[data-box-summary]');
    if (!btn) return;
    summaryFilter = btn.dataset.boxSummary || 'all';
    renderAll();
  });

  viewButtons.forEach(btn => btn.addEventListener('click', () => { currentView = btn.dataset.boxView; renderView(); }));

  function openFromEvent(event) {
    const el = event.target.closest('[data-box-code]');
    if (!el) return;
    openFrame(el.dataset.boxCode);
  }
  cardsRoot.addEventListener('click', openFromEvent);
  kanbanRoot.addEventListener('click', openFromEvent);
  listRoot.addEventListener('click', openFromEvent);

  kanbanRoot.addEventListener('dragstart', event => {
    const card = event.target.closest('[data-box-code]');
    if (!card || summaryFilter === 'archive') return;
    dragCode = card.dataset.boxCode;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragCode);
    card.classList.add('is-dragging');
  });
  kanbanRoot.addEventListener('dragend', event => {
    event.target.closest('[data-box-code]')?.classList.remove('is-dragging');
    kanbanRoot.querySelectorAll('.is-drag-over').forEach(el => el.classList.remove('is-drag-over'));
    dragCode = null;
  });
  kanbanRoot.addEventListener('dragover', event => {
    const col = event.target.closest('[data-box-drop-status]');
    if (!col || !dragCode) return;
    event.preventDefault();
    col.classList.add('is-drag-over');
  });
  kanbanRoot.addEventListener('dragleave', event => {
    const col = event.target.closest('[data-box-drop-status]');
    if (col && !col.contains(event.relatedTarget)) col.classList.remove('is-drag-over');
  });
  kanbanRoot.addEventListener('drop', event => {
    const col = event.target.closest('[data-box-drop-status]');
    if (!col) return;
    event.preventDefault();
    col.classList.remove('is-drag-over');
    const code = dragCode || event.dataTransfer.getData('text/plain');
    changeStatusFromKanban(code, col.dataset.boxDropStatus);
    dragCode = null;
  });

  historyPager.addEventListener('click', event => {
    const btn = event.target.closest('[data-history-page]');
    if (!btn || btn.disabled) return;
    historyPage = Number(btn.dataset.historyPage) || 1;
    renderHistory();
  });

  modal.addEventListener('click', event => {
    if (event.target.closest('[data-box-modal-close]')) closeFrameModal();
    else if (!event.target.closest('.box-state-menu-wrap')) stateMenu.hidden = true;
  });
  addModal.addEventListener('click', event => { if (event.target.closest('[data-box-add-modal-close]')) closeAddModal(); });
  manipInput.addEventListener('keydown', event => { if (event.key === 'Enter' && manipInput.value.trim()) saveManip(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!modal.hidden) closeFrameModal();
    if (!addModal.hidden) closeAddModal();
  });

  renderAll();

  // Přepravní boxy jsou sdílené pro všechny přes Firestore (stejný kv-transport-mapping
  // projekt jako mapování vozidel a čtečky). Při úplně prvním spuštění (dosud
  // nezaložený seedovací marker) se do Firestore jednorázově nahraje existující
  // evidence rámů a historie z boxes-seed-data.js.
  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js");
    const {
      initializeFirestore,
      persistentLocalCache,
      persistentMultipleTabManager,
      collection,
      doc,
      getDoc,
      writeBatch,
      query,
      orderBy,
      onSnapshot,
      setDoc,
      addDoc
    } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");

    const app = initializeApp({
      apiKey: "AIzaSyBX3Phi9CNQPjxYXMKil7exLrJ7ZbRUMbM",
      authDomain: "kv-transport-mapping.firebaseapp.com",
      projectId: "kv-transport-mapping",
      storageBucket: "kv-transport-mapping.firebasestorage.app",
      messagingSenderId: "144100896901",
      appId: "1:144100896901:web:2ceef97e784e06385239ec"
    }, "kvTransportMapping");
    const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

    framesRef = collection(db, 'boxFrames');
    historyRef = collection(db, 'boxHistory');
    firestoreDoc = doc;
    firestoreSetDoc = setDoc;
    firestoreAddDoc = addDoc;

    const seedStatusRef = doc(db, 'meta', 'boxesSeedStatus');
    const seedStatusSnap = await getDoc(seedStatusRef);
    if (!seedStatusSnap.exists() && (BASE.frames?.length || BASE.history?.length)) {
      const batch = writeBatch(db);
      (BASE.frames || []).forEach(frame => {
        const code = normalizeCode(frame.frame_code);
        batch.set(doc(framesRef, code), {
          frame_code: code,
          name: String(frame.name || code).trim(),
          status: ['assigned', 'unknown'].includes(frame.status) ? frame.status : 'home',
          manip_unit_code: frame.manip_unit_code ? String(frame.manip_unit_code).trim() : null,
          note: String(frame.note || ''),
          archived: Boolean(frame.archived),
          updated_at: frame.updated_at || new Date().toISOString()
        });
      });
      (BASE.history || []).forEach(row => {
        batch.set(doc(historyRef), {
          frame_code: normalizeCode(row.frame_code),
          frame_name: row.frame_name || '',
          action_type: row.action_type || 'create',
          manip_unit_code: row.manip_unit_code || null,
          note: row.note || '',
          status: row.status || 'home',
          created_at: row.created_at || new Date().toISOString(),
          actor_name: row.actor_name || 'Import',
          actor_email: row.actor_email || null
        });
      });
      batch.set(seedStatusRef, { seeded: true, seededAt: new Date().toISOString(), frameCount: (BASE.frames || []).length, historyCount: (BASE.history || []).length });
      await batch.commit();
    }

    onSnapshot(framesRef, snapshot => {
      frames = snapshot.docs.map(docSnap => docSnap.data());
      renderAll();
    }, error => {
      console.error('prepravni-boxy.js: chyba synchronizace rámů.', error);
    });

    onSnapshot(query(historyRef, orderBy('created_at', 'desc')), snapshot => {
      history = snapshot.docs.map(docSnap => docSnap.data());
      renderAll();
    }, error => {
      console.error('prepravni-boxy.js: chyba synchronizace historie.', error);
    });
  } catch (error) {
    console.error('prepravni-boxy.js: Firestore se nepodařilo načíst.', error);
  }
})();
