(function () {
  'use strict';

  const ACTOR_KEY = 'kve.audit.actor.v1';
  const ACTOR_LAST_KEY = 'kve.audit.actor.last.v1';
  const ACTOR_TTL_MS = 60 * 60 * 1000;
  const DEVICE_ID_KEY = 'kve.audit.device-id.v1';

  const ROOT_ORG_CODE = "110700000";
  const ORG_RANGE_END = "110800000";
  const EXCLUDED_BRANCH_PREFIX = "110703";
  const PEOPLE_COLLECTION = "okbase_absences_by_person";
  const AUDIT_COLLECTION = "auditLog";

  let metadataPromise = null;
  let actorPromise = null;
  let actorRowsPromise = null;
  let firestoreReady = null;

  function makeId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'audit-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_ID_KEY) || '';
      if (!id) {
        id = makeId();
        localStorage.setItem(DEVICE_ID_KEY, id);
      }
      return id;
    } catch (_) {
      return 'Nezjištěno';
    }
  }

  function detectDevice() {
    const ua = navigator.userAgent || '';
    const platform = navigator.userAgentData?.platform || navigator.platform || 'Neznámá platforma';
    let browser = 'Prohlížeč';
    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/Chrome\//.test(ua)) browser = 'Chrome';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari';
    return `${platform} • ${browser}`;
  }

  async function getMetadata() {
    if (metadataPromise) return metadataPromise;
    metadataPromise = (async () => {
      let ip = 'Nezjištěna';
      try {
        const response = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
        if (response.ok) {
          const data = await response.json();
          if (data?.ip) ip = String(data.ip);
        }
      } catch (_) {}
      return { ip, device: detectDevice(), deviceId: getDeviceId() };
    })();
    return metadataPromise;
  }

  function loadActor() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ACTOR_KEY) || 'null');
      if (!parsed || typeof parsed !== 'object' || !parsed.name) return null;
      return {
        id: String(parsed.id || ''),
        name: String(parsed.name || ''),
        email: String(parsed.email || '')
      };
    } catch (_) {
      return null;
    }
  }

  function saveActor(actor) {
    try {
      localStorage.setItem(ACTOR_KEY, JSON.stringify(actor));
      localStorage.setItem(ACTOR_LAST_KEY, String(Date.now()));
    } catch (_) {}
    window.dispatchEvent(new CustomEvent('kve:audit-actor-changed', { detail: actor }));
  }

  function actorIsFresh() {
    const actor = loadActor();
    if (!actor) return false;
    try {
      const last = Number(localStorage.getItem(ACTOR_LAST_KEY) || 0);
      return last > 0 && (Date.now() - last) < ACTOR_TTL_MS;
    } catch (_) {
      return false;
    }
  }

  function touchActor() {
    try { localStorage.setItem(ACTOR_LAST_KEY, String(Date.now())); } catch (_) {}
  }

  // --- Seznam osob pro našeptávač (samostatné napojení na Firestore, stejné
  // org. filtrování jako zbytek appky - viz domu.js/kolo-stesti.js). ---

  async function getFirestore() {
    if (firestoreReady) return firestoreReady;
    firestoreReady = (async () => {
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
        addDoc
      } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");

      const peopleApp = initializeApp({
        apiKey: "AIzaSyCaanEUktq1zw_kQszcVT5kfTK81SEq68Q",
        authDomain: "okbase-dovolene.firebaseapp.com",
        projectId: "okbase-dovolene",
        storageBucket: "okbase-dovolene.firebasestorage.app",
        messagingSenderId: "698583441353",
        appId: "1:698583441353:web:ed6efef9e2881ed5f09218"
      }, "kveAuditPeople");
      const peopleDb = initializeFirestore(peopleApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

      const mappingApp = initializeApp({
        apiKey: "AIzaSyBX3Phi9CNQPjxYXMKil7exLrJ7ZbRUMbM",
        authDomain: "kv-transport-mapping.firebaseapp.com",
        projectId: "kv-transport-mapping",
        storageBucket: "kv-transport-mapping.firebasestorage.app",
        messagingSenderId: "144100896901",
        appId: "1:144100896901:web:2ceef97e784e06385239ec"
      }, "kveAuditMapping");
      const mappingDb = initializeFirestore(mappingApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

      return {
        peopleDb, mappingDb, collection, doc, query, orderBy, onSnapshot, addDoc,
        peopleQuery: query(collection(peopleDb, PEOPLE_COLLECTION), orderBy("osobaId", "asc")),
        auditRef: collection(mappingDb, AUDIT_COLLECTION)
      };
    })();
    return firestoreReady;
  }

  async function getActorRows() {
    if (actorRowsPromise) return actorRowsPromise;
    actorRowsPromise = (async () => {
      try {
        const ctx = await getFirestore();
        return await new Promise(resolve => {
          const unsubscribe = ctx.onSnapshot(ctx.peopleQuery, snapshot => {
            unsubscribe();
            const rows = snapshot.docs
              .map(docSnap => ({ firebaseDocId: docSnap.id, ...docSnap.data() }))
              .filter(isEmployeeActive)
              .filter(isUnderNehvizdyDc)
              .filter(person => normalize(person.parentUnitNazev) !== "doprava")
              .filter(person => !isInExcludedTransportBranch(person))
              .map(person => ({
                id: getStableId(person),
                name: getPersonName(person),
                email: firstText(person.email)
              }))
              .filter(row => row.name)
              .sort((a, b) => a.name.localeCompare(b.name, 'cs-CZ', { sensitivity: 'base' }));
            resolve(rows);
          }, error => {
            console.error('audit.js: chyba načítání osob pro našeptávač.', error);
            resolve([]);
          });
        });
      } catch (error) {
        console.error('audit.js: Firestore se nepodařilo načíst.', error);
        return [];
      }
    })();
    return actorRowsPromise;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function normalizeText(value) {
    return String(value || '')
      .trim()
      .toLocaleLowerCase('cs-CZ')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  function sameActor(a, b) {
    if (!a || !b) return false;
    if (a.id && b.id) return a.id === b.id;
    return a.name === b.name && a.email === b.email;
  }

  function displayValue(value) {
    if (value === undefined) return '—';
    if (value === null) return 'null';
    if (typeof value === 'string') return value || 'prázdné';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      const text = JSON.stringify(value);
      return text.length > 700 ? text.slice(0, 697) + '…' : text;
    } catch (_) { return String(value); }
  }

  function actorDisplay(actor) {
    if (!actor) return 'Nikdo';
    return actor.email ? `${actor.name} (${actor.email})` : actor.name;
  }

  async function appendEntry(data, actorOverride) {
    const timestamp = new Date().toISOString();
    const meta = await getMetadata();
    const actor = actorOverride || loadActor();
    const dateObj = new Date(timestamp);
    const entry = {
      timestamp,
      date: dateObj.toLocaleDateString('cs-CZ'),
      time: dateObj.toLocaleTimeString('cs-CZ'),
      actorId: actor?.id || '',
      actorName: actor?.name || 'Neurčený uživatel',
      actorEmail: actor?.email || '',
      module: data.module || 'Aplikace',
      action: data.action || 'Změna',
      entity: data.entity || '—',
      field: data.field || '—',
      oldValue: displayValue(data.oldValue),
      newValue: displayValue(data.newValue),
      detail: data.detail || '',
      ip: meta.ip,
      device: meta.device,
      deviceId: meta.deviceId
    };
    try {
      const ctx = await getFirestore();
      await ctx.addDoc(ctx.auditRef, entry);
    } catch (error) {
      console.error('audit.js: nepodařilo se zapsat auditní záznam.', error);
    }
    return entry;
  }

  async function auditActorChange(previousActor, nextActor, source) {
    if (sameActor(previousActor, nextActor)) return null;
    return appendEntry({
      module: 'Audit',
      action: previousActor ? 'Přepnutí uživatele' : 'Výběr uživatele',
      entity: source || 'Aktivní uživatel',
      field: 'Uživatel',
      oldValue: actorDisplay(previousActor),
      newValue: actorDisplay(nextActor),
      detail: 'Změna identity uživatele používané pro auditní záznamy.'
    }, nextActor);
  }

  function renderSuggestions(container, rows, query, onSelect) {
    const normalized = normalizeText(query);
    if (!normalized) {
      container.innerHTML = '<div class="audit-actor-suggestion-hint">Začněte psát jméno nebo e-mail.</div>';
      container.hidden = false;
      return;
    }
    const matches = rows.filter(row => {
      const haystack = normalizeText(`${row.name} ${row.email}`);
      return haystack.includes(normalized);
    }).slice(0, 10);
    if (!matches.length) {
      container.innerHTML = '<div class="audit-actor-suggestion-hint">Žádný uživatel neodpovídá zadanému textu.</div>';
      container.hidden = false;
      return;
    }
    container.innerHTML = matches.map(row => `
      <button type="button" class="audit-actor-suggestion" data-actor-id="${escapeHtml(row.id)}" data-actor-name="${escapeHtml(row.name)}" data-actor-email="${escapeHtml(row.email)}">
        <strong>${escapeHtml(row.name)}</strong>${row.email ? `<span>${escapeHtml(row.email)}</span>` : ''}
      </button>`).join('');
    container.hidden = false;
    container.querySelectorAll('.audit-actor-suggestion').forEach(button => {
      button.addEventListener('click', () => {
        const row = {
          id: button.dataset.actorId || '',
          name: button.dataset.actorName || '',
          email: button.dataset.actorEmail || ''
        };
        onSelect(row);
      });
    });
  }

  async function chooseActor(force, source) {
    const current = loadActor();
    if (current && !force && actorIsFresh()) return current;
    if (actorPromise) return actorPromise;

    actorPromise = new Promise(resolve => {
      document.getElementById('kveAuditActorModal')?.remove();
      const modal = document.createElement('div');
      modal.id = 'kveAuditActorModal';
      modal.className = 'audit-actor-modal';
      modal.innerHTML = `
        <div class="audit-actor-dialog" role="dialog" aria-modal="true" aria-labelledby="auditActorTitle">
          <div class="audit-actor-title" id="auditActorTitle">Kdo právě používá aplikaci?</div>
          <p class="audit-actor-text">Vyberte své jméno. Každá provedená změna se uloží do auditu pod tímto uživatelem. Pokud se u počítače vystřídá jiný člověk, změňte uživatele v části Historie změn.</p>
          <label class="audit-actor-label" for="auditActorInput">Uživatel</label>
          <div class="audit-actor-autocomplete">
            <input id="auditActorInput" class="audit-actor-input" type="text" autocomplete="off" spellcheck="false" placeholder="Načítám uživatele…" disabled>
            <div id="auditActorSuggestions" class="audit-actor-suggestions" hidden></div>
          </div>
          <div id="auditActorSelection" class="audit-actor-selection" hidden></div>
          <div id="auditActorWarning" class="audit-actor-warning" hidden></div>
          <div class="audit-actor-actions"><button type="button" class="btn primary" id="auditActorConfirm" disabled>Potvrdit uživatele</button></div>
        </div>`;
      document.body.appendChild(modal);

      const input = modal.querySelector('#auditActorInput');
      const suggestions = modal.querySelector('#auditActorSuggestions');
      const selection = modal.querySelector('#auditActorSelection');
      const warning = modal.querySelector('#auditActorWarning');
      const confirm = modal.querySelector('#auditActorConfirm');
      let rows = [];
      let selectedActor = null;

      const selectActor = actor => {
        selectedActor = actor;
        input.value = actor.name;
        suggestions.hidden = true;
        selection.hidden = false;
        selection.innerHTML = `<span>Vybráno:</span><strong>${escapeHtml(actor.name)}</strong>${actor.email ? `<small>${escapeHtml(actor.email)}</small>` : ''}`;
        confirm.disabled = false;
      };

      input.addEventListener('input', () => {
        selectedActor = null;
        selection.hidden = true;
        confirm.disabled = true;
        renderSuggestions(suggestions, rows, input.value, selectActor);
      });
      input.addEventListener('focus', () => renderSuggestions(suggestions, rows, input.value, selectActor));
      input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        if (selectedActor) {
          event.preventDefault();
          confirm.click();
          return;
        }
        const normalized = normalizeText(input.value);
        const exact = rows.filter(row => normalizeText(row.name) === normalized || normalizeText(row.email) === normalized);
        if (exact.length === 1) {
          event.preventDefault();
          selectActor(exact[0]);
          confirm.click();
        }
      });

      confirm.addEventListener('click', async () => {
        if (!selectedActor) return;
        const previousActor = current;
        confirm.disabled = true;
        saveActor(selectedActor);
        modal.remove();
        actorPromise = null;
        await auditActorChange(previousActor, selectedActor, source);
        resolve(selectedActor);
      });

      getActorRows().then(loadedRows => {
        rows = loadedRows;
        if (!rows.length) {
          warning.hidden = false;
          warning.textContent = 'Seznam uživatelů se nepodařilo načíst. Obnovte stránku a zkuste to znovu.';
          input.placeholder = 'Uživatelé nejsou dostupní';
          return;
        }
        input.disabled = false;
        input.placeholder = 'Začněte psát své jméno…';
        if (current) {
          const matched = rows.find(row => sameActor(row, current));
          if (matched) selectActor(matched);
        }
        setTimeout(() => input.focus(), 0);
      }).catch(() => {
        warning.hidden = false;
        warning.textContent = 'Seznam uživatelů se nepodařilo načíst.';
        input.placeholder = 'Uživatelé nejsou dostupní';
      });
    });

    return actorPromise;
  }

  async function logChange({ module, action, entity, field, oldValue, newValue, detail } = {}) {
    const actor = await chooseActor(false, 'Automatické ověření uživatele');
    touchActor();
    return appendEntry({ module, action, entity, field, oldValue, newValue, detail }, actor);
  }

  function logDiff(module, action, entity, oldObj, newObj, fields) {
    const keys = Array.isArray(fields) ? fields : Array.from(new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]));
    let count = 0;
    keys.forEach(key => {
      const before = oldObj ? oldObj[key] : undefined;
      const after = newObj ? newObj[key] : undefined;
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      count++;
      logChange({ module, action, entity, field: key, oldValue: before, newValue: after });
    });
    return count;
  }

  window.KVEAudit = {
    logChange,
    logDiff,
    getActor: loadActor,
    chooseActor: () => chooseActor(true, 'Historie změn'),
    ensureActor: (source) => chooseActor(false, source || 'Ověření uživatele'),
    actorIsFresh
  };

  function renderHeaderActor() {
    const button = document.getElementById('headerActorButton');
    if (!button) return;
    const actor = loadActor();
    button.innerHTML = actor
      ? `<span>Aktivní uživatel:</span><strong>${escapeHtml(actor.name)}</strong>`
      : '<span>Aktivní uživatel:</span><strong>Není vybrán</strong>';
  }

  function initHeaderActor() {
    const button = document.getElementById('headerActorButton');
    if (!button) return;
    renderHeaderActor();
    button.addEventListener('click', () => chooseActor(true, 'Záhlaví stránky'));
    window.addEventListener('kve:audit-actor-changed', renderHeaderActor);
  }

  initHeaderActor();
  getMetadata();

  // Identita pro audit se ověřuje při načtení stránky, ale modal se ukáže
  // jen když chybí nebo je starší než hodinu (viz actorIsFresh/ACTOR_TTL_MS).
  setTimeout(() => {
    chooseActor(false, 'Spuštění aplikace');
  }, 0);

  // --- Org. filtrování a identifikace osob (duplikace stejné logiky jako
  // domu.js/kolo-stesti.js/dochazkovy-bonus.js). ---

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
