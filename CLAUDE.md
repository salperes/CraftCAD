# CraftCAD

Web-based 2D CAD with AutoCAD-style commands, DXF read/write and DWG read/write (via a local converter).

**Mevcut Versiyon:** 0.3.1 (Rev. ID 9)

## Versioning and changelog

Follows `../../MSS/mds/versioning.md`:

- Version format `MAJOR.MINOR.Version`; the third part is a counter that increases by 1 on every code change and restarts at 0 on a MINOR bump.
- Every code change: run tests → prepend an entry to `changelog.md` (Rev. ID +1, Version, Rev. Date `DD.MM.YYYY`, Rev. Time local `HH:MM:SS`, Rev. Prompt, Rev. Report) → bump `"version"` in `package.json` → update the "Mevcut Versiyon" line above → commit. Push only when the user asks.
- `changelog.md` keeps at most 11 entries; beyond that the oldest 10 move to `archives/changelog_{START}-{END}.md` (newest first). Existing entries are never edited.
- The version is shown in the title bar and in About CraftCAD (application menu, `ABOUT` command); `/api/health` returns it.

## Commands

```bash
npm run dev      # dev server + DWG conversion API
npm run build    # typecheck + production build to dist/
npm run serve    # dist/ + conversion API on http://localhost:8080
npm test         # Node unit + DXF round-trip tests
```

UI checks: `test/ui-shot.mjs`, `test/perf.mjs`, `test/otrack.mjs`, `test/dwgsave.mjs` drive the running dev server with Playwright (headless Chromium). `test/acad-check.ps1` validates DXF/DWG output with AutoCAD Core Console when installed.

## Layout

- `src/core/` geometry, entities, drawing database, modify algorithms, MTEXT parsing
- `src/io/` DXF reader/writer, DWG import (`dwg.ts`), conversion API client (`convert.ts`)
- `src/app/` editor (prompts, snapping, OTRACK, grips), commands, preferences
- `src/view/` Canvas 2D renderer and WebGL layer
- `src/ui/` ribbon, command line, dialogs, palettes, contextual tabs
- `server/` local DWG conversion (ODA File Converter / AutoCAD Core Console) and production server

`test/fixtures/` holds local sample drawings (Autodesk samples, user files) and is git-ignored.
