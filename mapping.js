(async () => {
  'use strict';

  const $ = id => document.getElementById(id);
  const deepClone = value => JSON.parse(JSON.stringify(value));

  function mergeTransportConfig(base, saved) {
    return {
      ...base,
      ...saved,
      groups: { ...base.groups, ...(saved?.groups || {}) },
      placeRules: { ...base.placeRules, ...(saved?.placeRules || {}) },
      vehicles: Array.isArray(saved?.vehicles) ? saved.vehicles : base.vehicles
    };
  }
  let transportConfig = deepClone(window.TRANSPORT_CONFIG || {});

  const mappingBody = $('vehicleMappingBody');
  const addMappingBtn = $('addMappingBtn');
  const saveVehicleMappingsBtn = $('saveVehicleMappingsBtn');
  const saveTransportRulesBtn = $('saveTransportRulesBtn');
  const insideLabelInput = $('insideLabelInput');
  const outsideLabelInput = $('outsideLabelInput');
  const branchPrefixInput = $('branchPrefixInput');
  const emphasizeBranchInput = $('emphasizeBranchInput');
  const vehicleMappingStatus = $('vehicleMappingStatus');
  const transportRulesStatus = $('transportRulesStatus');

  let vehicleDirty = false;
  let rulesDirty = false;
  function hasUnsavedMappingChanges() { return vehicleDirty || rulesDirty; }

  function currentGroupLabel(key) {
    return transportConfig.groups?.[key]?.label || (key === 'inside' ? 'Vnitřek' : 'Venek');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function vehicleSortRank(value) {
    const text = String(value || '').trim();
    if (/^\d+$/.test(text)) return { group: 0, number: Number(text), text };
    const ex = text.match(/^EX(\d+)$/i);
    if (ex) return { group: 1, number: Number(ex[1]), text };
    return { group: 2, number: 0, text };
  }
  function sortVehicles(rows) {
    return [...rows].sort((a,b) => {
      const ar=vehicleSortRank(a.carNumber), br=vehicleSortRank(b.carNumber);
      if (ar.group !== br.group) return ar.group - br.group;
      if (ar.group < 2 && ar.number !== br.number) return ar.number - br.number;
      if (ar.group === 2) {
        const d=ar.text.localeCompare(br.text,'cs-CZ',{numeric:true,sensitivity:'base'});
        if (d) return d;
      }
      return String(a.vehicle||'').localeCompare(String(b.vehicle||''),'cs-CZ',{numeric:true,sensitivity:'base'});
    });
  }
  function mappingRowTemplate(row, index) {
    const group = row.group === 'inside' ? 'inside' : 'outside';
    return `<tr data-map-index="${index}">
      <td><input class="mapping-input" data-field="vehicle" value="${escapeHtml(row.vehicle || '')}" autocomplete="off"></td>
      <td><input class="mapping-input" data-field="carNumber" value="${escapeHtml(row.carNumber || '')}" autocomplete="off"></td>
      <td><select class="mapping-select" data-field="group"><option value="inside"${group === 'inside' ? ' selected' : ''}>${escapeHtml(currentGroupLabel('inside'))}</option><option value="outside"${group === 'outside' ? ' selected' : ''}>${escapeHtml(currentGroupLabel('outside'))}</option></select></td>
      <td><button type="button" class="btn danger mapping-remove" data-remove-mapping="${index}">Odebrat</button></td>
    </tr>`;
  }
  function renderMappingEditor() {
    if (!vehicleDirty) mappingBody.innerHTML = sortVehicles(transportConfig.vehicles || []).map(mappingRowTemplate).join('');
    if (!rulesDirty) {
      insideLabelInput.value = transportConfig.groups?.inside?.label || 'Vnitřek';
      outsideLabelInput.value = transportConfig.groups?.outside?.label || 'Venek';
      branchPrefixInput.value = transportConfig.placeRules?.branchPrefix || 'K & V';
      emphasizeBranchInput.checked = transportConfig.placeRules?.emphasizeBranch !== false;
    }
    saveVehicleMappingsBtn.disabled = !vehicleDirty;
    saveTransportRulesBtn.disabled = !rulesDirty;
  }
  function collectVehicles() {
    const vehicles=[];
    for (const tr of mappingBody.querySelectorAll('tr[data-map-index]')) {
      const vehicle=tr.querySelector('[data-field="vehicle"]').value.trim();
      const carNumber=tr.querySelector('[data-field="carNumber"]').value.trim();
      const group=tr.querySelector('[data-field="group"]').value === 'inside' ? 'inside' : 'outside';
      if (!vehicle && !carNumber) continue;
      if (!vehicle || !carNumber) throw new Error('Každý řádek musí mít vyplněný kód vozidla i číslo auta.');
      vehicles.push({vehicle,carNumber,group});
    }
    const seen=new Set();
    for (const row of vehicles) {
      const key=row.vehicle.toLocaleUpperCase('cs-CZ');
      if (seen.has(key)) throw new Error(`Vozidlo '${row.vehicle}' je v mapování vícekrát.`);
      seen.add(key);
    }
    return vehicles;
  }

  addMappingBtn.addEventListener('click', () => {
    const index=Date.now();
    mappingBody.insertAdjacentHTML('afterbegin', mappingRowTemplate({vehicle:'',carNumber:'',group:'outside'}, index));
    vehicleDirty=true;
    saveVehicleMappingsBtn.disabled=false;
    mappingBody.querySelector('tr:first-child [data-field="vehicle"]')?.focus();
  });
  mappingBody.addEventListener('input', () => { vehicleDirty=true; saveVehicleMappingsBtn.disabled=false; vehicleMappingStatus.textContent=''; });
  mappingBody.addEventListener('change', () => { vehicleDirty=true; saveVehicleMappingsBtn.disabled=false; vehicleMappingStatus.textContent=''; });
  mappingBody.addEventListener('click', e => {
    const btn=e.target.closest('[data-remove-mapping]');
    if (!btn) return;
    btn.closest('tr')?.remove();
    vehicleDirty=true; saveVehicleMappingsBtn.disabled=false; vehicleMappingStatus.textContent='';
  });
  [insideLabelInput,outsideLabelInput,branchPrefixInput,emphasizeBranchInput].forEach(el => {
    el.addEventListener('input', () => { rulesDirty=true; saveTransportRulesBtn.disabled=false; transportRulesStatus.textContent=''; });
    el.addEventListener('change', () => { rulesDirty=true; saveTransportRulesBtn.disabled=false; transportRulesStatus.textContent=''; });
  });
  window.addEventListener('beforeunload', e => {
    if (!hasUnsavedMappingChanges()) return;
    e.preventDefault();
    e.returnValue='';
  });

  // Mapování vozidel a pravidla přepravy jsou sdílená pro všechny přes Firestore
  // (samostatný Firebase projekt, odděleně od dat přítomností). Dokud se
  // nepřipojí, appka běží s vestavěnými výchozími hodnotami z transport-config.js.
  let transportConfigRef = null;
  let firestoreSetDoc = null;
  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js");
    const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, onSnapshot, setDoc } =
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
    transportConfigRef = doc(db, 'config', 'transport');
    firestoreSetDoc = setDoc;

    onSnapshot(transportConfigRef, snapshot => {
      if (snapshot.exists()) {
        transportConfig = mergeTransportConfig(deepClone(window.TRANSPORT_CONFIG || {}), snapshot.data());
      } else {
        // První spuštění vůbec: založ sdílený dokument z vestavěných výchozích hodnot.
        setDoc(transportConfigRef, deepClone(window.TRANSPORT_CONFIG || {})).catch(err =>
          console.error('Mapování přepravy: nepodařilo se založit počáteční data ve Firestore.', err));
        return;
      }
      renderMappingEditor();
    }, error => {
      console.error('Mapování přepravy: chyba synchronizace s Firestore.', error);
    });
  } catch (err) {
    console.error('Mapování přepravy: Firestore se nepodařilo načíst, používám vestavěné výchozí hodnoty.', err);
  }

  saveVehicleMappingsBtn.addEventListener('click', async () => {
    if (!transportConfigRef) {
      vehicleMappingStatus.textContent='Nelze uložit: spojení s databází není dostupné.';
      vehicleMappingStatus.style.color='var(--danger)';
      return;
    }
    try {
      const previousVehicles=transportConfig.vehicles;
      const nextConfig={...transportConfig,vehicles:sortVehicles(collectVehicles())};
      saveVehicleMappingsBtn.disabled=true;
      await firestoreSetDoc(transportConfigRef, nextConfig);
      transportConfig=nextConfig;
      vehicleDirty=false;
      renderMappingEditor();
      window.KVEAudit?.logChange({ module:'Mapování přepravy', action:'Uložení mapování vozidel', entity:'Vozidla', field:'vehicles', oldValue:previousVehicles, newValue:transportConfig.vehicles });
      vehicleMappingStatus.textContent='Změny vozidel byly uloženy pro všechny.';
      vehicleMappingStatus.style.color='';
    } catch(err) {
      vehicleMappingStatus.textContent=err?.message||String(err);
      vehicleMappingStatus.style.color='var(--danger)';
      renderMappingEditor();
    }
  });

  saveTransportRulesBtn.addEventListener('click', async () => {
    if (!transportConfigRef) {
      transportRulesStatus.textContent='Nelze uložit: spojení s databází není dostupné.';
      transportRulesStatus.style.color='var(--danger)';
      return;
    }
    try {
      const previousRules={ groups:transportConfig.groups, placeRules:transportConfig.placeRules };
      const nextConfig={
        ...transportConfig,
        groups:{inside:{label:insideLabelInput.value.trim()||'Vnitřek'},outside:{label:outsideLabelInput.value.trim()||'Venek'}},
        placeRules:{...transportConfig.placeRules,branchPrefix:branchPrefixInput.value.trim()||'K & V',emphasizeBranch:emphasizeBranchInput.checked}
      };
      saveTransportRulesBtn.disabled=true;
      await firestoreSetDoc(transportConfigRef, nextConfig);
      transportConfig=nextConfig;
      rulesDirty=false;
      renderMappingEditor();
      window.KVEAudit?.logChange({ module:'Mapování přepravy', action:'Uložení pravidel', entity:'Pravidla přepravy', field:'groups/placeRules', oldValue:previousRules, newValue:{ groups:transportConfig.groups, placeRules:transportConfig.placeRules } });
      transportRulesStatus.textContent='Pravidla přepravy byla uložena pro všechny.';
      transportRulesStatus.style.color='';
    } catch(err) {
      transportRulesStatus.textContent=err?.message||String(err);
      transportRulesStatus.style.color='var(--danger)';
      renderMappingEditor();
    }
  });

  renderMappingEditor();
})();
