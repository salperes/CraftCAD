// Local DWG/DXF conversion through ODA File Converter (preferred) or AutoCAD Core Console.
// Used by the Vite dev/preview middleware and by server/serve.mjs.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/** DWG/DXF versions offered in the UI (ODA names); AutoCAD Core Console uses the year. */
export const VERSIONS = ['ACAD2018', 'ACAD2013', 'ACAD2010', 'ACAD2007', 'ACAD2004', 'ACAD2000'];

function newestIn(dir, match, exe) {
  if (!existsSync(dir)) return null;
  const hits = readdirSync(dir).filter((d) => match.test(d)).sort().reverse();
  for (const d of hits) {
    const p = join(dir, d, exe);
    if (existsSync(p)) return p;
  }
  return null;
}

function findOda() {
  const env = process.env.ODA_FILE_CONVERTER;
  if (env && existsSync(env)) return env;
  if (process.platform === 'win32') {
    for (const root of ['C:\\Program Files\\ODA', 'C:\\Program Files (x86)\\ODA']) {
      const p = newestIn(root, /^ODAFileConverter/i, 'ODAFileConverter.exe');
      if (p) return p;
    }
    return null;
  }
  for (const p of ['/usr/bin/ODAFileConverter', '/usr/local/bin/ODAFileConverter', '/opt/ODAFileConverter/ODAFileConverter', '/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter']) {
    if (existsSync(p)) return p;
  }
  return null;
}

function findAccore() {
  const env = process.env.ACCORECONSOLE;
  if (env && existsSync(env)) return env;
  if (process.platform !== 'win32') return null;
  return newestIn('C:\\Program Files\\Autodesk', /^AutoCAD 20\d\d$/i, 'accoreconsole.exe');
}

let cached = null;

/** Detects available converters (cached; pass refresh=true to rescan). */
export function converterInfo(refresh = false) {
  if (cached && !refresh) return cached;
  const oda = findOda();
  const accore = findAccore();
  cached = {
    available: !!(oda || accore),
    engine: oda ? 'ODA File Converter' : accore ? 'AutoCAD Core Console' : null,
    path: oda ?? accore ?? null,
    kind: oda ? 'oda' : accore ? 'accore' : null,
    versions: VERSIONS,
  };
  return cached;
}

function run(exe, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { windowsHide: true, ...opts });
    let out = '';
    p.stdout?.on('data', (d) => { out += d.toString(); });
    p.stderr?.on('data', (d) => { out += d.toString(); });
    const timer = setTimeout(() => { p.kill(); reject(new Error('Conversion timed out.')); }, 180_000);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.replace(/\0/g, '') }); });
  });
}

/**
 * Converts a drawing. from/to are 'dwg' | 'dxf'; version is one of VERSIONS.
 * Returns the converted file bytes.
 */
export async function convert(input, from, to, version = 'ACAD2018') {
  const info = converterInfo();
  if (!info.available) throw new Error('No DWG converter found. Install ODA File Converter (free) or set ODA_FILE_CONVERTER.');
  if (!VERSIONS.includes(version)) throw new Error(`Unsupported version ${version}.`);
  const dir = await mkdtemp(join(tmpdir(), 'craftcad-'));
  try {
    const inDir = join(dir, 'in'), outDir = join(dir, 'out');
    await Promise.all([mkdirp(inDir), mkdirp(outDir)]);
    const inFile = join(inDir, `drawing.${from}`);
    await writeFile(inFile, input);
    if (info.kind === 'oda') {
      // ODAFileConverter <in dir> <out dir> <version> <DWG|DXF> <recurse> <audit> [filter]
      const r = await run(info.path, [inDir, outDir, version, to.toUpperCase(), '0', '1', `*.${from.toUpperCase()}`]);
      const files = await readdir(outDir);
      const hit = files.find((f) => f.toLowerCase() === `drawing.${to}`);
      if (!hit) throw new Error(`ODA File Converter produced no output. ${r.out.slice(-400)}`);
      return await readFile(join(outDir, hit));
    }
    // AutoCAD Core Console: open the input and SAVEAS the requested format.
    const outFile = join(outDir, `drawing.${to}`).replace(/\\/g, '/');
    const year = version.replace('ACAD', '');
    const cmd = to === 'dwg'
      ? `(command "_.SAVEAS" "${year}" "${outFile}")`
      : `(command "_.SAVEAS" "DXF" "_V" "${year}" "16" "${outFile}")`;
    const scr = join(dir, 'convert.scr');
    await writeFile(scr, ['(setvar "FILEDIA" 0)', '(setvar "CMDECHO" 0)', cmd, '_.QUIT _Y', ''].join('\r\n'));
    const r = await run(info.path, ['/i', inFile, '/s', scr, '/l', 'en-US'], { cwd: dir });
    if (!existsSync(outFile)) throw new Error(`AutoCAD Core Console produced no output. ${r.out.split(/\r?\n/).filter((l) => /error|invalid|discarded/i.test(l)).join(' ').slice(0, 400)}`);
    return await readFile(outFile);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function mkdirp(p) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(p, { recursive: true });
}

// ---------------------------------------------------------------------------
// HTTP handler shared by the Vite plugin and the standalone server.

const MAX_BYTES = 200 * 1024 * 1024;

/** Connect-style middleware for /api/convert and /api/convert/status. */
export async function convertMiddleware(req, res, next) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/convert') && url.pathname !== '/api/health') return next?.();
  const send = (status, body, type = 'application/json') => {
    res.statusCode = status;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  };
  try {
    if (url.pathname === '/api/health') {
      const i = converterInfo();
      return send(200, JSON.stringify({ status: 'ok', version: VERSION, converter: i.engine }));
    }
    if (url.pathname === '/api/convert/status') {
      const i = converterInfo(url.searchParams.has('refresh'));
      return send(200, JSON.stringify({ available: i.available, engine: i.engine, versions: i.versions }));
    }
    if (req.method !== 'POST') return send(405, JSON.stringify({ error: 'POST required' }));
    const from = url.searchParams.get('from'), to = url.searchParams.get('to');
    const version = url.searchParams.get('version') ?? 'ACAD2018';
    if (!['dwg', 'dxf'].includes(from) || !['dwg', 'dxf'].includes(to)) return send(400, JSON.stringify({ error: 'from/to must be dwg or dxf' }));
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BYTES) return send(413, JSON.stringify({ error: 'File too large' }));
      chunks.push(c);
    }
    const out = await convert(Buffer.concat(chunks), from, to, version);
    return send(200, out, 'application/octet-stream');
  } catch (e) {
    return send(500, JSON.stringify({ error: e.message ?? String(e) }));
  }
}

/** Vite plugin: serves the conversion API in dev and preview. */
export function convertPlugin() {
  return {
    name: 'craftcad-convert',
    configureServer(server) { server.middlewares.use(convertMiddleware); },
    configurePreviewServer(server) { server.middlewares.use(convertMiddleware); },
  };
}
