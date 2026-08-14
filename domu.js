(async function () {
  'use strict';

  const page = document.getElementById('homePage');
  if (!page) return;

  const TASK_KEY = 'kve.home.todos.local.v1';
  const PRESENCE_FILTER_KEY = 'kve.home.presence.departments.v1';
  const WEATHER_LOCATION_KEY = 'kve.home.weather.location.v1';
  const WEATHER_LOCATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const WEATHER_PERMISSION_REMIND_KEY = 'kve.home.weather.permission-remind.v1';
  const WEATHER_PERMISSION_REMIND_MS = 12 * 60 * 60 * 1000;

  const ROOT_ORG_CODE = "110700000";
  const ORG_RANGE_END = "110800000";
  const EXCLUDED_BRANCH_PREFIX = "110703";
  const COLLECTION_NAME = "okbase_absences_by_person";
  const firebaseConfig = {
    apiKey: "AIzaSyCaanEUktq1zw_kQszcVT5kfTK81SEq68Q",
    authDomain: "okbase-dovolene.firebaseapp.com",
    projectId: "okbase-dovolene",
    storageBucket: "okbase-dovolene.firebasestorage.app",
    messagingSenderId: "698583441353",
    appId: "1:698583441353:web:ed6efef9e2881ed5f09218"
  };

  const openCount = document.getElementById('homeOpenCount');
  const openSectionCount = document.getElementById('homeOpenSectionCount');
  const addToggle = document.getElementById('homeAddTaskToggle');
  const taskForm = document.getElementById('homeTaskForm');
  const taskText = document.getElementById('homeTaskText');
  const taskDueDate = document.getElementById('homeTaskDueDate');
  const taskPriority = document.getElementById('homeTaskPriority');
  const taskNoteToggle = document.getElementById('homeTaskNoteToggle');
  const taskNote = document.getElementById('homeTaskNote');
  const openTasks = document.getElementById('homeOpenTasks');
  const doneToggle = document.getElementById('homeDoneToggle');
  const doneChevron = document.getElementById('homeDoneChevron');
  const doneLabel = document.getElementById('homeDoneLabel');
  const doneTasks = document.getElementById('homeDoneTasks');
  const controlsCount = document.getElementById('homeControlsCount');
  const controlsList = document.getElementById('homeControlsList');
  const greetingText = document.getElementById('homeGreetingText');
  const dateText = document.getElementById('homeDateText');
  const weatherText = document.getElementById('homeWeatherText');
  const weatherPermissionModal = document.getElementById('homeWeatherPermissionModal');
  const weatherPermissionMessage = document.getElementById('homeWeatherPermissionMessage');
  const weatherPermissionAllow = document.getElementById('homeWeatherPermissionAllow');
  const weatherPermissionLater = document.getElementById('homeWeatherPermissionLater');
  const weatherPermissionClose = document.getElementById('homeWeatherPermissionClose');

  const presenceMenuBtn = document.getElementById('homePresenceMenuBtn');
  const presenceMenu = document.getElementById('homePresenceMenu');
  const departmentFilterBtn = document.getElementById('homeDepartmentFilterBtn');
  const departmentModal = document.getElementById('homeDepartmentModal');
  const departmentList = document.getElementById('homeDepartmentList');
  const departmentSelectAll = document.getElementById('homeDepartmentSelectAll');
  const departmentClear = document.getElementById('homeDepartmentClear');
  const presenceUpdated = document.getElementById('homePresenceUpdated');
  const vacationUpdated = document.getElementById('homeVacationUpdated');
  const presencePresent = document.getElementById('homePresencePresent');
  const presenceBreak = document.getElementById('homePresenceBreak');
  const presenceAbsent = document.getElementById('homePresenceAbsent');
  const presenceSick = document.getElementById('homePresenceSick');
  const presenceVacation = document.getElementById('homePresenceVacation');
  const presencePeopleModal = document.getElementById('homePresencePeopleModal');
  const presencePeopleTitle = document.getElementById('homePresencePeopleTitle');
  const presencePeopleList = document.getElementById('homePresencePeopleList');

  const modal = document.getElementById('homeTaskModal');
  const editForm = document.getElementById('homeTaskEditForm');
  const editText = document.getElementById('homeEditTaskText');
  const editDueDate = document.getElementById('homeEditTaskDueDate');
  const editPriority = document.getElementById('homeEditTaskPriority');
  const editNote = document.getElementById('homeEditTaskNote');
  const deleteBtn = document.getElementById('homeDeleteTaskBtn');

  let tasks = loadTasks();
  let selectedDepartments = loadPresenceFilter();
  let availableDepartments = [];
  let editingId = '';
  let draggingId = '';
  let presenceBuckets = { present: [], break: [], absent: [], sick: [], vacation: [] };
  let presenceRows = [];
  let presenceLastUpdate = 0;
  let wheelRows = {};

  addToggle.addEventListener('click', () => {
    taskForm.hidden = !taskForm.hidden;
    if (!taskForm.hidden) taskText.focus();
  });

  taskNoteToggle.addEventListener('click', () => {
    taskNote.hidden = !taskNote.hidden;
    if (!taskNote.hidden) taskNote.focus();
  });

  weatherPermissionAllow.addEventListener('click', () => {
    requestWeatherLocation();
  });
  weatherPermissionLater.addEventListener('click', () => {
    rememberWeatherPermissionReminder();
    closeWeatherPermissionModal();
  });
  weatherPermissionClose.addEventListener('click', () => {
    rememberWeatherPermissionReminder();
    closeWeatherPermissionModal();
  });
  weatherPermissionModal.querySelectorAll('[data-home-weather-permission-close]').forEach(el => {
    el.addEventListener('click', () => {
      rememberWeatherPermissionReminder();
      closeWeatherPermissionModal();
    });
  });

  taskForm.addEventListener('submit', event => {
    event.preventDefault();
    const text = taskText.value.trim();
    if (!text) return;
    const now = new Date().toISOString();
    const newTask = {
      id: createId(),
      text,
      dueDate: taskDueDate.value || '',
      priority: taskPriority.value || '',
      note: taskNote.value.trim(),
      done: false,
      createdAt: now,
      updatedAt: now
    };
    tasks.unshift(newTask);
    saveTasks();
    taskForm.reset();
    taskNote.hidden = true;
    taskForm.hidden = true;
    renderTasks();
  });

  doneToggle.addEventListener('click', () => {
    const willOpen = doneTasks.hidden;
    doneTasks.hidden = !willOpen;
    doneToggle.setAttribute('aria-expanded', String(willOpen));
    doneChevron.textContent = willOpen ? '⌄' : '›';
  });

  page.addEventListener('click', event => {
    const toggleDone = event.target.closest('[data-home-task-toggle]');
    if (toggleDone) {
      event.stopPropagation();
      const task = tasks.find(item => item.id === toggleDone.dataset.homeTaskToggle);
      if (!task) return;
      task.done = !task.done;
      task.updatedAt = new Date().toISOString();
      saveTasks();
      renderTasks();
      return;
    }

    const taskCard = event.target.closest('[data-home-task-id]');
    if (taskCard && !event.target.closest('button')) {
      openTaskModal(taskCard.dataset.homeTaskId || '');
    }
  });

  openTasks.addEventListener('dragstart', onDragStart);
  openTasks.addEventListener('dragover', onDragOver);
  openTasks.addEventListener('drop', event => onDrop(event, false));
  openTasks.addEventListener('dragend', onDragEnd);
  doneTasks.addEventListener('dragstart', onDragStart);
  doneTasks.addEventListener('dragover', onDragOver);
  doneTasks.addEventListener('drop', event => onDrop(event, true));
  doneTasks.addEventListener('dragend', onDragEnd);

  modal.addEventListener('click', event => {
    if (event.target.closest('[data-home-task-close]')) closeTaskModal();
  });

  editForm.addEventListener('submit', event => {
    event.preventDefault();
    const task = tasks.find(item => item.id === editingId);
    if (!task) return;
    const text = editText.value.trim();
    if (!text) return;
    task.text = text;
    task.dueDate = editDueDate.value || '';
    task.priority = editPriority.value || '';
    task.note = editNote.value.trim();
    task.updatedAt = new Date().toISOString();
    saveTasks();
    closeTaskModal();
    renderTasks();
  });

  deleteBtn.addEventListener('click', () => {
    if (!editingId) return;
    if (!confirm('Opravdu smazat tento úkol?')) return;
    tasks = tasks.filter(item => item.id !== editingId);
    saveTasks();
    closeTaskModal();
    renderTasks();
  });

  presenceMenuBtn.addEventListener('click', event => {
    event.stopPropagation();
    const open = presenceMenu.hidden;
    presenceMenu.hidden = !open;
    presenceMenuBtn.setAttribute('aria-expanded', String(open));
  });

  departmentFilterBtn.addEventListener('click', () => {
    presenceMenu.hidden = true;
    presenceMenuBtn.setAttribute('aria-expanded', 'false');
    openDepartmentModal();
  });

  departmentModal.addEventListener('click', event => {
    if (event.target.closest('[data-home-department-close]')) closeDepartmentModal();
  });

  departmentSelectAll.addEventListener('click', () => {
    selectedDepartments = [...availableDepartments];
    savePresenceFilter();
    renderDepartmentOptions();
    renderPresence();
  });

  departmentClear.addEventListener('click', () => {
    selectedDepartments = [];
    savePresenceFilter();
    renderDepartmentOptions();
    renderPresence();
  });

  page.querySelector('.home-presence-stats').addEventListener('click', event => {
    const button = event.target.closest('[data-home-presence-status]');
    if (!button) return;
    openPresencePeopleModal(button.dataset.homePresenceStatus || '');
  });

  presencePeopleModal.addEventListener('click', event => {
    if (event.target.closest('[data-home-presence-people-close]')) closePresencePeopleModal();
  });

  departmentList.addEventListener('change', event => {
    const input = event.target.closest('[data-home-department]');
    if (!input) return;
    const department = input.dataset.homeDepartment || '';
    if (!department) return;
    if (input.checked) {
      if (!selectedDepartments.includes(department)) selectedDepartments.push(department);
    } else {
      selectedDepartments = selectedDepartments.filter(item => item !== department);
    }
    savePresenceFilter();
    renderPresence();
  });

  document.addEventListener('click', event => {
    if (!presenceMenu.hidden && !event.target.closest('.home-presence-menu-wrap')) {
      presenceMenu.hidden = true;
      presenceMenuBtn.setAttribute('aria-expanded', 'false');
    }
  });

  window.addEventListener('storage', event => {
    if (event.key === TASK_KEY) {
      tasks = loadTasks();
      renderTasks();
    }
  });

  renderGreeting();
  loadWeather();
  renderTasks();
  renderControls();
  connectPresence();
  connectWheelRows();

  function connectPresence() {
    (async () => {
      try {
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

        const app = initializeApp(firebaseConfig, "kveHomePresence");
        const db = initializeFirestore(app, {
          localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        });
        const presenceQuery = query(collection(db, COLLECTION_NAME), orderBy("osobaId", "asc"));

        onSnapshot(presenceQuery, snapshot => {
          const people = snapshot.docs
            .map(doc => ({ firebaseDocId: doc.id, ...doc.data() }))
            .filter(isEmployeeActive)
            .filter(isUnderNehvizdyDc)
            .filter(person => normalize(person.parentUnitNazev) !== "doprava")
            .filter(person => !isInExcludedTransportBranch(person));
          presenceRows = buildPresenceRows(people);
          presenceLastUpdate = Date.now();
          renderPresence();
        }, error => {
          console.error('domu.js: chyba načítání přítomnosti.', error);
        });
      } catch (error) {
        console.error('domu.js: nepodařilo se připojit k Firestore.', error);
      }
    })();
  }

  function buildPresenceRows(source) {
    return source.map(person => ({
      name: getPersonName(person),
      department: text(person.orgjNazev),
      isPresent: person.isPritomna === true,
      presenceKnown: person.isPritomna === true || person.isPritomna === false,
      attendanceRecord: text(person.textPreruseni || person.presence?.textPreruseni),
      absences: Array.isArray(person.absences) ? person.absences.map(item => ({ ...item })) : []
    }));
  }

  function renderPresence() {
    availableDepartments = [...new Set(presenceRows.map(row => String(row.department || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'cs-CZ', { numeric: true, sensitivity: 'base' }));

    selectedDepartments = selectedDepartments.filter(item => availableDepartments.includes(item));
    if (!loadPresenceFilterWasSet() && selectedDepartments.length === 0) {
      selectedDepartments = [...availableDepartments];
      savePresenceFilter();
    }
    renderDepartmentOptions();

    const filtered = selectedDepartments.length
      ? presenceRows.filter(row => selectedDepartments.includes(String(row.department || '').trim()))
      : [];

    presenceBuckets = { present: [], break: [], absent: [], sick: [], vacation: [] };
    filtered.forEach(row => {
      const status = getPresenceStatus(row);
      if (Object.prototype.hasOwnProperty.call(presenceBuckets, status)) presenceBuckets[status].push(row);
    });

    presencePresent.textContent = String(presenceBuckets.present.length);
    presenceBreak.textContent = String(presenceBuckets.break.length);
    presenceAbsent.textContent = String(presenceBuckets.absent.length);
    presenceSick.textContent = String(presenceBuckets.sick.length);
    presenceVacation.textContent = String(presenceBuckets.vacation.length);

    const stamp = presenceLastUpdate ? formatTimestamp(presenceLastUpdate) : 'načítání…';
    presenceUpdated.textContent = stamp;
    vacationUpdated.textContent = stamp;
  }

  function openPresencePeopleModal(status) {
    const labels = { present: 'Přítomní', break: 'Přestávka', absent: 'Nepřítomní', sick: 'Nemocní', vacation: 'Dovolená (schváleno)' };
    const rows = Array.isArray(presenceBuckets[status]) ? [...presenceBuckets[status]] : [];
    rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'cs-CZ', { numeric: true, sensitivity: 'base' }));
    presencePeopleTitle.textContent = labels[status] || 'Uživatelé';
    presencePeopleList.innerHTML = rows.length
      ? rows.map(row => `<div class="home-presence-person">${escapeHtml(row.name || '—')}</div>`).join('')
      : '<div class="home-empty">V této skupině není žádný uživatel.</div>';
    presencePeopleModal.hidden = false;
    presencePeopleModal.setAttribute('aria-hidden', 'false');
  }

  function closePresencePeopleModal() {
    presencePeopleModal.hidden = true;
    presencePeopleModal.setAttribute('aria-hidden', 'true');
  }

  function renderGreeting() {
    const now = new Date();
    const hour = now.getHours();
    let greeting = 'Dobrý večer';
    if (hour < 10) greeting = 'Dobré ráno';
    else if (hour < 12) greeting = 'Dobré dopoledne';
    else if (hour < 13) greeting = 'Dobré poledne';
    else if (hour < 18) greeting = 'Dobré odpoledne';
    greetingText.textContent = `${greeting}.`;
    const formatted = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
    dateText.textContent = `Dnes je ${formatted.charAt(0).toUpperCase() + formatted.slice(1)}.`;
  }

  function closeWeatherPermissionModal() {
    weatherPermissionModal.hidden = true;
    weatherPermissionModal.setAttribute('aria-hidden', 'true');
  }

  function openWeatherPermissionModal(message) {
    weatherPermissionMessage.textContent = message || 'Poloha se používá pouze k zobrazení aktuálního počasí pro tvoje místo. Povol prosím přístup k poloze.';
    weatherPermissionModal.hidden = false;
    weatherPermissionModal.setAttribute('aria-hidden', 'false');
  }

  function loadCachedWeatherLocation() {
    try {
      const raw = localStorage.getItem(WEATHER_LOCATION_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      const latitude = Number(cached?.latitude);
      const longitude = Number(cached?.longitude);
      const savedAt = Number(cached?.savedAt);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(savedAt)) return null;
      if (Date.now() - savedAt > WEATHER_LOCATION_MAX_AGE_MS) return null;
      return { coords: { latitude, longitude } };
    } catch (_) {
      return null;
    }
  }

  function saveWeatherLocation(position) {
    try {
      const latitude = Number(position?.coords?.latitude);
      const longitude = Number(position?.coords?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      localStorage.setItem(WEATHER_LOCATION_KEY, JSON.stringify({ latitude, longitude, savedAt: Date.now() }));
      localStorage.removeItem(WEATHER_PERMISSION_REMIND_KEY);
    } catch (_) {}
  }

  function rememberWeatherPermissionReminder() {
    try {
      localStorage.setItem(WEATHER_PERMISSION_REMIND_KEY, String(Date.now()));
    } catch (_) {}
  }

  function shouldShowWeatherPermissionReminder() {
    try {
      const savedAt = Number(localStorage.getItem(WEATHER_PERMISSION_REMIND_KEY));
      return !Number.isFinite(savedAt) || Date.now() - savedAt >= WEATHER_PERMISSION_REMIND_MS;
    } catch (_) {
      return true;
    }
  }

  function getWeatherIcon(code) {
    if (!Number.isFinite(code)) return '🌤️';
    if (code === 0) return '☀️';
    if (code === 1 || code === 2) return '🌤️';
    if (code === 3) return '☁️';
    if (code === 45 || code === 48) return '🌫️';
    if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return '🌧️';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '🌨️';
    if (code >= 95) return '⛈️';
    return '🌤️';
  }

  async function fetchWeatherForPosition(position) {
    try {
      const latitude = Number(position.coords.latitude);
      const longitude = Number(position.coords.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&current=temperature_2m,apparent_temperature,weather_code&timezone=auto`;
      const response = await fetch(url);
      if (!response.ok) return;
      const data = await response.json();
      const temp = Number(data?.current?.temperature_2m);
      if (!Number.isFinite(temp)) return;
      const apparent = Number(data?.current?.apparent_temperature);
      const weatherCode = Number(data?.current?.weather_code);
      const unit = data?.current_units?.temperature_2m || '°C';
      const icon = getWeatherIcon(weatherCode);

      let placeName = '';
      try {
        const placeUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&zoom=10&addressdetails=1&accept-language=cs`;
        const placeResponse = await fetch(placeUrl, { headers: { Accept: 'application/json' } });
        if (placeResponse.ok) {
          const placeData = await placeResponse.json();
          const address = placeData?.address || {};
          placeName = String(address.city || address.town || address.village || address.municipality || address.county || '').trim();
        }
      } catch (_) {}

      weatherText.replaceChildren();

      const iconEl = document.createElement('span');
      iconEl.className = 'home-weather-icon';
      iconEl.textContent = icon;
      iconEl.setAttribute('aria-hidden', 'true');

      const contentEl = document.createElement('span');
      contentEl.className = 'home-weather-content';

      const labelEl = document.createElement('span');
      labelEl.className = 'home-weather-label';
      labelEl.textContent = 'Aktuální počasí';

      if (placeName) {
        const placeEl = document.createElement('span');
        placeEl.className = 'home-weather-place';
        placeEl.textContent = `Pro místo ${placeName} je aktuálně`;
        contentEl.append(labelEl, placeEl);
      } else {
        contentEl.appendChild(labelEl);
      }

      const valueRow = document.createElement('span');
      valueRow.className = 'home-weather-value-row';

      const tempEl = document.createElement('strong');
      tempEl.className = 'home-weather-temp';
      tempEl.textContent = `${Math.round(temp)} ${unit}`;
      valueRow.appendChild(tempEl);

      if (Number.isFinite(apparent)) {
        const feelsEl = document.createElement('span');
        feelsEl.className = 'home-weather-feels';
        feelsEl.textContent = `Pocitově ${Math.round(apparent)} ${unit}`;
        valueRow.appendChild(feelsEl);
      }

      contentEl.appendChild(valueRow);
      weatherText.append(iconEl, contentEl);
      weatherText.hidden = false;
      saveWeatherLocation(position);
      closeWeatherPermissionModal();
    } catch (_) {}
  }

  function requestWeatherLocation() {
    if (!navigator.geolocation || !window.fetch) return;
    navigator.geolocation.getCurrentPosition(
      fetchWeatherForPosition,
      error => {
        if (error?.code === 1) {
          rememberWeatherPermissionReminder();
          openWeatherPermissionModal('Pro zobrazení aktuálního počasí potřebujeme přístup k poloze. Poloha se používá pouze pro určení místního počasí. Pokud už prohlížeč oprávnění zablokoval, povol polohu v nastavení oprávnění tohoto webu a potom klikni na „Povolit polohu“.');
        }
      },
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 10 * 60 * 1000 }
    );
  }

  async function loadWeather() {
    if (!navigator.geolocation || !window.fetch) return;

    const cachedLocation = loadCachedWeatherLocation();
    if (cachedLocation) {
      fetchWeatherForPosition(cachedLocation);
      return;
    }

    try {
      if (navigator.permissions?.query) {
        const permission = await navigator.permissions.query({ name: 'geolocation' });
        if (permission.state === 'granted') {
          requestWeatherLocation();
          return;
        }
        if (permission.state === 'denied') {
          if (shouldShowWeatherPermissionReminder()) {
            openWeatherPermissionModal('Pro zobrazení aktuálního počasí potřebujeme přístup k poloze. Poloha se používá pouze pro určení místního počasí. Povol polohu v oprávněních tohoto webu a potom klikni na „Povolit polohu“.');
          }
          return;
        }
        if (permission.state === 'prompt') {
          if (shouldShowWeatherPermissionReminder()) {
            openWeatherPermissionModal('Pro zobrazení aktuálního počasí potřebujeme přístup k poloze. Poloha se použije pouze k určení místního počasí. Klikni na „Povolit polohu“ a prohlížeč se tě následně zeptá na oprávnění.');
          }
          return;
        }
      }
    } catch (_) {}

    if (shouldShowWeatherPermissionReminder()) {
      openWeatherPermissionModal('Pro zobrazení aktuálního počasí potřebujeme přístup k poloze. Poloha se použije pouze k určení místního počasí. Klikni na „Povolit polohu“.');
    }
  }

  function getPresenceStatus(row) {
    const record = normalizePresenceText(row.attendanceRecord);
    if (isSickRecord(record)) return 'sick';
    if (hasVacationToday(row.absences)) return 'vacation';
    if ((row.isPresent === true || record) && isBreakRecord(record) && !isDepartureRecord(record)) return 'break';
    if (row.isPresent === true && !isBreakRecord(record)) return 'present';
    if (row.presenceKnown === true || isDepartureRecord(record)) return 'absent';
    return 'absent';
  }

  function normalizePresenceText(value) {
    return String(value || '').trim().toLocaleLowerCase('cs-CZ');
  }

  function isDepartureRecord(value) {
    return /odchod z prac|odchod domu|odchod domů|konec prac|ukončení prac|ukonceni prac/.test(value);
  }

  function isBreakRecord(value) {
    if (!value || isDepartureRecord(value)) return false;
    return /pauz|přestávk|prestavk|oběd|obed|svačin|svacin|kuřáck|kurack|kouř|kour|cigaret|návštěv|navstev/.test(value);
  }

  function isSickRecord(value) {
    return /nemoc/.test(value);
  }

  function hasVacationToday(absences) {
    if (!Array.isArray(absences)) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return absences.some(item => {
      const start = parseDateOnly(item?.zacatek);
      const end = parseDateOnly(item?.konec);
      if (!start || !end || start > today || end < today) return false;
      const status = String(item?.status || item?.stav || item?.schvaleni || '').toLocaleUpperCase('cs-CZ');
      if (status && (status.includes('NESCHVAL') || status.includes('ZRUS'))) return false;
      return true;
    });
  }

  function parseDateOnly(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function renderDepartmentOptions() {
    departmentList.innerHTML = availableDepartments.length
      ? availableDepartments.map(department => `<label class="home-department-option"><input type="checkbox" data-home-department="${escapeHtml(department)}" ${selectedDepartments.includes(department) ? 'checked' : ''}><span>${escapeHtml(department)}</span></label>`).join('')
      : '<div class="home-empty">Ve Správě uživatelů nejsou dostupná žádná oddělení.</div>';
  }

  function openDepartmentModal() {
    renderDepartmentOptions();
    departmentModal.hidden = false;
    departmentModal.setAttribute('aria-hidden', 'false');
  }

  function closeDepartmentModal() {
    departmentModal.hidden = true;
    departmentModal.setAttribute('aria-hidden', 'true');
  }

  function loadPresenceFilter() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PRESENCE_FILTER_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (_) {
      return [];
    }
  }

  function loadPresenceFilterWasSet() {
    try { return localStorage.getItem(PRESENCE_FILTER_KEY) !== null; } catch (_) { return false; }
  }

  function savePresenceFilter() {
    try { localStorage.setItem(PRESENCE_FILTER_KEY, JSON.stringify(selectedDepartments)); } catch (_) {}
  }

  function formatTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function renderTasks() {
    const active = tasks.filter(item => !item.done);
    const done = tasks.filter(item => item.done);
    openCount.textContent = `Otevřené: ${active.length}`;
    openSectionCount.textContent = String(active.length);
    doneLabel.textContent = `Hotové úkoly (${done.length})`;

    openTasks.innerHTML = active.length
      ? active.map(task => taskHtml(task)).join('')
      : '<div class="home-empty">Žádné otevřené úkoly.</div>';
    doneTasks.innerHTML = done.length
      ? done.map(task => taskHtml(task)).join('')
      : '<div class="home-empty">Zatím žádné hotové úkoly.</div>';
  }

  function taskHtml(task) {
    const priority = priorityMeta(task.priority);
    const due = task.dueDate ? `<span class="home-task-due">${escapeHtml(formatDateCs(task.dueDate))}</span>` : '';
    const note = task.note ? '<span class="home-task-note-mark" title="Úkol má poznámku">▤</span>' : '';
    return `<article class="home-task-card${task.done ? ' is-done' : ''}" draggable="true" data-home-task-id="${escapeHtml(task.id)}">
      <button type="button" class="home-task-check ${priority.className}${task.done ? ' is-checked' : ''}" data-home-task-toggle="${escapeHtml(task.id)}" aria-label="${task.done ? 'Označit jako nedokončené' : 'Označit jako dokončené'}">${task.done ? '✓' : ''}</button>
      <div class="home-task-main"><div class="home-task-title-row"><strong>${escapeHtml(task.text)}</strong>${note}</div></div>
      <div class="home-task-meta">${due}</div>
    </article>`;
  }

  function renderControls() {
    const todayIso = formatDateIso(new Date());
    const entries = Object.entries(wheelRows)
      .map(([key, record]) => controlEntry(key, record))
      .filter(Boolean)
      .filter(entry => entry.date === todayIso)
      .sort((a, b) => shiftOrder(a.shiftKey) - shiftOrder(b.shiftKey));

    controlsCount.textContent = `Celkem: ${entries.length}`;
    controlsList.innerHTML = entries.length
      ? entries.map(controlHtml).join('')
      : '<div class="home-empty home-controls-empty">Dnes zatím nejsou uložené žádné kontroly.</div>';
  }

  function formatDateIso(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function connectWheelRows() {
    (async () => {
      try {
        const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js");
        const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, onSnapshot } =
          await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");

        const app = initializeApp({
          apiKey: "AIzaSyBX3Phi9CNQPjxYXMKil7exLrJ7ZbRUMbM",
          authDomain: "kv-transport-mapping.firebaseapp.com",
          projectId: "kv-transport-mapping",
          storageBucket: "kv-transport-mapping.firebasestorage.app",
          messagingSenderId: "144100896901",
          appId: "1:144100896901:web:2ceef97e784e06385239ec"
        }, "kvTransportMapping");
        const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

        onSnapshot(collection(db, 'wheelRows'), snapshot => {
          const next = {};
          snapshot.forEach(docSnap => { next[docSnap.id] = docSnap.data(); });
          wheelRows = next;
          renderControls();
        }, error => {
          console.error('domu.js: chyba synchronizace kola štěstí.', error);
        });
      } catch (error) {
        console.error('domu.js: nepodařilo se připojit k Firestore (kolo štěstí).', error);
      }
    })();
  }

  function controlEntry(key, record) {
    const match = String(key).match(/^(\d{4}-\d{2}-\d{2})\|(morning|afternoon|night)$/);
    if (!match || !record || typeof record !== 'object') return null;
    const names = Array.isArray(record.names) ? record.names.filter(Boolean) : [];
    const hasData = Boolean(String(record.controller || '').trim() || String(record.witness || '').trim() || names.length);
    if (!hasData) return null;
    const results = record.results && typeof record.results === 'object' ? record.results : {};
    const completed = names.filter(name => results[name]?.kontrola === true).length;
    const withIssues = names.filter(name => results[name]?.kontrola === true && results[name]?.vysledek === 's vyhradami').length;
    return {
      date: match[1],
      shiftKey: match[2],
      controller: String(record.controller || '').trim(),
      witness: String(record.witness || '').trim(),
      names,
      completed,
      withIssues
    };
  }

  function controlHtml(item) {
    const total = item.names.length;
    let statusClass = 'planned';
    let statusText = total ? `${item.completed}/${total} zkontrolováno` : 'Naplánováno';
    if (item.withIssues > 0) {
      statusClass = 'issues';
      statusText = `${item.withIssues} s výhradami`;
    } else if (total > 0 && item.completed === total) {
      statusClass = 'done';
      statusText = 'Dokončeno';
    } else if (item.completed > 0) {
      statusClass = 'partial';
    }
    const people = [item.controller ? `Kontrolor: ${item.controller}` : '', item.witness ? `Svědek: ${item.witness}` : ''].filter(Boolean).join(' • ');
    return `<a class="home-control-card" href="./kolo-stesti.html?date=${encodeURIComponent(item.date)}">
      <div class="home-control-primary"><span class="home-control-date">${escapeHtml(formatDateCs(item.date))}</span><strong>${escapeHtml(shiftLabel(item.shiftKey))}</strong></div>
      <div class="home-control-people">${escapeHtml(people || 'Kontrolor a svědek zatím nevybráni')}</div>
      <span class="home-control-status ${statusClass}">${escapeHtml(statusText)}</span>
    </a>`;
  }

  function openTaskModal(id) {
    const task = tasks.find(item => item.id === id);
    if (!task) return;
    editingId = id;
    editText.value = task.text || '';
    editDueDate.value = task.dueDate || '';
    editPriority.value = task.priority || '';
    editNote.value = task.note || '';
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    editText.focus();
  }

  function closeTaskModal() {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    editingId = '';
  }

  function onDragStart(event) {
    const card = event.target.closest('[data-home-task-id]');
    if (!card) return;
    draggingId = card.dataset.homeTaskId || '';
    card.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggingId);
  }

  function onDragOver(event) {
    if (!draggingId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const card = event.target.closest('[data-home-task-id]');
    if (!card || card.dataset.homeTaskId === draggingId) return;
    card.classList.add('is-drag-target');
  }

  function onDrop(event, done) {
    event.preventDefault();
    document.querySelectorAll('.home-task-card.is-drag-target').forEach(el => el.classList.remove('is-drag-target'));
    const target = event.target.closest('[data-home-task-id]');
    if (!draggingId || !target) return;
    const dragged = tasks.find(item => item.id === draggingId);
    const targetTask = tasks.find(item => item.id === target.dataset.homeTaskId);
    if (!dragged || !targetTask || dragged.done !== done || targetTask.done !== done) return;

    const sectionIds = tasks.filter(item => item.done === done).map(item => item.id);
    const from = sectionIds.indexOf(draggingId);
    const to = sectionIds.indexOf(targetTask.id);
    if (from < 0 || to < 0 || from === to) return;
    sectionIds.splice(to, 0, sectionIds.splice(from, 1)[0]);

    const lookup = new Map(tasks.map(item => [item.id, item]));
    const other = tasks.filter(item => item.done !== done);
    const reordered = sectionIds.map(id => lookup.get(id)).filter(Boolean);
    tasks = done ? [...other, ...reordered] : [...reordered, ...other];
    saveTasks();
    renderTasks();
  }

  function onDragEnd() {
    draggingId = '';
    document.querySelectorAll('.home-task-card.is-dragging,.home-task-card.is-drag-target').forEach(el => el.classList.remove('is-dragging', 'is-drag-target'));
  }

  function loadTasks() {
    try {
      const raw = JSON.parse(localStorage.getItem(TASK_KEY) || '[]');
      return Array.isArray(raw) ? raw.map(normalizeTask).filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }

  function normalizeTask(task) {
    if (!task || typeof task !== 'object' || !String(task.text || '').trim()) return null;
    return {
      id: String(task.id || createId()),
      text: String(task.text || '').trim(),
      dueDate: String(task.dueDate || task.due_date || '').slice(0, 10),
      priority: ['low', 'medium', 'high'].includes(task.priority) ? task.priority : '',
      note: String(task.note || ''),
      done: Boolean(task.done ?? task.hotovo),
      createdAt: String(task.createdAt || task.vytvoreno || new Date().toISOString()),
      updatedAt: String(task.updatedAt || task.createdAt || task.vytvoreno || new Date().toISOString())
    };
  }

  function saveTasks() {
    try { localStorage.setItem(TASK_KEY, JSON.stringify(tasks)); } catch (_) {}
  }


  function createId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function priorityMeta(priority) {
    if (priority === 'high') return { className: ' priority-high' };
    if (priority === 'medium') return { className: ' priority-medium' };
    if (priority === 'low') return { className: ' priority-low' };
    return { className: '' };
  }

  function shiftOrder(key) {
    return key === 'morning' ? 1 : key === 'afternoon' ? 2 : 3;
  }

  function shiftLabel(key) {
    return key === 'morning' ? 'Ranní' : key === 'afternoon' ? 'Odpolední' : 'Noční';
  }

  function formatDateCs(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return value || '';
    return `${Number(match[3])}. ${Number(match[2])}. ${match[1]}`;
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

  function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function normalize(value) {
    return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("cs-CZ").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
})();
