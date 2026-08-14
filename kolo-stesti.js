(async function () {
  'use strict';

  const page = document.getElementById('wheelPage');
  const calendar = document.getElementById('wheelCalendar');
  const monthLabel = document.getElementById('wheelMonthLabel');
  const status = document.getElementById('wheelStatus');
  const prevBtn = document.getElementById('wheelPrevMonth');
  const nextBtn = document.getElementById('wheelNextMonth');
  const todayBtn = document.getElementById('wheelToday');
  const mappingBtn = document.getElementById('wheelMappingBtn');
  const mappingModal = document.getElementById('wheelMappingModal');
  const mappingColumns = document.getElementById('wheelMappingColumns');
  const resultModal = document.getElementById('wheelResultModal');
  const resultTitle = document.getElementById('wheelResultTitle');
  const resultSubtitle = document.getElementById('wheelResultSubtitle');
  const resultTabs = document.getElementById('wheelResultTabs');
  const resultBody = document.getElementById('wheelResultBody');
  const resultSave = document.getElementById('wheelResultSave');
  if (!page) return;

  const ROOT_ORG_CODE = "110700000";
  const ORG_RANGE_END = "110800000";
  const EXCLUDED_BRANCH_PREFIX = "110703";
  const PEOPLE_COLLECTION = "okbase_absences_by_person";
  const ANNOTATIONS_COLLECTION = "userAnnotations";
  const WHEEL_ROWS_COLLECTION = "wheelRows";

  const MAPPING_GROUPS = [
    { key: '1', label: 'Směna 1' },
    { key: '2', label: 'Směna 2' },
    { key: 'N', label: 'Noční' }
  ];
  const SHIFT_ROWS = [
    { key: 'morning', label: 'Ranní' },
    { key: 'afternoon', label: 'Odpolední' },
    { key: 'night', label: 'Noční' }
  ];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let current = new Date(today.getFullYear(), today.getMonth(), 1);
  let people = [];
  let annotations = {};
  let rows = [];
  let loaded = false;
  let state = { rows: {} };
  let userMapping = {};
  const expandedEmptyDays = new Set();
  const autoDrawInFlight = new Set();
  let activeResultRowKey = '';
  let activeResultName = '';
  let resultDraft = {};

  let wheelRowsRef = null;
  let userMappingDocRef = null;
  let firestoreDoc = null;
  let firestoreSetDoc = null;

  prevBtn.addEventListener('click', () => {
    current = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    render();
    autoDrawPendingRows();
  });
  nextBtn.addEventListener('click', () => {
    const next = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    if (next > thisMonth) return;
    current = next;
    render();
    autoDrawPendingRows();
  });
  todayBtn.addEventListener('click', () => {
    current = new Date(today.getFullYear(), today.getMonth(), 1);
    render();
    autoDrawPendingRows();
    requestAnimationFrame(() => document.getElementById(`wheel-day-${formatDate(today)}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  });

  mappingBtn.addEventListener('click', openMappingModal);
  mappingModal.addEventListener('click', event => {
    if (event.target.closest('[data-wheel-mapping-close]')) {
      closeMappingModal();
      return;
    }
    const resetBtn = event.target.closest('button[data-wheel-mapping-reset]');
    if (resetBtn) {
      const group = resetBtn.dataset.wheelMappingReset || '';
      if (!group) return;
      Object.keys(userMapping).forEach(userId => {
        if (userMapping[userId] === group) delete userMapping[userId];
      });
      saveUserMapping();
      renderMappingModal();
      render();
      return;
    }
    const checkbox = event.target.closest('input[data-wheel-mapping-user]');
    if (!checkbox) return;
    const userId = checkbox.dataset.userId || '';
    const group = checkbox.dataset.group || '';
    if (!userId || !group) return;
    if (checkbox.checked) userMapping[userId] = group;
    else if (userMapping[userId] === group) delete userMapping[userId];
    saveUserMapping();
    renderMappingModal();
    render();
  });

  calendar.addEventListener('change', event => {
    const select = event.target.closest('select[data-wheel-role]');
    if (!select) return;
    const rowKey = select.dataset.rowKey || '';
    const role = select.dataset.wheelRole || '';
    if (!rowKey || !role) return;
    const record = getRecord(rowKey);
    record[role] = select.value;
    if (record.controller && record.witness && record.controller === record.witness) {
      if (role === 'controller') record.witness = '';
      else record.controller = '';
    }
    saveRow(rowKey);
    render();
  });

  calendar.addEventListener('click', event => {
    const resultBtn = event.target.closest('[data-wheel-result-open]');
    if (resultBtn) {
      const rowKey = resultBtn.dataset.rowKey || '';
      const name = resultBtn.dataset.name || '';
      if (rowKey && name) openResultModal(rowKey, name);
      return;
    }

    const expandBtn = event.target.closest('[data-wheel-expand-day]');
    if (expandBtn) {
      const dateText = expandBtn.dataset.date || '';
      if (!dateText) return;
      expandedEmptyDays.add(dateText);
      render();
      autoDrawPendingRows();
      requestAnimationFrame(() => document.getElementById(`wheel-day-${dateText}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      return;
    }

    const collapseBtn = event.target.closest('[data-wheel-collapse-day]');
    if (collapseBtn) {
      const dateText = collapseBtn.dataset.date || '';
      if (!dateText) return;
      expandedEmptyDays.delete(dateText);
      render();
      requestAnimationFrame(() => document.getElementById(`wheel-day-${dateText}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
      return;
    }

    const drawBtn = event.target.closest('[data-wheel-draw]');
    if (!drawBtn) return;
    const rowKey = drawBtn.dataset.rowKey || '';
    const dateText = drawBtn.dataset.date || '';
    const shiftKey = drawBtn.dataset.shift || '';
    if (!rowKey || !dateText || !shiftKey) return;
    drawPeople(rowKey, dateText, shiftKey);
  });

  resultModal.addEventListener('click', event => {
    if (event.target.closest('[data-wheel-result-close]')) {
      closeResultModal();
      return;
    }
    const tab = event.target.closest('[data-wheel-result-tab]');
    if (tab) {
      activeResultName = tab.dataset.name || '';
      renderResultModal();
    }
  });

  resultBody.addEventListener('change', event => {
    const field = event.target.dataset.wheelResultField || '';
    if (!field || !activeResultName || !resultDraft[activeResultName]) return;
    resultDraft[activeResultName][field] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
  });

  resultBody.addEventListener('input', event => {
    const field = event.target.dataset.wheelResultField || '';
    if (!field || !activeResultName || !resultDraft[activeResultName]) return;
    resultDraft[activeResultName][field] = event.target.value;
  });

  resultSave.addEventListener('click', saveResultModal);

  render();
  connectFirestore();

  function updateStatus() {
    const leaders = getLeaders();
    const controlled = rows.filter(row => row.controlEnabled === true).length;
    const mapped = rows.filter(row => row.controlEnabled === true && userMapping[row.id]).length;
    status.classList.remove('error');
    status.textContent = `${controlled} osob povolených pro kontrolu • ${mapped} namapovaných • ${leaders.length} vedoucích`;
  }

  function rebuildRows() {
    rows = buildRows(people, annotations);
    loaded = true;
    cleanupUserMapping();
    updateStatus();
    if (!mappingModal.hidden) renderMappingModal();
    render();
    autoDrawPendingRows();
  }

  async function connectFirestore() {
    try {
      const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js");
      const {
        initializeFirestore,
        persistentLocalCache,
        persistentMultipleTabManager,
        collection,
        doc,
        query,
        orderBy,
        onSnapshot,
        setDoc
      } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");

      const peopleApp = initializeApp({
        apiKey: "AIzaSyCaanEUktq1zw_kQszcVT5kfTK81SEq68Q",
        authDomain: "okbase-dovolene.firebaseapp.com",
        projectId: "okbase-dovolene",
        storageBucket: "okbase-dovolene.firebasestorage.app",
        messagingSenderId: "698583441353",
        appId: "1:698583441353:web:ed6efef9e2881ed5f09218"
      }, "kveWheelPeople");
      const peopleDb = initializeFirestore(peopleApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
      const peopleQuery = query(collection(peopleDb, PEOPLE_COLLECTION), orderBy("osobaId", "asc"));

      onSnapshot(peopleQuery, snapshot => {
        people = snapshot.docs
          .map(docSnap => ({ firebaseDocId: docSnap.id, ...docSnap.data() }))
          .filter(isEmployeeActive)
          .filter(isUnderNehvizdyDc)
          .filter(person => normalize(person.parentUnitNazev) !== "doprava")
          .filter(person => !isInExcludedTransportBranch(person));
        rebuildRows();
      }, error => {
        console.error('kolo-stesti.js: chyba synchronizace uživatelů.', error);
        status.textContent = 'Nepodařilo se načíst data o uživatelích.';
        status.classList.add('error');
      });

      const mappingApp = initializeApp({
        apiKey: "AIzaSyBX3Phi9CNQPjxYXMKil7exLrJ7ZbRUMbM",
        authDomain: "kv-transport-mapping.firebaseapp.com",
        projectId: "kv-transport-mapping",
        storageBucket: "kv-transport-mapping.firebasestorage.app",
        messagingSenderId: "144100896901",
        appId: "1:144100896901:web:2ceef97e784e06385239ec"
      }, "kvTransportMapping");
      const mappingDb = initializeFirestore(mappingApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

      firestoreDoc = doc;
      firestoreSetDoc = setDoc;
      wheelRowsRef = collection(mappingDb, WHEEL_ROWS_COLLECTION);
      userMappingDocRef = doc(mappingDb, 'config', 'wheelUserMapping');

      onSnapshot(collection(mappingDb, ANNOTATIONS_COLLECTION), snapshot => {
        const next = {};
        snapshot.forEach(docSnap => { next[decodeURIComponent(docSnap.id)] = docSnap.data(); });
        annotations = next;
        rebuildRows();
      }, error => {
        console.error('kolo-stesti.js: chyba synchronizace nastavení uživatelů.', error);
      });

      onSnapshot(wheelRowsRef, snapshot => {
        const next = {};
        snapshot.forEach(docSnap => { next[docSnap.id] = docSnap.data(); });
        state.rows = next;
        render();
        autoDrawPendingRows();
      }, error => {
        console.error('kolo-stesti.js: chyba synchronizace kola štěstí.', error);
      });

      onSnapshot(userMappingDocRef, snapshot => {
        userMapping = snapshot.exists() ? { ...snapshot.data() } : {};
        cleanupUserMapping();
        if (!mappingModal.hidden) renderMappingModal();
        updateStatus();
        render();
        autoDrawPendingRows();
      }, error => {
        console.error('kolo-stesti.js: chyba synchronizace mapování uživatelů.', error);
      });

      const requestedDate = new URLSearchParams(location.search).get('date');
      if (requestedDate) goToDate(requestedDate);
    } catch (error) {
      console.error('kolo-stesti.js: Firestore se nepodařilo načíst.', error);
      status.textContent = 'Nepodařilo se připojit k databázi.';
      status.classList.add('error');
    }
  }

  function goToDate(value) {
    const date = parseDateOnly(value);
    if (!date) return;
    current = new Date(date.getFullYear(), date.getMonth(), 1);
    render();
    autoDrawPendingRows();
    requestAnimationFrame(() => document.getElementById(`wheel-day-${formatDate(date)}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  function render() {
    monthLabel.textContent = capitalize(current.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' }));
    if (!loaded && !rows.length) {
      calendar.innerHTML = '<div class="wheel-empty">Načítám data…</div>';
      return;
    }

    const leaders = getLeaders();
    const daysInMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
    const isCurrentMonth = current.getFullYear() === today.getFullYear() && current.getMonth() === today.getMonth();
    const firstVisibleDay = isCurrentMonth ? today.getDate() : daysInMonth;
    nextBtn.disabled = isCurrentMonth;
    const parts = [];

    for (let day = firstVisibleDay; day >= 1; day--) {
      const date = new Date(current.getFullYear(), current.getMonth(), day);
      const dateText = formatDate(date);
      const week = isoWeek(date);
      const isToday = dateText === formatDate(today);
      const hasDayData = dayHasData(dateText);
      const isCollapsedEmptyDay = !isToday && !hasDayData && !expandedEmptyDays.has(dateText);
      parts.push(`<section id="wheel-day-${dateText}" class="wheel-day${isToday ? ' is-today' : ''}${isCollapsedEmptyDay ? ' is-collapsed-empty' : ''}">`);
      if (isCollapsedEmptyDay) {
        parts.push(`<div class="wheel-day-collapsed"><div><strong>${escapeHtml(date.toLocaleDateString('cs-CZ'))} (${escapeHtml(dayName(date))})</strong><span>${week}. týden</span></div><div class="wheel-no-check">Kontrola neproběhla</div><button class="btn wheel-backfill-btn" type="button" data-wheel-expand-day data-date="${dateText}">Doplnit zpětně</button></div>`);
        parts.push('</section>');
        continue;
      }

      const canCollapseEmptyDay = !isToday && !hasDayData && expandedEmptyDays.has(dateText);
      parts.push(`<div class="wheel-day-head"><strong>${escapeHtml(date.toLocaleDateString('cs-CZ'))} (${escapeHtml(dayName(date))})</strong><div class="wheel-day-head-actions"><span>${week}. týden</span>${canCollapseEmptyDay ? `<button class="btn wheel-collapse-btn" type="button" data-wheel-collapse-day data-date="${dateText}">Zabalit</button>` : ''}</div></div>`);
      parts.push('<div class="wheel-grid-head"><div>Směna</div><div>Kontrolor</div><div>Svědek</div><div>Jméno 1</div><div>Jméno 2</div><div>Jméno 3</div><div>Akce</div></div>');

      for (const shift of SHIFT_ROWS) {
        const rowKey = `${dateText}|${shift.key}`;
        const record = getRecord(rowKey, false) || { controller: '', witness: '', names: [] };
        const eligible = getEligibleControlled(dateText, shift.key, rowKey);
        const group = groupForShift(date, shift.key);
        const names = Array.isArray(record.names) ? record.names.slice(0, 3) : [];
        while (names.length < 3) names.push('');

        parts.push(`<div class="wheel-grid-row" data-wheel-row="${escapeHtml(rowKey)}">`);
        parts.push(`<div class="wheel-shift-cell"><strong>${escapeHtml(shift.label)}</strong>${group ? `<span>Skupina ${escapeHtml(group)}</span>` : ''}</div>`);
        parts.push(`<div>${leaderSelect('controller', rowKey, record.controller, record.witness, leaders, 'Vyberte kontrolora')}</div>`);
        parts.push(`<div>${leaderSelect('witness', rowKey, record.witness, record.controller, leaders, 'Vyberte svědka')}</div>`);
        for (const name of names) parts.push(`<div class="wheel-person-cell">${renderControlledPerson(record, rowKey, name)}</div>`);
        const firstResultName = (record.names || []).find(Boolean) || '';
        parts.push(`<div class="wheel-action-cell"><details class="wheel-row-menu"><summary aria-label="Akce" title="Akce">⋯</summary><div class="wheel-row-menu-popover"><button type="button" data-wheel-draw data-row-key="${escapeHtml(rowKey)}" data-date="${dateText}" data-shift="${shift.key}"${eligible.length ? '' : ' disabled'}>${record.names?.length ? 'Losovat znovu' : 'Losovat'}</button>${firstResultName ? `<button type="button" data-wheel-result-open data-row-key="${escapeHtml(rowKey)}" data-name="${escapeHtml(firstResultName)}">Výsledky</button>` : ''}</div></details></div>`);
        parts.push('</div>');
      }
      parts.push('</section>');
    }
    calendar.innerHTML = parts.join('');
  }

  function defaultPersonResult() {
    return { kontrola: false, skrinka: false, batoh: false, vysledek: '', poznamka: '' };
  }

  function getPersonResult(record, name) {
    if (!record || !name) return defaultPersonResult();
    const stored = record.results && record.results[name];
    return stored && typeof stored === 'object' ? { ...defaultPersonResult(), ...stored } : defaultPersonResult();
  }

  function getResultStatus(result) {
    if (!result || !result.kontrola) return { icon: '⏳', label: 'Čeká na kontrolu' };
    if (result.vysledek === 's vyhradami') return { icon: '⚠️', label: 'Kontrola s výhradami' };
    if (result.vysledek === 'v poradku') return { icon: '✅', label: 'Kontrola v pořádku' };
    return { icon: '☑️', label: 'Kontrola provedena – výsledek nezadán' };
  }

  function renderControlledPerson(record, rowKey, name) {
    if (!name) return '<span class="wheel-dash">—</span>';
    const result = getPersonResult(record, name);
    const state = getResultStatus(result);
    const title = result.kontrola
      ? `${state.label}\nSkříňka: ${result.skrinka ? 'ANO' : 'NE'}\nBatoh: ${result.batoh ? 'ANO' : 'NE'}`
      : state.label;
    return `<button class="wheel-person-button" type="button" data-wheel-result-open data-row-key="${escapeHtml(rowKey)}" data-name="${escapeHtml(name)}" title="${escapeHtml(title)}"><span class="wheel-person-status" aria-hidden="true">${state.icon}</span><span>${escapeHtml(name)}</span></button>`;
  }

  function openResultModal(rowKey, name) {
    const record = getRecord(rowKey, false);
    if (!record || !Array.isArray(record.names) || !record.names.length) return;
    activeResultRowKey = rowKey;
    activeResultName = record.names.includes(name) ? name : record.names[0];
    resultDraft = {};
    record.names.filter(Boolean).forEach(person => {
      resultDraft[person] = getPersonResult(record, person);
    });
    renderResultModal();
    resultModal.hidden = false;
    resultModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeResultModal() {
    resultModal.hidden = true;
    resultModal.setAttribute('aria-hidden', 'true');
    activeResultRowKey = '';
    activeResultName = '';
    resultDraft = {};
    document.body.style.overflow = '';
  }

  function renderResultModal() {
    const record = getRecord(activeResultRowKey, false);
    if (!record) return;
    const names = Array.isArray(record.names) ? record.names.filter(Boolean) : [];
    if (!names.length) return;
    if (!names.includes(activeResultName)) activeResultName = names[0];
    const [dateText, shiftKey] = activeResultRowKey.split('|');
    const shift = SHIFT_ROWS.find(item => item.key === shiftKey);
    const parsedDate = parseDateOnly(dateText);
    resultTitle.textContent = 'Výsledek kontroly';
    resultSubtitle.textContent = `${parsedDate ? parsedDate.toLocaleDateString('cs-CZ') : dateText} • ${shift ? shift.label : shiftKey}`;
    resultTabs.innerHTML = names.map(name => {
      const result = resultDraft[name] || defaultPersonResult();
      const state = getResultStatus(result);
      return `<button class="wheel-result-tab${name === activeResultName ? ' is-active' : ''}" type="button" data-wheel-result-tab data-name="${escapeHtml(name)}"><span>${state.icon}</span>${escapeHtml(name)}</button>`;
    }).join('');
    const result = resultDraft[activeResultName] || defaultPersonResult();
    resultBody.innerHTML = `<div class="wheel-result-person-title">${escapeHtml(activeResultName)}</div>
      <label class="wheel-result-check"><input type="checkbox" data-wheel-result-field="kontrola"${result.kontrola ? ' checked' : ''}><span>Kontrola provedena</span></label>
      <div class="wheel-result-separator"></div>
      <label class="wheel-result-check"><input type="checkbox" data-wheel-result-field="skrinka"${result.skrinka ? ' checked' : ''}><span>Kontrola skříňky</span></label>
      <label class="wheel-result-check"><input type="checkbox" data-wheel-result-field="batoh"${result.batoh ? ' checked' : ''}><span>Kontrola batohu</span></label>
      <div class="wheel-result-separator"></div>
      <select class="wheel-result-select" data-wheel-result-field="vysledek">
        <option value=""${!result.vysledek ? ' selected' : ''}>Výsledek kontroly</option>
        <option value="v poradku"${result.vysledek === 'v poradku' ? ' selected' : ''}>V pořádku</option>
        <option value="s vyhradami"${result.vysledek === 's vyhradami' ? ' selected' : ''}>S výhradami</option>
      </select>
      <textarea class="wheel-result-note" data-wheel-result-field="poznamka" placeholder="Poznámky">${escapeHtml(result.poznamka || '')}</textarea>`;
  }

  function saveResultModal() {
    const record = getRecord(activeResultRowKey, false);
    if (!record) return;
    record.results = { ...(record.results || {}) };
    Object.keys(resultDraft).forEach(name => {
      record.results[name] = { ...defaultPersonResult(), ...resultDraft[name] };
    });
    saveRow(activeResultRowKey);
    closeResultModal();
    render();
  }

  function dayHasData(dateText) {
    return SHIFT_ROWS.some(shift => {
      const record = getRecord(`${dateText}|${shift.key}`, false);
      if (!record) return false;
      if (String(record.controller || '').trim()) return true;
      if (String(record.witness || '').trim()) return true;
      return Array.isArray(record.names) && record.names.some(name => String(name || '').trim());
    });
  }

  function leaderSelect(role, rowKey, value, otherValue, leaders, placeholder) {
    const options = leaders
      .filter(row => row.name !== otherValue || row.name === value)
      .map(row => `<option value="${escapeHtml(row.name)}"${row.name === value ? ' selected' : ''}>${escapeHtml(row.name)}</option>`)
      .join('');
    return `<select class="wheel-select" data-wheel-role="${role}" data-row-key="${escapeHtml(rowKey)}"><option value="">${placeholder}</option>${options}</select>`;
  }

  function getLeaders() {
    return rows
      .filter(row => row.isSupervisor === true && row.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'cs-CZ', { sensitivity: 'base', numeric: true }));
  }

  function getEligibleControlled(dateText, shiftKey, rowKey) {
    const date = parseDateOnly(dateText);
    if (!date) return [];

    // U již provedené kontroly zachovej původní okruh lidí. Změna mapování
    // smí ovlivnit jen nové / dosud neprovedené kontroly.
    const record = rowKey ? getRecord(rowKey, false) : null;
    if (record && Array.isArray(record.eligibleUserIds) && record.eligibleUserIds.length) {
      const frozenIds = new Set(record.eligibleUserIds);
      return rows.filter(row => frozenIds.has(row.id))
        .sort((a, b) => a.name.localeCompare(b.name, 'cs-CZ', { sensitivity: 'base', numeric: true }));
    }

    const group = shiftKey === 'night' ? 'N' : groupForShift(date, shiftKey);
    return rows.filter(row => {
      if (row.controlEnabled !== true) return false;
      if (userMapping[row.id] !== group) return false;
      if (isAbsentOnDate(row, date)) return false;
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name, 'cs-CZ', { sensitivity: 'base', numeric: true }));
  }

  function groupForShift(date, shiftKey) {
    if (shiftKey === 'night') return '';
    const oddWeek = isoWeek(date) % 2 === 1;
    if (shiftKey === 'morning') return oddWeek ? '1' : '2';
    return oddWeek ? '2' : '1';
  }

  function isAbsentOnDate(row, date) {
    const absences = Array.isArray(row.absences) ? row.absences : [];
    return absences.some(item => {
      const start = parseDateOnly(item?.zacatek);
      const end = parseDateOnly(item?.konec);
      return start && end && start <= date && end >= date;
    });
  }

  function openMappingModal() {
    renderMappingModal();
    mappingModal.hidden = false;
    mappingModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeMappingModal() {
    mappingModal.hidden = true;
    mappingModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function renderMappingModal() {
    const controlledUsers = rows
      .filter(row => row.controlEnabled === true && row.id && row.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'cs-CZ', { sensitivity: 'base', numeric: true }));

    mappingColumns.innerHTML = MAPPING_GROUPS.map(group => {
      const list = controlledUsers.length ? controlledUsers.map(row => {
        const assignedGroup = userMapping[row.id] || '';
        const checked = assignedGroup === group.key;
        const disabled = Boolean(assignedGroup && assignedGroup !== group.key);
        return `<label class="wheel-mapping-user${disabled ? ' is-disabled' : ''}"><input type="checkbox" data-wheel-mapping-user data-user-id="${escapeHtml(row.id)}" data-group="${group.key}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}><span>${escapeHtml(row.name)}</span></label>`;
      }).join('') : '<div class="wheel-mapping-empty">Žádní uživatelé s aktivní Kontrolou.</div>';
      return `<section class="wheel-mapping-column"><h3><span>${escapeHtml(group.label)}</span><button type="button" class="wheel-mapping-reset" data-wheel-mapping-reset="${group.key}" title="Odškrtnout celý sloupec">Reset</button></h3><div class="wheel-mapping-list">${list}</div></section>`;
    }).join('');
  }

  function cleanupUserMapping() {
    const validIds = new Set(rows.filter(row => row.controlEnabled === true).map(row => row.id));
    let changed = false;
    Object.keys(userMapping).forEach(id => {
      if (!validIds.has(id) || !['1', '2', 'N'].includes(userMapping[id])) {
        delete userMapping[id];
        changed = true;
      }
    });
    if (changed) saveUserMapping();
  }

  function saveUserMapping() {
    if (!userMappingDocRef) return;
    firestoreSetDoc(userMappingDocRef, userMapping).catch(error => {
      console.error('kolo-stesti.js: nepodařilo se uložit mapování uživatelů.', error);
    });
  }

  function drawPeople(rowKey, dateText, shiftKey) {
    const record = getRecord(rowKey);
    let eligible;

    if (Array.isArray(record.eligibleUserIds) && record.eligibleUserIds.length) {
      eligible = getEligibleControlled(dateText, shiftKey, rowKey);
    } else {
      eligible = getEligibleControlled(dateText, shiftKey, '');
      record.eligibleUserIds = eligible.map(row => row.id);
    }

    // Osoba, u které už byla kontrola provedena, je uzamčená ve svém slotu.
    // Opakované losování může změnit pouze dosud nezkontrolované osoby.
    const currentNames = Array.isArray(record.names) ? record.names.slice(0, 3) : [];
    while (currentNames.length < 3) currentNames.push('');
    const lockedNames = new Set(currentNames.filter(name => name && getPersonResult(record, name).kontrola));
    const candidates = eligible.filter(row => !lockedNames.has(row.name));
    const replacement = randomSample(candidates, 3 - lockedNames.size).map(row => row.name);
    let replacementIndex = 0;
    record.names = currentNames.map(name => {
      if (name && lockedNames.has(name)) return name;
      const nextName = replacement[replacementIndex] || '';
      replacementIndex += 1;
      return nextName;
    }).filter(Boolean);

    saveRow(rowKey);
    render();
  }

  // Kontrolované osoby se pro každý den losují automaticky, jakmile jsou
  // pro danou směnu k dispozici nějací způsobilí lidé. Ruční "Losovat znovu"
  // slouží jen k opakování losování, ne k prvnímu losování.
  function autoDrawPendingRows() {
    if (!loaded) return;
    const daysInMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
    const isCurrentMonth = current.getFullYear() === today.getFullYear() && current.getMonth() === today.getMonth();
    const lastDay = isCurrentMonth ? today.getDate() : daysInMonth;

    for (let day = 1; day <= lastDay; day++) {
      const date = new Date(current.getFullYear(), current.getMonth(), day);
      const dateText = formatDate(date);
      for (const shift of SHIFT_ROWS) {
        const rowKey = `${dateText}|${shift.key}`;
        if (autoDrawInFlight.has(rowKey)) continue;
        const record = getRecord(rowKey, false);
        const hasNames = Boolean(record && Array.isArray(record.names) && record.names.some(Boolean));
        if (hasNames) continue;
        const eligible = getEligibleControlled(dateText, shift.key, rowKey);
        if (!eligible.length) continue;
        autoDrawInFlight.add(rowKey);
        try {
          drawPeople(rowKey, dateText, shift.key);
        } finally {
          autoDrawInFlight.delete(rowKey);
        }
      }
    }
  }

  function randomSample(items, count) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = secureRandomInt(i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, Math.min(count, copy.length));
  }

  function secureRandomInt(max) {
    if (max <= 1) return 0;
    if (window.crypto?.getRandomValues) {
      const limit = Math.floor(0x100000000 / max) * max;
      const buf = new Uint32Array(1);
      do window.crypto.getRandomValues(buf); while (buf[0] >= limit);
      return buf[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function getRecord(key, create = true) {
    if (!state.rows || typeof state.rows !== 'object') state.rows = {};
    if (!state.rows[key] && create) state.rows[key] = { controller: '', witness: '', names: [] };
    return state.rows[key] || null;
  }

  function saveRow(rowKey) {
    if (!wheelRowsRef || !firestoreDoc || !firestoreSetDoc) return;
    const record = state.rows[rowKey];
    if (!record) return;
    firestoreSetDoc(firestoreDoc(wheelRowsRef, rowKey), record).catch(error => {
      console.error('kolo-stesti.js: nepodařilo se uložit záznam kola štěstí.', error);
    });
  }

  // --- Data o lidech (duplikace org. logiky ze Správy uživatelů, viz domu.js) ---

  function buildRows(source, annotationsMap) {
    const orgLeaders = buildOrgLeaderIndex(source);
    const list = source.map(person => {
      const id = getStableId(person);
      const saved = annotationsMap[id] || {};
      return {
        id,
        name: getPersonName(person),
        manager: getManagerName(person, source, orgLeaders),
        controlEnabled: saved.control === true,
        absences: Array.isArray(person.absences) ? person.absences.map(item => ({ ...item })) : []
      };
    });
    const supervisorNames = new Set(list.map(row => row.manager).filter(name => name && name !== '—'));
    list.forEach(row => { row.isSupervisor = supervisorNames.has(row.name); });
    return list;
  }

  function buildOrgLeaderIndex(source) {
    const groups = new Map();
    for (const person of source) {
      const position = parseOrgPosition(getPrimaryOrgPosition(person));
      if (!position.base || !Number.isFinite(position.sub) || position.sub <= 0) continue;
      if (!groups.has(position.base)) groups.set(position.base, []);
      groups.get(position.base).push({ person, sub: position.sub });
    }

    const leaders = new Map();
    for (const [base, members] of groups) {
      members.sort((a, b) => {
        if (a.sub !== b.sub) return a.sub - b.sub;
        return getPersonName(a.person).localeCompare(getPersonName(b.person), "cs-CZ", { numeric: true, sensitivity: "base" });
      });
      if (members.length) leaders.set(base, members[0].person);
    }
    return leaders;
  }

  function getManagerName(person, source, leaders) {
    const selfId = getStableId(person);
    const position = parseOrgPosition(getPrimaryOrgPosition(person));
    if (!position.base || !Number.isFinite(position.sub) || position.sub <= 0) return "—";

    const sameUnitLeader = leaders.get(position.base);
    if (sameUnitLeader && getStableId(sameUnitLeader) !== selfId) {
      return getPersonName(sameUnitLeader);
    }

    const parentBase = getParentOrgCode(person, position.base, source);
    if (!parentBase || parentBase === position.base) return "—";

    const parentLeader = leaders.get(parentBase);
    if (parentLeader && getStableId(parentLeader) !== selfId) {
      return getPersonName(parentLeader);
    }

    return "—";
  }

  function getParentOrgCode(person, ownBase, source) {
    if (!/^\d{9}$/.test(ownBase) || ownBase === ROOT_ORG_CODE) return "";

    const prefix = ownBase.slice(0, 6);
    const suffix = ownBase.slice(6).split("");
    for (let i = suffix.length - 1; i >= 0; i--) {
      if (suffix[i] !== "0") {
        suffix[i] = "0";
        for (let j = i + 1; j < suffix.length; j++) suffix[j] = "0";
        const candidate = prefix + suffix.join("");
        if (candidate !== ownBase && hasOrgBase(source, candidate)) return candidate;
        break;
      }
    }

    if (ownBase.endsWith("000") && ownBase !== ROOT_ORG_CODE && hasOrgBase(source, ROOT_ORG_CODE)) {
      return ROOT_ORG_CODE;
    }

    return "";
  }

  function hasOrgBase(source, base) {
    return source.some(person => parseOrgPosition(getPrimaryOrgPosition(person)).base === base);
  }

  function getPrimaryOrgPosition(person) {
    const directSources = [
      person.organizacniCislo,
      person.orgCislo,
      person.orgNumber,
      person.orgUnitId,
      person.orgjId,
      person.orgUnitNazev,
      person.orgjNazev,
      person.orgStructure?.code,
      person.orgStructure?.id,
      person.orgStructure?.name
    ];

    const directCodes = directSources.flatMap(extractOrgCodes);
    const withSub = directCodes.filter(code => {
      const parsed = parseOrgPosition(code);
      return parsed.base && Number.isFinite(parsed.sub) && parsed.sub > 0;
    });
    if (withSub.length) return [...withSub].sort(compareOrgPosition)[0];

    const fallbackCodes = getOrgCodes(person).filter(code => {
      const parsed = parseOrgPosition(code);
      return parsed.base && Number.isFinite(parsed.sub) && parsed.sub > 0;
    });
    if (!fallbackCodes.length) return "";
    return [...fallbackCodes].sort((a, b) => {
      const aa = parseOrgPosition(a);
      const bb = parseOrgPosition(b);
      if (aa.base !== bb.base) return bb.base.localeCompare(aa.base, "cs-CZ", { numeric: true });
      return aa.sub - bb.sub;
    })[0];
  }

  function compareOrgPosition(a, b) {
    const aa = parseOrgPosition(a), bb = parseOrgPosition(b);
    if (aa.base !== bb.base) return aa.base.localeCompare(bb.base, "cs-CZ", { numeric: true });
    return aa.sub - bb.sub;
  }

  function getOrgCodes(person) {
    const codes = new Set();
    for (const source of getOrgSources(person)) {
      for (const code of extractOrgCodes(source)) codes.add(code);
    }
    return [...codes];
  }

  function getOrgSources(person) {
    const values = [
      person.orgPathText,
      person.orgUnitNazev,
      person.orgjNazev,
      person.orgUnitId,
      person.orgjId,
      person.orgCislo,
      person.orgNumber,
      person.organizacniCislo,
      person.orgParentNazev,
      person.orgParentId,
      person.orgParentCislo,
      person.orgParentKod,
      person.orgParentCode,
      person.mistoNazev,
      person.orgStructure?.code,
      person.orgStructure?.id,
      person.orgStructure?.name,
      person.orgStructure?.pathText
    ];
    if (Array.isArray(person.orgStructure?.path)) values.push(...person.orgStructure.path);
    if (person.orgStructure && typeof person.orgStructure === "object") {
      try { values.push(JSON.stringify(person.orgStructure)); } catch (_) {}
    }
    return values.flatMap(value => {
      if (value === undefined || value === null) return [];
      if (typeof value === "object") {
        try { return [JSON.stringify(value)]; } catch (_) { return []; }
      }
      return [String(value)];
    }).filter(Boolean);
  }

  function extractOrgCodes(value) {
    const textValue = String(value ?? "");
    const matches = textValue.match(/\b\d{9}(?:\s*[\/-]\s*\d{1,4})?\b/g) || [];
    return matches.map(value => value.replace(/\s+/g, "").replace("-", "/"));
  }

  function parseOrgPosition(value) {
    const raw = String(value || "");
    const match = raw.match(/^(\d{9})(?:\/(\d{1,4}))?$/);
    return match ? { base: match[1], sub: match[2] ? Number(match[2]) : Number.MAX_SAFE_INTEGER } : { base: raw, sub: Number.MAX_SAFE_INTEGER };
  }

  function isEmployeeActive(person) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const startMonth = numberOrNull(person.sm ?? person.startMonth);
    const startYear = numberOrNull(person.sy ?? person.startYear);
    const endMonth = numberOrNull(person.em ?? person.endMonth);
    const endYear = numberOrNull(person.ey ?? person.endYear);
    if (startMonth && startYear && (currentYear < startYear || (currentYear === startYear && currentMonth < startMonth))) return false;
    if (endMonth && endYear && (currentYear > endYear || (currentYear === endYear && currentMonth > endMonth))) return false;
    return true;
  }

  function isUnderNehvizdyDc(person) {
    return getOrgCodes(person).some(code => {
      const base = parseOrgPosition(code).base;
      return /^\d{9}$/.test(base) && base >= ROOT_ORG_CODE && base < ORG_RANGE_END;
    });
  }

  function isInExcludedTransportBranch(person) {
    return getOrgCodes(person).some(code => {
      const base = parseOrgPosition(code).base;
      return /^\d{9}$/.test(base) && base.startsWith(EXCLUDED_BRANCH_PREFIX);
    });
  }

  function getStableId(person) {
    return String(person.firebaseDocId || person.osobaId || person.osobniCislo || getPersonName(person));
  }

  function getPersonName(person) {
    return firstText(person.celeJmeno, person.osobaPopis) || `Osoba ${person.osobaId || ""}`.trim();
  }

  function firstText(...values) {
    for (const value of values) {
      const trimmed = text(value);
      if (trimmed) return trimmed;
    }
    return "";
  }

  function text(value) { return value === undefined || value === null ? "" : String(value).trim(); }

  function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function normalize(value) {
    return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("cs-CZ").replace(/\s+/g, " ").trim();
  }

  function isoWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseDateOnly(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    date.setHours(0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dayName(date) {
    return ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'][date.getDay()];
  }

  function capitalize(value) {
    return value ? value.charAt(0).toLocaleUpperCase('cs-CZ') + value.slice(1) : value;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
})();
