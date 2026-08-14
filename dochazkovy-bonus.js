(async function () {
  'use strict';

  const page = document.getElementById('bonusPage');
  if (!page) return;

  const ROOT_ORG_CODE = "110700000";
  const ORG_RANGE_END = "110800000";
  const EXCLUDED_BRANCH_PREFIX = "110703";
  const PEOPLE_COLLECTION = "okbase_absences_by_person";
  const ANNOTATIONS_COLLECTION = "userAnnotations";
  const PAYMENTS_COLLECTION = "bonusPayments";
  const SICKNESS_COLLECTION = "sicknessEvents";
  const DEFAULT_TOTAL = 10000;
  const YEAR = new Date().getFullYear();
  const QUARTER_START_MONTH = { q1: 0, q2: 3, q3: 6, q4: 9 };

  const LEGACY_USERS = Array.isArray(window.BONUS_USERS) ? window.BONUS_USERS : [];
  const LEGACY_PAYMENTS = Array.isArray(window.BONUS_PAYMENTS) ? window.BONUS_PAYMENTS : [];

  const BONUS_DEPARTMENT_GROUPS = [
    { label: 'Příjem', members: ['prijem', 'prijem 1', 'prijem 2', 'prijem - nocni'] },
    { label: 'Výdej', members: ['vydej', 'vydej 1', 'vydej 2', 'nocni', 'vydej obs'] },
    { label: 'Kabely', members: ['kabely', 'kabely 1', 'kabely2', 'kabely 2'] },
    { label: 'Reverzní logistika', members: ['reverzni logistika'] },
    { label: 'Sklad', members: ['sklad'] }
  ];

  const $ = id => document.getElementById(id);
  const heading = $('bonusHeading');
  const searchInput = $('bonusSearch');
  const departmentFilter = $('bonusDepartmentFilter');
  const managerFilter = $('bonusManagerFilter');
  const tableBody = $('bonusTableBody');
  const totalPayout = $('bonusTotalPayout');
  const successRate = $('bonusSuccessRate');
  const zeroPeople = $('bonusZeroPeople');
  const peopleCount = $('bonusPeopleCount');
  const settingsBtn = $('bonusSettingsBtn');
  const exportBtn = $('bonusExportBtn');
  const settingsModal = $('bonusSettingsModal');
  const totalAmountInput = $('bonusTotalAmount');
  const overwriteCheck = $('bonusOverwriteExisting');
  const saveSettingsBtn = $('bonusSaveSettingsBtn');
  const changeModal = $('bonusChangeModal');
  const changeReason = $('bonusChangeReason');
  const saveChangeBtn = $('bonusSaveChangeBtn');
  const changeTitle = $('bonusChangeTitle');

  heading.textContent = `Docházkový bonus - Sklad (${YEAR})`;

  let people = [];
  let annotations = {};
  let users = [];
  let payments = {};
  let sicknessByPerson = {};
  let totalAmount = DEFAULT_TOTAL;
  let pendingChange = null;

  let firestoreDoc = null;
  let firestoreSetDoc = null;
  let paymentsRef = null;
  let settingsDocRef = null;

  const legacyUsersByName = new Map(LEGACY_USERS.map(user => [normalize(user.jmeno), user]));
  const legacyPaymentsByUserId = new Map(LEGACY_PAYMENTS.map(p => [p.user_id, p]));

  function normalizePayment(p) {
    return {
      q1: Number(p?.q1 ?? 0), q2: Number(p?.q2 ?? 0), q3: Number(p?.q3 ?? 0), q4: Number(p?.q4 ?? 0),
      q1_note: p?.q1_note ?? '', q2_note: p?.q2_note ?? '', q3_note: p?.q3_note ?? '', q4_note: p?.q4_note ?? ''
    };
  }

  function defaultPayment() {
    const quarterlyDefault = totalAmount / 4;
    return normalizePayment({ q1: quarterlyDefault, q2: quarterlyDefault, q3: quarterlyDefault, q4: quarterlyDefault });
  }

  function getPayment(user) {
    const saved = payments[user.id];
    return saved ? normalizePayment(saved) : defaultPayment();
  }

  function afterQuarterStart(dateValue, quarter) {
    if (!dateValue) return false;
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return false;
    date.setHours(0, 0, 0, 0);
    const month = { q1: 0, q2: 3, q3: 6, q4: 9 }[quarter];
    if (month === undefined) return false;
    return date > new Date(YEAR, month, 1);
  }

  function quarterRange(quarter) {
    const startMonth = QUARTER_START_MONTH[quarter];
    return { start: new Date(YEAR, startMonth, 1), end: new Date(YEAR, startMonth + 3, 1) };
  }

  function hasSicknessInQuarter(user, quarter) {
    const events = sicknessByPerson[user.id];
    if (!events || !events.length) return false;
    const { start, end } = quarterRange(quarter);
    return events.some(evt => {
      const d = new Date(evt.detectedAt || evt.casPreruseni || '');
      return !Number.isNaN(d.getTime()) && d >= start && d < end;
    });
  }

  function effectiveQuarter(user, quarter) {
    if (afterQuarterStart(user.datum_nastupu, quarter)) return 0;
    return getPayment(user)[quarter];
  }

  // Automatické vynulování čtvrtletí kvůli nemoci z OKbase — zapíše se rovnou
  // do Firestore i do Historie změn, bez čekání na potvrzení člověkem. Jakmile
  // má čtvrtletí jakoukoli poznámku (ať už od tohohle mechanismu nebo od
  // ručního zásahu), znovu se nepřepisuje — člověk to pak může kdykoli sám
  // ručně přepsat přes běžnou úpravu odměny.
  function reconcileSicknessAutoZero() {
    if (!paymentsRef || !users.length) return;
    for (const user of users) {
      for (const quarter of ['q1', 'q2', 'q3', 'q4']) {
        if (afterQuarterStart(user.datum_nastupu, quarter)) continue;
        if (!hasSicknessInQuarter(user, quarter)) continue;
        const current = getPayment(user);
        if (current[`${quarter}_note`]) continue;
        const stamp = `[${new Date().toLocaleString('cs-CZ')}]`;
        const next = { ...current, [quarter]: 0, [`${quarter}_note`]: `OKbase: nemoc v průběhu čtvrtletí (automaticky) ${stamp}` };
        payments[user.id] = next;
        window.KVEAudit?.logSystemChange({
          module: 'Docházkový bonus', action: 'Automatické vynulování (nemoc)', entity: user.jmeno || user.id,
          field: quarter.toUpperCase(), oldValue: Number(current[quarter] || 0), newValue: 0,
          detail: 'OKbase: nemoc v průběhu čtvrtletí'
        });
        firestoreSetDoc(firestoreDoc(paymentsRef, paymentDocId(user.id)), next).catch(error => {
          console.error(`dochazkovy-bonus.js: nepodařilo se automaticky vynulovat odměnu (nemoc) uživatele ${user.id}.`, error);
        });
      }
    }
  }

  function userTotal(user) {
    return ['q1', 'q2', 'q3', 'q4'].reduce((sum, q) => sum + effectiveQuarter(user, q), 0);
  }

  function userMaximum(user) {
    const quarter = totalAmount / 4;
    return ['q1', 'q2', 'q3', 'q4'].reduce((sum, q) => sum + (afterQuarterStart(user.datum_nastupu, q) ? 0 : quarter), 0);
  }

  function filteredUsers() {
    const needle = (searchInput.value || '').trim().toLocaleLowerCase('cs-CZ');
    const dept = departmentFilter.value;
    const manager = managerFilter.value;
    return users.filter(user => {
      const byName = !needle || String(user.jmeno || '').toLocaleLowerCase('cs-CZ').includes(needle);
      return byName && (!dept || user.bonusCategory === dept) && (!manager || user.vedouci === manager);
    });
  }

  function fillFilters() {
    const selectedDepartment = departmentFilter.value;
    const selectedManager = managerFilter.value;
    const departments = BONUS_DEPARTMENT_GROUPS.map(group => group.label).filter(label => users.some(user => user.bonusCategory === label));
    const managers = [...new Set(users.map(u => u.vedouci).filter(v => v && v !== '—'))].sort((a, b) => a.localeCompare(b, 'cs-CZ', { sensitivity: 'base' }));
    departmentFilter.innerHTML = '<option value="">Všechna oddělení</option>' + departments.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join('');
    managerFilter.innerHTML = '<option value="">Všichni vedoucí</option>' + managers.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join('');
    departmentFilter.value = departments.includes(selectedDepartment) ? selectedDepartment : '';
    managerFilter.value = managers.includes(selectedManager) ? selectedManager : '';
  }

  function render() {
    const visibleUsers = filteredUsers();
    tableBody.innerHTML = visibleUsers.map(renderRow).join('');
    const payout = visibleUsers.reduce((s, u) => s + userTotal(u), 0);
    const maximum = visibleUsers.reduce((s, u) => s + userMaximum(u), 0);
    totalPayout.textContent = `${payout.toLocaleString('cs-CZ')} Kč`;
    successRate.textContent = `${maximum > 0 ? Math.round(payout / maximum * 100) : 0}%`;
    zeroPeople.textContent = String(visibleUsers.filter(u => userTotal(u) === 0).length);
    if (peopleCount) peopleCount.textContent = String(visibleUsers.length);
    if (!visibleUsers.length) tableBody.innerHTML = '<tr><td colspan="9" class="bonus-empty">Žádní uživatelé nenalezeni.</td></tr>';
  }

  function renderRow(user) {
    const payment = getPayment(user);
    const cells = ['q1', 'q2', 'q3', 'q4'].map(q => renderQuarterCell(user, payment, q)).join('');
    return `<tr>
      <td><strong>${escapeHtml(user.jmeno || '')}</strong></td>
      <td>${escapeHtml(user.pozice || '')}</td>
      <td>${escapeHtml(user.oddeleni || '')}</td>
      <td>${escapeHtml(user.vedouci || '')}</td>
      ${cells}
      <td class="bonus-total-cell ${totalCellClass(user)}">${userTotal(user).toLocaleString('cs-CZ')} Kč</td>
    </tr>`;
  }

  function totalCellClass(user) {
    const total = userTotal(user);
    const maximum = userMaximum(user);
    if (total === 0) return 'cell-danger';
    if (Math.abs(total - maximum) < 0.01) return 'cell-success';
    return 'cell-partial';
  }

  function renderQuarterCell(user, payment, quarter) {
    const excluded = afterQuarterStart(user.datum_nastupu, quarter);
    const value = excluded ? 0 : payment[quarter];
    const note = payment[`${quarter}_note`] || '';
    const title = excluded ? `Nástup ${formatDate(user.datum_nastupu)} je po začátku kvartálu.` : note;
    const colorClass = value === 0 ? (excluded && !note ? 'cell-disabled-zero' : 'cell-danger') : '';
    return `<td class="bonus-quarter-cell ${colorClass}">
      <button type="button" class="bonus-quarter-btn" data-bonus-user="${escapeAttr(user.id)}" data-bonus-quarter="${quarter}" ${excluded ? 'disabled' : ''} title="${escapeAttr(title)}">
        <span>${Number(value).toLocaleString('cs-CZ')} Kč</span>${note && !excluded ? '<small aria-hidden="true">●</small>' : ''}
      </button>
    </td>`;
  }

  function openChange(userId, quarter) {
    const user = users.find(u => u.id === userId);
    if (!user || afterQuarterStart(user.datum_nastupu, quarter)) return;
    const p = getPayment(user);
    const current = Number(p[quarter] || 0);
    const target = current > 0 ? 0 : totalAmount / 4;
    pendingChange = { user, quarter, target };
    changeTitle.textContent = `${user.jmeno} – ${quarter.toUpperCase()} → ${target.toLocaleString('cs-CZ')} Kč`;
    changeReason.value = '';
    openModal(changeModal);
    setTimeout(() => changeReason.focus(), 0);
  }

  function saveChange() {
    if (!pendingChange || !paymentsRef) return;
    const reason = changeReason.value.trim();
    if (!reason) return;
    const { user, quarter, target } = pendingChange;
    const current = getPayment(user);
    const stamp = `[${new Date().toLocaleString('cs-CZ')}]`;
    const next = { ...current, [quarter]: target, [`${quarter}_note`]: `${reason} ${stamp}` };
    payments[user.id] = next;
    window.KVEAudit?.logChange({ module: 'Docházkový bonus', action: 'Změna odměny', entity: user.jmeno || user.id, field: quarter.toUpperCase(), oldValue: Number(current[quarter] || 0), newValue: target, detail: reason });
    firestoreSetDoc(firestoreDoc(paymentsRef, paymentDocId(user.id)), next).catch(error => {
      console.error('dochazkovy-bonus.js: nepodařilo se uložit změnu odměny.', error);
    });
    closeModal(changeModal);
    pendingChange = null;
    render();
  }

  function saveSettings() {
    if (!settingsDocRef) return;
    const value = Number(totalAmountInput.value);
    if (!Number.isFinite(value) || value < 0) return;
    const oldTotalAmount = totalAmount;
    totalAmount = value;
    window.KVEAudit?.logChange({ module: 'Docházkový bonus', action: 'Změna nastavení', entity: 'Roční částka odměny', field: 'Celková částka', oldValue: oldTotalAmount, newValue: value });
    firestoreSetDoc(settingsDocRef, { totalAmount: value }).catch(error => {
      console.error('dochazkovy-bonus.js: nepodařilo se uložit nastavení.', error);
    });
    if (overwriteCheck.checked) {
      users.forEach(user => {
        const current = getPayment(user);
        const next = { ...current };
        let changed = false;
        ['q1', 'q2', 'q3', 'q4'].forEach(q => {
          if (Number(current[q]) > 0 && Number(current[q]) !== value / 4) {
            const oldQuarter = Number(current[q]);
            next[q] = value / 4;
            changed = true;
            window.KVEAudit?.logChange({ module: 'Docházkový bonus', action: 'Hromadná změna odměny', entity: user.jmeno || user.id, field: q.toUpperCase(), oldValue: oldQuarter, newValue: next[q] });
          }
        });
        if (changed) {
          payments[user.id] = next;
          firestoreSetDoc(firestoreDoc(paymentsRef, paymentDocId(user.id)), next).catch(error => {
            console.error(`dochazkovy-bonus.js: nepodařilo se hromadně přepsat odměnu uživatele ${user.id}.`, error);
          });
        }
      });
    }
    closeModal(settingsModal);
    render();
  }

  function exportExcel() {
    const visibleUsers = filteredUsers();
    if (!window.XLSX || !visibleUsers.length) return;
    const rows = visibleUsers.map(user => {
      const p = getPayment(user);
      return {
        Jméno: user.jmeno, Pozice: user.pozice, Oddělení: user.oddeleni, Vedoucí: user.vedouci,
        Q1: p.q1, Q1_Note: p.q1_note, Q2: p.q2, Q2_Note: p.q2_note,
        Q3: p.q3, Q3_Note: p.q3_note, Q4: p.q4, Q4_Note: p.q4_note, Celkem: userTotal(user)
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 10 }, { wch: 34 }, { wch: 10 }, { wch: 34 }, { wch: 10 }, { wch: 34 }, { wch: 10 }, { wch: 34 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Odměny');
    XLSX.writeFile(wb, `dochazkovy-bonus_${YEAR}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function paymentDocId(userId) {
    return `${userId}_${YEAR}`;
  }

  function rebuildUsers() {
    users = buildBonusUsers(people, annotations);
    fillFilters();
    render();
    reconcileSicknessAutoZero();
  }

  function buildBonusUsers(source, annotationsMap) {
    const orgLeaders = buildOrgLeaderIndex(source);
    return source
      .map(person => {
        const id = getStableId(person);
        const saved = annotationsMap[id] || {};
        if (saved.bonus !== true) return null;

        const place = text(person.orgStructure?.mistoNazev);
        const department = text(person.orgjNazev);
        const name = getPersonName(person);
        const legacy = legacyUsersByName.get(normalize(name));
        return {
          id,
          jmeno: name,
          pozice: place || legacy?.pozice || '',
          oddeleni: department || '—',
          bonusCategory: getBonusDepartmentCategory(department),
          vedouci: getManagerName(person, source, orgLeaders),
          datum_nastupu: text(person.veFirmeOd) || legacy?.datum_nastupu || ''
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.jmeno.localeCompare(b.jmeno, 'cs-CZ', { sensitivity: 'base' }));
  }

  function getBonusDepartmentCategory(department) {
    const normalized = normalize(department);
    const compact = normalized.replace(/\s+/g, '');
    for (const group of BONUS_DEPARTMENT_GROUPS) {
      if (group.members.some(member => {
        const normalizedMember = normalize(member);
        return normalized === normalizedMember || compact === normalizedMember.replace(/\s+/g, '');
      })) return group.label;
    }
    return '';
  }

  function openModal(modal) {
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('bonus-modal-open');
  }
  function closeModal(modal) {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    if (settingsModal.hidden && changeModal.hidden) document.body.classList.remove('bonus-modal-open');
  }
  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('cs-CZ');
  }
  function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(v) { return escapeHtml(v).replace(/\n/g, '&#10;'); }

  [searchInput, departmentFilter, managerFilter].forEach(el => el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', render));
  tableBody.addEventListener('click', e => {
    const btn = e.target.closest('[data-bonus-user][data-bonus-quarter]');
    if (btn) openChange(btn.dataset.bonusUser, btn.dataset.bonusQuarter);
  });
  settingsBtn.addEventListener('click', () => {
    totalAmountInput.value = String(totalAmount);
    overwriteCheck.checked = false;
    openModal(settingsModal);
  });
  exportBtn.addEventListener('click', exportExcel);
  saveSettingsBtn.addEventListener('click', saveSettings);
  saveChangeBtn.addEventListener('click', saveChange);
  document.querySelectorAll('[data-bonus-modal-close]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.closest('.bonus-modal'))));

  connectFirestore();

  async function connectFirestore() {
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
        setDoc
      } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");

      const peopleApp = initializeApp({
        apiKey: "AIzaSyCaanEUktq1zw_kQszcVT5kfTK81SEq68Q",
        authDomain: "okbase-dovolene.firebaseapp.com",
        projectId: "okbase-dovolene",
        storageBucket: "okbase-dovolene.firebasestorage.app",
        messagingSenderId: "698583441353",
        appId: "1:698583441353:web:ed6efef9e2881ed5f09218"
      }, "kveBonusPeople");
      const peopleDb = initializeFirestore(peopleApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
      const peopleQuery = query(collection(peopleDb, PEOPLE_COLLECTION), orderBy("osobaId", "asc"));

      onSnapshot(peopleQuery, snapshot => {
        people = snapshot.docs
          .map(docSnap => ({ firebaseDocId: docSnap.id, ...docSnap.data() }))
          .filter(isEmployeeActive)
          .filter(isUnderNehvizdyDc)
          .filter(person => normalize(person.parentUnitNazev) !== "doprava")
          .filter(person => !isInExcludedTransportBranch(person));
        rebuildUsers();
        maybeSeedFromLegacy();
      }, error => {
        console.error('dochazkovy-bonus.js: chyba synchronizace uživatelů.', error);
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
      paymentsRef = collection(mappingDb, PAYMENTS_COLLECTION);
      settingsDocRef = doc(mappingDb, 'config', 'bonusSettings');

      onSnapshot(collection(mappingDb, ANNOTATIONS_COLLECTION), snapshot => {
        const next = {};
        snapshot.forEach(docSnap => { next[decodeURIComponent(docSnap.id)] = docSnap.data(); });
        annotations = next;
        rebuildUsers();
      }, error => {
        console.error('dochazkovy-bonus.js: chyba synchronizace nastavení uživatelů.', error);
      });

      onSnapshot(paymentsRef, snapshot => {
        const next = {};
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          const userId = docSnap.id.replace(new RegExp(`_${YEAR}$`), '');
          next[userId] = data;
        });
        payments = next;
        render();
        reconcileSicknessAutoZero();
      }, error => {
        console.error('dochazkovy-bonus.js: chyba synchronizace odměn.', error);
      });

      onSnapshot(settingsDocRef, snapshot => {
        totalAmount = snapshot.exists() && Number.isFinite(Number(snapshot.data()?.totalAmount))
          ? Number(snapshot.data().totalAmount)
          : DEFAULT_TOTAL;
        render();
      }, error => {
        console.error('dochazkovy-bonus.js: chyba synchronizace nastavení odměn.', error);
      });

      onSnapshot(collection(mappingDb, SICKNESS_COLLECTION), snapshot => {
        const next = {};
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          if (!data?.personId) return;
          if (!next[data.personId]) next[data.personId] = [];
          next[data.personId].push(data);
        });
        sicknessByPerson = next;
        render();
        reconcileSicknessAutoZero();
      }, error => {
        console.error('dochazkovy-bonus.js: chyba synchronizace nemocí z OKbase.', error);
      });

      // Jednorázový import existující evidence odměn (bonus-seed-data.js) do Firestore,
      // spárovaný na reálné osoby podle jména (stejný vzor jako u čteček/boxů). Musí
      // počkat na první načtení reálných lidí, aby bylo k dispozici skutečné ID osoby
      // (osobaId), ne legacy UUID z productio2 - viz maybeSeedFromLegacy() níže.
      const seedStatusRef = doc(mappingDb, 'meta', 'bonusSeedStatus');
      let seedAttempted = false;

      async function maybeSeedFromLegacy() {
        if (seedAttempted || !people.length || !LEGACY_PAYMENTS.length) return;
        seedAttempted = true;
        try {
          const seedStatusSnap = await getDoc(seedStatusRef);
          if (seedStatusSnap.exists()) return;

          const batch = writeBatch(mappingDb);
          let seededCount = 0;
          for (const person of people) {
            const legacyUser = legacyUsersByName.get(normalize(getPersonName(person)));
            if (!legacyUser) continue;
            const payment = legacyPaymentsByUserId.get(legacyUser.id);
            if (!payment) continue;
            const seedYear = Number(payment.year) || YEAR;
            const personId = getStableId(person);
            batch.set(doc(paymentsRef, `${personId}_${seedYear}`), normalizePayment(payment));
            seededCount++;
          }
          batch.set(seedStatusRef, { seeded: true, seededAt: new Date().toISOString(), count: seededCount });
          await batch.commit();
        } catch (error) {
          console.error('dochazkovy-bonus.js: nepodařilo se naimportovat existující evidenci odměn.', error);
        }
      }

      maybeSeedFromLegacy();
    } catch (error) {
      console.error('dochazkovy-bonus.js: Firestore se nepodařilo načíst.', error);
    }
  }

  // --- Data o lidech (duplikace org. logiky ze Správy uživatelů / Kola štěstí) ---

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
})();
