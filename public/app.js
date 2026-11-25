const LOCAL_DB_KEY = 'medset_hospital_db_v1';
let useLocalStore = window.location.hostname.endsWith('.vercel.app');

function readLocalDb() {
  try {
    const raw = localStorage.getItem(LOCAL_DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        nextPatientId: parsed.nextPatientId || 1,
        nextVaccineId: parsed.nextVaccineId || 1,
        nextRecordId: parsed.nextRecordId || 1,
        patients: Array.isArray(parsed.patients) ? parsed.patients : [],
        vaccines: Array.isArray(parsed.vaccines) ? parsed.vaccines : [],
        records: Array.isArray(parsed.records) ? parsed.records : []
      };
    }
  } catch {
    // ignore corrupted storage
  }
  return {
    nextPatientId: 1,
    nextVaccineId: 1,
    nextRecordId: 1,
    patients: [],
    vaccines: [],
    records: []
  };
}

function writeLocalDb(state) {
  localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(state));
}

function buildLocalAnalysis(state) {
  const patients = [...state.patients].sort((a, b) => a.patient_code.localeCompare(b.patient_code));
  const vaccines = [...state.vaccines].sort((a, b) => a.vaccine_code.localeCompare(b.vaccine_code));
  const pById = Object.fromEntries(patients.map((p) => [p.id, p]));
  const vById = Object.fromEntries(vaccines.map((v) => [v.id, v]));

  const records = state.records
    .filter((r) => pById[r.patient_id] && vById[r.vaccine_id])
    .map((r) => ({
      ...r,
      patient_code: pById[r.patient_id].patient_code,
      full_name: pById[r.patient_id].full_name,
      vaccine_code: vById[r.vaccine_id].vaccine_code,
      vaccine_name: vById[r.vaccine_id].vaccine_name
    }))
    .sort((a, b) => (b.vaccinated_date || '').localeCompare(a.vaccinated_date || '') || b.id - a.id);

  const recordMap = new Map();
  for (const r of records) {
    recordMap.set(`${r.patient_id}:${r.vaccine_id}`, r);
  }

  const comparisons = [];
  let vaccinatedCount = 0;
  let pairIndex = 1;

  for (const p of patients) {
    for (const v of vaccines) {
      const rec = recordMap.get(`${p.id}:${v.id}`) || null;
      const isVaccinated = Boolean(rec);
      if (isVaccinated) vaccinatedCount += 1;
      comparisons.push({
        pairIndex: pairIndex++,
        patientId: p.id,
        patientCode: p.patient_code,
        patientName: p.full_name,
        vaccineId: v.id,
        vaccineCode: v.vaccine_code,
        vaccineName: v.vaccine_name,
        dosesRequired: v.doses_required,
        orderedPair: `(${p.patient_code}, ${v.vaccine_code})`,
        status: isVaccinated ? 'Vaccinated' : 'Unrecorded',
        record: rec
      });
    }
  }

  const totalCombinations = patients.length * vaccines.length;
  const unrecordedCount = totalCombinations - vaccinatedCount;
  const coveragePercent = totalCombinations > 0
    ? Number(((vaccinatedCount / totalCombinations) * 100).toFixed(1))
    : 0;

  const patientSummary = patients.map((p) => {
    const vaccinatedList = [];
    const unrecordedList = [];
    for (const v of vaccines) {
      const rec = recordMap.get(`${p.id}:${v.id}`);
      if (rec) {
        vaccinatedList.push({
          vaccineId: v.id,
          vaccineCode: v.vaccine_code,
          vaccineName: v.vaccine_name,
          doseNumber: rec.dose_number,
          vaccinatedDate: rec.vaccinated_date,
          administeredBy: rec.administered_by
        });
      } else {
        unrecordedList.push({
          vaccineId: v.id,
          vaccineCode: v.vaccine_code,
          vaccineName: v.vaccine_name
        });
      }
    }
    const totalVaccines = vaccines.length;
    const pct = totalVaccines > 0 ? Number(((vaccinatedList.length / totalVaccines) * 100).toFixed(1)) : 0;
    return {
      patientId: p.id,
      patientCode: p.patient_code,
      fullName: p.full_name,
      age: p.age,
      gender: p.gender,
      bloodGroup: p.blood_group,
      vaccinatedCount: vaccinatedList.length,
      unrecordedCount: unrecordedList.length,
      totalVaccines,
      coveragePercent: pct,
      vaccinatedList,
      unrecordedList
    };
  });

  const vaccineSummary = vaccines.map((v) => {
    let count = 0;
    for (const p of patients) {
      if (recordMap.has(`${p.id}:${v.id}`)) count += 1;
    }
    const pct = patients.length > 0 ? Number(((count / patients.length) * 100).toFixed(1)) : 0;
    return {
      vaccineId: v.id,
      vaccineCode: v.vaccine_code,
      vaccineName: v.vaccine_name,
      targetDisease: v.target_disease,
      dosesRequired: v.doses_required,
      vaccinatedPatients: count,
      unrecordedPatients: patients.length - count,
      coveragePercent: pct
    };
  });

  return {
    summary: {
      cardinalityA: patients.length,
      cardinalityB: vaccines.length,
      totalCombinations,
      vaccinatedCount,
      unrecordedCount,
      coveragePercent
    },
    comparisons,
    patientSummary,
    vaccineSummary,
    records
  };
}

