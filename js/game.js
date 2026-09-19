/* Hollowpath — Hold the road. WorldWideVibes vertical slice.
   Canvas 2D, no deps. Fixed-path tower defense, one wave. */
(() => {
  const W = 1280;
  const H = 720;
  const canvas = document.getElementById("view");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const ovTitle = document.getElementById("ovTitle");
  const ovBody = document.getElementById("ovBody");
  const ovKicker = document.getElementById("ovKicker");
  const ovAct = document.getElementById("ovAct");
  const waveBtn = document.getElementById("waveBtn");
  const goldEl = document.getElementById("gold");
  const livesEl = document.getElementById("lives");
  const hintEl = document.getElementById("hint");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const PATH = [
    { x: 40, y: 318 },
    { x: 168, y: 292 },
    { x: 286, y: 338 },
    { x: 372, y: 468 },
    { x: 510, y: 538 },
    { x: 668, y: 500 },
    { x: 792, y: 372 },
    { x: 930, y: 286 },
    { x: 1088, y: 268 },
    { x: 1248, y: 292 },
  ];
  const PADS = [
    { x: 250, y: 188 },
    { x: 390, y: 620 },
    { x: 560, y: 368 },
    { x: 720, y: 620 },
    { x: 860, y: 168 },
    { x: 1040, y: 420 },
  ];

  const CFG = {
    goldStart: 70,
    towerCost: 35,
    lives: 3,
    beetleHp: 26,
    beetleSpeed: 46,
    beetleCount: 10,
    spawnEvery: 0.78,
    towerRange: 198,
    towerDmg: 16,
    towerCd: 0.52,
    cinderSpeed: 380,
    bounty: 6,
  };

  const pathLen = (() => {
    let t = 0;
    const seg = [];
    for (let i = 0; i < PATH.length - 1; i++) {
      const a = PATH[i], b = PATH[i + 1];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      seg.push({ a, b, d, t0: t, t1: t + d });
      t += d;
    }
    return { total: t, seg };
  })();

  function along(dist) {
    const d = Math.max(0, Math.min(pathLen.total, dist));
    for (const s of pathLen.seg) {
      if (d <= s.t1) {
        const u = s.d < 1 ? 0 : (d - s.t0) / s.d;
        return {
          x: s.a.x + (s.b.x - s.a.x) * u,
          y: s.a.y + (s.b.y - s.a.y) * u,
          ang: Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x),
        };
      }
    }
    const last = PATH[PATH.length - 1];
    return { x: last.x, y: last.y, ang: 0 };
  }

  let audio;
  function ensureAudio() {
    if (audio) return audio;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audio = new AC();
    return audio;
  }
  function tone(freq, dur, type, gain, slide) {
    const ac = ensureAudio();
    if (!ac) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, ac.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, ac.currentTime + dur);
    g.gain.setValueAtTime(gain ?? 0.05, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g);
    g.connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + dur + 0.02);
  }

  const state = {
    mode: "title", // title | prep | wave | hold | breach
    gold: CFG.goldStart,
    lives: CFG.lives,
    towers: [],
    beetles: [],
    cinders: [],
    fx: [],
    hoverPad: -1,
    spawnLeft: 0,
    spawnT: 0,
    elapsed: 0,
    trauma: 0,
    freeze: 0,
    t: 0,
  };

  function resetPrep() {
    state.mode = "prep";
    state.gold = CFG.goldStart;
    state.lives = CFG.lives;
    state.towers = [];
    state.beetles = [];
    state.cinders = [];
    state.fx = [];
    state.spawnLeft = CFG.beetleCount;
    state.spawnT = 0;
    state.elapsed = 0;
    state.trauma = 0;
    overlay.classList.add("hidden");
    waveBtn.hidden = false;
    waveBtn.disabled = true;
    hintEl.textContent = "Tap an iron pad to plant a lantern. Two will hold, if you choose the cut well.";
    syncHud();
  }

  function startWave() {
    if (state.mode !== "prep") return;
    if (state.towers.length < 1) return;
    state.mode = "wave";
    waveBtn.hidden = true;
    hintEl.textContent = "The blight is on the road.";
    tone(140, 0.35, "triangle", 0.06, 90);
  }

  function endHold() {
    state.mode = "hold";
    ovKicker.textContent = "The pass holds";
    ovTitle.textContent = "Hold.";
    ovBody.textContent = "The lanterns kept the cut. This is the vertical slice — not a Release, not a campaign. One wave, survived.";
    ovAct.textContent = "Watch again";
    overlay.classList.remove("hidden");
    tone(220, 0.5, "sine", 0.05, 330);
  }

  function endBreach() {
    state.mode = "breach";
    ovKicker.textContent = "The cut is taken";
    ovTitle.textContent = "Breach.";
    ovBody.textContent = "Beetles reached the gate. Place lanterns on the bends — range is a circle, the road is not.";
    ovAct.textContent = "Take the watch";
    overlay.classList.remove("hidden");
    tone(90, 0.6, "sawtooth", 0.04, 50);
  }

  function syncHud() {
    goldEl.textContent = String(state.gold);
    livesEl.textContent = String(state.lives);
  }

  function padAt(x, y) {
    let best = -1, bestD = 46;
    for (let i = 0; i < PADS.length; i++) {
      if (state.towers.some((tw) => tw.pad === i)) continue;
      const d = Math.hypot(PADS[i].x - x, PADS[i].y - y);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function canvasPoint(ev) {
    const r = canvas.getBoundingClientRect();
    const src = ev.touches ? ev.touches[0] : ev;
    return {
      x: ((src.clientX - r.left) / r.width) * W,
      y: ((src.clientY - r.top) / r.height) * H,
    };
  }

  function tryPlace(x, y) {
    if (state.mode !== "prep" && state.mode !== "wave") return;
    if (state.mode === "wave") return;
    const i = padAt(x, y);
    if (i < 0) return;
    if (state.gold < CFG.towerCost) {
      hintEl.textContent = "Not enough iron. Two lanterns is the watch.";
      return;
    }
    state.gold -= CFG.towerCost;
    const p = PADS[i];
    state.towers.push({ pad: i, x: p.x, y: p.y, cd: 0, ang: -Math.PI / 2, flash: 0 });
    state.fx.push({ kind: "ring", x: p.x, y: p.y, life: 0.45, r: 12 });
    tone(180 + state.towers.length * 20, 0.12, "square", 0.04);
    waveBtn.disabled = state.towers.length < 1;
    hintEl.textContent = state.towers.length >= 2
      ? "The watch is set. Call the wave."
      : "One more lantern if you can spare the iron — or call the wave.";
    syncHud();
  }

  canvas.addEventListener("pointermove", (e) => {
    const p = canvasPoint(e);
    state.hoverPad = padAt(p.x, p.y);
  });
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const p = canvasPoint(e);
    tryPlace(p.x, p.y);
  });
  waveBtn.addEventListener("click", startWave);
  ovAct.addEventListener("click", () => {
    ensureAudio()?.resume?.();
    resetPrep();
  });

  function spawnBeetle() {
    state.beetles.push({
      dist: 0,
      hp: CFG.beetleHp,
      max: CFG.beetleHp,
      speed: CFG.beetleSpeed * (0.92 + Math.random() * 0.16),
      phase: Math.random() * Math.PI * 2,
      hit: 0,
      alive: true,
    });
  }

  function firstInRange(tw) {
    let best = null, bestD = -1;
    const r2 = CFG.towerRange * CFG.towerRange;
    for (const b of state.beetles) {
      if (!b.alive) continue;
      const p = along(b.dist);
      const dx = p.x - tw.x, dy = p.y - tw.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2 && b.dist > bestD) {
        bestD = b.dist;
        best = { b, p };
      }
    }
    return best;
  }

  function killBeetle(b, p) {
    b.alive = false;
    b.hp = 0;
    state.gold += CFG.bounty;
    syncHud();
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 90;
      state.fx.push({
        kind: "bit",
        x: p.x, y: p.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.45 + Math.random() * 0.3,
        c: Math.random() > 0.5 ? "#6a7348" : "#2a2418",
      });
    }
    state.fx.push({ kind: "num", x: p.x, y: p.y, text: "+" + CFG.bounty, life: 0.7 });
    tone(90, 0.14, "triangle", 0.05, 60);
  }

  function leak(b) {
    b.alive = false;
    if (state.mode !== "wave") return;
    state.lives = Math.max(0, state.lives - 1);
    state.trauma = Math.min(1, state.trauma + 0.55);
    syncHud();
    tone(70, 0.4, "sawtooth", 0.05, 40);
    if (state.lives <= 0) endBreach();
  }

  function step(dt) {
    if (state.freeze > 0) {
      state.freeze -= dt;
      return;
    }
    state.t += dt;
    state.trauma = Math.max(0, state.trauma - dt * 1.6);

    if (state.mode === "wave") {
      state.elapsed += dt;
      if (state.spawnLeft > 0) {
        state.spawnT -= dt;
        if (state.spawnT <= 0) {
          spawnBeetle();
          state.spawnLeft--;
          state.spawnT = CFG.spawnEvery;
        }
      }
      for (const b of state.beetles) {
        if (!b.alive) continue;
        b.dist += b.speed * dt;
        b.hit = Math.max(0, b.hit - dt);
        if (b.dist >= pathLen.total - 8) leak(b);
      }
      for (const tw of state.towers) {
        tw.cd -= dt;
        tw.flash = Math.max(0, tw.flash - dt);
        const tgt = firstInRange(tw);
        if (tgt) {
          tw.ang = Math.atan2(tgt.p.y - tw.y, tgt.p.x - tw.x);
          if (tw.cd <= 0) {
            tw.cd = CFG.towerCd;
            tw.flash = 0.12;
            state.cinders.push({
              x: tw.x + Math.cos(tw.ang) * 18,
              y: tw.y + Math.sin(tw.ang) * 18 - 26,
              tx: tgt.b,
              ang: tw.ang,
              life: 0.9,
            });
            tone(420 + Math.random() * 40, 0.06, "sine", 0.03);
          }
        }
      }
      for (const c of state.cinders) {
        if (c.life <= 0) continue;
        const p = c.tx.alive ? along(c.tx.dist) : { x: c.x + Math.cos(c.ang) * 20, y: c.y + Math.sin(c.ang) * 20 };
        const dx = p.x - c.x, dy = p.y - c.y;
        const d = Math.hypot(dx, dy) || 1;
        c.x += (dx / d) * CFG.cinderSpeed * dt;
        c.y += (dy / d) * CFG.cinderSpeed * dt;
        c.life -= dt;
        if (d < 14 && c.tx.alive) {
          c.life = 0;
          c.tx.hp -= CFG.towerDmg;
          c.tx.hit = 0.12;
          state.freeze = reduceMotion ? 0 : 0.028;
          const hitP = along(c.tx.dist);
          state.fx.push({ kind: "spark", x: hitP.x, y: hitP.y, life: 0.18 });
          if (c.tx.hp <= 0) killBeetle(c.tx, hitP);
          else tone(260, 0.04, "square", 0.02);
        }
      }
      state.cinders = state.cinders.filter((c) => c.life > 0);
      state.beetles = state.beetles.filter((b) => b.alive || b.hit > 0);
      if (state.spawnLeft <= 0 && state.beetles.every((b) => !b.alive) && state.lives > 0 && state.mode === "wave") {
        endHold();
      }
    }

    for (const f of state.fx) {
      f.life -= dt;
      if (f.kind === "bit") {
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.vy += 120 * dt;
      }
      if (f.kind === "num") f.y -= 28 * dt;
      if (f.kind === "ring") f.r += 80 * dt;
    }
    state.fx = state.fx.filter((f) => f.life > 0);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBg() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1c1512");
    g.addColorStop(0.42, "#14110f");
    g.addColorStop(1, "#0b0b0c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#0f0e10";
    ctx.beginPath();
    ctx.moveTo(0, 210);
    ctx.bezierCurveTo(180, 80, 340, 160, 520, 90);
    ctx.bezierCurveTo(720, 20, 900, 110, W, 70);
    ctx.lineTo(W, 0);
    ctx.lineTo(0, 0);
    ctx.fill();

    ctx.fillStyle = "#161318";
    ctx.beginPath();
    ctx.moveTo(0, 280);
    ctx.bezierCurveTo(220, 160, 400, 240, 640, 150);
    ctx.bezierCurveTo(860, 80, 1040, 180, W, 140);
    ctx.lineTo(W, 0);
    ctx.lineTo(0, 0);
    ctx.fill();

    // mist
    ctx.fillStyle = "rgba(200,180,150,0.04)";
    ctx.fillRect(0, 250, W, 90);

    // dusk disc
    ctx.beginPath();
    ctx.fillStyle = "rgba(196,165,116,0.14)";
    ctx.arc(980, 92, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = "rgba(236,234,227,0.55)";
    ctx.arc(980, 92, 18, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawRoad() {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#2a241c";
    ctx.lineWidth = 54;
    ctx.beginPath();
    ctx.moveTo(PATH[0].x, PATH[0].y);
    for (let i = 1; i < PATH.length; i++) ctx.lineTo(PATH[i].x, PATH[i].y);
    ctx.stroke();
    ctx.strokeStyle = "#3d3428";
    ctx.lineWidth = 38;
    ctx.stroke();
    ctx.strokeStyle = "#4a3f30";
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 18]);
    ctx.stroke();
    ctx.setLineDash([]);

    // spawn cut
    ctx.fillStyle = "#0a0908";
    roundRect(-10, 268, 64, 96, 8);
    ctx.fill();
    ctx.strokeStyle = "#c4a574";
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.35;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // gate
    const g = PATH[PATH.length - 1];
    ctx.fillStyle = "#1a1816";
    ctx.fillRect(g.x - 18, g.y - 70, 14, 90);
    ctx.fillRect(g.x + 10, g.y - 70, 14, 90);
    ctx.fillStyle = "#c4a574";
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(g.x + 3, g.y - 78, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawPads() {
    PADS.forEach((p, i) => {
      const taken = state.towers.some((t) => t.pad === i);
      const hover = state.hoverPad === i && state.mode === "prep" && !taken;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 28, 0, Math.PI * 2);
      ctx.fillStyle = hover ? "rgba(196,165,116,0.16)" : "rgba(20,20,22,0.7)";
      ctx.fill();
      ctx.strokeStyle = hover ? "#c4a574" : taken ? "#6a675e" : "#8a8680";
      ctx.lineWidth = hover ? 2.4 : 1.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = taken ? "#c4a574" : "#3a3834";
      ctx.fill();
    });
  }

  function drawTower(tw) {
    ctx.save();
    ctx.translate(tw.x, tw.y);
    if (state.mode === "prep" || state.hoverPad === tw.pad) {
      ctx.beginPath();
      ctx.arc(0, 0, CFG.towerRange, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(196,165,116,0.22)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = "#1c1b19";
    ctx.fillRect(-7, -8, 14, 22);
    ctx.fillStyle = "#2a2824";
    ctx.fillRect(-10, 12, 20, 6);
    ctx.save();
    ctx.translate(0, -22);
    ctx.rotate(tw.ang);
    ctx.fillStyle = "#c8ccd4";
    ctx.fillRect(0, -2, 16, 4);
    ctx.restore();
    ctx.fillStyle = "#141416";
    ctx.fillRect(-8, -34, 16, 16);
    ctx.strokeStyle = "#c4a574";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-8, -34, 16, 16);
    const flicker = 0.72 + Math.sin(state.t * 9 + tw.x) * 0.12 + tw.flash * 2;
    ctx.beginPath();
    ctx.fillStyle = `rgba(236,234,227,${0.85 * flicker})`;
    ctx.arc(0, -26, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = `rgba(196,165,116,${0.18 * flicker})`;
    ctx.arc(0, -24, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBeetle(b) {
    const p = along(b.dist);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.ang);
    const walk = Math.sin(b.dist * 0.18 + b.phase);
    if (b.hit > 0) ctx.globalAlpha = 0.55 + Math.sin(state.t * 40) * 0.2;
    ctx.fillStyle = "#1a1814";
    for (let i = -1; i <= 1; i += 2) {
      ctx.beginPath();
      ctx.moveTo(-6, i * 6);
      ctx.lineTo(8, i * (10 + walk * 3));
      ctx.lineTo(10, i * 4);
      ctx.fill();
    }
    ctx.fillStyle = "#2e2a22";
    ctx.beginPath();
    ctx.ellipse(2, 0, 14, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#6a7348";
    ctx.lineWidth = 1;
    ctx.globalAlpha *= 0.9;
    ctx.stroke();
    ctx.fillStyle = "#3a362c";
    ctx.beginPath();
    ctx.ellipse(-10, 0, 7, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c4a574";
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(-16, -3);
    ctx.lineTo(-22, -6);
    ctx.moveTo(-16, 3);
    ctx.lineTo(-22, 6);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const hp = Math.max(0, b.hp / b.max);
    ctx.fillStyle = "rgba(11,11,12,0.7)";
    ctx.fillRect(-12, -16, 24, 3);
    ctx.fillStyle = hp > 0.35 ? "#c4a574" : "#8a5a48";
    ctx.fillRect(-12, -16, 24 * hp, 3);
    ctx.restore();
  }

  function drawFx() {
    for (const c of state.cinders) {
      ctx.beginPath();
      ctx.fillStyle = "rgba(236,234,227,0.9)";
      ctx.arc(c.x, c.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = "rgba(196,165,116,0.28)";
      ctx.arc(c.x, c.y, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const f of state.fx) {
      const a = Math.max(0, f.life);
      if (f.kind === "bit") {
        ctx.globalAlpha = Math.min(1, a * 3);
        ctx.fillStyle = f.c;
        ctx.fillRect(f.x, f.y, 3, 3);
      } else if (f.kind === "spark") {
        ctx.globalAlpha = a * 4;
        ctx.fillStyle = "#eceae3";
        ctx.beginPath();
        ctx.arc(f.x, f.y, 8, 0, Math.PI * 2);
        ctx.fill();
      } else if (f.kind === "ring") {
        ctx.globalAlpha = a * 2;
        ctx.strokeStyle = "#c4a574";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (f.kind === "num") {
        ctx.globalAlpha = Math.min(1, a * 2);
        ctx.fillStyle = "#c4a574";
        ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(f.text, f.x - 8, f.y);
      }
      ctx.globalAlpha = 1;
    }
  }

  function draw() {
    const shake = reduceMotion ? 0 : state.trauma * state.trauma;
    ctx.save();
    if (shake) {
      ctx.translate((Math.random() - 0.5) * 10 * shake, (Math.random() - 0.5) * 10 * shake);
    }
    drawBg();
    drawRoad();
    drawPads();
    for (const tw of state.towers) drawTower(tw);
    for (const b of state.beetles) if (b.alive || b.hit > 0) drawBeetle(b);
    drawFx();
    ctx.restore();
  }

  function fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  fit();
  addEventListener("resize", fit);

  let last = performance.now();
  let acc = 0;
  const STEP = 1 / 60;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    while (acc >= STEP) {
      step(STEP);
      acc -= STEP;
    }
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  syncHud();
})();
