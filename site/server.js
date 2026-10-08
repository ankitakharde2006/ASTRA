'use strict';

/**
 * Course Recap â€” backend.
 *
 * Node built-ins only. No dependencies, no build step.
 *
 *   GET  /                      -> site/index.html
 *   GET  /<file>                -> site/<file>
 *   GET  /output/<file>         -> output/<file>
 *   GET  /status                -> { state, stage, message }
 *   GET  /result                -> output/recap.json merged with output/review.json, 404 if absent
 *   POST /upload?name=<file>.pdf-> validate, clear output/, save to slides/, spawn recap run
 *   POST /cancel                -> kill a running recap run
 *
 * Serves http://localhost:3000. Files are only ever served from site/ and output/.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SITE_DIR = path.resolve(__dirname);
const OUTPUT_DIR = path.join(ROOT, 'output');
const SLIDES_DIR = path.join(ROOT, 'slides');

const HOST = 'localhost';
const PORT = 3000;

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 300);
const MAX_UPLOAD = MAX_UPLOAD_MB * 1024 * 1024;
const RUN_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

/**
 * How the recap run is invoked. `%s` is replaced with the relative PDF
 * path, e.g. `slides/day.pdf`.
 *
 * The originally requested form â€” `opencode run --command recap slides/%s` â€”
 * does NOT work on this installed CLI (v2.0.23). `opencode run --help`
 * lists no `--command` flag; it accepts only a message plus flags like
 * --file/--session/--model/--agent/--format/--auto/--standalone. The
 * spec'd form exits 1 with "Unrecognized flag: --command".
 *
 * Per the pipeline spec, the fallback is used instead: the full recap
 * instructions are passed as the run message, with the PDF path embedded.
 * Note `%s` already IS the `slides/<name>` path â€” do not prefix it again.
 * Two flags are required for a non-interactive child:
 *   --auto        no TTY, so it would otherwise block on a permission prompt
 *   --standalone  the default path connects to the background `serve`
 *                 process, which deadlocks when already busy
 *
 * Override without editing code, e.g.
 *   RECAP_CMD='opencode run --standalone --auto "/recap %s"' node site/server.js
 */
const RECAP_CMD = process.env.RECAP_CMD ||
  'opencode run --standalone --auto "Run the /recap pipeline on %s. ' +
  'The slide text is ALREADY extracted for you at %t with page markers - read that ' +
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
  'Never invent slide content. If %t does not exist, extract it first with ' +
  'python site/extract.py."';

const STAGES = ['Reading slides', 'Summarizing', 'Reviewing', 'Building diagram'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mmd': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** Single in-flight run state. */
const run = {
  state: 'idle', // idle | running | done | error
  stage: 'Reading slides',
  message: 'Waiting for a PDF.',
  file: null,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  pid: null,
  log: [],
  cancelled: false,
  hasResult: false, // only true once a run in this process produced a recap
  lastError: null,  // last error line from the run, shown in /status
};

let child = null;

// Run log, appended to output/server.log. output/ is cleared on each
// upload, so this file is exempt from the cleanup below.
const LOG_FILE = path.join(OUTPUT_DIR, 'server.log');
let logStream = null;
try {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
} catch (err) {
  console.error('Could not open output/server.log:', err.message);
}

function pushLog(line) {
  const t = new Date().toISOString().slice(11, 19);
  run.log.push(line);
  if (run.log.length > 400) run.log.shift();
  const stamped = t + '  ' + line;
  console.log(stamped);
  if (logStream) logStream.write(stamped + '\n');
}

/** Best-effort stage detection from the run's own output. */
function deriveStage(text) {
  const t = text.toLowerCase();
  if (/review|verdict|coverage|fix needed|approved/.test(t)) return 'Reviewing';
  if (/diagram|mermaid|svg|node count/.test(t)) return 'Building diagram';
  if (/summar|topic|recap\.md|recap\.json|takeaway|flashcard/.test(t)) return 'Summarizing';
  return 'Reading slides';
}

function setStage(stage, message) {
  run.stage = stage;
  if (message) run.message = message;
}

/**
 * Bare PDF filename only: no separators, no traversal, must start with an
 * alphanumeric. This value reaches a shell command, so it is whitelisted
 * rather than merely escaped.
 */
function safePdfName(raw) {
  const base = path.basename(String(raw || '')).trim();
  if (!base || base.length > 120) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/i.test(base)) return null;
  return base;
}