function localApi(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body
    ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body)
    : {};
  const state = readLocalDb();

  if (method === 'GET' && url === '/api/dashboard') {
    const analysis = buildLocalAnalysis(state);
    return { ...analysis.summary, recentRecords: analysis.records.slice(0, 5) };
  }

  if (method === 'GET' && url === '/api/patients') {
    return [...state.patients].sort((a, b) => a.patient_code.localeCompare(b.patient_code));
  }

  if (method === 'POST' && url === '/api/patients') {
    const code = String(body.patient_code || '').trim().toUpperCase();
    const name = String(body.full_name || '').trim();
    if (!code || !name || !body.age || !body.gender) {
      throw new Error('Patient code, full name, age, and gender are required.');
    }
    if (state.patients.some((p) => p.patient_code === code)) {
      throw new Error('Duplicate record: this patient code already exists.');
    }
    const created = {
      id: state.nextPatientId++,
      patient_code: code,
      full_name: name,
      age: Number(body.age),
      gender: String(body.gender).trim(),
      blood_group: String(body.blood_group || '').trim(),
      phone: String(body.phone || '').trim()
    };
    state.patients.push(created);
    writeLocalDb(state);
    return created;
  }

  const pMatch = url.match(/^\/api\/patients\/(\d+)$/);
  if (pMatch) {
    const id = Number(pMatch[1]);
    const idx = state.patients.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error('Patient not found.');
    if (method === 'PUT') {
      const code = String(body.patient_code || '').trim().toUpperCase();
      const name = String(body.full_name || '').trim();
      if (!code || !name || !body.age || !body.gender) {
        throw new Error('Patient code, full name, age, and gender are required.');
      }
      if (state.patients.some((p) => p.patient_code === code && p.id !== id)) {
        throw new Error('Duplicate record: this patient code already exists.');
      }
      state.patients[idx] = {
        ...state.patients[idx],
        patient_code: code,
        full_name: name,
        age: Number(body.age),
        gender: String(body.gender).trim(),
        blood_group: String(body.blood_group || '').trim(),
        phone: String(body.phone || '').trim()
      };
      writeLocalDb(state);
      return state.patients[idx];
    }
    if (method === 'DELETE') {
      state.patients.splice(idx, 1);
      state.records = state.records.filter((r) => r.patient_id !== id);
      writeLocalDb(state);
      return { deleted: true };
    }
  }

  if (method === 'GET' && url === '/api/vaccines') {
    return [...state.vaccines].sort((a, b) => a.vaccine_code.localeCompare(b.vaccine_code));
  }

  if (method === 'POST' && url === '/api/vaccines') {
    const code = String(body.vaccine_code || '').trim().toUpperCase();
    const name = String(body.vaccine_name || '').trim();
    if (!code || !name) {
      throw new Error('Vaccine code and vaccine name are required.');
    }
    if (state.vaccines.some((v) => v.vaccine_code === code)) {
      throw new Error('Duplicate record: this vaccine code already exists.');
    }
    const created = {
      id: state.nextVaccineId++,
      vaccine_code: code,
      vaccine_name: name,
      manufacturer: String(body.manufacturer || '').trim(),
      doses_required: Number(body.doses_required) || 1,
      target_disease: String(body.target_disease || '').trim()
    };
    state.vaccines.push(created);
    writeLocalDb(state);
    return created;
  }

  const vMatch = url.match(/^\/api\/vaccines\/(\d+)$/);
  if (vMatch) {
    const id = Number(vMatch[1]);
    const idx = state.vaccines.findIndex((v) => v.id === id);
    if (idx === -1) throw new Error('Vaccine not found.');
    if (method === 'PUT') {
      const code = String(body.vaccine_code || '').trim().toUpperCase();
      const name = String(body.vaccine_name || '').trim();
      if (!code || !name) {
        throw new Error('Vaccine code and vaccine name are required.');
      }
      if (state.vaccines.some((v) => v.vaccine_code === code && v.id !== id)) {
        throw new Error('Duplicate record: this vaccine code already exists.');
      }
      state.vaccines[idx] = {
        ...state.vaccines[idx],
        vaccine_code: code,
        vaccine_name: name,
        manufacturer: String(body.manufacturer || '').trim(),
        doses_required: Number(body.doses_required) || 1,
        target_disease: String(body.target_disease || '').trim()
      };
      writeLocalDb(state);
      return state.vaccines[idx];
    }
    if (method === 'DELETE') {
      state.vaccines.splice(idx, 1);
      state.records = state.records.filter((r) => r.vaccine_id !== id);
      writeLocalDb(state);
      return { deleted: true };
    }
  }

  if (method === 'GET' && url === '/api/cartesian-product') {
    const setA = [...state.patients].sort((a, b) => a.patient_code.localeCompare(b.patient_code));
    const setB = [...state.vaccines].sort((a, b) => a.vaccine_code.localeCompare(b.vaccine_code));
    const pairs = [];
    let idx = 1;
    for (const p of setA) {
      for (const v of setB) {
        pairs.push({
          pairIndex: idx++,
          patient_id: p.id,
          patient_code: p.patient_code,
          full_name: p.full_name,
          vaccine_id: v.id,
          vaccine_code: v.vaccine_code,
          vaccine_name: v.vaccine_name,
          target_disease: v.target_disease,
          orderedPair: `(${p.patient_code}, ${v.vaccine_code})`,
          labelPair: `(${p.full_name}, ${v.vaccine_name})`
        });
      }
    }
    return {
      setA,
      setB,
      cardinalityA: setA.length,
      cardinalityB: setB.length,
      totalCombinations: setA.length * setB.length,
      pairs
    };
  }

  if (method === 'GET' && url === '/api/records') {
    return buildLocalAnalysis(state).records;
  }

  if (method === 'POST' && url === '/api/records') {
    const pid = Number(body.patient_id);
    const vid = Number(body.vaccine_id);
    if (!pid || !vid || !body.vaccinated_date) {
      throw new Error('Patient, vaccine, and vaccination date are required.');
    }
    if (state.records.some((r) => r.patient_id === pid && r.vaccine_id === vid)) {
      throw new Error('Duplicate record: this patient-vaccine pair is already recorded.');
    }
    const created = {
      id: state.nextRecordId++,
      patient_id: pid,
      vaccine_id: vid,
      dose_number: Number(body.dose_number) || 1,
      vaccinated_date: body.vaccinated_date,
      administered_by: String(body.administered_by || '').trim(),
      notes: String(body.notes || '').trim()
    };
    state.records.push(created);
    writeLocalDb(state);
    return created;
  }

  const rMatch = url.match(/^\/api\/records\/(\d+)$/);
  if (rMatch && method === 'DELETE') {
    const id = Number(rMatch[1]);
    const before = state.records.length;
    state.records = state.records.filter((r) => r.id !== id);
    if (state.records.length === before) throw new Error('Vaccination record not found.');
    writeLocalDb(state);
    return { deleted: true };
  }

  if (method === 'GET' && url === '/api/analysis') {
    return buildLocalAnalysis(state);
  }

  if (method === 'POST' && url === '/api/clear-data') {
    writeLocalDb({
      nextPatientId: 1,
      nextVaccineId: 1,
      nextRecordId: 1,
      patients: [],
      vaccines: [],
      records: []
    });
    return { cleared: true };
  }

  throw new Error('API route not found.');
}

async function api(url, options = {}) {
  if (useLocalStore) {
    return localApi(url, options);
  }
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options
  };
  if (config.body && typeof config.body !== 'string') {
    config.body = JSON.stringify(config.body);
  }
  const res = await fetch(url, config);
  if (res.status === 404) {
    useLocalStore = true;
    return localApi(url, options);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function showToast(message, isError = false) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initSidebar(activePage) {
  const links = document.querySelectorAll('.nav-link');
  links.forEach((link) => {
    if (link.dataset.page === activePage) {
      link.classList.add('active');
    }
  });

  const menuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.querySelector('.sidebar');
  if (menuBtn && sidebar) {
    menuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }
}
