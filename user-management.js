(async function () {
  const statusElement = document.getElementById("userManagementStatus");
  const bodyElement = document.getElementById("userManagementBody");

  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js");
    const {
      initializeFirestore,
      persistentLocalCache,
      persistentMultipleTabManager,
      collection,
      query,
      orderBy,
      getDocsFromCache,
      getDocsFromServer,
      doc,
      onSnapshot,
      setDoc
    } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");

    // app.js i tento soubor potřebují Firestore ve stejném kv-transport-mapping projektu
    // (mapování vozidel, resp. anotace uživatelů). Otevřít k němu z jedné stránky dvě
    // samostatná připojení současně vede k nedeterministické "permission-denied" chybě
    // při startu, proto si obě sdílí jedno společné přes window.
    function connectSharedKvTransportMappingFirestore() {
      if (!window.__kvTransportMappingFirestorePromise) {
        window.__kvTransportMappingFirestorePromise = (async () => {
          const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } =
            await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");
          const app = initializeApp({
            apiKey: "AIzaSyBX3Phi9CNQPjxYXMKil7exLrJ7ZbRUMbM",
            authDomain: "kv-transport-mapping.firebaseapp.com",
            projectId: "kv-transport-mapping",
            storageBucket: "kv-transport-mapping.firebasestorage.app",
            messagingSenderId: "144100896901",
            appId: "1:144100896901:web:2ceef97e784e06385239ec"
          }, "kvTransportMapping");
          return initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
        })();
      }
      return window.__kvTransportMappingFirestorePromise;
    }

    const ROOT_ORG_CODE = "110700000";
    const ORG_RANGE_END = "110800000";
    const COLLECTION_NAME = "okbase_absences_by_person";
    const LAST_SERVER_REFRESH_KEY = "kve.user-management.last-server-refresh.v1";
    const AUTO_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
    const LEGACY_DATA_CACHE_KEY = "kve.user-management.data.v1";
    const LEGACY_LOCAL_STATE_KEY = "kve.user-management.v1";
    const ANNOTATIONS_COLLECTION_NAME = "userAnnotations";

    const firebaseConfig = {
      apiKey: "AIzaSyCaanEUktq1zw_kQszcVT5kfTK81SEq68Q",
      authDomain: "okbase-dovolene.firebaseapp.com",
      projectId: "okbase-dovolene",
      storageBucket: "okbase-dovolene.firebasestorage.app",
      messagingSenderId: "698583441353",
      appId: "1:698583441353:web:ed6efef9e2881ed5f09218"
    };

    const SHIFT_BY_ORG = new Map([
      ["110701011", "Kabely 1"],
      ["110701012", "Kabely 2"],
      ["110701021", "Příjem 1"],
      ["110701022", "Příjem 2"],
      ["110701023", "Příjem - noční"],
      ["110701031", "Výdej 1"],
      ["110701032", "Výdej 2"],
      ["110701033", "Noční"],
      ["110701034", "Výdej OBS"]
    ]);

    const body = document.getElementById("userManagementBody");
    const status = document.getElementById("userManagementStatus");
    const page = document.getElementById("userManagementPage");
    const refreshButton = document.getElementById("refreshUserManagementBtn");
    if (!body || !status || !page || !refreshButton) throw new Error("Správa uživatelů nemá připravené prvky stránky.");

    let localState = {};
    let people = [];
    let allRows = [];
    let loadedOnce = false;
    let refreshPromise = null;
    const filters = {
      name: "", place: "", department: "", manager: "", shift: "",
      email: "", phone: "", control: "", bonus: ""
    };

    const firebaseApp = initializeApp(firebaseConfig);
    const db = initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
    const usersQuery = query(collection(db, COLLECTION_NAME), orderBy("osobaId", "asc"));

    // Email/kontrola/docházkový bonus jsou anotace nad konkrétními lidmi, ale ukládáme
    // je do stejného sdíleného kv-transport-mapping připojení jako mapování přepravy
    // (odděleně od dat o přítomnosti), aby se sdílely živě pro všechny stejným způsobem.
    const annotationsDb = await connectSharedKvTransportMappingFirestore();
    const annotationsCollectionRef = collection(annotationsDb, ANNOTATIONS_COLLECTION_NAME);
    const annotationDocId = id => encodeURIComponent(id);

    onSnapshot(annotationsCollectionRef, snapshot => {
      const next = {};
      snapshot.forEach(docSnap => { next[decodeURIComponent(docSnap.id)] = docSnap.data(); });
      localState = next;
      renderFilteredRows();
    }, error => {
      console.error("Anotace uživatelů (email/kontrola/bonus): chyba synchronizace s Firestore.", error);
    });

    // Stará čistě lokální data z předchozí verze appky (než se anotace přesunuly
    // do Firestore) už dál nepoužíváme.
    try { localStorage.removeItem(LEGACY_LOCAL_STATE_KEY); } catch (_) {}

    // Starou vlastní datovou cache už nepoužíváme. Firestore má vlastní persistentní IndexedDB cache.
    try { localStorage.removeItem(LEGACY_DATA_CACHE_KEY); } catch (_) {}

    refreshButton.addEventListener("click", () => refreshFromServer(false));

    const pageObserver = new MutationObserver(() => {
      if (!page.hidden) ensureUsersLoaded();
    });
    pageObserver.observe(page, { attributes: true, attributeFilter: ["hidden"] });
    if (!page.hidden) ensureUsersLoaded();

    async function ensureUsersLoaded() {
      if (!loadedOnce) {
        loadedOnce = true;
        const cacheLoaded = await loadFromFirestoreCache();
        if (!cacheLoaded || isServerRefreshDue()) {
          await refreshFromServer(cacheLoaded);
        }
        return;
      }

      if (isServerRefreshDue()) {
        await refreshFromServer(true);
      }
    }

    async function loadFromFirestoreCache() {
      try {
        status.classList.remove("error");
        status.textContent = "Načítám uložená data…";
        const snapshot = await getDocsFromCache(usersQuery);
        if (snapshot.empty) return false;
        applySnapshot(snapshot);
        status.textContent = buildStatusText("Lokální data");
        return true;
      } catch (error) {
        console.warn("Firestore cache není dostupná:", error);
        return false;
      }
    }

    async function refreshFromServer(keepCurrentRows) {
      if (refreshPromise) return refreshPromise;

      refreshPromise = (async () => {
        refreshButton.disabled = true;
        status.classList.remove("error");
        status.textContent = keepCurrentRows ? "Aktualizuji uživatele…" : "Načítám uživatele…";

        try {
          const snapshot = await getDocsFromServer(usersQuery);
          applySnapshot(snapshot);
          saveLastServerRefresh(Date.now());
          status.textContent = buildStatusText("Aktuální data");
        } catch (error) {
          console.error(error);
          if (people.length > 0) {
            status.textContent = "Zobrazuji uložená data • aktualizace selhala";
            status.classList.add("error");
          } else {
            status.textContent = "Chyba načítání dat";
            status.classList.add("error");
            body.innerHTML = `<tr><td colspan="9" class="user-management-empty">Nepodařilo se načíst data z Firestore.</td></tr>`;
          }
        } finally {
          refreshButton.disabled = false;
          refreshPromise = null;
        }
      })();

      return refreshPromise;
    }

    function applySnapshot(snapshot) {
      people = snapshot.docs
        .map(doc => ({ firebaseDocId: doc.id, ...doc.data() }))
        .filter(isEmployeeActive)
        .filter(isUnderNehvizdyDc)
        .filter(person => normalize(person.parentUnitNazev) !== "doprava")
        .filter(person => !isInExcludedTransportBranch(person));
      render();
    }

    function isServerRefreshDue() {
      const lastRefresh = loadLastServerRefresh();
      return !lastRefresh || Date.now() - lastRefresh >= AUTO_REFRESH_INTERVAL_MS;
    }

    function loadLastServerRefresh() {
      try {
        const value = Number(localStorage.getItem(LAST_SERVER_REFRESH_KEY) || 0);
        return Number.isFinite(value) && value > 0 ? value : 0;
      } catch (_) {
        return 0;
      }
    }

    function saveLastServerRefresh(timestamp) {
      try { localStorage.setItem(LAST_SERVER_REFRESH_KEY, String(timestamp)); } catch (_) {}
    }

    function buildStatusText(prefix) {
      const lastRefresh = loadLastServerRefresh();
      if (!lastRefresh) return `${prefix} • ${people.length} uživatelů`;
      const time = new Date(lastRefresh).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
      return `${prefix} • ${people.length} uživatelů • server ${time}`;
    }

    function render() {
      allRows = buildRows(people);
      updateFilterOptions();
      renderFilteredRows();
    }

    function updateFilterOptions() {
      const selectKeys = ["place", "department", "manager", "shift"];
      for (const key of selectKeys) {
        const select = document.querySelector(`select[data-user-filter="${key}"]`);
        if (!select) continue;

        const currentValue = filters[key];
        const values = [...new Set(allRows
          .map(row => String(row[key] || "").trim())
          .filter(value => value && value !== "—"))]
          .sort((a, b) => a.localeCompare(b, "cs-CZ", { numeric: true, sensitivity: "base" }));

        select.innerHTML = `<option value="">Vše</option>` + values
          .map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
          .join("");

        if (currentValue && values.includes(currentValue)) {
          select.value = currentValue;
        } else {
          filters[key] = "";
          select.value = "";
        }
      }
    }

    function renderFilteredRows() {
      const rows = allRows.filter(matchesFilters);
      status.classList.remove("error");
      status.textContent = hasActiveFilters()
        ? `${rows.length} z ${allRows.length} uživatelů`
        : `${allRows.length} uživatelů`;

      if (!allRows.length) {
        body.innerHTML = `<tr><td colspan="9" class="user-management-empty">Pod organizační strukturou ${ROOT_ORG_CODE} nebyli nalezeni žádní aktivní uživatelé.</td></tr>`;
        return;
      }

      if (!rows.length) {
        body.innerHTML = `<tr><td colspan="9" class="user-management-empty">Filtru neodpovídá žádný uživatel.</td></tr>`;
        return;
      }

      body.innerHTML = rows.map(row => {
        const saved = localState[row.id] || {};
        const databaseEmail = row.email.trim();
        const emailValue = databaseEmail || String(saved.email || "");
        const emailEditable = !databaseEmail;
        return `<tr data-user-id="${escapeHtml(row.id)}">
          <td class="user-name-cell">${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.place)}</td>
          <td>${escapeHtml(row.department)}</td>
          <td>${escapeHtml(row.manager)}</td>
          <td>${escapeHtml(row.shift)}</td>
          <td>${emailEditable
            ? `<input class="user-email-input" type="email" data-user-email value="${escapeHtml(emailValue)}" autocomplete="off">`
            : `<span class="user-email-readonly">${escapeHtml(databaseEmail)}</span>`}
          </td>
          <td>${escapeHtml(row.phone)}</td>
          <td class="center-col"><button class="state-dot${saved.control === true ? " on" : ""}" type="button" data-user-control aria-pressed="${saved.control === true ? "true" : "false"}" title="Kontrola"></button></td>
          <td class="center-col"><button class="state-dot${saved.bonus === true ? " on" : ""}" type="button" data-user-bonus aria-pressed="${saved.bonus === true ? "true" : "false"}" title="Docházkový bonus"></button></td>
        </tr>`;
      }).join("");
    }

    function matchesFilters(row) {
      const saved = localState[row.id] || {};
      const effectiveEmail = row.email.trim() || String(saved.email || "").trim();
      const textValues = {
        name: row.name,
        place: row.place,
        department: row.department,
        manager: row.manager,
        shift: row.shift,
        email: effectiveEmail,
        phone: row.phone
      };

      for (const key of ["name", "email", "phone"]) {
        if (filters[key] && !normalize(textValues[key]).includes(normalize(filters[key]))) return false;
      }

      for (const key of ["place", "department", "manager", "shift"]) {
        if (filters[key] && normalize(textValues[key]) !== normalize(filters[key])) return false;
      }

      if (filters.control) {
        const isOn = saved.control === true;
        if ((filters.control === "yes") !== isOn) return false;
      }
      if (filters.bonus) {
        const isOn = saved.bonus === true;
        if ((filters.bonus === "yes") !== isOn) return false;
      }
      return true;
    }

    function hasActiveFilters() {
      return Object.values(filters).some(Boolean);
    }

    function buildRows(source) {
      const orgLeaders = buildOrgLeaderIndex(source);
      return source.map(person => {
        const id = getStableId(person);
        return {
          id,
          name: getPersonName(person),
          place: text(person.mistoNazev),
          department: text(person.orgParentNazev),
          manager: getManagerName(person, source, orgLeaders),
          shift: getShift(person),
          email: getEmail(person),
          phone: getPhone(person),
          sortCode: getPrimaryOrgPosition(person)
        };
      }).sort((a, b) => {
        const org = compareOrgPosition(a.sortCode, b.sortCode);
        if (org) return org;
        return a.name.localeCompare(b.name, "cs-CZ", { numeric: true, sensitivity: "base" });
      });
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
          return getPersonName(a.person).localeCompare(getPersonName(b.person), "cs-CZ", {
            numeric: true,
            sensitivity: "base"
          });
        });
        if (members.length) leaders.set(base, members[0].person);
      }
      return leaders;
    }

    function getManagerName(person, source, leaders) {
      const selfId = getStableId(person);
      const position = parseOrgPosition(getPrimaryOrgPosition(person));
      if (!position.base || !Number.isFinite(position.sub) || position.sub <= 0) return "—";

      // 1) Každého v organizační jednotce řídí nejnižší nenulová pozice za lomítkem.
      //    Např. 110701011/04 -> 110701011/01.
      const sameUnitLeader = leaders.get(position.base);
      if (sameUnitLeader && getStableId(sameUnitLeader) !== selfId) {
        return getPersonName(sameUnitLeader);
      }

      // 2) Pokud je člověk sám nejnižší pozicí své jednotky, jeho nadřízený je
      //    nejnižší nenulová pozice nadřazené organizační jednotky.
      //    Např. 110701011/01 -> 110701000/01.
      const parentBase = getParentOrgCode(person, position.base, source);
      if (!parentBase || parentBase === position.base) return "—";

      const parentLeader = leaders.get(parentBase);
      if (parentLeader && getStableId(parentLeader) !== selfId) {
        return getPersonName(parentLeader);
      }

      return "—";
    }

    function getParentOrgCode(person, ownBase, source) {
      // Hierarchie se určuje pouze z devítimístného organizačního čísla.
      // Vždy se v posledním trojčíslí vynuluje nejpravější nenulová číslice:
      // 110701012 -> 110701010 -> 110701000 -> 110700000.
      // 110701022 -> 110701020 -> 110701000 -> 110700000.
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

      // Pokud už jsme na xxxxxx000, další úroveň je kořen Nehvizdy DC.
      if (ownBase.endsWith("000") && ownBase !== ROOT_ORG_CODE && hasOrgBase(source, ROOT_ORG_CODE)) {
        return ROOT_ORG_CODE;
      }

      return "";
    }

    function hasOrgBase(source, base) {
      return source.some(person => parseOrgPosition(getPrimaryOrgPosition(person)).base === base);
    }

    function getShift(person) {
      const direct = firstText(
        person.smenaNazev,
        person.smena,
        person.shiftName,
        person.shift,
        person.pracovniSmena,
        person.presence?.smenaNazev,
        person.presence?.smena
      );
      if (direct) return direct;
      for (const code of getOrgCodes(person)) {
        const base = code.slice(0, 9);
        if (SHIFT_BY_ORG.has(base)) return SHIFT_BY_ORG.get(base);
      }
      return "—";
    }

    function getEmail(person) {
      return firstText(person.email, person.emailAdresa, person.eMail, person.mail, person.contact?.email, person.kontakt?.email);
    }

    function getPhone(person) {
      return firstText(person.telefon, person.telefonCislo, person.phone, person.mobile, person.mobil, person.contact?.phone, person.kontakt?.telefon) || "—";
    }

    function isUnderNehvizdyDc(person) {
      return getOrgCodes(person).some(code => {
        const base = parseOrgPosition(code).base;
        return /^\d{9}$/.test(base) && base >= ROOT_ORG_CODE && base < ORG_RANGE_END;
      });
    }

    function isInExcludedTransportBranch(person) {
      // Organizační větev 110703000 = všechny organizační jednotky 110703xxx.
      // Rozhoduje vždy devítimístné číslo před lomítkem, nikoli název pozice.
      const EXCLUDED_BRANCH_PREFIX = "110703";
      return getOrgCodes(person).some(code => {
        const base = parseOrgPosition(code).base;
        return /^\d{9}$/.test(base) && base.startsWith(EXCLUDED_BRANCH_PREFIX);
      });
    }

    function getPrimaryOrgPosition(person) {
      // Pro určení vlastní pozice nepoužívej celý orgPath ani parent hodnoty.
      // Ty obsahují nadřazené kódy a mohly by člověku přiřadit cizí pozici.
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

      // Fallback pouze pokud přímá pole pozici neobsahují. Preferuj nejhlubší kód s nenulovým /xx.
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

    function compareOrgPosition(a, b) {
      const aa = parseOrgPosition(a), bb = parseOrgPosition(b);
      if (aa.base !== bb.base) return aa.base.localeCompare(bb.base, "cs-CZ", { numeric: true });
      return aa.sub - bb.sub;
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

    function getStableId(person) {
      return String(person.firebaseDocId || person.osobaId || person.osobniCislo || getPersonName(person));
    }
    function getPersonName(person) {
      return firstText(person.celeJmeno, person.osobaPopis) || `Osoba ${person.osobaId || ""}`.trim();
    }
    function firstText(...values) {
      for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
      }
      return "";
    }
    function text(value) { return value === undefined || value === null ? "" : String(value).trim(); }
    function normalize(value) {
      return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("cs-CZ").replace(/\s+/g, " ").trim();
    }
    function numberOrNull(value) {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
    }
    function getRowId(target) {
      return target.closest("tr[data-user-id]")?.dataset.userId || "";
    }
    function stateFor(id) {
      if (!localState[id]) localState[id] = {};
      return localState[id];
    }

    body.addEventListener("click", event => {
      const control = event.target.closest("[data-user-control]");
      const bonus = event.target.closest("[data-user-bonus]");
      const button = control || bonus;
      if (!button) return;
      const id = getRowId(button);
      if (!id) return;
      const key = control ? "control" : "bonus";
      const value = !(stateFor(id)[key] === true);
      stateFor(id)[key] = value;
      button.classList.toggle("on", value);
      button.setAttribute("aria-pressed", value ? "true" : "false");
      if (filters[key]) renderFilteredRows();
      setDoc(doc(annotationsCollectionRef, annotationDocId(id)), { [key]: value }, { merge: true }).catch(error => {
        console.error("Nepodařilo se uložit změnu do Firestore.", error);
      });
    });

    body.addEventListener("change", event => {
      const input = event.target.closest("[data-user-email]");
      if (!input) return;
      const id = getRowId(input);
      if (!id) return;
      const email = input.value.trim();
      stateFor(id).email = email;
      if (filters.email) renderFilteredRows();
      setDoc(doc(annotationsCollectionRef, annotationDocId(id)), { email }, { merge: true }).catch(error => {
        console.error("Nepodařilo se uložit email do Firestore.", error);
      });
    });

    document.querySelectorAll("[data-user-filter]").forEach(control => {
      const updateFilter = () => {
        const key = control.dataset.userFilter;
        if (!Object.prototype.hasOwnProperty.call(filters, key)) return;
        filters[key] = control.value.trim();
        renderFilteredRows();
      };
      control.addEventListener(control.tagName === "SELECT" ? "change" : "input", updateFilter);
    });
  } catch (error) {
    console.error("Správa uživatelů - inicializace selhala:", error);
    if (statusElement) {
      statusElement.textContent = "Chyba načítání dat";
      statusElement.classList.add("error");
    }
    if (bodyElement) {
      bodyElement.innerHTML = `<tr><td colspan="9" class="user-management-empty">Nepodařilo se spustit načítání uživatelů. ${String(error && error.message ? error.message : error)}</td></tr>`;
    }
  }
})();