/** Resolve inside a root, refusing traversal. */
function safeJoin(rootDir, urlPath) {
  const rel = path.posix.normalize('/' + urlPath).replace(/^\/+/, '');
  const resolved = path.resolve(rootDir, rel);
  if (resolved !== rootDir && !resolved.startsWith(rootDir + path.sep)) return null;
  return resolved;
}

function sendJson(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function sendText(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

/** Remove previous run artefacts so the UI can never show stale results.
 *  output/server.log is kept so the run history survives across uploads. */
async function clearOutput() {
  await fsp.mkdir(OUTPUT_DIR, { recursive: true });
  const entries = await fsp.readdir(OUTPUT_DIR, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === 'server.log') continue;
    await fsp.unlink(path.join(OUTPUT_DIR, entry.name));
    removed++;
  }
  if (removed) pushLog('cleared output/ (' + removed + ' file' + (removed === 1 ? '' : 's') + ')');
}

async function serveFile(res, filePath) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    sendText(res, 404, 'Not found');
    return;
  }
  if (stat.isDirectory()) {
    sendText(res, 404, 'Not found');
    return;
  }
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(filePath).pipe(res);
}

/**
 * Stream the request body straight to dest with pipe â€” nothing is
 * buffered in memory. Enforces the size limit while streaming, and
 * rejects files whose first bytes are not the %PDF header.
 */
function streamUpload(req, dest) {
  return new Promise((resolve, reject) => {
    let header = Buffer.alloc(0);
    let size = 0;
    let settled = false;
    const out = fs.createWriteStream(dest);

    const fail = (err, code) => {
      if (settled) return;
      settled = true;
      // Stop writing to disk, but do NOT destroy the request â€”
      // that would kill the socket before the error response
      // can be delivered to the client.
      out.destroy();
      fsp.unlink(dest).catch(() => {});
      reject(Object.assign(err, { code: code || 'UPLOAD' }));
    };

    out.on('error', (err) => fail(err, 'WRITE'));
    out.on('finish', () => {
      if (settled) return;
      settled = true;
      // Backstop for bodies shorter than 5 bytes.
      if (header.subarray(0, 5).toString('latin1') !== '%PDF-') {
        fail(new Error('That file is not a PDF.'), 'NOT_PDF');
        return;
      }
      resolve(size);
    });

    req.on('data', (chunk) => {
      if (settled) return;
      if (header.length < 5) {
        header = Buffer.concat([header, chunk]).subarray(0, 5);
        // Fail fast on non-PDFs instead of buffering the whole body.
        if (header.length === 5 && header.toString('latin1') !== '%PDF-') {
          fail(new Error('That file is not a PDF.'), 'NOT_PDF');
          return;
        }
      }
      size += chunk.length;
      if (size > MAX_UPLOAD) {
        fail(new Error('File is larger than ' + MAX_UPLOAD_MB + ' MB.'), 'TOO_LARGE');
      }
    });

    req.pipe(out);
  });
}

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Fallback result builder: used when the run produced recap.md and
 * diagram.mmd but no recap.json. Parses the recap-style markdown into
 * the same shape so the page can still render. Sections it cannot
 * recover (flashcards, overview) are left absent â€” the frontend hides
 * those sections rather than showing anything invented.
 */
