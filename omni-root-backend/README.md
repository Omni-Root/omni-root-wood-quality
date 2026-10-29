# Omni-Root — Field Unit (Computer Vision + Offline Sync)

Part of **Omni-Root**, the wood-quality inspection system built for the
**FIAP × John Deere Innovation Challenge 2026** (with Suzano and Eldorado
Brasil), track *"Wood Quality"*. The project finished **2nd out of 9 finalist
teams** at FIAP NEXT 2026.

This folder is the software that runs **on the harvester**: a camera looks at
each log, computer vision measures its quality in real time, results are stored
locally (works with no internet) and synced to a central PostgreSQL when a
connection is available. The web interface lives in
[`../omni-root-dashboard`](../omni-root-dashboard).

> **About the data in this repository.** All inventory data and genetic clone
> codes are **synthetic / generic** (`CLONE_A`, `CLONE_B`, …). Real partner
> data was used during the challenge and is not published here.

---

## 1. The idea in one line

Camera on the machine → computer vision evaluates the log in real time → stored
locally (SQLite, works offline) → synced to a central PostgreSQL when there is
network → dashboard shows, analyses and exports.

---

## 2. Architecture

```
        HARVESTER (Windows)                           CENTRAL (office / cloud)
 ┌──────────────────────────────────────┐          ┌────────────────────────────┐
 │ main.py                              │          │                            │
 │  ├─ Camera (OpenCV)     thread 1     │          │   PostgreSQL               │
 │  ├─ YOLO inference      thread 2     │  sync    │   desafio_madeira          │
 │  ├─ Classical CV + DB   thread 3     │ ───────► │        ▲                   │
 │  └─ SQLite (omni_root_local.db)      │ when     │        │ read-only         │
 │                                      │ online   │   Dashboard                │
 │         sync_daemon.py ──────────────┼─────────►│                            │
 └──────────────────────────────────────┘          └────────────────────────────┘
```

**The camera is the only mandatory hardware.** An earlier version had a load
cell and ADC to "measure" density; they were **removed**, because basic density
does not come from a sensor, it comes from the mill's clone catalogue
(section 7). The camera-to-log distance is a **calibrated constant** in
`config.json`, not an ultrasonic sensor. An optional **GNSS receiver** adds the
position of each log.

**Why Windows and not a Raspberry Pi:** real John Deere harvesters run Windows
Embedded. Running the prototype on a Windows laptop is closer to the real
target, and without physical sensors there was no reason to keep the Pi.

**The dashboard** reads the **same** PostgreSQL that `sync_daemon.py` feeds. The
`PG_*` variable names are identical in both `.env` files on purpose.

---

## 3. How to run

### Set up the environment

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

> ⚠️ The model weights (`models/wood_best.pt`, ~84 MB) are **not in Git**
> (`*.pt` is in `.gitignore`). Without them, `main.py` falls back to the generic
> `yolov8n.pt`, which detects no wood defects at all.

### Automatic scale: print the marker (once)

```powershell
python calibrar.py --gerar-marcador
```

Generates `marcador_aruco_5cm.png`. Print it at **100%** (no "fit to page"),
check with a ruler that the black square is 5 cm, and place it next to the log
(on a real machine, fixed to the harvester head). `main.py` detects the marker
in every frame and computes cm/px **on its own**, with no manual clicks and
robust to camera movement. A magenta "scale" square on screen confirms it was
seen.

Without a marker in the frame, the scale falls back to `cm_por_px` from the
config (factory calibration of the mount; `python calibrar.py --regua` gets it
on the prototype) and, last, to the GSD formula with generic optics.

> On a real machine, diameter and length do not even need the camera: the
> harvester head already measures both (knife and feed-roller sensors) and
> exports them in StanForD `.hpr`. The camera adds what the head **cannot** see:
> residual bark, defects and crookedness.

### Export the model for CPU (once per machine)

```powershell
python exportar_modelo.py
```

The harvester has no GPU. The `.pt` model on PyTorch CPU costs ~2.4 s per
frame; the same model in **OpenVINO INT8** (Intel's CPU runtime, quantised with
real captures) costs ~0.5 s. `main.py` automatically loads
`models/wood_best_int8_openvino_model` when it exists. The export (~170 MB) is
not in Git; each machine generates its own.

