<p align="center">
  <img src="frontend/public/logo.png" alt="Table2Knowledge Studio" width="600">
</p>

<p align="center">
  <strong>Turn spreadsheets into knowledge graphs — visually.</strong><br>
  A drag-and-drop mapping tool for RDF/OWL ontologies with built-in RDF export.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white" alt="React 18">
  <img src="https://img.shields.io/badge/FastAPI-0.110+-009688?logo=fastapi&logoColor=white" alt="FastAPI">
  <img src="https://img.shields.io/badge/rdflib-6.3+-blue" alt="rdflib">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
</p>

---

## What is Table2Knowledge Studio?

Table2Knowledge Studio is a localhost web application that lets you map tabular data (CSV, TSV, Excel) onto RDF/OWL ontologies through an intuitive visual interface. You build a conceptual graph by dragging ontology classes onto a canvas, connect them with properties, assign table columns to nodes, and export the result as RDF — ready for your triplestore.

It was originally developed for archaeological data management using CIDOC CRM, but works with **any RDF/OWL ontology**.

### Key Features

- **Visual graph builder** — Drag-and-drop ontology classes, draw property connections, build your mapping visually
- **Ontology-aware** — Loads TTL/RDF/OWL files, browses class hierarchies, suggests valid properties with domain/range inference including `owl:inverseOf`
- **Table mapping** — Load CSV/TSV/XLSX files, drag column headers onto graph nodes to assign IDs and labels
- **Dot-One properties** — Visual support for RDF-star annotations (e.g. typing a relationship: `<< SU1 AP11_has_physical_relation_to SU2 >> P2_has_type "above"`)
- **Named Graphs** — Group nodes into named graphs (I4_Proposition_Set) with visual bounding boxes
- **Multi-format RDF export** — TriG, N-Quads, Turtle, RDF/XML, N-Triples, JSON-LD — with proper RDF-star syntax for dot-one properties
- **RDF Pipeline** — Integrated 3-step workflow: Export → Ontotext Refine → GraphDB
- **GraphML export** — yEd-compatible with colors, positions, and edge labels
- **Image export** — Publication-ready PNG (2× resolution) and editable SVG
- **Graph verification** — Checks for missing mappings, ID/label swaps, orphan nodes, widening warnings
- **CIDOC CRM color convention** — Nodes are automatically colored by their CRM superclass

---

## Quick Start

### Prerequisites

- **Python 3.10+** with pip
- **Node.js 18+** with npm

### One-Command Setup (only needed once)

**Windows:**
```bash
setup.bat
```

**Linux / macOS:**
```bash
chmod +x setup.sh
./setup.sh
```

This will:
1. Create a Python virtual environment and install dependencies
2. Install frontend npm packages

### One-Command Start

**Windows:**
```bash
start.bat
```

**Linux / macOS:**
```bash
chmod +x start.sh
./start.sh
```

This will: 
1. Start the backend (FastAPI on port 8000)
2. Wait for the backend to be ready
3. Start the frontend (Vite on port 3000)
4. Open your browser



### Manual Start

```bash
# Backend
cd backend
python -m venv .venv
.venv/Scripts/activate    # Windows
# source .venv/bin/activate  # Linux/Mac
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Then open **http://localhost:3000**.

---

## How It Works

### 1. Load an Ontology

Upload one or more TTL/RDF/OWL ontology files. The backend parses them and builds an inference cache for class hierarchies, property domains/ranges, and `owl:inverseOf` relationships.

### 2. Build Your Conceptual Graph

Use the **Triple Explorer** (left panel) to browse the ontology:
- **① Subject** — Select a class (e.g. `E27_Site`)
- **② Predicate** — Pick a property (e.g. `P89_falls_within`)
- **③ Object** — Choose the range class (e.g. `E53_Place`)

Drag classes onto the canvas to create nodes. Connect them by drawing edges between handles, or let the tool auto-connect when you drop an object while a subject is selected.

### 3. Map Your Table Data

Switch to the **Tables** tab, load your CSV/TSV/XLSX file, and drag column headers onto nodes:
- **Upper drop zone** → Label column (display name)
- **Lower drop zone** → ID column (unique identifier)

### 4. Export

Choose your export format:

| Export | Description |
|---|---|
| **RDF** (TriG, Turtle, etc.) | Direct 1-click RDF export with RDF-star support |
| **RDF Pipeline** | 3-step workflow via Ontotext Refine → GraphDB |
| **GraphML** | yEd-compatible graph with colors and positions |
| **PNG** | Publication-ready image at 2× resolution |
| **SVG** | Scalable vector graphic, editable in Illustrator/Inkscape |

---

## Dot-One Properties (RDF-star)

Table2Knowledge supports annotating relationships — for example, typing a stratigraphic relation:

> *"SU1002 has a physical relation to SU1001, and that relation has type 'below'"*

In RDF-star syntax:
```turtle
<< oeai:SU1002 crmarchaeo:AP11_has_physical_relation_to oeai:SU1001 >>
    crm:P2_has_type oeai:below .
