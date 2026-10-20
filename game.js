'use strict';

(() => {
  const COLS = 21, ROWS = 21;
  // Rand um das Spielfeld (in Feldern) für den Zaun; oben zusätzlich Platz,
  // damit Mattis Kopf in Reihe 0 über den Zaun ragen kann
  const PAD = { top: 1.8, side: 0.32, bottom: 0.32 };
  const COMBO_MS = 3000, ITEM_MS = 6000, POOP_EVERY = 3, MAX_COMBO = 5, SPRINT_MS = 5000;
  const C = {
    lawnA: '#3d7a4b', lawnB: '#43834f', fence: '#7a5a3a', fur: '#fbfaf6',
    poop: '#6b4423', poopHi: '#93683e',
    leash: '#d23a30', leashHi: '#f07a6e', leg: '#27292c', legFar: '#17181b',
    treat: '#f6e7c8', treatEdge: '#7a4a1e', kibbleHi: '#e09a5c', collar: '#e0483e',
    bag: '#3d6fd1', bagHi: '#a9c6f5', ball: '#d7e64a', stick: '#8a5a2b',
  };
  // Sonder-Items, höchstens eins gleichzeitig auf dem Feld
  const ITEMS = {
    bag: { pts: 50, chance: 0.12 },   // Kotbeutel: räumt 3 Haufen weg
    ball: { pts: 30, chance: 0.12 },  // Sprint: schneller, Leckerlis zählen doppelt
    stick: { pts: 20, chance: 0.10 }, // Leine 2 Felder kürzer
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

  let S, W = 0, H = 0, cell = 0, dpr = 1, shake = 0, last = 0, particles = [], touch = null;
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

  const bestKey = () => (S.mode === 'daily' ? 'best:daily:' + S.seed : 'best:free');
  const sprinting = () => S.t < S.sprintUntil;
  const stepMs = () => Math.max(68, 145 - S.eaten * 2.2) * (sprinting() ? 0.65 : 1);
  const same = (a, b) => a && b && a.x === b.x && a.y === b.y;

  // ---------- Spielzustand ----------
  function newGame(mode) {
    const seed = mode === 'daily' ? todaySeed() : (Math.random() * 2 ** 32) >>> 0;
    const snake = [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }];
    S = {
      mode, seed, rng: seed, snake, from: snake.map(p => ({ ...p })),
      dir: { x: 1, y: 0 }, queue: [], poops: [], treat: null, item: null,
      score: 0, eaten: 0, combo: 1, comboUntil: 0, sprintUntil: 0, t: 0, acc: 0,
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
    return S.snake.some(p => same(p, c)) || S.poops.some(p => same(p, c)) || same(S.treat, c) || same(S.item, c);
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
    const food = same(S.treat, n) ? 'treat' : same(S.item, n) ? S.item.kind : null;

    if (n.x < 0 || n.y < 0 || n.x >= COLS || n.y >= ROWS) return die('Gegen den Zaun gelaufen.');
    // Leinenende rückt nach, außer die Leine wird gerade länger
    const body = food ? S.snake : S.snake.slice(0, -1);
    if (body.some(p => same(p, n))) return die('In der eigenen Leine verheddert.');
    if (S.poops.some(p => same(p, n))) return die('In einen Haufen getreten.');

    S.from = S.snake.map(p => ({ ...p }));
    S.snake.unshift(n);
    if (food) {
      S.from.push({ ...S.from[S.from.length - 1] });
      eat(food, n);
    } else {
      S.snake.pop();
    }
    if (S.item && S.t > S.item.until) S.item = null;
  }

  function eat(kind, at) {
    S.combo = S.t <= S.comboUntil ? Math.min(S.combo + 1, MAX_COMBO) : 1;
    S.comboUntil = S.t + COMBO_MS;
    const base = kind === 'treat' ? (sprinting() ? 20 : 10) : ITEMS[kind].pts;
    const pts = base * S.combo;
    S.score += pts;
    const x = at.x + 0.5, y = at.y + 0.5;
    floatText(x, at.y + 0.2, '+' + pts);

    if (kind === 'treat') {
      S.eaten++;
      burst(x, y, C.kibbleHi, 12);
      S.treat = freeCell();
      sfx.eat(S.combo);
      if (S.eaten % POOP_EVERY === 0) dropPoop();
      if (!S.item && S.eaten >= 4) spawnItem();
    } else {
      S.item = null;
      sfx.item();
      if (kind === 'bag') {
        burst(x, y, C.bagHi, 20);
        for (let i = 0; i < 3 && S.poops.length; i++) {
          const [p] = S.poops.splice(Math.floor(rand() * S.poops.length), 1);
          burst(p.x + 0.5, p.y + 0.5, C.poop, 10);
        }
      } else if (kind === 'ball') {
        burst(x, y, C.ball, 20);
        S.sprintUntil = S.t + SPRINT_MS;
        floatText(x, at.y - 0.4, 'Sprint!');
      } else if (kind === 'stick') {
        burst(x, y, C.stick, 16);
        shorten(3); // 1 Feld Wachstum durchs Fressen + 2 kürzer
      }
    }
    updateHud();
  }

  function shorten(n) {
    const keep = Math.max(3, S.snake.length - n);
    for (const p of S.snake.slice(keep)) burst(p.x + 0.5, p.y + 0.5, C.leash, 4);
    S.snake.length = keep;
    S.from.length = keep;
  }

  function spawnItem() {
    for (const [kind, it] of Object.entries(ITEMS)) {
      if (kind === 'bag' && S.poops.length < 2) continue;
      if (kind === 'stick' && S.snake.length < 7) continue;
      if (rand() < it.chance) {
        const c = freeCell();
        if (c) S.item = { kind, ...c, until: S.t + ITEM_MS };
        return;
      }
    }
  }

  // Matti macht hinter sich ein Häufchen -> bleibt als Hindernis liegen
  function dropPoop() {
    const p = S.snake[Math.min(2, S.snake.length - 1)];
    S.poops.push({ x: p.x, y: p.y, born: S.t, flip: rand() < 0.5 });
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
    item: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, f * 1.01, 0.12, 'triangle', 0.08, i * 0.07)),
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
  // Canvas-Höhe wird explizit in px gesetzt und der Rahmen wächst mit.
  // (height: 100% in einer aspect-ratio-Box rechnet Safari anders -> Rand überdeckte die unterste Reihe)
  function resize() {
    const w = wrap.clientWidth, r = Math.min(window.devicePixelRatio || 1, 2);
    if (w === W && r === dpr) return;   // eigene Höhenänderung löst den Observer erneut aus
    dpr = r;
    W = w;
    cell = w / (COLS + 2 * PAD.side);
    H = Math.round(cell * (ROWS + PAD.top + PAD.bottom));
    canvas.style.height = H + 'px';
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Zaun direkt um die Wiese; darüber bleibt der Seitenhintergrund sichtbar,
  // damit klar ist, wo das Feld endet
  function drawFence() {
    const f = PAD.side * cell, y = PAD.top * cell - f;
    const h = (ROWS + 2 * PAD.side) * cell;
    const box = dy => {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(0, y + dy, W, h, f * 1.2);
      else ctx.rect(0, y + dy, W, h);
    };
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    box(f * 0.6);
    ctx.fill();
    ctx.fillStyle = C.fence;
    box(0);
    ctx.fill();
  }


  function boneShape(x, y, s, fill, outline) {
    const c = cell * s;
    ctx.save();
    ctx.translate(x * cell, y * cell);
    ctx.rotate(-0.5);
    const shape = () => {
      ctx.beginPath();
      ctx.rect(-c * 0.32, -c * 0.09, c * 0.64, c * 0.18);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        ctx.moveTo(sx * c * 0.33 + c * 0.12, sy * c * 0.09);
        ctx.arc(sx * c * 0.33, sy * c * 0.09, c * 0.12, 0, Math.PI * 2);
      }
    };
    if (outline) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = c * 0.12;
      ctx.lineJoin = 'round';
      shape();
      ctx.stroke();
    }
    ctx.fillStyle = fill;
    shape();
    ctx.fill('nonzero');
    ctx.restore();
  }

  // Leckerli: heller Knochen mit dunkler Kontur und pulsierendem Lichtkreis,
  // damit es sich auch auf kleinen Handy-Displays klar von den Haufen abhebt
  function drawTreat(t, now) {
    const x = (t.x + 0.5) * cell, y = (t.y + 0.5) * cell;
    const pulse = 0.5 + 0.5 * Math.sin(now / 220);
    ctx.fillStyle = `rgba(255, 244, 214, ${0.18 + 0.17 * pulse})`;
    ctx.beginPath();
    ctx.arc(x, y, cell * (0.5 + 0.12 * pulse), 0, Math.PI * 2);
    ctx.fill();
    boneShape(t.x + 0.5, t.y + 0.5 + Math.sin(now / 300) * 0.05, 1.15, C.treat, C.treatEdge);
  }

  function poopShape(x, y, k, flip) {
    const c = cell * k;
    ctx.save();
    ctx.translate(x * cell, y * cell + cell * 0.18);
    if (flip) ctx.scale(-1, 1);
    ctx.fillStyle = C.poop;
    for (const [w, h, dy] of [[0.36, 0.13, 0], [0.27, 0.11, -0.15], [0.17, 0.09, -0.28]]) {
      ctx.beginPath();
      ctx.ellipse(0, dy * c, w * c, h * c, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(-0.07 * c, -0.33 * c);
    ctx.quadraticCurveTo(0.02 * c, -0.5 * c, 0.11 * c, -0.43 * c);
    ctx.quadraticCurveTo(0.04 * c, -0.37 * c, 0.06 * c, -0.31 * c);
    ctx.fill();
    ctx.fillStyle = C.poopHi;
    ctx.beginPath();
    ctx.ellipse(-0.13 * c, -0.03 * c, 0.1 * c, 0.035 * c, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawItem(it, now) {
    const c = cell * 1.3;
    ctx.save();
    ctx.translate((it.x + 0.5) * cell, (it.y + 0.5) * cell + Math.sin(now / 250) * cell * 0.05);
    ctx.shadowColor = 'rgba(255,255,255,0.75)';
    ctx.shadowBlur = c * (0.3 + 0.2 * Math.sin(now / 150));
    ctx.lineCap = 'round';
    if (it.kind === 'ball') {
      ctx.fillStyle = C.ball;
      ctx.beginPath();
      ctx.arc(0, 0, c * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = C.fur;
      ctx.lineWidth = c * 0.05;
      ctx.beginPath(); ctx.arc(-c * 0.34, 0, c * 0.22, -1, 1); ctx.stroke();
      ctx.beginPath(); ctx.arc(c * 0.34, 0, c * 0.22, Math.PI - 1, Math.PI + 1); ctx.stroke();
    } else if (it.kind === 'stick') {
      ctx.rotate(-0.6);
      ctx.strokeStyle = C.stick;
      ctx.lineWidth = c * 0.13;
      ctx.beginPath(); ctx.moveTo(-c * 0.42, 0); ctx.lineTo(c * 0.42, 0); ctx.stroke();
      ctx.lineWidth = c * 0.07;
      ctx.beginPath(); ctx.moveTo(c * 0.08, 0); ctx.lineTo(c * 0.24, -c * 0.2); ctx.stroke();
    } else {
      // Kotbeutel, oben verknotet
      ctx.fillStyle = C.bag;
      ctx.beginPath();
      ctx.moveTo(-c * 0.24, -c * 0.12);
      ctx.quadraticCurveTo(-c * 0.32, c * 0.34, 0, c * 0.34);
      ctx.quadraticCurveTo(c * 0.32, c * 0.34, c * 0.24, -c * 0.12);
      ctx.closePath();
      ctx.fill();
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(sx * c * 0.11, -c * 0.22, c * 0.07, c * 0.13, sx * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = C.bagHi;
      ctx.fillRect(-c * 0.14, c * 0.02, c * 0.05, c * 0.18);
    }
    ctx.restore();
  }

  function render(alpha, now) {
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawFence();
    ctx.translate(PAD.side * cell, PAD.top * cell);

    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      ctx.fillStyle = (x + y) % 2 ? C.lawnA : C.lawnB;
      ctx.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
    }

    for (const p of S.poops) {
      const k = Math.min(1, (S.t - p.born) / 250);
      poopShape(p.x + 0.5, p.y + 0.5, 1 - (1 - k) ** 3, p.flip);
    }

    drawMatti(alpha, now);

    // Leckerli und Items nach Matti zeichnen, sonst verdeckt ihn sein 2–3 Felder großes Sprite
    if (S.treat) drawTreat(S.treat, now);
    // läuft das Item ab, blinkt es
    if (S.item && (S.item.until - S.t > 1500 || Math.floor(now / 120) % 2)) drawItem(S.item, now);

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

  // Sprites (aus KI-Charakterblatt ausgeschnitten): side schaut nach links, ohne Beine
  const SPRITES = {};
  for (const n of ['side-body', 'back', 'front']) {
    const img = new Image();
    img.src = `assets/matti-${n}.png`;
    SPRITES[n.replace('-body', '')] = img;
  }
  const ready = img => img.complete && img.naturalWidth > 0;
  // Halsband-Position im Sprite (relativ, 0..1)
  const COLLAR = { side: [0.26, 0.27], back: [0.5, 0.25], front: [0.5, 0.29] };

  function drawLeash(pts) {
    const n = pts.length;
    if (n < 2) return;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    };
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = cell * 0.22;
    ctx.save(); ctx.translate(0, cell * 0.08); path(); ctx.stroke(); ctx.restore();
    ctx.strokeStyle = C.leash;
    ctx.lineWidth = cell * 0.16;
    path(); ctx.stroke();
    // Webmuster der Leine
    ctx.strokeStyle = C.leashHi;
    ctx.lineWidth = cell * 0.04;
    ctx.setLineDash([cell * 0.12, cell * 0.14]);
    path(); ctx.stroke();
    ctx.setLineDash([]);
    // Handschlaufe am Ende
    const e = pts[n - 1], p = pts[n - 2];
    const ang = Math.atan2(e.y - p.y, e.x - p.x);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(ang);
    ctx.strokeStyle = C.leash;
    ctx.lineWidth = cell * 0.13;
    ctx.beginPath();
    ctx.ellipse(cell * 0.18, 0, cell * 0.22, cell * 0.15, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Seitenansicht: Beine werden gezeichnet (Koordinaten im 192×186-Sprite).
  // Trab: diagonale Paare schwingen gemeinsam, Knie beugt beim Vorschwingen.
  const LEGS = [
    { x: 64, y: 92, l1: 42, l2: 44, w: 14, far: true, ph: Math.PI },
    { x: 138, y: 98, l1: 38, l2: 42, w: 16, far: true, ph: 0 },
    { x: 56, y: 92, l1: 42, l2: 44, w: 15, far: false, ph: 0 },
    { x: 128, y: 98, l1: 38, l2: 42, w: 17, far: false, ph: Math.PI },
  ];
  // Front/Rücken: Beinstreifen unterhalb von cut, Mitte (Schwanz/Brust) bleibt stehen
  const FACING = { back: { cut: 140, mid: [19, 27] }, front: { cut: 132, mid: [22, 38] } };

  // Hund wird offscreen zusammengesetzt und als Ganzes mit Glow gezeichnet,
  // sonst bekommt jedes Beinsegment einen eigenen hellen Rand
  const dog = document.createElement('canvas'), dctx = dog.getContext('2d');

  function drawLeg(L, gait, moving) {
    const phi = gait + L.ph;
    // Vorschwingen = Richtung Kopf (-x); im Stand leicht gespreizt
    const th = moving ? Math.sin(phi) * 0.5 : Math.cos(L.ph) * 0.2;
    const knee = moving ? Math.max(0, Math.cos(phi)) * 0.9 : 0;
    const kx = L.x - Math.sin(th) * L.l1, ky = L.y + Math.cos(th) * L.l1;
    const th2 = th - knee;
    const px = kx - Math.sin(th2) * L.l2, py = Math.min(180, ky + Math.cos(th2) * L.l2);
    dctx.strokeStyle = dctx.fillStyle = L.far ? C.legFar : C.leg;
    dctx.lineCap = 'round';
    dctx.lineWidth = L.w;
    dctx.beginPath(); dctx.moveTo(L.x, L.y); dctx.lineTo(kx, ky); dctx.stroke();
    dctx.lineWidth = L.w * 0.6;
    dctx.beginPath(); dctx.moveTo(kx, ky); dctx.lineTo(px, py); dctx.stroke();
    dctx.beginPath();
    dctx.ellipse(px - 3, py - 1, 7, 4.5, 0, 0, Math.PI * 2);
    dctx.fill();
  }

  function drawSide(img, gait, moving) {
    const nw = img.naturalWidth, nh = img.naturalHeight;
    for (const L of LEGS) if (L.far) drawLeg(L, gait, moving);
    dctx.drawImage(img, 0, 0, nw, nh);
    for (const L of LEGS) if (!L.far) drawLeg(L, gait, moving);
  }

  function drawFacing(img, f, gait, moving) {
    const nw = img.naturalWidth, nh = img.naturalHeight, h = nh - f.cut;
    const [m0, m1] = f.mid;
    dctx.drawImage(img, 0, 0, nw, f.cut + 1, 0, 0, nw, f.cut + 1);
    dctx.drawImage(img, m0, f.cut, m1 - m0, h, m0, f.cut, m1 - m0, h);
    // angehobenes Bein: Pfote steigt, Streifen wird kürzer
    for (const [x0, x1, ph] of [[0, m0, 0], [m1, nw, Math.PI]]) {
      const lift = moving ? Math.max(0, Math.sin(gait + ph)) : 0;
      dctx.drawImage(img, x0, f.cut, x1 - x0, h, x0, f.cut, x1 - x0, h * (1 - 0.3 * lift));
    }
  }

  function drawMatti(alpha, now) {
    const pts = S.snake.map((p, i) => {
      const f = S.from[i] || p;
      return { x: (f.x + (p.x - f.x) * alpha + 0.5) * cell, y: (f.y + (p.y - f.y) * alpha + 0.5) * cell };
    });

    const h = S.snake[0], f = S.from[0] || h;
    const mv = { x: h.x - f.x, y: h.y - f.y };
    const d = mv.x || mv.y ? mv : S.dir;
    const running = S.phase === 'run';
    const dead = S.phase === 'over';
    const gait = S.gait || 0;
    const bob = Math.abs(Math.sin(gait)) * cell * 0.07;
    const head = pts[0], neck = pts[1] || head;

    let img, x, y;
    if (d.x) {
      img = SPRITES.side;
      x = (head.x + neck.x) / 2;          // Körper zwischen Kopf- und Nackenfeld
      y = head.y + cell * 0.45;           // Pfoten am unteren Zellrand
    } else {
      img = d.y < 0 ? SPRITES.back : SPRITES.front;
      x = head.x;
      y = (d.y < 0 ? neck.y : head.y) + cell * 0.45;
    }
    if (!ready(img)) { drawLeash(pts); return; }
    const ratio = img.naturalWidth / img.naturalHeight;
    const sw = d.x ? cell * 2.3 : cell * 2.7 * ratio, sh = sw / ratio;

    // Leine startet am Halsband und läuft hinter Matti entlang
    const [cu, cv] = COLLAR[img === SPRITES.side ? 'side' : d.y < 0 ? 'back' : 'front'];
    const leash = [{ x: x + (cu - 0.5) * sw * (d.x > 0 ? -1 : 1), y: y - bob - sh * (1 - cv) }, ...pts.slice(1)];
    drawLeash(leash);

    // Bodenschatten
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y, (d.x ? sw * 0.4 : sw * 0.7), cell * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(x, y - bob);
    if (dead) ctx.rotate(d.x > 0 ? -0.25 : 0.25);
    else if (d.x) ctx.rotate(Math.sin(gait) * 0.035);
    if (d.x > 0) ctx.scale(-1, 1);        // Sprite schaut nach links

    const k = sw / img.naturalWidth * dpr;
    dog.width = Math.ceil(img.naturalWidth * k);
    dog.height = Math.ceil(img.naturalHeight * k);
    dctx.setTransform(k, 0, 0, k, 0, 0);
    if (d.x) drawSide(img, gait, running);
    else drawFacing(img, FACING[d.y < 0 ? 'back' : 'front'], gait, running);

    // heller Rand, damit Schwarz auf Gras lesbar bleibt
    ctx.shadowColor = sprinting() ? C.ball : 'rgba(251,250,246,0.55)';
    ctx.shadowBlur = cell * (sprinting() ? 0.4 : 0.12);
    ctx.drawImage(dog, -sw / 2, -sh, sw, sh);
    ctx.restore();
  }

  // ---------- Loop ----------
  function frame(now) {
    const dt = Math.min((now - (last || now)) / 1000, 0.1);
    last = now;

    if (S.phase === 'run') {
      S.t += dt * 1000;
      S.acc += dt * 1000;
      S.gait = (S.gait || 0) + dt * 1000 / stepMs() * Math.PI;
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
    if (data.S && data.S.poops) {
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
