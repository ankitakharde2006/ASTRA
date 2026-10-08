/* Course Recap Generator — state machine:
   empty → uploading → processing → result | error.
   All recap content arrives from GET /result and is written with
   textContent only, so no JSON text can ever become markup. */
(function () {
  'use strict';

  // When index.html is opened by double-click (file://), the page comes from
  // disk but the API lives on the local server — point API calls at it.
  // Served over http://, API is empty and every call stays relative.
  var API = location.protocol === 'file:' ? 'http://localhost:3000' : '';
  function api(p) { return API + p; }

  var THEME_KEY = 'recap-theme';
  var root = document.documentElement;

  var $ = function (id) { return document.getElementById(id); };
  var views = { empty: $('view-empty'), processing: $('view-processing'), error: $('view-error'), result: $('view-result') };

  var heroBadge = $('hero-badge');
  var heroTitle = $('hero-title');
  var heroPurpose = $('hero-purpose');
  var heroMeta = $('hero-meta');
  var heroActions = $('hero-actions');
  var reviewWrap = null;
  var sectionNav = $('section-nav');

  var HERO_DEFAULTS = {
    badge: heroBadge.textContent,
    title: heroTitle.textContent,
    purpose: heroPurpose.textContent,
    meta: heroMeta.textContent
  };

  var limitMB = 300;
  var pollTimer = null;
  var elapsedTimer = null;
  var currentStageIndex = -1;
  var startedAtMs = 0;
  var renderCount = 0;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------- Theme ---------- */

  function currentTheme() {
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  var toggle = $('theme-toggle');
  function updateToggle() {
    if (!toggle) return;
    var label = currentTheme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label);
  }
  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      updateToggle();
      renderDiagram();
    });
  }
  updateToggle();

  /* ---------- Views ---------- */

  function setView(name) {
    Object.keys(views).forEach(function (k) {
      if (views[k]) views[k].hidden = k !== name;
    });
    document.body.setAttribute('data-view', name);
  }

  function resetHero() {
    heroBadge.textContent = HERO_DEFAULTS.badge;
    heroTitle.textContent = HERO_DEFAULTS.title;
    heroPurpose.textContent = HERO_DEFAULTS.purpose;
    heroPurpose.hidden = false;
    heroMeta.textContent = HERO_DEFAULTS.meta;
    heroActions.hidden = true;
    var oldBadge = heroActions.querySelector('.review-badge');
    if (oldBadge) oldBadge.remove();
    if (sectionNav) sectionNav.hidden = true;
    document.title = 'Course Recap Generator';
  }

  function showEmpty() {
    stopPolling();
    setView('empty');
    resetHero();
    hideUploadProgress();
  }

  function showError(message, detail) {
    stopPolling();
    setView('error');
    resetHero();
    $('error-message').textContent = message || 'The run failed.';
    var d = $('error-detail');
    var text = detail || '';
    if (/rate limit|quota|free-models/i.test((message || '') + ' ' + text)) {
      text = (text ? text + '\n\n' : '') +
        'The free-model daily quota is exhausted. Add credits in your OpenCode account ($10 for 1000 requests/day) or wait for the daily reset, then upload again — or ask the assistant to generate the recap in-session.';
    }
    if (text) { d.textContent = text; d.hidden = false; } else { d.hidden = true; d.textContent = ''; }
  }

  function showProcessing(status) {
    setView('processing');
    heroActions.hidden = true;
    if (sectionNav) sectionNav.hidden = true;
    if (status) {
      if (status.file) $('processing-file').textContent = status.file;
      updateStepper(status);
      if (status.message) $('process-message').textContent = status.message;
      if (status.startedAt) {
        startedAtMs = Date.parse(status.startedAt) || Date.now();
        startElapsed();
      }
    }
  }

  /* ---------- Status / polling ---------- */

  function getStatus() {
    return fetch(api('/status'), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('status ' + r.status);
      return r.json();
    });
  }

  function handleStatus(s) {
    if (s.state === 'running') {
      showProcessing(s);
    } else if (s.state === 'done') {
      loadResult(s);
    } else if (s.state === 'error') {
      // A failure the user just watched (post-upload) surfaces; a stale
      // pre-load error never replaces the clean home page. Either way keep
      // watching: once the recap appears (e.g. generated after a quota
      // failure), the page must swap to the result instead of sitting on
      // the error for ever.
      if (document.body.getAttribute('data-view') !== 'empty') {
        showError(s.message || 'The run failed.', s.lastError);
      }
      pollTimer = setTimeout(poll, 5000);
    } else {
      showEmpty(); // idle — before the first upload, or after Cancel
      pollTimer = setTimeout(poll, 5000);
    }
  }

  function poll() {
    clearTimeout(pollTimer);
    getStatus().then(function (s) {
      handleStatus(s);
      if (s.state === 'running') pollTimer = setTimeout(poll, 2000);
    }).catch(function () {
      showError('Lost contact with the server.', 'The status endpoint stopped responding. Check the server tab and try again.');
    });
  }

  function stopPolling() {
    clearTimeout(pollTimer);
    pollTimer = null;
    stopElapsed();
  }

  function loadResult(status) {
    fetch(api('/result'), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('no result');
      return r.json();
    }).then(function (data) {
      stopPolling();
      showResult(data, status);
    }).catch(function () {
      showError('The run finished, but no recap was found.', 'output/recap.json is missing — check the server log.');
    });
  }

  /* ---------- Stepper / progress ---------- */

  function updateStepper(status) {
    var stages = status.stages || ['Reading slides', 'Summarizing', 'Reviewing', 'Building diagram'];
    var idx = stages.indexOf(status.stage);
    if (idx < 0) idx = 0;
    if (idx === currentStageIndex) return;
    currentStageIndex = idx;
    Array.prototype.forEach.call(document.querySelectorAll('#stepper .step'), function (step) {
      var n = Number(step.getAttribute('data-step'));
      step.classList.toggle('is-active', n === idx);
      step.classList.toggle('is-done', n < idx);
      var dot = step.querySelector('.step-dot');
      if (dot) dot.textContent = n < idx ? '✓' : String(n + 1);
    });
  }

  function startElapsed() {
    stopElapsed();
    var tick = function () {
      var sec = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
      var m = Math.floor(sec / 60);
      var s2 = sec % 60;
      $('process-elapsed').textContent = 'Elapsed ' + (m < 10 ? '0' + m : m) + ':' + (s2 < 10 ? '0' + s2 : s2);
    };
    tick();
    elapsedTimer = setInterval(tick, 1000);
  }

  function stopElapsed() {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }

  /* ---------- Upload ---------- */

  var dropzone = $('dropzone');
  var fileInput = $('file-input');

  function updateLimitHint() {
    var hint = $('limit-hint');
    if (hint) hint.textContent = 'One deck per run · up to ' + limitMB + ' MB';
  }

  function safeName(name) {
    var base = String(name || '').replace(/[^\w .-]/g, '-').replace(/\s+/g, '-');
    base = base.replace(/^[^A-Za-z0-9]+/, '');
    if (/\.pdf$/i.test(base)) base = base.replace(/\.pdf$/i, '.pdf');
    else base = (base || 'deck') + '.pdf';
    if (base.length > 100) base = base.slice(0, 90).replace(/\.pdf$/i, '') + '.pdf';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/i.test(base)) base = 'deck.pdf';
    return base;
  }

  function validate(file) {
    if (!file) return 'No file chosen.';
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      return 'Only PDF files are supported.';
    }
    if (limitMB && file.size > limitMB * 1048576) {
      return 'That file is larger than ' + limitMB + ' MB.';
    }
    return null;
  }

  function showUploadProgress() {
    $('upload-progress').hidden = false;
    setUploadPct(0);
  }

  function hideUploadProgress() {
    var p = $('upload-progress');
    if (p) p.hidden = true;
    var bar = $('upload-bar');
    if (bar) bar.style.width = '0%';
  }

  function setUploadPct(pct) {
    $('upload-bar').style.width = pct + '%';
    $('upload-label').textContent = pct >= 100 ? 'Upload complete — starting the recap…' : 'Uploading… ' + pct + '%';
  }

  function handleFile(file) {
    var box = $('upload-error');
    var problem = validate(file);
    if (problem) {
      if (box) { box.textContent = problem; box.hidden = false; }
      return;
    }
    if (box) { box.hidden = true; box.textContent = ''; }
    stopPolling(); // kill idle/error watchers so no stray poll flips views mid-upload
    showUploadProgress();
    $('processing-file').textContent = file.name;
    currentStageIndex = -1;

    var xhr = new XMLHttpRequest();
    xhr.open('POST', api('/upload?name=' + encodeURIComponent(safeName(file.name))));
    xhr.upload.addEventListener('progress', function (e) {
      if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', function () {
      if (xhr.status === 202) {
        hideUploadProgress();
        startedAtMs = Date.now();
        showProcessing({
          file: file.name,
          stage: 'Reading slides',
          stages: ['Reading slides', 'Summarizing', 'Reviewing', 'Building diagram'],
          message: 'Upload received — reading slides…',
          startedAt: new Date().toISOString()
        });
        poll();
      } else {
        var msg = 'Upload failed (HTTP ' + xhr.status + ').';
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch (e) {}
        showError(msg, null);
      }
    });
    xhr.addEventListener('error', function () {
      showError('Could not reach the server to upload the file.', 'Start it with: node site/server.js');
    });
    xhr.send(file);
  }

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', function () { fileInput.click(); });
    dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
      fileInput.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) {
        e.preventDefault();
        dropzone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) {
        e.preventDefault();
        dropzone.classList.remove('is-dragover');
      });
    });
    dropzone.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
  }

  /* ---------- Cancel / retry / another ---------- */

  var cancelBtn = $('cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      cancelBtn.disabled = true;
      fetch(api('/cancel'), { method: 'POST' }).catch(function () {}).then(function () {
        cancelBtn.disabled = false;
        setTimeout(poll, 500);
      });
    });
  }

  var retryBtn = $('retry-btn');
  if (retryBtn) retryBtn.addEventListener('click', showEmpty);

  var anotherBtn = $('another-btn');
  if (anotherBtn) {
    anotherBtn.addEventListener('click', function () {
      showEmpty();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Navbar: brand returns home; Upload PDF opens the picker directly.
  var navUpload = $('nav-upload');
  if (navUpload) {
    navUpload.addEventListener('click', function () {
      showEmpty(); // the picker lives on the home page
      if (fileInput) fileInput.click();
    });
  }

  var brandHome = $('brand-home');
  if (brandHome) {
    brandHome.addEventListener('click', function (e) {
      e.preventDefault();
      showEmpty();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------- Result rendering ---------- */

  function showSection(id, on) {
    var s = $(id);
    if (s) s.hidden = !on;
  }

  function showResult(data, status) {
    setView('result');
    resetHero();
    heroActions.hidden = false;

    var topics = Array.isArray(data.topics) ? data.topics : [];
    var takeaways = Array.isArray(data.takeaways) ? data.takeaways : [];
    var flashcards = Array.isArray(data.flashcards) ? data.flashcards : [];
    var glossary = Array.isArray(data.glossary) ? data.glossary : [];

    // Hero
    var titleText = data.title || (data.source ? String(data.source).replace(/\.pdf$/i, '') : 'Course recap');
    heroTitle.textContent = titleText;
    document.title = titleText + ' — Recap';
    if (data.overview) heroPurpose.textContent = data.overview;
    else heroPurpose.hidden = true;
    heroBadge.textContent = (status && status.file) ? status.file : 'Course recap';
    heroMeta.textContent = topics.length
      ? topics.length + ' topics · single pass · extract → recap → review → diagram'
      : 'Single pass · extract → recap → review → diagram';

    // Review badge
    var review = data.review || null;
    if (review && review.verdict) {
      var ok = /APPROVED|pass/i.test(String(review.verdict));
      var badge = el('span', 'review-badge ' + (ok ? 'is-ok' : 'is-warn'));
      var cov = (typeof review.coverage === 'number' && review.coverage > 0) ? ' · coverage ' + review.coverage : '';
      badge.textContent = String(review.verdict) + cov;
      heroActions.insertBefore(badge, heroActions.firstChild);
    }

    // Concepts + topics
    showSection('concepts', topics.length > 0);
    showSection('topics', topics.length > 0);
    var grid = $('card-grid');
    var list = $('topic-list');
    grid.textContent = '';
    list.textContent = '';
    topics.forEach(function (t, i) {
      var id = 'topic-' + (i + 1);

      var card = el('a', 'concept-card');
      card.href = '#' + id;
      card.appendChild(el('span', 'slide-pill', t.slides ? 'slides ' + t.slides : ''));
      card.appendChild(el('span', 'concept-name', t.name || t.title || ''));
      grid.appendChild(card);

      var art = el('article', 'topic');
      art.id = id;
      var h = el('h3');
      h.appendChild(document.createTextNode(t.name || t.title || ''));
      if (t.slides) h.appendChild(el('span', 'slide-pill', 'slides ' + t.slides));
      art.appendChild(h);
      if (t.summary) art.appendChild(el('p', null, t.summary));
      if (t.example) {
        var q = el('blockquote', 'example');
        q.appendChild(el('cite', null, 'Example from the slides'));
        q.appendChild(document.createTextNode(t.example));
        art.appendChild(q);
      }
      list.appendChild(art);
    });

    // Takeaways
    showSection('takeaways', takeaways.length > 0);
    var tl = $('takeaway-list');
    tl.textContent = '';
    takeaways.forEach(function (t) { tl.appendChild(el('li', null, t)); });

    // Flashcards
    showSection('flashcards', flashcards.length > 0);
    var fg = $('flash-grid');
    fg.textContent = '';
    flashcards.forEach(function (f) {
      var btn = el('button', 'flip-card');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', 'false');
      var inner = el('span', 'flip-inner');
      var front = el('span', 'flip-face flip-front', f.q || '');
      var back = el('span', 'flip-face flip-back', f.a || '');
      inner.appendChild(front);
      inner.appendChild(back);
      btn.appendChild(inner);
      fg.appendChild(btn);
    });

    // Diagram
    var hasDiagram = typeof data.diagram === 'string' && data.diagram.trim();
    showSection('diagram', !!hasDiagram);
    if (hasDiagram) {
      $('diagram-pre').textContent = data.diagram;
      renderDiagram(data.diagram);
    }

    // Glossary
    showSection('glossary', glossary.length > 0);
    var gl = $('glossary-list');
    gl.textContent = '';
    glossary.forEach(function (g) {
      var dt = el('dt');
      dt.appendChild(document.createTextNode(g.term || ''));
      if (g.slides) dt.appendChild(el('span', 'slide-pill', g.slides.indexOf('-') >= 0 || g.slides.indexOf(',') >= 0 ? 'slides ' + g.slides : 'slide ' + g.slides));
      gl.appendChild(dt);
      gl.appendChild(el('dd', null, g.definition || ''));
    });

    // Closing note in footer
    var fn = $('footer-note');
    if (data.closing) { fn.textContent = data.closing; fn.hidden = false; }
    else { fn.textContent = ''; fn.hidden = true; }

    if (sectionNav) sectionNav.hidden = false;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* ---------- Flashcards (delegated — content is dynamic) ---------- */

  document.addEventListener('click', function (e) {
    var card = e.target && e.target.closest ? e.target.closest('.flip-card') : null;
    if (!card) return;
    var on = card.getAttribute('aria-pressed') === 'true';
    card.setAttribute('aria-pressed', on ? 'false' : 'true');
  });

  /* ---------- Mermaid ---------- */

  var holder = $('diagram-render');
  var diagramSource = '';
  var note = $('diagram-note');
  var downloadBtn = $('download-svg');

  function showDiagramFallback() {
    if (note) note.hidden = false;
    if (downloadBtn) downloadBtn.disabled = true;
  }

  function renderDiagram(src) {
    if (src) diagramSource = src;
    if (!holder || !diagramSource) return;
    if (!window.mermaid) { showDiagramFallback(); return; }
    try {
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: currentTheme() === 'dark' ? 'dark' : 'default',
        flowchart: { htmlLabels: false, curve: 'basis' }
      });
      renderCount += 1;
      holder.innerHTML = '';
      Promise.resolve(window.mermaid.render('recapDiagram' + renderCount, diagramSource)).then(function (out) {
        holder.innerHTML = out.svg;
        if (downloadBtn) downloadBtn.disabled = !holder.querySelector('svg');
      }).catch(showDiagramFallback);
    } catch (e) {
      showDiagramFallback();
    }
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', function () {
      var svg = holder && holder.querySelector('svg');
      if (!svg) return;
      var clone = svg.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      var rect = svg.getBoundingClientRect();
      if (!clone.getAttribute('width')) {
        clone.setAttribute('width', Math.round(rect.width) || 800);
        clone.setAttribute('height', Math.round(rect.height) || 600);
      }
      var blob = new Blob([clone.outerHTML], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'recap-diagram.svg';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
  }

  /* ---------- Boot ---------- */

  function boot() {
    getStatus().then(function (s) {
      if (s.maxUploadMB) limitMB = s.maxUploadMB;
      updateLimitHint();
      if (s.state === 'running') {
        // Resume a run that is genuinely in progress right now.
        startedAtMs = s.startedAt ? (Date.parse(s.startedAt) || Date.now()) : Date.now();
        showProcessing(s);
        poll();
      } else if (s.state === 'error') {
        // Opening the site never replays an older deck or a stale error:
        // start on the clean home page, but keep watching quietly so a
        // recap being prepared (e.g. after a quota failure) appears by itself.
        showEmpty();
        pollTimer = setTimeout(poll, 5000);
      } else {
        // idle or done — the home page always takes a fresh PDF directly.
        showEmpty();
      }
    }).catch(function () {
      showEmpty();
      var noteEl = $('connection-note');
      if (noteEl) noteEl.hidden = false;
    });
  }

  /* ---------- Download menu ---------- */

  Array.prototype.forEach.call(document.querySelectorAll('[data-output]'), function (a) {
    a.setAttribute('href', api('/output/' + a.getAttribute('data-output')));
  });

  var printBtn = $('print-btn');
  if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

  boot();
})();
