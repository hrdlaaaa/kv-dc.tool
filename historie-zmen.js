(async function () {
  'use strict';

  const page = document.getElementById('auditPage');
  if (!page) return;

  const search = document.getElementById('auditSearch');
  const moduleFilter = document.getElementById('auditModuleFilter');
  const count = document.getElementById('auditCount');
  const body = document.getElementById('auditTableBody');

  const MAX_ENTRIES = 1000;
  let entries = [];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fillModules(data) {
    const selected = moduleFilter.value;
    const modules = [...new Set(data.map(item => item.module).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs-CZ'));
    moduleFilter.innerHTML = '<option value="">Všechny moduly</option>' + modules.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    if (modules.includes(selected)) moduleFilter.value = selected;
  }

  function render() {
    fillModules(entries);
    const q = (search.value || '').trim().toLocaleLowerCase('cs-CZ');
    const module = moduleFilter.value;
    const data = entries.filter(item => {
      if (module && item.module !== module) return false;
      if (!q) return true;
      return [item.date, item.time, item.actorName, item.actorEmail, item.module, item.action, item.entity, item.field, item.oldValue, item.newValue, item.ip, item.device, item.deviceId].join(' ').toLocaleLowerCase('cs-CZ').includes(q);
    });
    count.textContent = `${data.length} záznamů`;
    body.innerHTML = data.length ? data.map(item => `<tr>
      <td class="audit-nowrap"><strong>${escapeHtml(item.date)}</strong><br><span>${escapeHtml(item.time)}</span></td>
      <td><strong>${escapeHtml(item.actorName || 'Neurčený uživatel')}</strong>${item.actorEmail ? `<br><span class="audit-muted">${escapeHtml(item.actorEmail)}</span>` : ''}</td>
      <td><span class="audit-module">${escapeHtml(item.module)}</span></td>
      <td>${escapeHtml(item.action)}</td>
      <td>${escapeHtml(item.entity)}</td>
      <td>${escapeHtml(item.field)}</td>
      <td class="audit-value audit-old">${escapeHtml(item.oldValue)}</td>
      <td class="audit-value audit-new">${escapeHtml(item.newValue)}</td>
      <td class="audit-nowrap">${escapeHtml(item.ip)}</td>
      <td>${escapeHtml(item.device)}${item.deviceId ? `<br><span class="audit-muted">ID: ${escapeHtml(String(item.deviceId).slice(0, 18))}</span>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="10" class="audit-empty">Zatím nejsou zaznamenané žádné změny.</td></tr>';
  }

  search.addEventListener('input', render);
  moduleFilter.addEventListener('change', render);

  render();

  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js");
    const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, query, orderBy, limit, onSnapshot } =
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

    const auditQuery = query(collection(db, 'auditLog'), orderBy('timestamp', 'desc'), limit(MAX_ENTRIES));
    onSnapshot(auditQuery, snapshot => {
      entries = snapshot.docs.map(docSnap => docSnap.data());
      render();
    }, error => {
      console.error('historie-zmen.js: chyba synchronizace auditu.', error);
    });
  } catch (error) {
    console.error('historie-zmen.js: Firestore se nepodařilo načíst.', error);
  }
})();
