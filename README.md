# Design and Development of a Database Relationship Analyzer Using Cartesian Products

**Application:** Hospital Vaccination Management System

A full-stack web application built with **Node.js**, **SQLite (`node:sqlite`)**, and **HTML/CSS/JavaScript** that demonstrates Set Theory and Relational Algebra in a hospital vaccination workflow.

## Modules

1. **Home & Dashboard (`index.html`)** — Overview of Set $A$ (Patients), Set $B$ (Vaccines), Relation $R$ (Actual Vaccination Records), and Cartesian Product $A \times B$.
2. **Module 1: Database Input & Set Formation (`module1.html`)** — Add, edit, and delete patients and vaccines in SQLite and automatically form Set $A$ and Set $B$.
3. **Module 2: Cartesian Product & Pair Mapping (`module2.html`)** — Dynamically generate $A \times B$, calculate $|A| \times |B|$, and inspect ordered pairs in a table or matrix grid.
4. **Module 3: Relationship Analysis & Visualization (`module3.html`)** — Record actual vaccinations ($R \subseteq A \times B$), compare $R$ against $A \times B$ to identify vaccinated and unrecorded pairs, view patient-wise coverage charts, export CSV, and print summary reports.

## How to Run

Requires **Node.js 22.5+** (uses built-in `node:sqlite`).

```bash
node server.js
```

Then open **http://localhost:3000** in your browser.