```

To create a dot-one: select an edge in the graph, then drag an ontology class onto it. A visual midpoint appears on the edge showing the annotation.

---

## Named Graphs

Group nodes into named graphs (useful for CIDOC CRM's I4_Proposition_Set or any named graph context):

1. Select nodes in the graph (Shift+Click or drag a selection box)
2. Open the **Graphs** panel
3. Enter a label and click **Selection → Graph**

Click on a named graph entry to highlight its nodes with a colored bounding box and zoom to fit.

Named graphs are exported in **TriG** and **N-Quads** formats.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 5, ReactFlow 11, Lucide Icons, html-to-image |
| Backend | Python, FastAPI, rdflib, pandas, openpyxl |
| Ontology Support | RDF/OWL with RDFS inference, `owl:inverseOf`, `owl:unionOf` |
| Export | TriG, N-Quads, Turtle, RDF/XML, N-Triples, JSON-LD, GraphML, PNG, SVG |
| Optional | Ontotext Refine + GraphDB (for the RDF Pipeline workflow) |

---

## Project Structure

```
table2knowledge/
├── backend/
│   ├── main.py              # FastAPI server + rdflib inference engine
│   └── requirements.txt
├── frontend/
│   ├── public/logo.png      # Application logo
│   ├── src/
│   │   ├── App.jsx           # Main application component
│   │   ├── components/       # UI components (modals, panels, nodes)
│   │   ├── utils/            # Export logic, API calls, color scheme
│   │   └── index.css         # Light theme with IBM Plex typography
│   └── package.json
├── start.bat                 # Windows launcher
├── start.sh                  # Linux/Mac launcher
└── README.md
```

---

## Configuration

### Prefix Manager

All namespace prefixes must be defined for correct RDF URI expansion. The Prefix Manager:
- Auto-detects prefixes from loaded ontologies
- Scans table data for prefixed values and warns about undefined prefixes
- Manages the **Data ID Prefix** (prepended to all row IDs, e.g. `oeai:`)

### Widening

Enable **Widening** in the toolbar to also see properties defined on subclasses of your selected subject. Useful when working with broad classes like `E18_Physical_Thing`. Widened properties are highlighted in amber.

---

## CIDOC CRM Support

While Table2Knowledge works with any RDF/OWL ontology, it has built-in support for CIDOC CRM:

- **Color coding** — Nodes are colored by their CRM anchor class (e.g. brown for Physical Things, blue for Temporal Entities, pink for Actors)
- **Label preference** — German `rdfs:label` translations are preferred, with fallback to English
- **CRM extensions** — Supports CRMarchaeo, CRMsci, LRMoo and other CIDOC extensions
- **Auto-prefixing** — CRM property patterns (P1_, AP3_, SP5_ etc.) are auto-resolved to `crm:` prefix

---

## Saving & Loading Projects

Projects are saved as JSON files containing:
- All nodes with positions, colors, mapped columns, and table data
- All edges with properties, join keys, and dot-one annotations
- Named graph definitions
- Prefix map and configuration

This means you can save your work, close the application, and resume later — even without the original table files loaded.

---

## License

GPL 3.0

---

## Acknowledgments and Credits

**RDF-Pipeline** incl. all Scripts for Ontotext Refine and GraphDB: *Gerald Hiebel, University of Innsbruck, Institute of Archaeology and Digital Science Centre* Gerald.Hiebel@uibk.ac.at; https://www.uibk.ac.at/archaeologien/institut/mitarbeiter/gerald-hiebel/gerald_hiebel.html; OrcID: https://orcid.org/0000-0002-3799-8391 

**Ontotext Refine Client:** <https://github.com/Ontotext-AD/ontorefine-client> — *Apache-2.0 license*

Developed for digital archaeology and cultural heritage data management. The CIDOC CRM color scheme follows established conventions in the CRM community.