async function buildResultFromMd() {
  let md = '';
  let diagram = '';
  try { md = await fsp.readFile(path.join(OUTPUT_DIR, 'recap.md'), 'utf8'); } catch { return null; }
  try { diagram = (await fsp.readFile(path.join(OUTPUT_DIR, 'diagram.mmd'), 'utf8')).trim(); } catch { /* optional */ }
  if (!md || !md.trim()) return null;

  const result = { topics: [], takeaways: [], flashcards: [] };

  const title = md.match(/^#\s+(.+)\s*$/m);
  if (title) result.title = title[1].trim();

  const field = (block, label) => {
    const re = new RegExp('\\*\\*' + label + ':\\*\\*\\s*(.*?)(?=\\n\\*\\*|\\n##|$)', 's');
    const f = block.match(re);
    return f ? f[1].replace(/\s+/g, ' ').trim() : '';
  };

  const blocks = md.split(/^##\s+Topic\s+/m).slice(1);
  for (const block of blocks) {
    const head = block.match(/^(\d+)\s*[â€”â€“-]\s*(.+)/);
    result.topics.push({
      name: head ? head[2].trim() : '',
      slides: field(block, 'Slide Range').replace(/^slides\s*/i, '').trim(),
      summary: field(block, 'Summary'),
      example: field(block, 'Example'),
    });
  }

  const tk = md.match(/^##\s+Exam takeaways[\s\S]*$/m);
  if (tk) {
    result.takeaways = tk[0].split(/\r?\n/)
      .map((line) => line.match(/^\s*\d+\.\s+(.*)/))
      .filter(Boolean)
      .map((m) => m[1].replace(/\*\*/g, '').trim());
  }

  if (diagram) result.diagram = diagram;
  return result;
}

function startRun(fileName) {
  const rel = 'slides/' + fileName;
  const txtRel = fileName.replace(/\.pdf$/i, '.txt');
  // Stage 1 runs inside this same child, before OpenCode starts: extract the
  // text with pypdf (seconds) so the spawned run reads one ready-made file
  // instead of improvising an extraction strategy — the pdf-reader MCP is
  // broken and pdftotext is absent, which used to burn minutes of turns.
  // cmd precedence: (extract || fallback) && opencode, so the run always starts.
  const extractStep =
    'python site/extract.py ' + rel + ' ' + txtRel +
    ' || echo extract skipped - run will fall back to pypdf && ';
  const command = extractStep + RECAP_CMD.replace('%s', rel).replace('%t', txtRel);

  run.state = 'running';
  run.stage = STAGES[0];
  run.message = 'Reading slidesâ€¦';
  run.file = fileName;
  run.startedAt = new Date().toISOString();
  run.finishedAt = null;
  run.exitCode = null;
  run.cancelled = false;
  run.log = [];
  run.lastError = null;

  pushLog('run: ' + command);

  child = spawn(command, { shell: true, cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  run.pid = child.pid || null;

  const timer = setTimeout(() => {
    pushLog('run exceeded ' + RUN_TIMEOUT_MS / 60000 + ' min â€” stopping');
    try { child.kill('SIGKILL'); } catch { /* gone */ }
  }, RUN_TIMEOUT_MS);

  let tail = '';
  // The CLI writes its whole TUI to stderr and sprinkles ANSI
  // color codes through both streams â€” strip them, and only
  // treat error-looking lines as "the last error".
  const ANSI_RE = new RegExp('\\x1b\\[[0-9;]*[A-Za-z]', 'g');
  const ERROR_RE = /error|failed|failure|exception|unrecognized|invalid|quota|rate.?limit|denied|fatal/i;
  const consume = (stream, tag) => {
    if (!stream) return;
    stream.on('data', (data) => {
      tail += data.toString();
      const lines = tail.split(/\r?\n/);
      tail = lines.pop() || '';
      for (const line of lines) {
        const text = line.replace(ANSI_RE, '').trim();
        if (!text) continue;
        pushLog(tag + text);
        // Keep the last error line so /status can surface the real failure.
        if (ERROR_RE.test(text)) run.lastError = text;
        if (run.state === 'running') {
          setStage(deriveStage(text));
          // Latest activity line â€” shown by the frontend under the
          // stage, so the page reflects live progress.
          run.message = text.length > 140 ? text.slice(0, 137) + 'â€¦' : text;
        }
      }
    });
  };
  consume(child.stdout, '');
  consume(child.stderr, '! ');

  child.on('error', (err) => {
    clearTimeout(timer);
    run.state = 'error';
    run.finishedAt = new Date().toISOString();
    run.message = 'Could not start OpenCode: ' + err.message;
    pushLog('! spawn failed: ' + err.message);
    child = null;
  });

  child.on('close', async (code) => {
    clearTimeout(timer);
    child = null;
    run.exitCode = code;
    run.finishedAt = new Date().toISOString();

    if (run.cancelled) {
      run.state = 'idle';
      run.stage = STAGES[0];
      run.message = 'Cancelled.';
      pushLog('run cancelled');
      return;
    }

    const produced = await readJson(path.join(OUTPUT_DIR, 'recap.json'));
    const hasMd = await fsp.access(path.join(OUTPUT_DIR, 'recap.md')).then(() => true, () => false);
    const hasMmd = await fsp.access(path.join(OUTPUT_DIR, 'diagram.mmd')).then(() => true, () => false);

    if (produced || (hasMd && hasMmd)) {
      // The artefacts are the product. clearOutput() wiped
      // output/ before the run, so any file here was written
      // by THIS run - serve it even if the CLI exited non-zero.
      run.state = 'done';
      run.stage = STAGES[STAGES.length - 1];
      run.message = code === 0 ? 'Recap ready.' : 'Recap ready (OpenCode exited with code ' + code + ').';
      run.hasResult = true;
      pushLog('run finished â€” recap artefacts present');
    } else if (code === 0) {
      run.state = 'error';
      run.stage = STAGES[STAGES.length - 1];
      run.message = 'The run finished but produced no recap.json. Check that the /recap command exists.';
      pushLog('! exit 0 but no output/recap.json');
    } else {
      run.state = 'error';
      run.message = 'OpenCode exited with code ' + code + '. Check the server log for details.';
      pushLog('! exit ' + code);
    }
  });
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://' + (req.headers.host || HOST));
  } catch {
    sendText(res, 400, 'Bad request');
    return;
  }
  const pathname = decodeURIComponent(url.pathname);

  // Every response is readable from another origin — in particular from
  // index.html opened by double-click (file://, Origin: null).
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Allow the page to call the API from another origin — in particular
  // when index.html is opened by double-click (file://, Origin: null).
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  try {
    // ---------------- status ----------------
    if (pathname === '/status') {
      // While idle or after a failed run, reconcile with disk: if the
      // current upload's recap exists (e.g. generated in-session after a
      // quota failure), flip to done instead of leaving the error up.
      syncFromDisk();
      sendJson(res, 200, {
        state: run.state,
        stage: run.stage,
        message: run.message,
        lastError: run.lastError,
        maxUploadMB: MAX_UPLOAD_MB,
        file: run.file,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        exitCode: run.exitCode,
        stages: STAGES,
      });
      return;
    }

    // ---------------- result ----------------
    if (pathname === '/result') {
      // Serve whenever a complete-looking recap exists on disk. Artefacts can
      // come from this process's run OR be written outside it (e.g. generated
      // in-session after a quota failure) — either way they are the product.
      // Mid-run files may be half-written, so hide them until the run ends.
      if (run.state === 'running' && !run.hasResult) {
        sendJson(res, 404, { error: 'No recap yet.' });
        return;
      }
      const recap = await readJson(path.join(OUTPUT_DIR, 'recap.json'));
      if (recap) {
        const review = await readJson(path.join(OUTPUT_DIR, 'review.json'));
        sendJson(res, 200, { ...recap, review: review || null });
        return;
      }
      // No recap.json, but recap.md + diagram.mmd exist: build a result
      // from those instead of failing.
      const fallback = await buildResultFromMd();
      if (fallback) {
        const review = await readJson(path.join(OUTPUT_DIR, 'review.json'));
        sendJson(res, 200, { ...fallback, review: review || null });
        return;
      }
      sendJson(res, 404, { error: 'No recap yet.' });
      return;
    }

    // ---------------- cancel ----------------
    if (pathname === '/cancel' && req.method === 'POST') {
      if (run.state === 'running' && child) {
        run.cancelled = true;
        try { child.kill('SIGKILL'); } catch { /* gone */ }
        sendJson(res, 200, { state: run.state, stage: run.stage, message: 'Cancellingâ€¦' });
      } else {
        sendJson(res, 200, { state: run.state, stage: run.stage, message: run.message });
      }
      return;
    }

    // ---------------- upload ----------------
    if (pathname === '/upload') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Use POST /upload?name=<file>.pdf' });
        return;
      }
      if (run.state === 'running') {
        sendJson(res, 409, { error: 'A recap is already running.' });
        return;
      }

      const rawName = url.searchParams.get('name') || '';
      if (/[\\/]/.test(rawName)) {
        sendJson(res, 400, { error: 'Use a plain file name such as day.pdf, without a path.' });
        return;
      }
      const name = safePdfName(rawName);
      if (!name) {
        sendJson(res, 400, { error: 'That is not a valid PDF name. Use something like day.pdf.' });
        return;
      }

      const dest = path.join(SLIDES_DIR, name);
      await fsp.mkdir(SLIDES_DIR, { recursive: true });

      let size;
      try {
        size = await streamUpload(req, dest);
      } catch (err) {
        const code = err.code === 'TOO_LARGE' ? 413 : 400;
        sendJson(res, code, { error: err.message });
        return;
      }

      await clearOutput();

      run.log = [];
      run.hasResult = false;
      // Remember which deck produced the artefacts, so the site can name it.
      await fsp.writeFile(path.join(OUTPUT_DIR, '.source.json'), JSON.stringify({ file: name })).catch(() => {});
      pushLog('saved slides/' + name + ' (' + (size / 1048576).toFixed(2) + ' MB)');
      startRun(name);

      sendJson(res, 202, { ok: true, file: name });
      return;
    }

    // ---------------- static ----------------
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Method not allowed');
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      await serveFile(res, path.join(SITE_DIR, 'index.html'));
      return;
    }

    if (pathname.startsWith('/output/')) {
      const target = safeJoin(OUTPUT_DIR, pathname.slice('/output'.length));
      if (!target) { sendText(res, 403, 'Forbidden'); return; }
      await serveFile(res, target);
      return;
    }

    if (pathname.startsWith('/slides')) {
      sendText(res, 403, 'Forbidden');
      return;
    }

    const target = safeJoin(SITE_DIR, pathname);
    if (!target) { sendText(res, 403, 'Forbidden'); return; }
    await serveFile(res, target);
  } catch (err) {
    sendText(res, 500, 'Server error');
    console.error('error:', err.message);
  }
});