### Inspect with the camera

```powershell
python main.py --gui
```

Opens a window with live video and detections, and records inspections in
SQLite. Quit with **`q`** in the window or `Ctrl+C`. Without `--gui` it runs
headless (console + database only).

On screen: **coloured** boxes are defects that counted; **grey "(ignorado)"**
boxes are detections that the model made but the filters discarded (outside the
log or in the bark band, below minimum area, not persistent). The white line is
the segmented log contour; the third HUD line tells whether the camera sees the
**cross-section** or the **side** of the log, since indicators change meaning
(section 5). Press **`s`** to save the raw frame to `capturas/` (useful to build
a dataset and to test offline with `--fonte .\capturas`).

#### Segmentation: how the log is separated from the background

The system picks the strategy automatically:

- **Dark background (`fundo_escuro`)** — if the frame border is dark (median
  brightness < 60), segmentation is by **brightness**: wood of any tone versus
  black, independent of wood colour, white balance or bark. Very dark bark that
  "bites" the contour is closed by the convex hull (logs are convex). The ArUco
  card is **excluded** from the mask. Tested with discs, side views with and
  without bark, uneven light, shadows, small/off-centre pieces, empty table,
  hands (rejected) and the card alone (rejected).
- **Reference background (key `b`)** — for light or patterned backgrounds. The
  camera on the head always sees the same background, so the log is *what
  changed*. With the table/grapple **empty**, press `b`: that frame becomes the
  reference and segmentation becomes a difference in Lab space (brightness
  aligned by the border to tolerate webcam auto-exposure). A **thumbnail of the
  captured background** appears in a corner; if the piece shows up in it, the
  background is wrong — remove the piece and press `b` again. If the light or
  camera changes, the HUD shows `SEM TORA (fundo mudou (tecle b))`.
  *Why it exists:* under warm light, webcam auto white balance made light wood
  **the same colour** as a white bed sheet (Lab distance ≈ 4). No colour rule
  separates the two; the reference background does.
- **Light background by colour temperature (`cor`)** — on a webcam, white
  paper/walls come out **cold** (Lab b* 106–112) and wood comes out **warm**
  (b* 132–142, bark 138+). Otsu on the b* channel separates the two classes.
  Skin versus pinkish wood is decided by **redness** (Lab a* ≥ 140 and
  saturation ≤ 130 = skin), not by hue — wood on this camera has the same hue as
  skin.

**"Is this wood?" gate** — segmentation always finds *some* blob in the middle
of the frame (a keyboard or a laptop too). Before anything is measured or
recorded, `validar_tora()` requires: colour-based segmentation, most pixels
**wood-coloured**, **solidity** ≥ 0.8 (an open hand is not convex), low **skin**
fraction and a sane aspect ratio. If any check fails, the HUD shows
`SEM TORA (reason)`, no defect counts and no event opens. All thresholds are
`tora_*` keys in `config.json`.

**Known limitation:** wood-coloured backgrounds (wooden table, brown soil) are
confused with bark, and a hand holding the piece inside the frame merges with
the mask. In demos, rest the piece on a neutral or dark surface.

**Plan B for live demos** — if the webcam fails, the same code runs on a
recorded video or a folder of photos, with nothing mocked:

```powershell
python main.py --gui --fonte .\demo.mp4
python main.py --gui --fonte .\fotos_demo\
```

Other flags: `--config-file <path>`, `--clone <ID>`, `--idade <years>`,
`--gnss <port|file>`.

### Live camera on the dashboard (optional)

With `stream_url` set in `config.json` (e.g.
`http://<dashboard-ip>:3001/api/camera/frame`) and the same `STREAM_TOKEN` in
both `.env` files, `main.py` **pushes** the annotated frame (boxes + HUD) as
JPEG at `stream_fps` (default 4) to the dashboard server. The direction is the
same as the sync (field → central) because in the field the machine sits behind
4G/NAT. Without network the thread just backs off and retries; capture, model
and SQLite never wait for it. On the dashboard, a machine without network shows
**"Sem sinal"** (no signal) with its last frame dimmed. Empty `stream_url`
disables it.

### Fleet: real-time position and track (optional)

With a position source enabled (`gnss_porta`), `main.py` starts the fleet
thread (`omniroot/telemetria.py`), which:

