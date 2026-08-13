(() => {
      'use strict';

      if (!window.pdfjsLib) {
        const status = document.getElementById('status');
        if (status) {
          status.textContent = 'Nepodařilo se načíst PDF knihovnu. Zkontrolujte připojení k internetu.';
          status.className = 'status error';
        }
        return;
      }
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

      const CONFIG_STORAGE_KEY = 'kve.transport.mapping.v1';
      const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
      const $ = id => document.getElementById(id);
      const deepClone = value => JSON.parse(JSON.stringify(value));

      function loadTransportConfig() {
        const base = deepClone(window.TRANSPORT_CONFIG || {});
        try {
          const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
          if (!raw) return base;
          const saved = JSON.parse(raw);
          return {
            ...base,
            ...saved,
            groups: { ...base.groups, ...(saved.groups || {}) },
            placeRules: { ...base.placeRules, ...(saved.placeRules || {}) },
            vehicles: Array.isArray(saved.vehicles) ? saved.vehicles : base.vehicles
          };
        } catch (_) { return base; }
      }
      let transportConfig = loadTransportConfig();

      function findVehicleMapping(vehicle) {
        const key = String(vehicle || '').trim().toLocaleUpperCase('cs-CZ');
        return (transportConfig.vehicles || []).find(row => String(row.vehicle || '').trim().toLocaleUpperCase('cs-CZ') === key) || null;
      }
      function currentGroupLabel(key) {
        return transportConfig.groups?.[key]?.label || (key === 'inside' ? 'Vnitřek' : 'Venek');
      }
      function compileLegalFormRegex() {
        try { return new RegExp(transportConfig.placeRules?.legalFormAfterCommaPattern || '$a', 'i'); }
        catch (_) { return /$a/; }
      }
      function escapeRegex(value) { return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
      function branchPrefixRegex() {
        const prefix = String(transportConfig.placeRules?.branchPrefix || '').trim();
        if (!prefix) return null;
        const pieces = prefix.split(/\s+/).filter(Boolean).map(escapeRegex);
        const flexible = pieces.join('\\s+').replace(/&/g, '\\s*&\\s*');
        return new RegExp('^' + flexible + '\\s+(.+)$', 'i');
      }

      const state = { files: [], result: null };
      const dropzone = $('dropzone');
      const pageDropOverlay = $('pageDropOverlay');
      const fileInput = $('fileInput');
      const fileList = $('fileList');
      const filesDetails = $('filesDetails');
      const filesSummary = $('filesSummary');
      const toolbar = $('toolbar');
      const processBtn = $('processBtn');
      const clearBtn = $('clearBtn');
      const jsonBtn = $('jsonBtn');
      const xlsxBtn = $('xlsxBtn');
      const printBtn = $('printBtn');
      const statusEl = $('status');
      const warningsEl = $('warnings');
      const resultsCard = $('resultsCard');
      const resultsEl = $('results');
      const transportPage = $('transportPage');
      const mappingPage = $('mappingPage');
      const presencePage = $('presencePage');
      const userManagementPage = $('userManagementPage');
      const navTransport = $('navTransport');
      const navMapping = $('navMapping');
      const navPresence = $('navPresence');
      const navUserManagement = $('navUserManagement');
      const headerPageTitle = $('headerPageTitle');
      const transportHeaderTools = $('transportHeaderTools');
      const transportHeaderStatus = $('transportHeaderStatus');
      const transportHeaderWarnings = $('transportHeaderWarnings');
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
      const presenceVariant = $('presenceVariant');
      const presenceFrame = $('presenceFrame');
      const presencePlaceholder = $('presencePlaceholder');

      let activePage = 'transport';
      let vehicleDirty = false;
      let rulesDirty = false;

      function hasUnsavedMappingChanges() { return vehicleDirty || rulesDirty; }
      function confirmLeaveMapping() {
        if (!hasUnsavedMappingChanges()) return true;
        return confirm('Máte neuložené změny v mapování přepravy. Pokud odejdete, změny nebudou uloženy. Pokračovat?');
      }
      function discardMappingChanges() {
        vehicleDirty = false;
        rulesDirty = false;
        renderMappingEditor();
      }

      function setHeaderForPage(name) {
        const titles = { transport: 'Přeprava', mapping: 'Mapování přepravy', presence: 'Přítomnosti', userManagement: 'Správa uživatelů' };
        const title = titles[name] || 'Přeprava';
        headerPageTitle.textContent = title;
        document.title = title;
        const isTransport = name === 'transport';
        transportHeaderTools.hidden = !isTransport;
        transportHeaderStatus.hidden = !isTransport;
        transportHeaderWarnings.hidden = !isTransport;
      }

      function showPage(name) {
        if (activePage === 'mapping' && name !== 'mapping' && !confirmLeaveMapping()) return;
        if (activePage === 'mapping' && name !== 'mapping') discardMappingChanges();
        activePage = name;
        transportPage.hidden = name !== 'transport';
        mappingPage.hidden = name !== 'mapping';
        presencePage.hidden = name !== 'presence';
        userManagementPage.hidden = name !== 'userManagement';
        navTransport.classList.toggle('active', name === 'transport');
        navMapping.classList.toggle('active', name === 'mapping');
        navPresence.classList.toggle('active', name === 'presence');
        navUserManagement.classList.toggle('active', name === 'userManagement');
        navTransport.toggleAttribute('aria-current', name === 'transport');
        navMapping.toggleAttribute('aria-current', name === 'mapping');
        navPresence.toggleAttribute('aria-current', name === 'presence');
        navUserManagement.toggleAttribute('aria-current', name === 'userManagement');
        setHeaderForPage(name);
        if (name === 'mapping') renderMappingEditor();
      }
      navTransport.addEventListener('click', () => showPage('transport'));
      navMapping.addEventListener('click', () => showPage('mapping'));
      navPresence.addEventListener('click', () => showPage('presence'));
      navUserManagement.addEventListener('click', () => showPage('userManagement'));

      const PRESENCE_SOURCES = {
        prijem: './presence-prijem.html?embedded=1',
        vydej: './presence-vydej.html?embedded=1',
        kabely: './presence-kabely.html?embedded=1'
      };
      presenceVariant.addEventListener('change', () => {
        const src = PRESENCE_SOURCES[presenceVariant.value];
        if (!src) {
          presenceFrame.hidden = true;
          presenceFrame.removeAttribute('src');
          presencePlaceholder.hidden = false;
          return;
        }
        presencePlaceholder.hidden = true;
        presenceFrame.hidden = false;
        if (presenceFrame.getAttribute('src') !== src) presenceFrame.setAttribute('src', src);
      });

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
      function applyMappingToCurrentResults() {
        if (!state.result?.processedPdfs) return;
        for (const item of state.result.processedPdfs) {
          const mapping=findVehicleMapping(item.data.spz);
          item.data.cisloAuta=mapping?.carNumber ?? null;
          item.warnings=mapping ? [] : [`Vozidlo '${item.data.spz}' není v mapování; číslo auta je prázdné.`];
        }
        renderResult(state.result);
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
      saveVehicleMappingsBtn.addEventListener('click', () => {
        try {
          transportConfig={...transportConfig,vehicles:sortVehicles(collectVehicles())};
          localStorage.setItem(CONFIG_STORAGE_KEY,JSON.stringify(transportConfig));
          vehicleDirty=false;
          applyMappingToCurrentResults();
          renderMappingEditor();
          vehicleMappingStatus.textContent='Změny vozidel byly uloženy.';
        } catch(err) { vehicleMappingStatus.textContent=err?.message||String(err); vehicleMappingStatus.style.color='var(--danger)'; }
      });
      [insideLabelInput,outsideLabelInput,branchPrefixInput,emphasizeBranchInput].forEach(el => {
        el.addEventListener('input', () => { rulesDirty=true; saveTransportRulesBtn.disabled=false; transportRulesStatus.textContent=''; });
        el.addEventListener('change', () => { rulesDirty=true; saveTransportRulesBtn.disabled=false; transportRulesStatus.textContent=''; });
      });
      saveTransportRulesBtn.addEventListener('click', () => {
        transportConfig={
          ...transportConfig,
          groups:{inside:{label:insideLabelInput.value.trim()||'Vnitřek'},outside:{label:outsideLabelInput.value.trim()||'Venek'}},
          placeRules:{...transportConfig.placeRules,branchPrefix:branchPrefixInput.value.trim()||'K & V',emphasizeBranch:emphasizeBranchInput.checked}
        };
        localStorage.setItem(CONFIG_STORAGE_KEY,JSON.stringify(transportConfig));
        rulesDirty=false;
        applyMappingToCurrentResults();
        renderMappingEditor();
        transportRulesStatus.textContent='Pravidla přepravy byla uložena.';
      });
      window.addEventListener('beforeunload', e => {
        if (!hasUnsavedMappingChanges()) return;
        e.preventDefault();
        e.returnValue='';
      });

      function setStatus(text, type = 'muted') {
        statusEl.textContent = text;
        statusEl.className = `status ${type}`;
      }

      function escapeHtml(value) {
        return String(value ?? '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#039;');
      }

      function addFiles(fileLike) {
        const incoming = Array.from(fileLike).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
        const keys = new Set(state.files.map(f => `${f.name}|${f.size}|${f.lastModified}`));
        for (const file of incoming) {
          const key = `${file.name}|${file.size}|${file.lastModified}`;
          if (!keys.has(key)) {
            state.files.push(file);
            keys.add(key);
          }
        }
        renderFiles();
      }

      function renderFiles() {
        fileList.innerHTML = state.files.map((f, i) => `
          <li><span>${escapeHtml(f.name)} <span class="muted">(${Math.ceil(f.size/1024)} kB)</span></span>
          <button class="btn danger" data-remove="${i}" type="button">Odebrat</button></li>
        `).join('');
        const any = state.files.length > 0;
        processBtn.disabled = !any;
        clearBtn.disabled = !any && !state.result;
        filesDetails.hidden = !any;
        filesSummary.textContent = `Nahrané soubory (${state.files.length})`;
        if (any) {
          filesDetails.open = true;
          setStatus(`Vybráno souborů: ${state.files.length}`);
        } else if (!state.result) setStatus('');
      }

      fileList.addEventListener('click', e => {
        const button = e.target.closest('[data-remove]');
        if (!button) return;
        state.files.splice(Number(button.dataset.remove), 1);
        renderFiles();
      });

      fileInput.addEventListener('change', () => {
        addFiles(fileInput.files);
        fileInput.value = '';
      });
      // PDF lze přetáhnout kamkoliv na stránku. Dokumentové handlery zároveň
      // zabrání prohlížeči, aby upuštěné PDF otevřel místo aplikace.
      let dragDepth = 0;
      function hasFilesDrag(e) {
        return activePage === 'transport' && Array.from(e.dataTransfer?.types || []).includes('Files');
      }
      function setGlobalDrag(active) {
        document.body.classList.toggle('global-drag', active);
        pageDropOverlay.classList.toggle('active', active);
        pageDropOverlay.setAttribute('aria-hidden', active ? 'false' : 'true');
        dropzone.classList.toggle('drag', active);
      }
      document.addEventListener('dragenter', e => {
        if (!hasFilesDrag(e)) return;
        e.preventDefault();
        dragDepth += 1;
        setGlobalDrag(true);
      });
      document.addEventListener('dragover', e => {
        if (!hasFilesDrag(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        setGlobalDrag(true);
      });
      document.addEventListener('dragleave', e => {
        if (!hasFilesDrag(e)) return;
        e.preventDefault();
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) setGlobalDrag(false);
      });
      document.addEventListener('drop', e => {
        e.preventDefault();
        dragDepth = 0;
        setGlobalDrag(false);
        if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
      });
      window.addEventListener('blur', () => {
        dragDepth = 0;
        setGlobalDrag(false);
      });

      // Jakmile uživatel použije nástrojovou lištu, seznam souborů se sbalí.
      toolbar.addEventListener('click', e => {
        if (e.target.closest('button') && !filesDetails.hidden) filesDetails.open = false;
      });

      clearBtn.addEventListener('click', () => {
        state.files = [];
        state.result = null;
        warningsEl.innerHTML = '';
        resultsEl.innerHTML = '';
        resultsCard.hidden = true;
        jsonBtn.disabled = xlsxBtn.disabled = printBtn.disabled = true;
        renderFiles();
      });

      function centerX(w) { return (w.x0 + w.x1) / 2; }
      function centerY(w) { return (w.y0 + w.y1) / 2; }

      function textItemsToWords(items, pageHeight) {
        const words = [];
        for (const item of items) {
          const raw = (item.str || '').trim();
          if (!raw) continue;
          const parts = raw.split(/\s+/).filter(Boolean);
          const x0 = Number(item.transform?.[4] || 0);
          const baselineY = Number(item.transform?.[5] || 0);
          const topY = pageHeight - baselineY - Math.max(1, Number(item.height || 0));
          const height = Math.max(1, Number(item.height || 8));
          const totalWidth = Math.max(1, Number(item.width || raw.length * 4));
          let cursor = x0;
          const totalChars = parts.reduce((s,p) => s + p.length, 0) + Math.max(0, parts.length - 1);
          for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            const width = totalWidth * (p.length / Math.max(1, totalChars));
            words.push({ x0: cursor, y0: topY, x1: cursor + width, y1: topY + height, text: p });
            cursor += width + (parts.length > 1 ? totalWidth / totalChars : 0);
          }
        }
        words.sort((a,b) => centerY(a) - centerY(b) || a.x0 - b.x0);
        return words;
      }

      function extractTransportNumber(words) {
        for (let i = 0; i < words.length - 2; i++) {
          if (words[i].text.toLocaleLowerCase('cs-CZ') === 'přeprava' && words[i+1].text.toLocaleLowerCase('cs-CZ') === 'číslo:') {
            const value = words[i+2].text.trim();
            if (/^\d+$/.test(value)) return value;
          }
        }
        throw new Error("Nepodařilo se najít 'Přeprava číslo'.");
      }

      function extractVehicle(words) {
        const header = words.find(w => w.text.toLocaleLowerCase('cs-CZ') === 'vozidlo');
        if (!header) throw new Error("Nepodařilo se najít hlavičku sloupce 'vozidlo'.");
        const hx = centerX(header), hy = centerY(header);
        const candidates = words
          .filter(w => centerY(w) > hy + 4 && centerY(w) <= hy + 40 && Math.abs(centerX(w) - hx) <= 65)
          .map(w => ({ score: Math.abs(centerX(w)-hx) + .35*Math.abs(centerY(w)-(hy+15)), w }))
          .sort((a,b) => a.score - b.score);
        if (!candidates.length) throw new Error("Nepodařilo se najít hodnotu ve sloupci 'vozidlo'.");
        return candidates[0].w.text.trim();
      }

      function normalizeHeaderToken(text) {
        return String(text || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLocaleLowerCase('cs-CZ')
          .replace(/[^a-z0-9]/g, '');
      }

      function median(values) {
        if (!values.length) return null;
        const sorted = [...values].sort((a,b) => a-b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
      }

      function findDetailHeader(words) {
        const placeCandidates = words.filter(w => normalizeHeaderToken(w.text) === 'misto');
        const contactCandidates = words.filter(w => normalizeHeaderToken(w.text) === 'kontakt');
        const pairs = [];
        for (const place of placeCandidates) {
          for (const contact of contactCandidates) {
            if (contact.x0 <= place.x0) continue;
            const dy = Math.abs(centerY(place) - centerY(contact));
            if (dy <= 4.5) pairs.push({ place, contact, dy, y: (centerY(place)+centerY(contact))/2 });
          }
        }
        if (!pairs.length) throw new Error("Nepodařilo se najít společnou hlavičku tabulky 'Místo/Kontakt'.");

        // V dokumentu může být slovo „Místo“ i v horním informačním bloku.
        // Detailní tabulka je níže na stránce, proto bereme nejnižší platnou dvojici na stejné řádce.
        pairs.sort((a,b) => b.y - a.y || a.dy - b.dy);
        const { place, contact, y: headerY } = pairs[0];

        const sameHeaderLine = words.filter(w => Math.abs(centerY(w) - headerY) <= 5);
        const timeHeader = sameHeaderLine
          .filter(w => {
            const t = normalizeHeaderToken(w.text);
            return (t === 'cas' || t === 'as') && centerX(w) < centerX(place);
          })
          .sort((a,b) => centerX(b) - centerX(a))[0] || null;

        // Pokud font slovo Čas rozbije nebo zahodí první znak, opřeme levý sloupec o skutečné časy HH:MM.
        const timeValueXs = words
          .filter(w => centerY(w) > headerY + 4 && TIME_RE.test(w.text.trim()) && centerX(w) < centerX(place))
          .map(centerX);
        const timeCenter = timeHeader ? centerX(timeHeader) : median(timeValueXs);
        if (timeCenter == null) throw new Error("Nepodařilo se určit sloupec 'Čas'.");

        const placeCenter = centerX(place);
        const contactCenter = centerX(contact);
        const placeLeft = (timeCenter + placeCenter) / 2;
        const placeRight = (placeCenter + contactCenter) / 2;

        if (!(placeLeft < placeCenter && placeCenter < placeRight)) {
          throw new Error("Nepodařilo se spolehlivě určit hranice sloupce 'Místo'.");
        }
        return { headerY, placeLeft, placeRight, timeCenter, placeCenter, contactCenter };
      }

      function groupByVisualLine(words, tolerance = 1.8) {
        const ordered = [...words].sort((a,b) => centerY(a) - centerY(b) || a.x0 - b.x0);
        const lines = [];
        for (const w of ordered) {
          const cy = centerY(w);
          let line = lines.find(l => Math.abs(cy - l.y) <= tolerance);
          if (!line) { line = { y: cy, words: [] }; lines.push(line); }
          line.words.push(w);
          line.y = line.words.reduce((s,x) => s + centerY(x), 0) / line.words.length;
        }
        for (const l of lines) l.words.sort((a,b) => a.x0 - b.x0);
        return lines.sort((a,b) => a.y - b.y);
      }

      function normalizePlaceFirstLine(text) {
        let t = text.replace(/\s+/g, ' ').trim();
        if (!t) return t;
        const prefixRx = branchPrefixRegex();
        const branch = prefixRx ? t.match(prefixRx) : null;
        if (branch) {
          const branchName = branch[1].trim();
          return transportConfig.placeRules?.emphasizeBranch === false ? branchName : `<strong>${branchName}</strong>`;
        }
        t = t.replace(compileLegalFormRegex(), '').trim();
        return t;
      }

      function extractStops(words, inheritedLayout = null) {
        // První stránka obvykle obsahuje hlavičku tabulky, pokračovací stránky už ne.
        // Geometrii sloupců proto na první stránce odvodíme z hlavičky a na dalších
        // stránkách ji pouze znovu použijeme. Tím pokračování přes zalomení stránky
        // nepřijde o žádnou vykládku.
        const localLayout = inheritedLayout || findDetailHeader(words);
        const { placeLeft, placeRight, timeCenter } = localLayout;
        const headerY = inheritedLayout ? -Infinity : localLayout.headerY;

        // Text v PDF bývá centrovaný v buňce a PDF.js jej může rozdělit na několik
        // samostatných objektů. Krátký začátek názvu (typicky první 1–2 znaky) tak
        // může geometricky ležet těsně vlevo od matematického středu mezi sloupci.
        // Proto nepoužíváme placeLeft jako tvrdý ořez. Levou hranici pro čtení
        // odvozujeme dynamicky z mezery mezi středem sloupce Čas a hranicí Místo.
        // Je to obecné pravidlo layoutu, nikoli seznam konkrétních poboček/názvů.
        const placeScanLeft = timeCenter + (placeLeft - timeCenter) * 0.55;

        const timeWords = words
          .filter(w => centerY(w) > headerY + 5 && centerX(w) < placeLeft && TIME_RE.test(w.text.trim()))
          .filter(w => Math.abs(centerX(w) - timeCenter) <= Math.max(28, placeLeft - timeCenter))
          .sort((a,b) => centerY(a) - centerY(b));
        if (!timeWords.length) throw new Error('V tabulce nebyly nalezeny žádné zastávky s časem HH:MM.');

        const stops = [];
        for (let i = 0; i < timeWords.length; i++) {
          const tw = timeWords[i];
          const ty = centerY(tw);

          // Název zastávky začíná na stejné vizuální řádce jako čas.
          // Používáme střed textového prvku a skutečné hranice sloupce odvozené z hlavičky,
          // takže se do názvu nemůže přimíchat Kontakt ani Bal.
          let sameRowWords = words.filter(w => {
            const cy = centerY(w);
            // PDF.js může vrátit celý textový úsek jako jeden široký objekt.
            // Nesmíme rozhodovat podle jeho středu, protože by se první část názvu
            // u levého okraje sloupce zahodila. Stačí, když textový box se sloupcem Místo překrývá.
            const overlapsPlace = w.x1 > placeScanLeft && w.x0 < placeRight;
            return Math.abs(cy - ty) <= 4.5 && overlapsPlace;
          });

          if (!sameRowWords.length) {
            // Fallback pro PDF s mírně posunutou baseline: vezmeme nejbližší vizuální řádek
            // uvnitř rozsahu aktuální zastávky, stále pouze ve sloupci Místo.
            const startY = ty - 3.5;
            const endY = i + 1 < timeWords.length ? centerY(timeWords[i+1]) - 3.5 : Infinity;
            const rowWords = words.filter(w => {
              const cy = centerY(w);
              const overlapsPlace = w.x1 > placeScanLeft && w.x0 < placeRight;
              return cy >= startY && cy < endY && overlapsPlace;
            });
            const lines = groupByVisualLine(rowWords, 2.4);
            if (lines.length) {
              lines.sort((a,b) => Math.abs(a.y - ty) - Math.abs(b.y - ty));
              sameRowWords = lines[0].words;
            }
          }

          // Čas je na stejné řádce, ale nesmí se dostat do názvu ani po rozšíření levé hranice.
          sameRowWords = sameRowWords.filter(w => w !== tw && !TIME_RE.test(w.text.trim()));
          sameRowWords.sort((a,b) => a.x0 - b.x0);
          if (!sameRowWords.length) throw new Error(`U zastávky ${tw.text} chybí text ve sloupci Místo.`);
          const firstLine = sameRowWords.map(w => w.text.trim()).join(' ').replace(/\s+/g, ' ').trim();

          // Čistě číselný obsah je typický příznak chybně určeného sloupce (např. Bal.).
          // Raději zpracování zastavíme, než abychom zobrazili věcně chybná data.
          if (/^[\d\s.,+-]+$/.test(firstLine)) {
            throw new Error(`U zastávky ${tw.text} byl místo názvu nalezen číselný obsah '${firstLine}'. Změnil se layout PDF.`);
          }

          const normalized = normalizePlaceFirstLine(firstLine);
          if (!normalized) throw new Error(`U zastávky ${tw.text} vznikl prázdný název místa.`);
          stops.push({ cas: tw.text.trim(), misto: normalized });
        }
        return stops.reverse();
      }

      async function parsePdf(file) {
        const buffer = await file.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
        if (!doc.numPages) throw new Error('PDF nemá žádnou stránku.');

        let transportNumber = null, vehicle = null;
        let detailLayout = null;
        const chronological = [];
        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p);
          const viewport = page.getViewport({ scale: 1 });
          const text = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
          const words = textItemsToWords(text.items, viewport.height);
          if (p === 1) {
            transportNumber = extractTransportNumber(words);
            vehicle = extractVehicle(words);
            detailLayout = findDetailHeader(words);
          }
          try {
            // Na stránce 1 používáme její vlastní hlavičku; na dalších stránkách
            // pokračujeme se stejnou geometrií sloupců, i když se hlavička tabulky neopakuje.
            const pageStopsReverse = extractStops(words, p === 1 ? null : detailLayout);
            chronological.push(...pageStopsReverse.slice().reverse());
          } catch (err) {
            // Prázdná pokračovací stránka je v pořádku. Pokud ale obsahuje časové řádky,
            // nesmíme chybu tiše spolknout — jinak bychom část trasy ztratili.
            const hasLikelyStops = words.some(w => TIME_RE.test(w.text.trim()) && centerX(w) < (detailLayout?.placeLeft ?? Infinity));
            if (hasLikelyStops || !/hlavičku tabulky|žádné zastávky/.test(String(err.message))) throw err;
          }
        }
        if (!chronological.length) throw new Error('V dokumentu nebyly nalezeny žádné zastávky.');
        const vehicleMapping = findVehicleMapping(vehicle);
        const carNumber = vehicleMapping?.carNumber ?? null;
        const result = {
          fileName: file.name,
          data: {
            cisloAuta: carNumber,
            spz: vehicle,
            cisloPrepravy: transportNumber,
            vykladky: chronological.slice().reverse()
          }
        };
        if (carNumber == null) result.warnings = [`Vozidlo '${vehicle}' není v číselníku; číslo auta je prázdné.`];
        return result;
      }

      function compareByCarNumberThenName(a, b) {
        const aCar = String(a?.data?.cisloAuta ?? '').trim();
        const bCar = String(b?.data?.cisloAuta ?? '').trim();

        const ar = vehicleSortRank(aCar);
        const br = vehicleSortRank(bCar);

        // 1) čistá čísla 1..n
        // 2) EX1..EXn
        // 3) vše ostatní abecedně podle názvu v prvním sloupci
        if (ar.group !== br.group) return ar.group - br.group;
        if (ar.group === 0 || ar.group === 1) {
          const numberDiff = ar.number - br.number;
          if (numberDiff !== 0) return numberDiff;
        } else {
          const textDiff = ar.text.localeCompare(br.text, 'cs-CZ', { numeric: true, sensitivity: 'base' });
          if (textDiff !== 0) return textDiff;
        }

        const spzDiff = String(a?.data?.spz ?? '').localeCompare(String(b?.data?.spz ?? ''), 'cs-CZ', { numeric: true, sensitivity: 'base' });
        if (spzDiff !== 0) return spzDiff;
        return String(a?.data?.cisloPrepravy ?? '').localeCompare(String(b?.data?.cisloPrepravy ?? ''), 'cs-CZ', { numeric: true, sensitivity: 'base' });
      }

      function groupResults(processed) {
        const groupA = [], groupB = [];
        for (const item of processed) {
          const mapping = findVehicleMapping(item?.data?.spz);
          (mapping?.group === 'inside' ? groupA : groupB).push(item);
        }
        groupA.sort(compareByCarNumberThenName);
        groupB.sort(compareByCarNumberThenName);
        return { groupA, groupB };
      }

      function stripTags(text) { return String(text ?? '').replace(/<[^>]+>/g, ''); }

      function renderGroup(items, title) {
        if (!items.length) return '';
        const maxStops = Math.max(0, ...items.map(x => x.data.vykladky?.length || 0));
        const stopHeaders = Array.from({ length: maxStops }, (_, i) => `<th>${i+1}.</th>`).join('');
        const rows = items.map(item => {
          const d = item.data;
          const stops = Array.from({ length: maxStops }, (_, i) => `<td>${d.vykladky[i]?.misto || '—'}</td>`).join('');
          return `<tr><td>${escapeHtml(d.cisloAuta ?? '—')}</td><td>${escapeHtml(d.spz ?? '—')}</td><td>${escapeHtml(d.cisloPrepravy ?? '—')}</td>${stops}</tr>`;
        }).join('');
        return `<div class="section-title"><h2>${escapeHtml(title)}</h2></div>
          <div class="table-wrap"><table class="result-table"><thead><tr><th>Číslo auta</th><th>SPZ</th><th>Bouda</th>${stopHeaders}</tr></thead><tbody>${rows}</tbody></table></div>`;
      }

      function renderResult(result) {
        const grouped = groupResults(result.processedPdfs);
        resultsEl.innerHTML = renderGroup(grouped.groupA, currentGroupLabel('inside')) + renderGroup(grouped.groupB, currentGroupLabel('outside'));
        if (!result.processedPdfs.length) resultsEl.innerHTML = '<div class="empty">Nebyl zpracován žádný soubor.</div>';
        const warns = result.processedPdfs.flatMap(x => x.warnings || []);
        warningsEl.innerHTML = warns.map(w => `<div class="warning">${escapeHtml(w)}</div>`).join('');
        resultsCard.hidden = false;
        jsonBtn.disabled = xlsxBtn.disabled = printBtn.disabled = result.processedPdfs.length === 0;
      }

      processBtn.addEventListener('click', async () => {
        processBtn.disabled = true;
        clearBtn.disabled = true;
        warningsEl.innerHTML = '';
        setStatus('Zpracovávám PDF…');
        const processedPdfs = [], errors = [];
        for (let i = 0; i < state.files.length; i++) {
          const file = state.files[i];
          setStatus(`Zpracovávám ${i+1}/${state.files.length}: ${file.name}`);
          try { processedPdfs.push(await parsePdf(file)); }
          catch (err) { errors.push({ fileName: file.name, error: err?.message || String(err) }); }
        }
        state.result = {
          processedPdfs,
          errors,
          message: errors.length ? `Zpracováno ${processedPdfs.length} souborů, chyb ${errors.length}.` : 'Všechny soubory úspěšně zpracovány.'
        };
        renderResult(state.result);
        if (errors.length) {
          setStatus(state.result.message, 'error');
          warningsEl.innerHTML += errors.map(e => `<div class="warning"><strong>${escapeHtml(e.fileName)}</strong>: ${escapeHtml(e.error)}</div>`).join('');
        } else setStatus(state.result.message, 'ok');
        processBtn.disabled = state.files.length === 0;
        clearBtn.disabled = false;
      });

      function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      jsonBtn.addEventListener('click', () => {
        if (!state.result) return;
        const grouped = groupResults(state.result.processedPdfs);
        downloadBlob(new Blob([JSON.stringify({ ...state.result, ...grouped }, null, 2)], { type:'application/json;charset=utf-8' }), `prepravy-${new Date().toISOString().slice(0,10)}.json`);
      });

      xlsxBtn.addEventListener('click', () => {
        if (!state.result || !window.XLSX) {
          alert('Excel knihovna není načtena. Zkontrolujte připojení k internetu.');
          return;
        }
        const grouped = groupResults(state.result.processedPdfs);
        const wb = XLSX.utils.book_new();
        const appendGroupSheet = (items, sheetName) => {
          const maxStops = Math.max(0, ...items.map(x => x.data.vykladky?.length || 0));
          const header = ['Číslo auta','SPZ','Bouda', ...Array.from({length:maxStops}, (_,i) => `${i+1}.`)];
          const rows = items.map(item => {
            const d = item.data;
            const stops = (d.vykladky || []).map(x => stripTags(x.misto));
            while (stops.length < maxStops) stops.push('—');
            return [d.cisloAuta ?? '', d.spz ?? '', d.cisloPrepravy ?? '', ...stops];
          });
          const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
          XLSX.utils.book_append_sheet(wb, ws, sheetName);
        };
        appendGroupSheet(grouped.groupA, currentGroupLabel('inside').slice(0,31));
        appendGroupSheet(grouped.groupB, currentGroupLabel('outside').slice(0,31));
        XLSX.writeFile(wb, `vykladky-${new Date().toISOString().slice(0,10)}.xlsx`);
      });

      printBtn.addEventListener('click', () => window.print());
      renderMappingEditor();
      showPage('transport');
      renderFiles();
    })();