/**
 * Reconcile in-memory state with what is on disk. Artefacts only count when
 * output/.source.json names the deck that produced it — that file is written
 * on every upload, right after output/ is cleared — so a recap can only ever
 * be shown for the most recent upload, never as stale leftovers. Called at
 * startup and from /status while idle or after a failed run, so a recap
 * generated outside the run (e.g. in-session after a quota failure) replaces
 * the error view on the next poll instead of lingering.
 */
function syncFromDisk() {
  if (child || run.state === 'running' || run.state === 'done') return false;
  let src = null;
  try { src = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, '.source.json'), 'utf8')); } catch { return false; }
  if (!src || !src.file) return false;
  const hasRecap = fs.existsSync(path.join(OUTPUT_DIR, 'recap.json'));
  const hasPair = fs.existsSync(path.join(OUTPUT_DIR, 'recap.md')) &&
    fs.existsSync(path.join(OUTPUT_DIR, 'diagram.mmd'));
  if (!hasRecap && !hasPair) return false;
  run.hasResult = true;
  run.state = 'done';
  run.stage = STAGES[STAGES.length - 1];
  run.message = 'Recap ready.';
  run.file = src.file;
  run.finishedAt = run.finishedAt || new Date().toISOString();
  run.lastError = null;
  pushLog('recap artefacts present for ' + src.file + ' — serving them');
  return true;
}

syncFromDisk();

server.listen(PORT, HOST, () => {
  console.log('Course Recap â€” http://' + HOST + ':' + PORT);
  console.log('  serving site/    ' + SITE_DIR);
  console.log('  serving output/  ' + OUTPUT_DIR);
  console.log('  run command      ' + RECAP_CMD);
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('Port ' + PORT + ' is in use. Stop the other process or change PORT.');
    process.exit(1);
  }
  throw err;
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (child) { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    server.close(() => process.exit(0));
  });
}