- **Real time** (online): every 2 s sends the current position to the dashboard,
  identified by the machine **serial number** (`maquina_id`), with the same
  `STREAM_TOKEN` as the camera.
- **Track** (online or offline): stores points in `rastro_local` in SQLite;
  `sync_daemon.py` sends them to `rastro_maquinas` in Postgres and the dashboard
  draws the line — the stretch driven offline appears when the network returns.

Default config: **GNSS module first**, the operating system's location service
as backup — the same `config.json` works on **Windows and Linux**:

```json
"gnss_porta": "auto",
"gnss_reserva": "sistema"
```

- `"auto"` finds the serial port that is sending NMEA by itself (`COM5` on
  Windows, `/dev/ttyACM0` on Linux; the name changes when the receiver moves to
  another USB port). Tested with a u-blox 7 USB receiver on both systems. Needs
  `pyserial` (in `requirements.txt`); on Linux the user must be in the serial
  group (`uucp` on Arch, `dialout` on Debian/Ubuntu).
- While the GNSS has a fix, it wins (source "GNSS", with HDOP and satellites);
  without a fix or disconnected, the backup takes over — and every log and track
  point records which source it came from.
- Backup sources (also valid as `gnss_porta` or `--gnss`):

  | Value | Source | Recorded as |
  |---|---|---|
  | `"windows"` | Windows Location (Wi-Fi), via PowerShell | `windows_localizacao` |
  | `"linux"` | [GeoClue](https://gitlab.freedesktop.org/geoclue/geoclue), the Linux location service (Wi-Fi or IP), via its `where-am-i` client | `linux_geoclue` |
  | `"sistema"` | whichever of the two matches the OS it is running on | one of the above |
  | `""` | no backup | — |

  The accuracy radius reported by the OS is stored with each position. A source
  that cannot run on the current OS (e.g. `"windows"` on Linux, or GeoClue not
  installed) is skipped once, with the reason, instead of retrying forever.
- The HUD shows `GNSS: lat, lon | HDOP | sat | /dev/ttyACM0`, or
  `... | +-25000 m | Linux (GeoClue) [reserva: GNSS sem fix]` on the backup.

> **Indoors, a USB GNSS receiver usually never gets a fix**: it can *see*
> satellites but the signal is too weak to decode their data, so not even the
> UTC time comes out. Positions shown indoors come from the backup. The OS
> location is only as good as its Wi-Fi database: Windows uses Microsoft's;
> GeoClue uses public databases with sparse coverage in Brazil, where it often
> falls back to IP geolocation (accuracy of kilometres).

The track only grows while the machine **moves**: one point every 5 s if it
moved 20 m (or the reported accuracy, if larger). A stationary GNSS "wanders"
10–12 m indoors, and that must not become a route.

No receiver? Replay a recorded NMEA track through the same reading code:
`python main.py --gnss tests\trilha_teste_sintetica.nmea`.

### Central PostgreSQL (local, for testing)

```bash
docker compose up -d
```

Reads the same variables from `.env`. On the first start it applies
`Banco de dados/setup_completo.sql` automatically. On a database that is
already running, the same file applies changes without deleting or duplicating
anything (it is idempotent):

```powershell
cmd /c 'docker compose exec -T postgres psql -U postgres -d desafio_madeira < "Banco de dados\setup_completo.sql"'
```

(In Git Bash: the same command without `cmd /c '...'`.) Do not use
`Get-Content ... | docker ...`: PowerShell 5.1 replaces accented characters
with `?` in the pipe and the seed would create duplicate rows.

### Sync field → central

```powershell
python sync_daemon.py
```

### Test the model without a camera

```powershell
python tests\testar_modelo_eucalipto.py --pasta .\fotos_eucalipto --modelo .\models\wood_best.pt
```

Runs the model on a folder of images, saves annotated copies to
`tests/resultados_teste/` and summarises what was missed or detected with low
confidence.

### Simulate the whole operation without a camera

```powershell
python tests\simular_cenario.py --num-toras 15 --pasta .\fotos_eucalipto
```

Runs the **same** `analisar_frame()` (`omniroot/analise.py`) on images from disk
(or synthetic frames if the folder does not exist) and writes to SQLite exactly
like the machine would. Useful to populate Postgres/dashboard with data produced
by the real code (`--sem-banco` only analyses).

### Run the tests (no camera, no database)

```powershell
python tests\testar_equivalencia.py     # the whole pipeline is still identical to the reference
python tests\testar_evento_tora.py      # one log = one record
python tests\testar_luz.py              # low light: meter, enhancement, provenance
python tests\testar_portao_cor.py       # "is this wood?" gate and colour segmentation
python tests\testar_posicao.py          # GNSS/NMEA, Windows/Linux location, SQLite migration
python tests\testar_telemetria.py       # fleet: live position by serial number + offline track
python tests\testar_densidade_clones.py # density per clone read from the synced cache
```

`testar_equivalencia.py --gerar` records a new reference — only when a
behaviour change is **intentional**.

---

## 4. What each piece does

### Code organisation

`main.py` is only the **entry point** (arguments, threads, capture loop). The
logic lives in the `omniroot/` package, one module per responsibility:

| Module | Responsibility |
|---|---|
| `config.py` | `Config` (every parameter, with commented defaults) and `config.json` loading |
| `fontes.py` | Camera, video file or image folder |
| `luz.py` | Light meter and low-light enhancement (frame stacking + colour-preserving gain) |
| `analise.py` | Pipeline for **one** frame, from image to indicators (pure function) |
| `segmentacao.py` | Log mask (dark background, light background, reference background) and the "is this wood?" gate |
| `deteccao.py` | YOLO model (loading, grayscale + CLAHE, inference) and false-positive filters |
| `medidas.py` | px→cm scale (ArUco/calibration/GSD), diameter, bark, crookedness, cracks, volume, mass |
| `inventario.py` | Density per clone (cache synced from Postgres, automatic reload) |
| `classificacao.py` | Defect severity, log health, approved/quarantine/rejected, hash |
| `evento.py` | One log = one record (frame tracker and consolidation) |
| `registro.py` | Writing to local SQLite (log, indicators, defects, position) |
| `banco_local.py` | Schema/migrations shared with `sync_daemon.py` |
| `posicao.py` | Machine position: GNSS (NMEA serial/file) or the OS location service (Windows Location / GeoClue) |
| `telemetria.py` | Fleet: live position on the dashboard (by serial number) and track in SQLite, online or offline |
| `hud.py` / `stream.py` | Operator screen drawing / live camera to the dashboard |

**Behaviour guarantee:** `tests/testar_equivalencia.py` runs fixed scenes
through the whole pipeline and compares against a recorded reference (numbers,
HUD text and pixels) — refactoring cannot change anything silently.

### `main.py` — field inspection

Runs on **three threads** so the image never freezes:

- **Main thread**: only captures and displays video, at camera speed.
- **Model thread**: runs YOLO on the latest frame, as fast as the CPU allows
  (~0.5 s with OpenVINO INT8), and publishes the boxes.
- **Analysis thread**: classical vision (~70 ms — contour, bark, diameter,
  cracks, status) at ~10 fps, reusing the latest model boxes, and writes to
  SQLite.

Inference (heavy on CPU) never blocks the video; at worst, boxes appear a
fraction of a second behind the image. The camera buffer is pinned to 1 frame to
avoid accumulating lag. Optional extra threads push the live camera and the
fleet position to the dashboard.

**Recording: incremental event (`modo_gravacao: "evento"`, default).** A log
appears → after ~0.3 s (4 stable frames) the record is **already written** to
SQLite and the sync sends it within seconds → while the log stays in front of
the camera, the **same record** is updated every `intervalo_captura_seg` with the
accumulated frames → the log leaves, the last consolidation closes the record.
Console: `🟢 aberta` / `↻ atualizada` / `🏁 fechada`. Fast like interval
recording, but **one log = one record**. On the sync side this is an UPSERT by
`uuid_local`, read from a WAL snapshot, marking as synced only what was actually
sent — no race with `main.py`. The Postgres trigger notifies on INSERT **and**
UPDATE.

**How the event decides what is the same log.** The `RastreadorTora` turns the
frame sequence into **events**: it opens when a log appears and stays for
`evento_frames_abrir` analyses, closes when it disappears for
`evento_frames_fechar` (empty grapple) or when the contour "jumps" (another log
came in without a gap), and stores **one** record consolidating all frames:
**median** of geometric indicators (robust to a bad frame), length/crookedness
only from side-view frames, **union** of defects by type+position requiring
presence in `evento_defeito_min_quadros` frames, and health/status recomputed on
the consolidated defects with the rules of section 6. Events shorter than
`evento_frames_minimo` are discarded as noise. On a real machine the natural
trigger would be the head's cutting cycle.

Before reaching the model, every frame goes through
`preprocessar_para_modelo()`: **grayscale + CLAHE**, exactly the same
preprocessing used in training. This matters: sending the raw BGR frame degrades
accuracy **without any error** — the kind of bug that goes unnoticed. OpenCV
measurements (contour, bark percentage) keep using the **original colour**
frame, where colour helps.

### `sync_daemon.py` — synchronisation

Replaced an earlier `sync.go` (Go existed to build without CGO on the Raspberry
Pi; with the Pi out of scope and Python already on the machine, it became one
language less to maintain). It:

- checks whether PostgreSQL answers (a proxy for "is there internet?");
- sends logs with `sync_status = 0` **idempotently** (UPSERT by `uuid_local`),
  so a retry after a network drop never duplicates a record;
- marks a log as synced only **after** the whole log (record + indicators +
  defects) has landed — nothing is ever "half synced";
- sends the machine track (`rastro_local` → `rastro_maquinas`);
- **also downloads** the `clones_densidade` table from Postgres and rewrites the
  local cache `data/clones_densidade.json` (atomically: temp file + replace).
  That file **must not be edited by hand**: the central database is the source
  of truth. `main.py` **reloads the cache by itself** when the file changes
  (`inventario_atual()` checks the mtime once per second) and prints the change
  (`📥 ... CLONE_A: 490.0 -> 512.0 kg/m3`) — update the database and within
  ~1 s the machine uses the new value, without restarting.

### `config.json` — operation parameters

Machine and stand identity, clone, paths, AI thresholds (`conf_threshold`,
`imgsz`), camera index, recording interval and:

| Key | What it does |
|---|---|
| `marcador_aruco_cm` | Side (cm) of the printed ArUco marker. If it appears in the frame, the px→cm scale comes from it automatically. `0` disables. |
| `comprimento_corte_cm` | Bucking length for the stand (default 600 = 6 m). Used when the camera only sees the cross-section. |
| `roi` | `[x, y, w, h]` as a fraction of the frame: only this region goes to the model. `null` = whole frame. (`calibrar.py --roi`) |
| `cm_por_px` | Fixed mount scale, used when there is no marker in the frame (`calibrar.py --regua`). `0` = GSD formula with `distancia_camera_tora_cm`, `distancia_focal_mm` and `largura_sensor_mm`. |
| `filtro_area_minima` | Discards boxes smaller than this fraction of the frame (`0` disables). |
| `filtro_dentro_contorno` | Discards detections whose centre falls outside the log contour. |
| `filtro_persistencia` | Number of consecutive analyses a defect must appear in (`1` disables). |
| `fundo_auto_seg` / `fundo_limiar` / `fundo_salvar_em` | Reference background: seconds of automatic capture at start (0 = key `b` only); minimum Lab distance for "differs from background"; where to save a copy. |
| `tora_exigir_cor`, `tora_solidez_min`, `tora_fracao_pele_max`, `tora_razao_max`, `tora_fracao_madeira_min`, `tora_palida_b_min` | "Is this wood?" gate. Failing it → `SEM TORA`, nothing is recorded. |
| `conf_por_classe` | Per-class confidence threshold overriding `conf_threshold`. Default: `resin` 0.80, `Live_Knot` 0.70, `Marrow` 0.65, `Quartzity` 0.70 — the classes the model (trained on sawn timber) most often confuses with eucalyptus bark and edges. |
| `balanco_branco_borda` | White balance estimated from the frame border. **0 = off (default)**; enable (e.g. 0.10) only if the background comes out tinted. |
| `modo_gravacao` | `evento` (default: one log = one record) or `intervalo` (a record every `intervalo_captura_seg` while a log is present — for comparison only). |
| `evento_frames_abrir` / `_fechar` / `_minimo` | Consecutive analyses with a log to open; without a log to close; minimum not to be noise. |
| `evento_iou_troca` / `evento_frames_troca` | Contour IoU below this for that many frames = another log came in without a gap. |
| `evento_defeito_min_quadros` | A defect must appear in N frames of the event to enter the record. |
| `stream_url`, `stream_fps`, `stream_largura_px`, `stream_jpeg_qualidade` | Live camera on the dashboard. Empty URL disables; token in `STREAM_TOKEN` in `.env`. |
| `gnss_porta` / `gnss_baud` / `gnss_arquivo` / `gnss_validade_s` | Position of each log: NMEA serial port (`"COM5"`), `"auto"` (finds the port sending NMEA), a recorded NMEA track, or the OS location service (`"windows"`, `"linux"` or `"sistema"`). `--gnss` overrides (`--gnss` alone = `"sistema"`). Empty = logs without position. |
| `gnss_reserva` | Second source, used only while the main one has no position (default `"sistema"`: Windows Location or GeoClue, depending on the OS). Each position records its source. |
| `telemetria_url`, `telemetria_intervalo_s` | Fleet: the machine sends its current position every N s (default 2), identified by `maquina_id`. Empty URL = derived from `stream_url`. |
| `rastro_intervalo_s`, `rastro_distancia_min_m`, `rastro_parado_s` | Machine track: one point every N s if it moved at least X m, and one per minute while stopped. Recorded **online or offline**. |
| `luz_realce`, `luz_limiar_boa`, `luz_limiar_critica`, `luz_ruido_baixa`, `luz_ruido_critico`, `luz_ganho_max`, `luz_empilhar_max` | Low light (`omniroot/luz.py`): in low/critical light, stacks frames of the still log and applies colour-preserving gain. Never refuses: in critical light it measures and flags `_luz_critica` (low confidence, excluded from dashboard alerts). Noise is measured over time (difference between consecutive frames), so background texture does not count as noise. |

### Other folders

| Path | What it is |
|---|---|
| `data/clones_densidade.json` | Cache of the density-per-clone table (with documented sources) |
| `data/inventario.json` | **Synthetic** forest inventory (DBH samples and age per clone) used as dendrometric context |
| `Banco de dados/` | `setup_completo.sql` (the only Postgres script: schema + seed + density + trigger, idempotent) and `schema_sqlite.sql` (the machine's local database) |
| `models/` | YOLO weights (`wood_best.pt`, not in Git) and training evaluation images |
| `tests/` | Hardware-free tests (section 3) |
| `OmniRoot_Challenge_Vscode_Desktop.ipynb` | Model training notebook |
| `docker-compose.yml` | Local PostgreSQL to test `sync_daemon.py` and the dashboard |

---

## 5. Quality indicators

| Indicator | How it is obtained |
|---|---|
| Diameter | Camera: **cross-section** → equivalent diameter from the segmented area; **side** → short side of the minimum-area rectangle. px→cm scale: ArUco marker (automatic) > `cm_por_px` > GSD |
| Length | **Side** → measured long side. **Cross-section** → not visible; uses `comprimento_corte_cm` (the fixed bucking length, the same the head uses to cut) and records `metodo = comprimento_tracamento_config` |
| Crookedness | OpenCV — **log axis deflection / length** (%). The axis is the line of midpoints between the edges, slice by slice; 0 = straight. **Side view only**; on a cross-section it records 0 with `metodo = nao_aplicavel_secao` instead of inventing a number |
| Bark percentage | OpenCV — **residual bark**: % of the log surface (inside the contour) darker than 60% of the brightness of exposed wood (90th percentile). *(Earlier versions used a fixed-width ring and then Otsu, which split a clean disc with a shadow into 30–50% "bark", because Otsu always splits into two groups.)* |
| Surface defects | YOLO — knots, cracks, resin, etc. (section 8) |
| Radial crack (cross-section) | OpenCV — morphological black-hat on the core + geometric filter (long, thin, straight, through the centre). Covers what the model does not see: drying cracks on the cut face. Shown as `Crack (cv)` |
| Basic density | **Lookup by genetic clone** (not a sensor, not a formula) — section 7 |
| Usable volume | Geometry (cylinder), discounted by defect severity |
| Estimated dry mass | Usable volume × reference density |

**8 indicators are stored per inspection.** Volume is **measured**, density is
**referenced** — so dry mass inherits the density's uncertainty. It is an
estimate, not a weighing.

---

## 6. Severity-based classification

Not every defect matters equally to the pulp industry, so triage is weighted
instead of "detected something = rejected":

| Level | Classes | Weight |
|---|---|---|
| **Severe** | `Dead_Knot`, `Knot_missing`, `knot_with_crack`, `resin` | 1.0 |
| **Moderate** | `Crack`, `Marrow`, `Quartzity` | 0.5 |
| **Light** | `Live_Knot` | 0.2 |

The names are exactly the trained model's classes.

Rules, in order: a severe defect with confidence ≥ 70% rejects; an extensive
defect (≥ 5% of the area, ignoring light ones) rejects; health below 60% rejects;
a clean log with health ≥ 85% is approved; **only light defects with high health
is also approved**; everything else goes to quarantine (manual review). That last
rule is the practical benefit of weighting: a log with only live knots — the most
common, lowest-impact defect — does not create an unnecessary review queue.

The weights are a **design decision** based on known wood characteristics, not a
published standard. A company's official grading criterion only needs to replace
the sets at the top of `omniroot/classificacao.py`.

---

## 7. Density — why it works this way

Basic density **cannot be measured with a camera**, and it does not need to be.
In the forestry industry, basic density is defined mainly by the **genetic
material (clone)** and companies already keep it catalogued from lab tests. So
the right design is to **read it from the company's database**, not to add a
sensor to the harvester head. This approach was presented to and discussed with
the John Deere team during the challenge mentoring.

How it is implemented:

- The `clones_densidade` table in the central PostgreSQL is the **source of
  truth** (the lab updates it). `sync_daemon.py` downloads it to the machine and
  `main.py` reloads it on the fly.
- Every value carries its **provenance** (`tipo_dado`): `laboratorio` (real lab
  report), `literatura` (published value for that clone) or
  `referencia_generica` (hybrid average while waiting for a lab report). The
  dashboard shows the provenance next to every number.
- Clones without a published value use **490 kg/m³**, the average basic density
  of commercial *Eucalyptus grandis × E. urophylla* hybrids (the most common
  genetic material in Brazilian pulp plantations), from technical and academic
  sources cited in `data/clones_densidade.json`.
- If a clone has no density registered at all, the code uses **500 kg/m³** and
  **warns in the console** — a visible warning is better than hiding missing data
  behind an invented number.

Two approaches were **deliberately discarded**: a formula deriving density from
DBH/age (no scientific basis — DBH is not a good predictor of basic density) and
fixed "mocked" values per clone without a source.

The same pattern applies to **screened pulp yield** (`rendimento_depurado`),
which the dashboard uses to estimate pulp output and specific wood consumption
for the mill.

### What does NOT depend on the model

The challenge defines wood quality by **basic density, crookedness and bark
content**. None of the three comes from YOLO: density is a clone lookup,
crookedness and bark are classical OpenCV — as are diameter, length, volume, dry
mass and radial cracks. The model covers knots and surface defects.

---

## 8. Computer vision model

- **Architecture:** YOLOv8l, trained at 1024 px on the public Kaggle dataset
  `nomihsa965/large-scale-image-dataset-of-wood-surface-defects`, 8 defect
  classes (`Quartzity`, `Live_Knot`, `Marrow`, `resin`, `Dead_Knot`,
  `knot_with_crack`, `Knot_missing`, `Crack`).
- **Validation (source domain, 8 classes):** precision 0.755, recall 0.645,
  mAP@50 0.718, mAP@50-95 0.402 — read from the `wood_best.pt` checkpoint.
  *(`models/training_summary.png` and `validation_samples.png` are from an
  earlier single-class `wood_defect` model and do not reflect these weights.)*
- **Inference:** grayscale + CLAHE (identical to training), OpenVINO INT8 at
  640 px on CPU, per-class thresholds and post-inference filters (inside the
  contour, minimum area, persistence).

### Known limitation: domain gap

The training dataset is **European sawn timber** photographed on an industrial
conveyor — not eucalyptus logs with bark. On logs with bark, the model tends to
confuse normal bark texture with `resin`. A controlled test confirmed this is a
**domain mismatch** (not a bug, number of epochs or initial weights). No public
dataset of annotated eucalyptus log defects was found.

The planned fix is a small in-domain dataset and fine-tuning from the current
checkpoint:

1. **Own photos** (200–500) taken with the same camera (`s` key), varying view,
   bark, cracks, light, angle and distance, pre-annotated by the current model
   and corrected by hand.
2. **Negatives** (5–10%, empty labels): hands, keyboards, tables, empty grapple
   — the documented Ultralytics way of teaching "this is not a defect".
3. **Rehearsal**: a sample of the original dataset mixed in to avoid
   catastrophic forgetting, validating on **both** domains at the end.

The industry scans the **surface/bark** along the log, not the cut face, so new
photos should prioritise bark.

---

## 9. Scope — "wood" vs. "eucalyptus"

The challenge statement only says "wood quality". The pipeline is
**species-agnostic by design**: density is a swappable table and detection can be
generalised. Eucalyptus — the main species for the partner companies — is a
**specialisation through fine-tuning**, not a redesign.

---

## 10. File structure

```
main.py                            # Field: camera + YOLO + indicators + SQLite
calibrar.py                        # ArUco scale marker (and optional ROI/ruler calibration)
exportar_modelo.py                 # Exports the model to OpenVINO INT8 for CPU
sync_daemon.py                     # Local SQLite → central PostgreSQL (idempotent)
config.json                        # Machine/stand/camera/AI parameters
docker-compose.yml                 # Local test PostgreSQL
requirements.txt                   # Dependencies of main.py and sync_daemon.py
omniroot/                          # Pipeline modules (section 4)
data/clones_densidade.json         # Density-per-clone cache (written by the sync)
data/inventario.json               # Synthetic DBH/age/clone inventory
Banco de dados/schema_sqlite.sql   # Local schema (field)
Banco de dados/setup_completo.sql  # Central Postgres: schema + seed + density + trigger (idempotent)
models/wood_best.pt                # YOLO weights (not in Git)
tests/                             # Hardware-free tests and simulators
OmniRoot_Challenge_Vscode_Desktop.ipynb  # Training notebook
```

---

## 11. Status and future work

### Done

- ✅ **One log = one record** — `RastreadorTora` (events open/close with log
  presence; median + union across frames).
- ✅ **Real-time without freezing** — capture, model and analysis on separate
  threads.
- ✅ **5× faster CPU inference** — OpenVINO INT8 at 640 px.
- ✅ **Preprocessing aligned with training** (grayscale + CLAHE).
- ✅ **ROI and inference filters** — what the model detects outside the log is
  shown in grey as "ignored".
- ✅ **Fixed crookedness and bark metrics** — axis deflection and residual bark
  by percentile (section 5), tested with synthetic logs of known curvature.
- ✅ **Robust segmentation** — dark background, reference background, colour
  temperature, plus the "is this wood?" gate.
- ✅ **Automatic ArUco scale** and **`--fonte` video/folder** as a demo fallback.
- ✅ **Low-light handling** with provenance of the measurement conditions.
- ✅ **GNSS position per log** (EUDR-style geolocation) with the OS location
  service as backup (Windows Location or GeoClue on Linux).
- ✅ **Live camera and fleet tracking** on the dashboard, offline-first.
- ✅ **Density per clone with provenance and live reload**.
- ✅ **StanForD export** in the dashboard.

### Future work

1. **Eucalyptus fine-tuning** — collect and annotate in-domain photos
   (section 8).
2. **Validate the StanForD export** against the official XSD — it follows the
   public Skogforsk documentation but has not been formally validated.
3. **Field validation** on a real harvester (vibration, mud, rain, wet bark).
4. **Integration with the head's own measurements** (diameter/length from
   StanForD) to replace camera-based geometry on real machines.

---

## 12. Design decisions

- Windows for the prototype, not Raspberry Pi — mirrors the target environment.
- No force sensor/ADC — density is a lookup; camera-to-log distance is a
  calibrated constant.
- Density from the clone catalogue with documented provenance.
- Computer vision: the open problem is **in-domain data**, not hyperparameters
  or initial weights — confirmed with a controlled test.
- Sync in Python (`sync_daemon.py`), not Go — one language less.
- Dashboard in TypeScript, **read-only** on the central PostgreSQL.
- Species-agnostic pipeline — eucalyptus is a specialisation.
