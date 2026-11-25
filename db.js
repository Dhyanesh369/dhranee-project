const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, 'hospital_vaccination.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_code TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    age INTEGER NOT NULL,
    gender TEXT NOT NULL,
    blood_group TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS vaccines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vaccine_code TEXT NOT NULL UNIQUE,
    vaccine_name TEXT NOT NULL,
    manufacturer TEXT DEFAULT '',
    doses_required INTEGER NOT NULL DEFAULT 1,
    target_disease TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS vaccination_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    vaccine_id INTEGER NOT NULL,
    dose_number INTEGER NOT NULL DEFAULT 1,
    vaccinated_date TEXT NOT NULL,
    administered_by TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(patient_id, vaccine_id),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (vaccine_id) REFERENCES vaccines(id) ON DELETE CASCADE
  );
`);

function clearAllData() {
  db.exec(`
    DELETE FROM vaccination_records;
    DELETE FROM patients;
    DELETE FROM vaccines;
    DELETE FROM sqlite_sequence WHERE name IN ('patients', 'vaccines', 'vaccination_records');
  `);
}

module.exports = { db, clearAllData };
