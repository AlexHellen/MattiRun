'use strict';

(() => {
  const COLS = 21, ROWS = 21;
  const COMBO_MS = 3000, BONE_MS = 6000, SPOT_EVERY = 3, MAX_COMBO = 5;
  const C = {
    lawnA: '#3d7a4b', lawnB: '#43834f', fur: '#fbfaf6', spot: '#16130f',
    kibble: '#b8662e', kibbleHi: '#e09a5c', gold: '#f2c14e', collar: '#e0483e',
  };
  const KEYS = {
    ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  };

  const $ = id => document.getElementById(id);
  const canvas = $('board'), ctx = canvas.getContext('2d'), wrap = canvas.parentElement;
  const ui = {
    score: $('score'), best: $('best'), combo: $('combo'), comboBar: $('combo-bar'),
    overlay: $('overlay'), title: $('ov-title'), text: $('ov-text'), btn: $('ov-btn'),
    mute: $('mute'), modes: [...document.querySelectorAll('[data-mode]')],
  };
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // localStorage kann fehlen oder werfen (Private Mode, Sandbox) -> Spiel läuft trotzdem
  const store = {
    get(k, d) { try { const v = localStorage.getItem('matti-run:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('matti-run:' + k, JSON.stringify(v)); } catch { /* egal */ } },
  };

  let S, size = 0, cell = 0, shake = 0, last = 0, particles = [], touch = null;
  let muted = store.get('muted', false);

  // ---------- RNG ----------
  const todaySeed = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
  const fmtDate = s => `${s % 100}.${Math.floor(s / 100) % 100}.${Math.floor(s / 10000)}`;

  // mulberry32, Zustand in S.rng -> Tages-Seed reproduzierbar und snapshot-fähig
  function rand() {
    let t = (S.rng = (S.rng + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  // stabiles Fellmuster pro Segment
  function hash(n) {
    let t = Math.imul(n ^ 0x9E3779B9, 0x85EBCA6B);
    t ^= t >>> 13; t = Math.imul(t, 0xC2B2AE35);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  }

  const bestKey = () => (S.mode === 'daily' ? 'best:daily:' + S.seed : 'best:free');
  const stepMs = () => Math.max(68, 145 - S.eaten * 2.2);
  const same = (a, b) => a && b && a.x === b.x && a.y === b.y;

  // ---------- Spielzustand ----------
  function newGame(mode) {
    const seed = mode === 'daily' ? todaySeed() : (Math.random() * 2 ** 32) >>> 0;
    const snake = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }];
    S = {
      mode, seed, rng: seed, snake, from: snake.map(p => ({ ...p })),
      dir: { x: 1, y: 0 }, queue: [], spots: [], treat: null, bone: null,
      score: 0, eaten: 0, combo: 1, comboUntil: 0, t: 0, acc: 0,
      phase: 'ready', reason: '', newBest: false,
    };
    S.treat = freeCell();
    particles = [];
    store.set('mode', mode);
    updateHud();
    showOverlay();
  }

  const occupied = (x, y) => {
    const c = { x, y };
    return S.snake.some(p => same(p, c)) || S.spots.some(p => same(p, c)) || same(S.treat, c) || same(S.bone, c);
  };

  function freeCell() {
    for (let i = 0; i < 400; i++) {
      const x = Math.floor(rand() * COLS), y = Math.floor(rand() * ROWS);
      if (!occupied(x, y)) return { x, y };
    }
    const free = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!occupied(x, y)) free.push({ x, y });
    return free.length ? free[Math.floor(rand() * free.length)] : null;
  }

  function step() {
    if (S.queue.length) S.dir = S.queue.shift();
    const h = S.snake[0], n = { x: h.x + S.dir.x, y: h.y + S.dir.y };
    const food = same(S.treat, n) ? 'treat' : same(S.bone, n) ? 'bone' : null;

    if (n.x < 0 || n.y < 0 || n.x >= COLS || n.y >= ROWS) return die('Gegen den Zaun gelaufen.');
    // Schwanzspitze rückt weg, außer Matti wächst gerade
    const body = food ? S.snake : S.snake.slice(0, -1);
    if (body.some(p => same(p, n))) return die('In den eigenen Schwanz gebissen.');
    if (S.spots.some(p => same(p, n))) return die('Über einen Fleck gestolpert.');

    S.from = S.snake.map(p => ({ ...p }));
    S.snake.unshift(n);
    if (food) {
      S.from.push({ ...S.from[S.from.length - 1] });
      eat(food, n);
    } else {
      S.snake.pop();
    }
    if (S.bone && S.t > S.bone.until) S.bone = null;
  }

  function eat(kind, at) {
    S.combo = S.t <= S.comboUntil ? Math.min(S.combo + 1, MAX_COMBO) : 1;
    S.comboUntil = S.t + COMBO_MS;
    const pts = (kind === 'bone' ? 50 : 10) * S.combo;
    S.score += pts;
    floatText(at.x + 0.5, at.y + 0.2, '+' + pts);

    if (kind === 'bone') {
      S.bone = null;
      burst(at.x + 0.5, at.y + 0.5, C.gold, 26);
      for (let i = 0; i < 3 && S.spots.length; i++) {
        const [s] = S.spots.splice(Math.floor(rand() * S.spots.length), 1);
        burst(s.x + 0.5, s.y + 0.5, C.spot, 10);
      }
      sfx.bone();
    } else {
      S.eaten++;
      burst(at.x + 0.5, at.y + 0.5, C.kibbleHi, 12);
      S.treat = freeCell();
      sfx.eat(S.combo);
      if (S.eaten % SPOT_EVERY === 0) dropSpot();
      if (!S.bone && S.eaten >= 5 && rand() < 0.22) {
        const c = freeCell();
        if (c) S.bone = { ...c, until: S.t + BONE_MS };
      }
    }
    updateHud();
  }

  // Matti verliert einen Fleck am Schwanzende -> bleibt als Hindernis liegen
  function dropSpot() {
    const tail = S.snake[S.snake.length - 1];
    S.spots.push({ x: tail.x, y: tail.y, rot: rand() * Math.PI, born: S.t });
  }

  function die(reason) {
    S.phase = 'over';
    S.reason = reason;
    shake = reduceMotion ? 0 : 14;
    burst(S.snake[0].x + 0.5, S.snake[0].y + 0.5, C.collar, 22);
    sfx.die();
    const best = store.get(bestKey(), 0);
    S.newBest = S.score > best;
    if (S.newBest) store.set(bestKey(), S.score);
    updateHud();
    showOverlay();
  }

  // ---------- UI ----------
  function updateHud() {
    ui.score.textContent = S.score;
    ui.best.textContent = Math.max(store.get(bestKey(), 0), S.score);
    ui.combo.textContent = '×' + S.combo;
    ui.modes.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
  }

  function showOverlay() {
    const o = {
      ready: ['Matti Run',
        S.mode === 'daily' ? `Tages-Lauf vom ${fmtDate(S.seed)}. Alle starten mit demselben Seed.` : 'Freies Spiel mit zufälligem Seed.',
        'Los geht’s'],
      pause: ['Pause', 'Matti schnüffelt kurz am Laternenpfahl.', 'Weiter'],
      over: [S.newBest ? 'Neuer Rekord!' : 'Aus!', `${S.reason} ${S.score} Punkte, ${S.eaten} Leckerlis.`, 'Nochmal'],
    }[S.phase];
    ui.overlay.hidden = !o;
    if (o) [ui.title.textContent, ui.text.textContent, ui.btn.textContent] = o;
  }

  function primary() {
    initAudio();
    if (S.phase === 'over') newGame(S.mode);
    if (S.phase === 'ready' || S.phase === 'pause') {
      S.phase = 'run';
      showOverlay();
    }
  }

  function togglePause() {
    if (S.phase === 'run') { S.phase = 'pause'; showOverlay(); }
    else if (S.phase === 'pause') primary();
  }

  function turn(dx, dy) {
    if (S.phase === 'over') return;
    const ref = S.queue.length ? S.queue[S.queue.length - 1] : S.dir;
    const valid = !(dx === ref.x && dy === ref.y) && !(dx === -ref.x && dy === -ref.y);
    if (valid && S.queue.length < 3) S.queue.push({ x: dx, y: dy });
    if (S.phase !== 'run') primary();
  }

  function toggleMute() {
    muted = !muted;
    store.set('muted', muted);
    ui.mute.setAttribute('aria-pressed', String(!muted));
    ui.mute.textContent = muted ? 'Ton aus' : 'Ton an';
  }

  // ---------- Sound ----------
  let ac = null;
  function initAudio() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; } }
    if (ac.state === 'suspended') ac.resume();
  }
  function tone(f1, f2, dur, type = 'square', vol = 0.06, delay = 0) {
    if (muted || !ac) return;
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f1, t);
    o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  const sfx = {
    eat: c => { const f = 440 * 2 ** ((c - 1) * 2 / 12); tone(f, f * 1.5, 0.09); },
    bone: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, f * 1.01, 0.12, 'triangle', 0.08, i * 0.07)),
    die: () => tone(260, 60, 0.5, 'sawtooth', 0.08),
  };

  // ---------- Partikel ----------
  function burst(x, y, color, n) {
    if (reduceMotion) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 5;
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: 1.6 + Math.random(), r: 0.06 + Math.random() * 0.1, color });
    }
  }
  function floatText(x, y, text) {
    particles.push({ x, y, vx: 0, vy: -1.6, life: 1, decay: 1.1, text, color: C.fur });
  }

  // ---------- Rendering ----------
  function resize() {
    const w = wrap.clientWidth, dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = w;
    cell = w / COLS;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(w * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function boneShape(x, y, s, fill) {
    const c = cell * s;
    ctx.save();
    ctx.translate(x * cell, y * cell);
    ctx.rotate(-0.5);
    ctx.fillStyle = fill;
    ctx.fillRect(-c * 0.32, -c * 0.09, c * 0.64, c * 0.18);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sx * c * 0.33, sy * c * 0.09, c * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function blob(x, y, r, rot) {
    ctx.save();
    ctx.translate(x * cell, y * cell);
    ctx.rotate(rot);
    ctx.fillStyle = C.spot;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * cell, r * cell * 0.78, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r * cell * 0.62, -r * cell * 0.5, r * cell * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function render(alpha, now) {
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      ctx.fillStyle = (x + y) % 2 ? C.lawnA : C.lawnB;
      ctx.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
    }

    for (const s of S.spots) {
      const k = Math.min(1, (S.t - s.born) / 250);
      blob(s.x + 0.5, s.y + 0.5, 0.34 * (1 - (1 - k) ** 3), s.rot);
    }

    if (S.treat) {
      const bob = Math.sin(now / 300) * 0.05;
      boneShape(S.treat.x + 0.5, S.treat.y + 0.5 + bob, 0.95, C.kibble);
    }
    if (S.bone) {
      const left = S.bone.until - S.t;
      if (left > 1500 || Math.floor(now / 120) % 2) {
        ctx.save();
        ctx.shadowColor = C.gold;
        ctx.shadowBlur = cell * (0.4 + 0.25 * Math.sin(now / 150));
        boneShape(S.bone.x + 0.5, S.bone.y + 0.5, 1.3, C.gold);
        ctx.restore();
      }
    }

    drawMatti(alpha);

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      if (p.text) {
        ctx.font = `${Math.round(cell * 0.75)}px "Lilita One", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(p.text, p.x * cell, p.y * cell);
      } else {
        ctx.beginPath();
        ctx.arc(p.x * cell, p.y * cell, p.r * cell, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawMatti(alpha) {
    const n = S.snake.length;
    const pts = S.snake.map((p, i) => {
      const f = S.from[i] || p;
      return { x: (f.x + (p.x - f.x) * alpha + 0.5) * cell, y: (f.y + (p.y - f.y) * alpha + 0.5) * cell };
    });

    const path = (dy = 0) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y + dy);
      for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y + dy);
    };
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.lineWidth = cell * 0.78;
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    path(cell * 0.09);
    ctx.stroke();
    ctx.strokeStyle = C.fur;
    path();
    ctx.stroke();

    // Fellflecken: Index vom Schwanz aus, damit das Muster beim Wachsen stabil bleibt
    ctx.fillStyle = C.spot;
    for (let i = 1; i < n; i++) {
      const k = n - 1 - i;
      if (hash(k) > 0.62) continue;
      const ox = (hash(k + 77) - 0.5) * 0.34 * cell, oy = (hash(k + 191) - 0.5) * 0.34 * cell;
      ctx.beginPath();
      ctx.arc(pts[i].x + ox, pts[i].y + oy, (0.07 + hash(k + 33) * 0.09) * cell, 0, Math.PI * 2);
      ctx.fill();
    }

    // Kopf
    const h = S.snake[0], f = S.from[0] || h;
    const mv = { x: h.x - f.x, y: h.y - f.y };
    const d = mv.x || mv.y ? mv : S.dir;
    const dead = S.phase === 'over';
    ctx.save();
    ctx.translate(pts[0].x, pts[0].y);
    ctx.rotate(Math.atan2(d.y, d.x));

    ctx.fillStyle = C.collar;
    ctx.fillRect(-cell * 0.36, -cell * 0.4, cell * 0.14, cell * 0.8);

    ctx.fillStyle = C.spot;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(-cell * 0.08, s * cell * 0.4, cell * 0.22, cell * 0.12, s * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = C.fur;
    ctx.beginPath();
    ctx.arc(cell * 0.05, 0, cell * 0.46, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = C.spot;
    ctx.beginPath();
    ctx.arc(-cell * 0.12, -cell * 0.18, cell * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cell * 0.48, 0, cell * 0.1, cell * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();

    for (const s of [-1, 1]) {
      const ex = cell * 0.22, ey = s * cell * 0.17;
      if (dead) {
        ctx.strokeStyle = C.spot;
        ctx.lineWidth = cell * 0.05;
        ctx.beginPath();
        ctx.moveTo(ex - cell * 0.06, ey - cell * 0.06); ctx.lineTo(ex + cell * 0.06, ey + cell * 0.06);
        ctx.moveTo(ex + cell * 0.06, ey - cell * 0.06); ctx.lineTo(ex - cell * 0.06, ey + cell * 0.06);
        ctx.stroke();
      } else {
        ctx.fillStyle = C.spot;
        ctx.beginPath();
        ctx.arc(ex, ey, cell * 0.065, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.fur;
        ctx.beginPath();
        ctx.arc(ex + cell * 0.02, ey - cell * 0.02, cell * 0.022, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------- Loop ----------
  function frame(now) {
    const dt = Math.min((now - (last || now)) / 1000, 0.1);
    last = now;

    if (S.phase === 'run') {
      S.t += dt * 1000;
      S.acc += dt * 1000;
      let ms = stepMs();
      while (S.acc >= ms && S.phase === 'run') {
        S.acc -= ms;
        step();
        ms = stepMs();
      }
      if (S.combo > 1 && S.t > S.comboUntil) { S.combo = 1; updateHud(); }
    }

    shake = Math.max(0, shake - dt * 40);
    const damp = Math.pow(0.05, dt);
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (!p.text) { p.vx *= damp; p.vy *= damp; }
      p.life -= p.decay * dt;
    }
    particles = particles.filter(p => p.life > 0);

    const left = S.phase === 'over' ? 0 : Math.max(0, S.comboUntil - S.t) / COMBO_MS;
    ui.comboBar.style.width = (left * 100).toFixed(1) + '%';

    render(S.phase === 'run' ? Math.min(1, S.acc / stepMs()) : 1, now);
    requestAnimationFrame(frame);
  }

  // ---------- Input ----------
  addEventListener('keydown', e => {
    const onButton = e.target instanceof HTMLButtonElement;
    const d = KEYS[e.code];
    if (d) { e.preventDefault(); turn(...d); return; }
    if (onButton && (e.code === 'Space' || e.code === 'Enter')) return;
    if (e.code === 'Space' || e.code === 'KeyP' || e.code === 'Escape') {
      e.preventDefault();
      S.phase === 'run' || S.phase === 'pause' ? togglePause() : primary();
    } else if (e.code === 'Enter') {
      e.preventDefault();
      primary();
    } else if (e.code === 'KeyM') {
      toggleMute();
    }
  });

  // Wischen: nach jeder erkannten Geste neuer Ursprung -> mehrere Kurven ohne Absetzen
  wrap.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    touch = { x: e.clientX, y: e.clientY };
  });
  addEventListener('pointermove', e => {
    if (!touch) return;
    const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
    if (Math.hypot(dx, dy) < 24) return;
    Math.abs(dx) > Math.abs(dy) ? turn(Math.sign(dx), 0) : turn(0, Math.sign(dy));
    touch = { x: e.clientX, y: e.clientY };
  });
  addEventListener('pointerup', () => { touch = null; });
  addEventListener('pointercancel', () => { touch = null; });

  ui.btn.addEventListener('click', primary);
  ui.mute.addEventListener('click', toggleMute);
  ui.modes.forEach(b => b.addEventListener('click', () => { newGame(b.dataset.mode); b.blur(); }));
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.phase === 'run') togglePause(); });

  // ---------- Boot ----------
  function boot(data = {}) {
    if (data.S) {
      S = data.S;
      if (S.phase === 'run') S.phase = 'pause';
      updateHud();
      showOverlay();
    } else {
      newGame(store.get('mode', 'daily'));
    }
    muted = !muted; toggleMute(); // Button-Label synchronisieren
    resize();
    new ResizeObserver(resize).observe(wrap);
    requestAnimationFrame(frame);
  }

  window.claude?.hot?.snapshot?.(() => ({ S }));
  window.claude?.hot?.ready ? window.claude.hot.ready(boot) : boot(window.claude?.hot?.data ?? {});
})();
