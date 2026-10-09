// Slide Recap server — Node built-ins only. Run from anywhere: node site/server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 3000;
const SITE = __dirname;
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'output');
const SLIDES = path.join(ROOT, 'slides');
const MAX_BYTES = 100 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

let status = { state: 'idle', file: null, error: null, startedAt: null, finishedAt: null };

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// Serve files from `base`, refusing anything that resolves outside it.
function serveStatic(res, base, rel) {
  let target = path.resolve(base, '.' + path.sep + rel);
  if (target !== base && !target.startsWith(base + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
  fs.stat(target, (err, st) => {
    if (!err && st.isDirectory()) target = path.join(target, 'index.html');
    fs.readFile(target, (e, data) => {
      if (e) return sendJson(res, 404, { error: 'Not found' });
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  });
}

function clearOutput() {
  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });
}
if (process.env.KEEP && fs.existsSync(path.join(OUTPUT, 'recap.json'))) {
  status = { state: 'done', file: 'existing output', error: null, startedAt: null, finishedAt: Date.now() };
} else {
  clearOutput(); // a fresh start never shows data from an older PDF
}

function runRecap(name) {
  clearOutput();
  status = { state: 'running', file: name, error: null, startedAt: Date.now(), finishedAt: null };

  // Pre-extract text with pypdf (fast, no tools missing) so the model reads
  // one ready file instead of improvising extraction — avoids the 4-minute stall.
  const txt = name.replace(/\.pdf$/i, '.txt');
  const extract = spawn(`python site/extract.py slides/${name} ${txt}`, { shell: true, cwd: ROOT });
  extract.on('close', (ec) => {
    if (ec !== 0) {
      // fallback: the prompt tells the run to do its own extraction if the .txt is missing
      console.log('extract.py exited ' + ec + '; run will fall back');
    }
    // Now start the OpenCode run with the lean, quota-safe prompt.
    // Uses --standalone --auto (no --command) and embeds the AGENTS.md facts.
    const prompt =
      'Run the /recap pipeline on slides/' + name + '. ' +
      'The slide text is ALREADY extracted for you at ' + txt + ' with page markers - read that ' +
      'one file instead of the pdf-reader MCP or any page-by-page extraction, and do not ' +
      'explore the environment or check tool versions (AGENTS.md has the environment facts). ' +
      '(1) follow the recap-style skill and write output/recap.md, output/diagram.mmd ' +
      'and output/recap.json, with topics that span the whole deck; ' +
      '(2) review those three files against the extracted text yourself in this same turn, ' +
      'applying the reviewer rules from .opencode/agents/reviewer.md - one pass, no ' +
      'sub-agent, so the run stays within the free-model quota; ' +
      '(3) apply its fixes once, then stop; ' +
      '(4) write output/review.json immediately, before ending your turn - your turn is ' +
      'not finished until all five output files exist on disk. ' +
      'Keep tool calls to a minimum: no exploring beyond the deck and these files. ' +
      'Never invent slide content. If ' + txt + ' does not exist, extract it first with ' +
      'python site/extract.py.';
    const cmd = 'opencode run --standalone --auto "' + prompt.replace(/"/g, '\\"') + '"';
    const child = spawn(cmd, { shell: true, cwd: ROOT });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    child.stdout.on('data', () => {});
    child.on('error', (e) => {
      status = { ...status, state: 'error', error: e.message, finishedAt: Date.now() };
    });
    child.on('close', (code) => {
      if (status.state === 'error') return;
      let reason = '';
      try { reason = fs.readFileSync(path.join(OUTPUT, 'error.txt'), 'utf8').trim(); } catch {}
      if (code === 0 && !reason && !fs.existsSync(path.join(OUTPUT, 'recap.json'))) {
        reason = 'opencode finished but did not write output/recap.json.';
      }
      status = code === 0 && !reason
        ? { ...status, state: 'done', finishedAt: Date.now() }
        : reason ? { ...status, state: 'error', error: reason, finishedAt: Date.now() }
        : { ...status, state: 'error', error: stderr.trim() || `opencode exited with code ${code}`, finishedAt: Date.now() };
    });
  });
}

function handleUpload(req, res, url) {
  if (status.state === 'running') return sendJson(res, 409, { error: 'A recap is already running.' });

  const raw = path.basename(url.searchParams.get('name') || '');
  const name = raw.replace(/\s+/g, '_');
  if (!/^[A-Za-z0-9._-]+\.pdf$/i.test(name)) {
    return sendJson(res, 400, { error: 'Use ?name=<file>.pdf with letters, numbers, dots, dashes or underscores.' });
  }
  if (Number(req.headers['content-length']) > MAX_BYTES) {
    return sendJson(res, 413, { error: 'File is larger than 100 MB.' });
  }

  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BYTES) {
      aborted = true;
      sendJson(res, 413, { error: 'File is larger than 100 MB.' });
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (aborted) return;
    fs.mkdir(SLIDES, { recursive: true }, (err) => {
      if (err) return sendJson(res, 500, { error: err.message });
      fs.writeFile(path.join(SLIDES, name), Buffer.concat(chunks), (e) => {
        if (e) return sendJson(res, 500, { error: e.message });
        runRecap(name);
        sendJson(res, 202, status);
      });
    });
  });
  req.on('error', () => {});
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return sendJson(res, 400, { error: 'Bad path' }); }

  if (req.method === 'POST' && pathname === '/upload') return handleUpload(req, res, url);
  if (req.method === 'GET' && pathname === '/status') return sendJson(res, 200, status);
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });

  if (pathname.startsWith('/output/')) return serveStatic(res, OUTPUT, pathname.slice('/output/'.length));
  serveStatic(res, SITE, pathname.replace(/^\/+/, '') || 'index.html');
}).on('error', (e) => {
  console.error(e.code === 'EADDRINUSE'
    ? `Port ${PORT} is already in use by another program. Use another port, e.g. PORT=3001 node site/server.js (PowerShell: $env:PORT=3001; node site/server.js)`
    : e.message);
  process.exit(1);
}).listen(PORT, () => console.log(`Slide Recap running at http://localhost:${PORT}`));
