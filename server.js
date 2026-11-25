const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { db, clearAllData } = require('./db');

const PORT = process.env.PORT || 4000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, pathname) {
  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }
  let safePath = pathname === '/' ? '/index.html' : pathname;
  if (!path.extname(safePath)) {
    safePath = `${safePath}.html`;
  }
  const resolved = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(resolved, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function getAnalysisData() {
  const patients = db.prepare('SELECT * FROM patients ORDER BY patient_code ASC').all();
  const vaccines = db.prepare('SELECT * FROM vaccines ORDER BY vaccine_code ASC').all();
  const records = db.prepare(`
    SELECT vr.*, p.patient_code, p.full_name, v.vaccine_code, v.vaccine_name
    FROM vaccination_records vr
    JOIN patients p ON p.id = vr.patient_id
    JOIN vaccines v ON v.id = vr.vaccine_id
    ORDER BY vr.vaccinated_date DESC, vr.id DESC
  `).all();

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method;

  if (!pathname.startsWith('/api/')) {
    return serveStatic(res, pathname);
  }

  try {
    // Dashboard Summary
    if (method === 'GET' && pathname === '/api/dashboard') {
      const analysis = getAnalysisData();
      return sendJson(res, 200, {
        ...analysis.summary,
        recentRecords: analysis.records.slice(0, 5)
      });
    }

    // Module 1: Patients (Set A)
    if (method === 'GET' && pathname === '/api/patients') {
      const patients = db.prepare('SELECT * FROM patients ORDER BY patient_code ASC').all();
      return sendJson(res, 200, patients);
    }

    if (method === 'POST' && pathname === '/api/patients') {
      const body = await readBody(req);
      const { patient_code, full_name, age, gender, blood_group = '', phone = '' } = body;
      if (!patient_code || !full_name || !age || !gender) {
        return sendJson(res, 400, { error: 'Patient code, full name, age, and gender are required.' });
      }
      const result = db.prepare(`
        INSERT INTO patients (patient_code, full_name, age, gender, blood_group, phone)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(patient_code.trim().toUpperCase(), full_name.trim(), Number(age), gender.trim(), blood_group.trim(), phone.trim());
      const created = db.prepare('SELECT * FROM patients WHERE id = ?').get(result.lastInsertRowid);
      return sendJson(res, 201, created);
    }

    const patientMatch = pathname.match(/^\/api\/patients\/(\d+)$/);
    if (patientMatch) {
      const id = Number(patientMatch[1]);
      if (method === 'PUT') {
        const body = await readBody(req);
        const { patient_code, full_name, age, gender, blood_group = '', phone = '' } = body;
        if (!patient_code || !full_name || !age || !gender) {
          return sendJson(res, 400, { error: 'Patient code, full name, age, and gender are required.' });
        }
        const info = db.prepare(`
          UPDATE patients
          SET patient_code = ?, full_name = ?, age = ?, gender = ?, blood_group = ?, phone = ?
          WHERE id = ?
        `).run(patient_code.trim().toUpperCase(), full_name.trim(), Number(age), gender.trim(), blood_group.trim(), phone.trim(), id);
        if (info.changes === 0) return sendJson(res, 404, { error: 'Patient not found.' });
        const updated = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
        return sendJson(res, 200, updated);
      }
      if (method === 'DELETE') {
        const info = db.prepare('DELETE FROM patients WHERE id = ?').run(id);
        if (info.changes === 0) return sendJson(res, 404, { error: 'Patient not found.' });
        return sendJson(res, 200, { deleted: true });
      }
    }

    // Module 1: Vaccines (Set B)
    if (method === 'GET' && pathname === '/api/vaccines') {
      const vaccines = db.prepare('SELECT * FROM vaccines ORDER BY vaccine_code ASC').all();
      return sendJson(res, 200, vaccines);
    }

    if (method === 'POST' && pathname === '/api/vaccines') {
      const body = await readBody(req);
      const { vaccine_code, vaccine_name, manufacturer = '', doses_required = 1, target_disease = '' } = body;
      if (!vaccine_code || !vaccine_name) {
        return sendJson(res, 400, { error: 'Vaccine code and vaccine name are required.' });
      }
      const result = db.prepare(`
        INSERT INTO vaccines (vaccine_code, vaccine_name, manufacturer, doses_required, target_disease)
        VALUES (?, ?, ?, ?, ?)
      `).run(vaccine_code.trim().toUpperCase(), vaccine_name.trim(), manufacturer.trim(), Number(doses_required) || 1, target_disease.trim());
      const created = db.prepare('SELECT * FROM vaccines WHERE id = ?').get(result.lastInsertRowid);
      return sendJson(res, 201, created);
    }

    const vaccineMatch = pathname.match(/^\/api\/vaccines\/(\d+)$/);
    if (vaccineMatch) {
      const id = Number(vaccineMatch[1]);
      if (method === 'PUT') {
        const body = await readBody(req);
        const { vaccine_code, vaccine_name, manufacturer = '', doses_required = 1, target_disease = '' } = body;
        if (!vaccine_code || !vaccine_name) {
          return sendJson(res, 400, { error: 'Vaccine code and vaccine name are required.' });
        }
        const info = db.prepare(`
          UPDATE vaccines
          SET vaccine_code = ?, vaccine_name = ?, manufacturer = ?, doses_required = ?, target_disease = ?
          WHERE id = ?
        `).run(vaccine_code.trim().toUpperCase(), vaccine_name.trim(), manufacturer.trim(), Number(doses_required) || 1, target_disease.trim(), id);
        if (info.changes === 0) return sendJson(res, 404, { error: 'Vaccine not found.' });
        const updated = db.prepare('SELECT * FROM vaccines WHERE id = ?').get(id);
        return sendJson(res, 200, updated);
      }
      if (method === 'DELETE') {
        const info = db.prepare('DELETE FROM vaccines WHERE id = ?').run(id);
        if (info.changes === 0) return sendJson(res, 404, { error: 'Vaccine not found.' });
        return sendJson(res, 200, { deleted: true });
      }
    }

    // Module 2: Cartesian Product A × B
    if (method === 'GET' && pathname === '/api/cartesian-product') {
      const setA = db.prepare('SELECT id, patient_code, full_name, age, gender FROM patients ORDER BY patient_code ASC').all();
      const setB = db.prepare('SELECT id, vaccine_code, vaccine_name, target_disease, doses_required FROM vaccines ORDER BY vaccine_code ASC').all();
      const rows = db.prepare(`
        SELECT
          p.id AS patient_id,
          p.patient_code,
          p.full_name,
          v.id AS vaccine_id,
          v.vaccine_code,
          v.vaccine_name,
          v.target_disease
        FROM patients p
        CROSS JOIN vaccines v
        ORDER BY p.patient_code ASC, v.vaccine_code ASC
      `).all();

      const pairs = rows.map((row, idx) => ({
        pairIndex: idx + 1,
        ...row,
        orderedPair: `(${row.patient_code}, ${row.vaccine_code})`,
        labelPair: `(${row.full_name}, ${row.vaccine_name})`
      }));

      return sendJson(res, 200, {
        setA,
        setB,
        cardinalityA: setA.length,
        cardinalityB: setB.length,
        totalCombinations: setA.length * setB.length,
        pairs
      });
    }

    // Module 3: Actual Vaccination Records (Relation R) & Analysis
    if (method === 'GET' && pathname === '/api/records') {
      const records = db.prepare(`
        SELECT vr.*, p.patient_code, p.full_name, v.vaccine_code, v.vaccine_name
        FROM vaccination_records vr
        JOIN patients p ON p.id = vr.patient_id
        JOIN vaccines v ON v.id = vr.vaccine_id
        ORDER BY vr.vaccinated_date DESC, vr.id DESC
      `).all();
      return sendJson(res, 200, records);
    }

    if (method === 'POST' && pathname === '/api/records') {
      const body = await readBody(req);
      const { patient_id, vaccine_id, dose_number = 1, vaccinated_date, administered_by = '', notes = '' } = body;
      if (!patient_id || !vaccine_id || !vaccinated_date) {
        return sendJson(res, 400, { error: 'Patient, vaccine, and vaccination date are required.' });
      }
      const result = db.prepare(`
        INSERT INTO vaccination_records (patient_id, vaccine_id, dose_number, vaccinated_date, administered_by, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(Number(patient_id), Number(vaccine_id), Number(dose_number) || 1, vaccinated_date, administered_by.trim(), notes.trim());
      const created = db.prepare(`
        SELECT vr.*, p.patient_code, p.full_name, v.vaccine_code, v.vaccine_name
        FROM vaccination_records vr
        JOIN patients p ON p.id = vr.patient_id
        JOIN vaccines v ON v.id = vr.vaccine_id
        WHERE vr.id = ?
      `).get(result.lastInsertRowid);
      return sendJson(res, 201, created);
    }

    const recordMatch = pathname.match(/^\/api\/records\/(\d+)$/);
    if (recordMatch && method === 'DELETE') {
      const id = Number(recordMatch[1]);
      const info = db.prepare('DELETE FROM vaccination_records WHERE id = ?').run(id);
      if (info.changes === 0) return sendJson(res, 404, { error: 'Vaccination record not found.' });
      return sendJson(res, 200, { deleted: true });
    }

    if (method === 'GET' && pathname === '/api/analysis') {
      return sendJson(res, 200, getAnalysisData());
    }

    if (method === 'POST' && pathname === '/api/clear-data') {
      clearAllData();
      return sendJson(res, 200, { cleared: true });
    }

    return sendJson(res, 404, { error: 'API route not found.' });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return sendJson(res, 409, { error: 'Duplicate record: this code or patient-vaccine pair already exists.' });
    }
    return sendJson(res, 500, { error: err.message || 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Hospital Vaccination Analyzer running at http://localhost:${PORT}`);
});

