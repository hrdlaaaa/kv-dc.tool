(async function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  if (!$('readersPage')) return;

  const READERS_COLLECTION = 'readers';
  const SEED_STATUS_DOC = 'readersSeedStatus';
  const seedRows = Array.isArray(window.MINDVIO_READERS_DATA) ? window.MINDVIO_READERS_DATA : [];

  let rows = [];
  let readersRef = null;
  let firestoreSetDoc = null;
  let firestoreDoc = null;
  let snAscending = true;
  let summaryFilter = 'total';

  function normalizeRow(item) {
    return { ...item, vyrazeno: item?.vyrazeno === true };
  }

  function text(value) {
    return value == null || String(value).trim() === '' ? '—' : String(value);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function normalize(value) {
    return String(value == null ? '' : value).trim().toLocaleLowerCase('cs-CZ');
  }

  function matchesSummaryFilter(r) {
    if (summaryFilter === 'vyrazeno') return r.vyrazeno === true;
    if (r.vyrazeno === true) return false;
    if (summaryFilter === 'vydej') return r.oddeleni === 'VÝDEJ';
    if (summaryFilter === 'prijem') return r.oddeleni === 'PŘÍJEM';
    if (summaryFilter === 'kabelovka') return r.oddeleni === 'KABELOVKA';
    if (summaryFilter === 'reverzni') return r.oddeleni === 'REVERZNÍ';
    if (summaryFilter === 'servis') return r.stav === 'Servis';
    return true;
  }

  function filteredRows() {
    const q = normalize($('readerSearch')?.value);
    const dept = $('readerDepartmentFilter')?.value || '';
    const type = $('readerTypeFilter')?.value || '';
    const state = $('readerStateFilter')?.value || '';
    return rows.filter(r => {
      if (!matchesSummaryFilter(r)) return false;
      if (dept && r.oddeleni !== dept) return false;
      if (type && r.typ !== type) return false;
      if (state && r.stav !== state) return false;
      if (!q) return true;
      const hay = [r.sn, r.cislo, r.ip, r.ticket, r.poznamka, r.oddeleni, r.typ, r.stav]
        .map(normalize).join(' ');
      return hay.includes(q);
    }).sort((a, b) => {
      const cmp = String(a.sn || '').localeCompare(String(b.sn || ''), 'cs-CZ', { numeric: true, sensitivity: 'base' });
      return snAscending ? cmp : -cmp;
    });
  }

  function renderSummary() {
    const activeRows = rows.filter(r => r.vyrazeno !== true);
    const retiredRows = rows.filter(r => r.vyrazeno === true);
    const defs = [
      ['total', 'CELKEM', activeRows.length, 'čteček'],
      ['vydej', 'VÝDEJ', activeRows.filter(r => r.oddeleni === 'VÝDEJ').length, ''],
      ['prijem', 'PŘÍJEM', activeRows.filter(r => r.oddeleni === 'PŘÍJEM').length, ''],
      ['kabelovka', 'KABELOVKA', activeRows.filter(r => r.oddeleni === 'KABELOVKA').length, ''],
      ['reverzni', 'REVERZNÍ', activeRows.filter(r => r.oddeleni === 'REVERZNÍ').length, ''],
      ['servis', 'V SERVISU', activeRows.filter(r => r.stav === 'Servis').length, 'stav Servis'],
      ['vyrazeno', 'VYŘAZENO', retiredRows.length, 'mimo evidenci']
    ];
    $('readerSummary').innerHTML = defs.map(([kind, label, count, sub]) =>
      `<button type="button" class="reader-summary-card reader-summary-card-${kind}${summaryFilter === kind ? ' is-active' : ''}" data-reader-summary-filter="${kind}" aria-pressed="${summaryFilter === kind ? 'true' : 'false'}"><span class="reader-summary-label">${label}</span><span class="reader-summary-value">${count}</span>${sub ? `<span class="reader-summary-sub">${sub}</span>` : '<span class="reader-summary-sub">&nbsp;</span>'}</button>`
    ).join('');
  }

  function stateClass(value) {
    const key = normalize(value).normalize('NFD').replace(/[̀-ͯ]/g, '');
    return 'reader-state reader-state-' + key.replace(/[^a-z0-9]+/g, '-');
  }

  function departmentClass(value) {
    const key = normalize(value).normalize('NFD').replace(/[̀-ͯ]/g, '');
    const mapped = key === 'vydej' ? 'vydej' : key === 'prijem' ? 'prijem' : key === 'kabelovka' ? 'kabelovka' : key === 'reverzni' ? 'reverzni' : 'unknown';
    return 'reader-department reader-department-' + mapped;
  }

  function render() {
    renderSummary();
    const data = filteredRows();
    const body = $('readerTableBody');
    body.innerHTML = data.map(r => {
      const ticket = r.ticket ? `<a class="reader-ticket" href="${escapeHtml(r.ticket)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(r.ticket)}">${escapeHtml(r.ticket)}</a>` : '—';
      return `<tr${r.vyrazeno ? ' class="reader-row-retired"' : ''}>
        <td>${escapeHtml(text(r.cislo))}</td>
        <td class="reader-sn">${escapeHtml(text(r.sn))}</td>
        <td>${escapeHtml(text(r.ip))}</td>
        <td><span class="${departmentClass(r.oddeleni)}">${escapeHtml(text(r.oddeleni))}</span></td>
        <td>${escapeHtml(text(r.typ))}</td>
        <td><span class="${stateClass(r.stav)}">${escapeHtml(text(r.stav))}</span></td>
        <td>${escapeHtml(text(r.inventura_dne))}</td>
        <td>${escapeHtml(text(r.servis_od))}</td>
        <td class="reader-ticket-cell">${ticket}</td>
        <td class="reader-note" title="${escapeHtml(r.poznamka || '')}">${escapeHtml(text(r.poznamka))}</td>
        <td><button class="reader-edit-btn" type="button" data-reader-id="${escapeHtml(r.id)}">Upravit</button></td>
      </tr>`;
    }).join('');
    const baseCount = summaryFilter === 'vyrazeno' ? rows.filter(r => r.vyrazeno === true).length : rows.filter(r => r.vyrazeno !== true).length;
    $('readerCount').textContent = `Zobrazeno ${data.length} z ${baseCount} záznamů`;
    $('readerSortSnArrow').textContent = snAscending ? '↑' : '↓';
  }

  function openModal(row) {
    const editing = !!row;
    $('readerModalTitle').textContent = editing ? 'Upravit čtečku' : 'Nová čtečka';
    $('readerId').value = row?.id || '';
    $('readerNumber').value = row?.cislo || '';
    $('readerSn').value = row?.sn || '';
    $('readerIp').value = row?.ip || '';
    $('readerDepartment').value = row?.oddeleni || '';
    $('readerType').value = row?.typ || '';
    $('readerState').value = row?.stav || '';
    $('readerNote').value = row?.poznamka || '';
    $('readerInventoryDate').value = row?.inventura_dne || '';
    $('readerServiceFrom').value = row?.servis_od || '';
    $('readerTicket').value = row?.ticket || '';
    const retireBtn = $('readerRetireBtn');
    if (retireBtn) {
      retireBtn.hidden = !editing;
      retireBtn.textContent = row?.vyrazeno ? 'Vrátit mezi aktivní' : 'Přesunout do Vyřazeno';
      retireBtn.classList.toggle('reader-restore-btn', row?.vyrazeno === true);
      retireBtn.dataset.readerId = row?.id || '';
    }
    const modal = $('readerModal');
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('reader-modal-open');
    setTimeout(() => $('readerSn').focus(), 0);
  }

  function closeModal() {
    const modal = $('readerModal');
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('reader-modal-open');
  }

  function makeId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'local-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function nullable(value) {
    const s = String(value || '').trim();
    return s || null;
  }

  async function saveForm(event) {
    event.preventDefault();
    if (!readersRef) return;
    const id = $('readerId').value;
    const now = new Date().toISOString();
    const old = id ? rows.find(r => r.id === id) : null;
    const item = {
      id: old?.id || makeId(),
      cislo: nullable($('readerNumber').value),
      sn: $('readerSn').value.trim(),
      ip: nullable($('readerIp').value),
      oddeleni: $('readerDepartment').value,
      typ: $('readerType').value,
      stav: $('readerState').value,
      poznamka: nullable($('readerNote').value),
      inventura_dne: nullable($('readerInventoryDate').value),
      servis_od: nullable($('readerServiceFrom').value),
      ticket: nullable($('readerTicket').value),
      vyrazeno: old?.vyrazeno === true,
      created_at: old?.created_at || now,
      updated_at: now
    };
    await firestoreSetDoc(firestoreDoc(readersRef, item.id), item);
    closeModal();
  }

  async function toggleRetired(id) {
    const row = rows.find(r => r.id === id);
    if (!row || !readersRef) return;
    const next = { ...row, vyrazeno: !(row.vyrazeno === true), updated_at: new Date().toISOString() };
    await firestoreSetDoc(firestoreDoc(readersRef, id), next);
    closeModal();
  }

  function resetStandardFilters() {
    $('readerSearch').value = '';
    $('readerDepartmentFilter').value = '';
    $('readerTypeFilter').value = '';
    $('readerStateFilter').value = '';
  }

  function initUi() {
    $('addReaderBtn').addEventListener('click', () => openModal(null));
    $('readerForm').addEventListener('submit', saveForm);
    document.querySelectorAll('[data-reader-modal-close]').forEach(el => el.addEventListener('click', closeModal));
    $('readerModal').addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    $('readerTableBody').addEventListener('click', e => {
      const btn = e.target.closest('[data-reader-id]');
      if (!btn) return;
      const row = rows.find(r => r.id === btn.dataset.readerId);
      if (row) openModal(row);
    });
    $('readerSummary').addEventListener('click', e => {
      const card = e.target.closest('[data-reader-summary-filter]');
      if (!card) return;
      summaryFilter = card.dataset.readerSummaryFilter || 'total';
      resetStandardFilters();
      render();
    });
    const retireBtn = $('readerRetireBtn');
    if (retireBtn) retireBtn.addEventListener('click', () => toggleRetired(retireBtn.dataset.readerId));
    ['readerSearch', 'readerDepartmentFilter', 'readerTypeFilter', 'readerStateFilter'].forEach(id => {
      const el = $(id);
      el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', render);
    });
    $('readerSortSn').addEventListener('click', () => { snAscending = !snAscending; render(); });
  }

  initUi();
  render();

  // Čtečky jsou sdílené pro všechny přes Firestore (stejný kv-transport-mapping
  // projekt jako mapování vozidel). Při úplně prvním spuštění (prázdná kolekce
  // a dosud nezaložený seedovací marker) se do Firestore jednorázově nahraje
  // existující evidence čteček z readers-seed-data.js.
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
      onSnapshot,
      setDoc
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

    readersRef = collection(db, READERS_COLLECTION);
    firestoreSetDoc = setDoc;
    firestoreDoc = doc;

    const seedStatusRef = doc(db, 'meta', SEED_STATUS_DOC);
    const seedStatusSnap = await getDoc(seedStatusRef);
    if (!seedStatusSnap.exists() && seedRows.length) {
      const batch = writeBatch(db);
      seedRows.forEach(item => batch.set(doc(readersRef, item.id), normalizeRow(item)));
      batch.set(seedStatusRef, { seeded: true, seededAt: new Date().toISOString(), count: seedRows.length });
      await batch.commit();
    }

    onSnapshot(readersRef, snapshot => {
      rows = snapshot.docs.map(docSnap => normalizeRow(docSnap.data()));
      render();
    }, error => {
      console.error('ctecky.js: chyba synchronizace s Firestore.', error);
    });
  } catch (error) {
    console.error('ctecky.js: Firestore se nepodařilo načíst.', error);
  }
})();
