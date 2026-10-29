# Omni-Root — Edge Computer Vision for Wood Quality on Forestry Harvesters

**2nd place (out of 9 finalist teams) at FIAP NEXT 2026 — John Deere Innovation Challenge**, in partnership with Suzano and Eldorado Brasil, two of the world's largest pulp producers.

Omni-Root inspects logs in real time with a camera mounted on the harvester head, runs fully **offline in the field**, and syncs to a central database whenever connectivity returns. A web dashboard turns the data into quality insights, georeferenced maps and exports in industry formats.

| Folder | What it is |
|---|---|
| [`Omni-Root_challenge_2026/`](Omni-Root_challenge_2026) | Field unit (Python): camera, computer vision, GNSS, local SQLite and sync daemon |
| [`omni-root-dashboard/`](omni-root-dashboard) | Dashboard (TypeScript): Express API + React UI over the central PostgreSQL |

> 📹 Demo video: _coming soon_

**Team of 5 · 4th-year Computer Engineering (FIAP).**
**My role — lead developer:** I designed and built a good part of the field system (computer vision pipeline, measurements, log event tracking, offline storage and sync, GNSS integration, CPU optimisation) and a large part of the dashboard.

---

## The problem

Wood quality (basic density, crookedness, bark content, defects) drives costs in both harvesting and pulp production. Today it is measured by **sparse manual sampling**, often weeks before harvest, so the mill has little visibility of what is actually arriving. The challenge: automate and simplify that measurement.

## What we built

```
     HARVESTER (Windows Embedded, no GPU, intermittent 4G)          CENTRAL
 ┌──────────────────────────────────────────────────────┐   ┌─────────────────────┐
 │ camera ─► YOLOv8 (OpenVINO INT8) + classical CV       │   │ PostgreSQL          │
 │            │                                          │   │   ▲                 │
 │            ▼                                          │   │   │ read-only       │
 │   per-log event consolidation ─► SQLite (offline)     │──►│ Dashboard           │
 │   GNSS (NMEA) position per log                        │   │ (Express + React)   │
 │                         sync daemon (idempotent) ─────┘   └─────────────────────┘
 └──────────────────────────────────────────────────────┘
```

**Field unit (Python)**
- **Defect detection** with a YOLOv8 model (8 classes: knots, cracks, resin…), plus classical OpenCV measurement of diameter, length, **residual bark %**, **crookedness** and radial cracks.
- **Runs on CPU**: harvesters have no GPU, so the model is exported to **OpenVINO INT8**. Inference went from **~2.4 s to ~0.5 s per frame**.
- **Non-blocking pipeline**: separate threads for capture, inference and analysis, so the operator's video never freezes.
- **Automatic scale** via an ArUco marker on the head (px→cm without manual calibration), with fallbacks.
- **Robust segmentation**: several strategies (dark background, colour temperature in Lab space, background subtraction) and an "is this actually wood?" gate that rejects hands, keyboards and empty frames.
- **One log = one record**: a frame tracker opens and closes log events and consolidates N frames (median of geometric indicators, defects counted only if they persist across frames). The record is written within ~0.3 s and refined while the log stays in view.
- **GNSS**: auto-detects the serial port of a u-blox receiver, parses NMEA and falls back to Windows Location. Each log stores its coordinates and position source, in line with **EU Deforestation Regulation (EUDR)** geolocation requirements.

**Sync**
- Local-first SQLite in WAL mode. The sync daemon pushes to PostgreSQL **idempotently** (UPSERT by local UUID) and marks a record as synced only after the log, its indicators and its defects have all landed — safe under dropped connections and retries.
- Reference data (wood density per genetic clone) flows the other way, central → field, and is hot-reloaded without restarting.

**Dashboard (TypeScript)**
- Express + React + Recharts + Leaflet; **live updates via Server-Sent Events** (Postgres `LISTEN/NOTIFY`).
- Quality by stand and clone, predicted dry mass and pulp output for the mill (with uncertainty ranges), distributions, a weekday × hour failure heatmap, a "where to act" quality map, live fleet position and tracks, and a live camera feed.
- Exports to **CSV, PDF and StanForD 2010** (the forestry machine data standard).
- Role-based accounts (admin / reader / guest) stored in PostgreSQL: scrypt password hashing, brute-force limiting, and **instant session revocation** (password, role or status changes close open sessions, including live SSE streams).
- Data connection is read-only at the Postgres level; accounts are written through a separate role that can only touch the users table. OAuth social login (Google, Microsoft, GitHub) and accessibility (text-to-speech alerts, colour-blind / dyslexia / high-contrast modes, keyboard shortcuts).

## Engineering decisions worth discussing

- **Density from the company's catalogue, not from a sensor.** Forestry companies already catalogue basic density per genetic clone from lab tests. We read it from the database, tagged with its **provenance** (lab / literature / generic reference), instead of adding hardware to the harvester head. We discussed and validated this approach with John Deere's team.
- **Let the camera do what the head can't.** Harvester heads already measure diameter and length. The camera adds what they miss: bark residue, defects and crookedness.
- **Windows, not Raspberry Pi**, to mirror the real target environment (Windows Embedded).
- **Regression safety**: an equivalence test runs fixed scenes through the whole pipeline and compares numbers, HUD text and pixels against a stored reference, so refactors can't silently change behaviour.

## Results and honest limitations

- Detector (YOLOv8l, 8 classes) on a **public wood-defect dataset**: precision 0.755, recall 0.645, mAP@50 0.718. No eucalyptus-specific labelled dataset was available; the plan for in-domain fine-tuning is documented in the field unit README.
- Validated on a bench prototype (laptop + webcam + GNSS module) with real wood samples, not on a production harvester.

## Data

All inventory data and clone codes in this repository are **synthetic / generic**. Partner data used during the challenge is not published.

## Stack

Python · OpenCV · Ultralytics YOLOv8 · OpenVINO / NNCF · SQLite · PostgreSQL · pyserial (NMEA) · TypeScript · Node/Express · React · Vite · Recharts · Leaflet · SSE · pdfkit · Docker Compose

~14k lines of code, with automated tests that need no camera and no database.
