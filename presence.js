(function () {
  'use strict';

  if (new URLSearchParams(location.search).get('embedded') === '1') {
    document.body.classList.add('embedded-view');
  }

  const config = window.PRESENCE_CONFIG;
  if (!config) { console.error('presence.js: chybí window.PRESENCE_CONFIG.'); return; }

  const headingEl = document.getElementById('pageHeading');
  if (headingEl) headingEl.textContent = config.heading;

  const groupsEl = document.getElementById('groups');
  if (config.layout === 'centered') {
    groupsEl.classList.add('groups--centered');
  } else {
    document.documentElement.style.setProperty('--group-count', String(config.targetGroups.length));
  }

  (async () => {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js");
    const {
      initializeFirestore,
      persistentLocalCache,
      persistentMultipleTabManager,
      collection,
      query,
      orderBy,
      onSnapshot
    } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");

    const firebaseConfig = {
      apiKey: "AIzaSyCaanEUktq1zw_kQszcVT5kfTK81SEq68Q",
      authDomain: "okbase-dovolene.firebaseapp.com",
      projectId: "okbase-dovolene",
      storageBucket: "okbase-dovolene.firebasestorage.app",
      messagingSenderId: "698583441353",
      appId: "1:698583441353:web:ed6efef9e2881ed5f09218"
    };

    const COLLECTION_NAME = "okbase_absences_by_person";
    const TARGET_GROUPS = config.targetGroups;
    const EXPECTED_GROUP_COUNT = TARGET_GROUPS.length;

    const app = initializeApp(firebaseConfig);
    const db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });

    const els = {
      groups: document.getElementById("groups"),
      connection: document.getElementById("connection"),
      connectionText: document.getElementById("connectionText"),
      lastUpdate: document.getElementById("lastUpdate"),
      clockTime: document.getElementById("clockTime"),
      clockDate: document.getElementById("clockDate"),
      messageOverlay: document.getElementById("messageOverlay"),
      messageTitle: document.getElementById("messageTitle"),
      messageText: document.getElementById("messageText")
    };

    let people = [];

    function updateClock() {
      const now = new Date();
      els.clockTime.textContent = now.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
      els.clockDate.textContent = now.toLocaleDateString("cs-CZ", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
    }

    updateClock();
    setInterval(updateClock, 1000);

    const q = query(collection(db, COLLECTION_NAME), orderBy("osobaId", "asc"));
    onSnapshot(q, snapshot => {
      people = snapshot.docs
        .map(doc => ({ firebaseDocId: doc.id, ...doc.data() }))
        .filter(isEmployeeActive);

      renderDashboard();
      setConnection("online", "Online data načtena");
      els.lastUpdate.textContent = `Poslední aktualizace: ${new Date().toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    }, error => {
      console.error(error);
      setConnection("error", "Chyba načítání dat");
      showMessage("Nepodařilo se načíst data", `Zkontrolujte připojení a oprávnění Firestore.\n\n${error.message}`);
    });

    function renderDashboard() {
      const grouped = buildTargetGroups(people);
      els.groups.innerHTML = "";

      if (grouped.length === 0) {
        showMessage(
          "Organizační větev nebyla nalezena",
          `V datech nebyly nalezeny organizační jednotky ${config.notFoundGroups}.`
        );
        return;
      }

      hideMessage();
      const visibleGroups = grouped.slice(0, EXPECTED_GROUP_COUNT);
      for (const group of visibleGroups) {
        els.groups.appendChild(renderGroup(group));
      }

      while (els.groups.children.length < EXPECTED_GROUP_COUNT) {
        const placeholder = document.createElement("section");
        placeholder.className = "group-column";
        placeholder.innerHTML = `
          <header class="group-head">
            <h2 class="group-name">Skupina nenalezena</h2>
            <div class="group-count"><strong>0 / 0</strong><span>na směně</span></div>
          </header>
          <div class="empty-group">V organizační struktuře nebyla nalezena další skupina.</div>`;
        els.groups.appendChild(placeholder);
      }

      fitPeopleToScreen(visibleGroups);
    }

    function buildTargetGroups(sourcePeople) {
      return TARGET_GROUPS.map(definition => {
        const groupPeople = sourcePeople.filter(person => belongsToGroup(person, definition.code));

        const orderedPeople = [...groupPeople].sort((a, b) => {
          const aSubNumber = getGroupSubNumber(a, definition.code);
          const bSubNumber = getGroupSubNumber(b, definition.code);

          if (aSubNumber !== bSubNumber) return aSubNumber - bSubNumber;

          const aOrder = getExplicitPersonOrder(a);
          const bOrder = getExplicitPersonOrder(b);
          if (aOrder !== bOrder) return aOrder - bOrder;

          return getPersonName(a).localeCompare(getPersonName(b), "cs", {
            numeric: true,
            sensitivity: "base"
          });
        });

        const leader = orderedPeople.length > 0 ? orderedPeople[0] : null;

        return {
          key: definition.code,
          code: definition.code,
          name: definition.name,
          leaderId: leader ? getPersonStableId(leader) : null,
          people: orderedPeople
        };
      });
    }

    function belongsToGroup(person, groupCode) {
      return getOrgCodeSources(person).some(source =>
        normalizeOrgCodeText(source).includes(groupCode)
      );
    }

    function getGroupSubNumber(person, groupCode) {
      const found = [];

      for (const source of getOrgCodeSources(person)) {
        const text = normalizeOrgCodeText(source);

        // Standardní zápis organizační pozice: 110701031/01, 110701031 / 01 apod.
        const slashPattern = new RegExp(`${groupCode}\\s*[/]\\s*(\\d{1,4})`, "g");
        for (const match of text.matchAll(slashPattern)) {
          found.push(Number(match[1]));
        }

        // Záloha pro exporty, které oddělovač uloží jako pomlčku nebo mezeru.
        const loosePattern = new RegExp(`${groupCode}\\s*[- ]\\s*(\\d{1,4})(?:\\D|$)`, "g");
        for (const match of text.matchAll(loosePattern)) {
          found.push(Number(match[1]));
        }
      }

      return found.length ? Math.min(...found) : Number.MAX_SAFE_INTEGER;
    }

    function normalizeOrgCodeText(value) {
      return String(value ?? "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function getOrgCodeSources(person) {
      const values = [
        person.orgPathText,
        person.orgUnitNazev,
        person.orgjNazev,
        person.orgUnitId,
        person.orgjId,
        person.orgStructure?.code,
        person.orgStructure?.id,
        person.orgStructure?.name,
        person.orgStructure?.pathText
      ];

      if (Array.isArray(person.orgStructure?.path)) {
        values.push(...person.orgStructure.path);
      }

      // Některé importy mají čísla organizačních jednotek uvnitř vnořeného objektu.
      if (person.orgStructure && typeof person.orgStructure === "object") {
        try { values.push(JSON.stringify(person.orgStructure)); } catch (_) {}
      }

      return values
        .flatMap(value => {
          if (value === undefined || value === null) return [];
          if (typeof value === "object") {
            try { return [JSON.stringify(value)]; } catch (_) { return []; }
          }
          return [String(value)];
        })
        .filter(value => value.trim() !== "");
    }

    function renderGroup(group) {
      const section = document.createElement("section");
      section.className = "group-column";

      const onShift = group.people.filter(isOnShift).length;
      section.innerHTML = `
        <header class="group-head">
          <h2 class="group-name">${escapeHtml(group.name)}</h2>
          <div class="group-count"><strong>${onShift} / ${group.people.length}</strong><span>na směně</span></div>
        </header>
        <div class="people"></div>`;

      const peopleContainer = section.querySelector(".people");
      if (group.people.length === 0) {
        peopleContainer.innerHTML = `<div class="empty-group">Ve skupině nejsou aktivní zaměstnanci.</div>`;
        return section;
      }

      group.people.forEach(person => {
        peopleContainer.appendChild(renderPerson(person, getPersonStableId(person) === group.leaderId));
      });
      return section;
    }

    function renderPerson(person, isLeader) {
      const status = getPersonStatus(person);
      const row = document.createElement("article");
      row.className = `person ${status.className}${isLeader ? " is-leader" : ""}`;
      row.innerHTML = `
        <div class="person-emoji${status.useDot ? " status-dot" : ""}" aria-hidden="true">${status.symbol}</div>
        <div class="person-main${status.label ? " has-status" : ""}">
          <div class="person-name">
            <span class="person-name-text">${escapeHtml(getPersonName(person))}</span>
          </div>
          ${status.label ? `<div class="person-status">${escapeHtml(status.label)}</div>` : ""}
        </div>`;
      return row;
    }

    function getPersonStatus(person) {
      const vacation = getCurrentVacation(person);
      const interruptionText = getInterruptionText(person).trim();
      const normalizedStatus = normalizeText(interruptionText);
      const displayInterruptionText = getDisplayInterruptionText(interruptionText);

      if (vacation) {
        const until = vacation.konec ? ` do ${formatDate(vacation.konec)}` : "";
        return { symbol: "🏖️", useDot: false, label: until.trim(), className: "status-vacation" };
      }

      const visibleInterruptionText = isStandardAttendanceRecord(normalizedStatus)
        ? ""
        : displayInterruptionText;

      if (isSmokingPause(person)) {
        return { symbol: "🚬", useDot: false, label: getSmokingPauseLabel(person), className: "status-smoking" };
      }

      if (isLunchBreak(person)) {
        return { symbol: "🍽", useDot: false, label: visibleInterruptionText, className: "status-lunch" };
      }

      if (person.isPritomna === true && isArrivalStatus(normalizedStatus)) {
        return { symbol: "", useDot: true, label: "", className: "status-present" };
      }

      if (person.isPritomna === true) {
        return { symbol: "", useDot: true, label: visibleInterruptionText, className: "status-interruption" };
      }

      if (person.isPritomna === false) {
        return { symbol: "", useDot: true, label: visibleInterruptionText, className: "status-absent" };
      }

      return { symbol: "", useDot: true, label: "", className: "status-unknown" };
    }

    function getSmokingPauseLabel(person) {
      const time = formatTimeOnly(person.casPreruseni || person.presence?.casPreruseni);
      return time ? `od ${time}` : "";
    }

    function formatTimeOnly(value) {
      if (!value) return "";

      if (typeof value === "string") {
        const directTime = value.match(/(?:^|[ T])(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (directTime) {
          return `${directTime[1].padStart(2, "0")}:${directTime[2]}:${directTime[3] || "00"}`;
        }
      }

      let date = null;
      if (value instanceof Date) {
        date = value;
      } else if (typeof value?.toDate === "function") {
        date = value.toDate();
      } else if (typeof value === "object" && Number.isFinite(Number(value.seconds))) {
        date = new Date(Number(value.seconds) * 1000);
      } else {
        date = new Date(value);
      }

      if (!date || Number.isNaN(date.getTime())) return "";
      return date.toLocaleTimeString("cs-CZ", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      });
    }

    function getDisplayInterruptionText(interruptionText) {
      const normalized = normalizeText(interruptionText);
      if (normalized === "prichod do prace") return "Příchod";
      if (normalized === "odchod z prace") return "Odchod";
      return interruptionText;
    }

    function isStandardAttendanceRecord(normalizedStatus) {
      return normalizedStatus === "prichod do prace" ||
             normalizedStatus === "prichod" ||
             normalizedStatus === "odchod z prace" ||
             normalizedStatus === "odchod";
    }

    function isArrivalStatus(normalizedStatus) {
      if (!normalizedStatus) return true;
      return normalizedStatus === "prichod do prace" ||
             normalizedStatus === "prichod" ||
             normalizedStatus === "pritomen" ||
             normalizedStatus === "na pracovisti";
    }

    function getPersonStableId(person) {
      return String(person.firebaseDocId || person.osobaId || person.osobniCislo || getPersonName(person));
    }

    function getExplicitPersonOrder(person) {
      const values = [
        person.poradi, person.order, person.sortOrder, person.orgPoradi,
        person.orgStructure?.order, person.orgStructure?.sortOrder,
        person.poradiVOJ, person.poradiVOrg
      ];
      for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number)) return number;
      }
      return 999999;
    }

    function isOnShift(person) {
      if (getCurrentVacation(person)) {
        return false;
      }

      return person.isPritomna === true ||
             isSmokingPause(person) ||
             isLunchBreak(person);
    }

    function getCurrentVacation(person) {
      const absences = Array.isArray(person.absences) ? person.absences : [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      return absences
        .filter(item => {
          const start = parseDateOnly(item.zacatek);
          const end = parseDateOnly(item.konec);
          return start && end && start <= today && end >= today;
        })
        .sort((a, b) => String(a.zacatek || "").localeCompare(String(b.zacatek || "")))[0] || null;
    }

    function isSmokingPause(person) {
      const text = normalizeText([
        getInterruptionText(person), person.poznamka, person.presence?.poznamka
      ].filter(Boolean).join(" "));
      return text.includes("kur") || text.includes("kour") || text.includes("smoke") || text.includes("cigaret") || text.includes("tabak");
    }

    function isLunchBreak(person) {
      if (isSmokingPause(person)) return false;
      const text = normalizeText(getInterruptionText(person));
      return text.includes("prestav") || text.includes("obed") || text.includes("lunch") || text.includes("jidlo");
    }

    function getInterruptionText(person) {
      return person.textPreruseni || person.presence?.textPreruseni || "";
    }

    function getPersonName(person) {
      return person.celeJmeno || person.osobaPopis || `Osoba ${person.osobaId || ""}`.trim();
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

    function fitPeopleToScreen(groups) {
      const maxPeople = Math.max(1, ...groups.map(group => group.people.length));
      const groupsElement = document.getElementById("groups");
      const groupHeight = Math.max(1, groupsElement?.clientHeight || window.innerHeight);
      const sampleHead = groupsElement?.querySelector(".group-head");
      const headHeight = Math.ceil(sampleHead?.getBoundingClientRect().height || 72);

      // V embedded režimu musí být vždy vidět všichni lidé bez scrollování.
      // Velikost řádku, mezery i písmo proto dopočítáme z reálně dostupné výšky iframe.
      const peoplePadding = 18;
      const availableForPeople = Math.max(120, groupHeight - headHeight - peoplePadding);
      const preferredGap = 7;
      const minGap = 2;
      let gap = preferredGap;
      let rowHeight = Math.floor((availableForPeople - (maxPeople - 1) * gap) / maxPeople);

      if (rowHeight < 40) {
        gap = Math.max(minGap, Math.floor((availableForPeople - maxPeople * 30) / Math.max(1, maxPeople - 1)));
        rowHeight = Math.floor((availableForPeople - (maxPeople - 1) * gap) / maxPeople);
      }

      rowHeight = Math.max(26, Math.min(76, rowHeight));
      const fontSize = Math.max(12, Math.min(32, Math.floor(rowHeight * .44)));
      const sidePadding = Math.max(4, Math.min(11, Math.floor(rowHeight * .16)));
      const iconSize = Math.max(14, Math.min(34, Math.floor(rowHeight * .48)));

      document.documentElement.style.setProperty("--person-row-height", `${rowHeight}px`);
      document.documentElement.style.setProperty("--person-font-size", `${fontSize}px`);
      document.documentElement.style.setProperty("--person-gap", `${gap}px`);
      document.documentElement.style.setProperty("--person-side-padding", `${sidePadding}px`);
      document.documentElement.style.setProperty("--person-icon-size", `${iconSize}px`);
    }

    window.addEventListener("resize", () => renderDashboard());

    function parseDateOnly(value) {
      if (!value) return null;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      date.setHours(0, 0, 0, 0);
      return date;
    }

    function formatDate(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value || "");
      return date.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit" });
    }

    function numberOrNull(value) {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : null;
    }

    function normalizeText(value) {
      return String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function setConnection(mode, text) {
      els.connection.className = `connection ${mode || ""}`.trim();
      els.connectionText.textContent = text;
    }

    function showMessage(title, text) {
      els.messageTitle.textContent = title;
      els.messageText.textContent = text;
      els.messageOverlay.classList.remove("hidden");
    }

    function hideMessage() {
      els.messageOverlay.classList.add("hidden");
    }
  })();
})();
