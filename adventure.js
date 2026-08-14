"use strict";

(() => {
  const canvas = document.getElementById("world");
  const ctx = canvas.getContext("2d");
  const memoryRow = document.getElementById("memoryRow");
  const anchorBtn = document.getElementById("anchorBtn");
  const hint = document.getElementById("visualHint");
  const toast = document.getElementById("storyToast");
  const resetBtn = document.getElementById("resetBtn");
  const WORLD = { w: 1900, h: 1200 };
  const SAVE_KEY = "blobbo-meadow-v1";
  const COLORS = { ink: "#293044", player: "#ef7657", pip: "#f3ba52", pebble: "#82a7c9", sprout: "#73bf75", toasty: "#ed7652" };
  const defaultSave = () => ({ seedPlanted: false, visits: 0, met: {}, trust: { Pip: 0, Pebble: 0, Sprout: 0, Toasty: 0 } });
  let save = loadSave();
  save.visits += 1;
  persist();

  let dpr = 1, viewW = 0, viewH = 0, elapsed = 0, last = 0;
  let camera = { x: 470, y: 760, zoom: 1 };
  let pointer = { active: false, sx: 0, sy: 0, x: 0, y: 0 };
  const keys = {};
  let tether = null, tetherTTL = 0, reconnectBlock = null, reconnectUntil = 0;
  let anchorT = 0, anchorCd = 0;
  let resetArmed = false, toastTimer = 0, hintHidden = false;
  let audio = null;
  const particles = [];
  const fireflies = Array.from({ length: 18 }, (_, i) => ({ x: 1420 + (i % 6) * 58 + Math.random() * 30, y: 690 + Math.floor(i / 6) * 65 + Math.random() * 25, p: Math.random() * 7 }));
  const flowers = Array.from({ length: 54 }, (_, i) => ({ x: 90 + (i * 137) % 1700, y: 90 + (i * 223) % 1000, c: ["#fff4a8", "#f39bad", "#a8dff3", "#ffffff"][i % 4] }));

  const player = makeBlob("You", 390, 780, 29, COLORS.player, "player");
  const residents = [
    makeBlob("Pip", 870, 655, 27, COLORS.pip, "pip"),
    makeBlob("Pebble", 315, 290, 25, COLORS.pebble, "pebble"),
    makeBlob("Sprout", 660, 255, 24, COLORS.sprout, "sprout"),
    makeBlob("Toasty", 1475, 790, 28, COLORS.toasty, "toasty")
  ];
  const SEED_HOME = { x: 900, y: 630 };
  const seed = { x: save.seedPlanted ? 1480 : SEED_HOME.x, y: save.seedPlanted ? 304 : SEED_HOME.y, vx: 0, vy: 0, r: 16, angle: .3, riverT: 0 };
  const garden = { x: 1480, y: 304, r: 115, holeR: 34 };

  function loadSave() {
    try {
      const raw = JSON.parse(localStorage.getItem(SAVE_KEY));
      return Object.assign(defaultSave(), raw || {}, { trust: Object.assign(defaultSave().trust, raw?.trust || {}), met: Object.assign({}, raw?.met || {}) });
    } catch { return defaultSave(); }
  }
  function persist() { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }
  function makeBlob(name, x, y, r, color, role) {
    return { name, x, y, homeX: x, homeY: y, vx: 0, vy: 0, r, color, role, heading: 0, wobble: Math.random() * 20, footPhase: Math.random() * 10, squish: 0, blink: 0, blinkIn: 1 + Math.random() * 3, bubble: null, bubbleT: 0, aiT: Math.random() * 2, calmT: 0, celebrateT: 0, metPulse: 0 };
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp((n >> 16) + amount, 0, 255), g = clamp(((n >> 8) & 255) + amount, 0, 255), b = clamp((n & 255) + amount, 0, 255);
    return `rgb(${r},${g},${b})`;
  }
  function riverCenter(y) { return 1172 + Math.sin((y - 110) * .0062) * 72; }
  function onBridge(o) { return o.y > 526 - o.r && o.y < 648 + o.r && Math.abs(o.x - riverCenter(o.y)) < 178; }
  function inRiver(o) { return !onBridge(o) && Math.abs(o.x - riverCenter(o.y)) < 108 + o.r * .45; }
  function blockRiver(b, oldX, oldY) {
    if (!inRiver(b)) return;
    const side = oldX < riverCenter(oldY) ? -1 : 1;
    b.x = riverCenter(b.y) + side * (110 + b.r);
    b.y = oldY;
    b.vx *= -.18; b.vy *= .55; b.squish = Math.max(b.squish, .35);
  }
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    viewW = innerWidth; viewH = innerHeight;
    canvas.width = Math.round(viewW * dpr); canvas.height = Math.round(viewH * dpr);
    canvas.style.width = viewW + "px"; canvas.style.height = viewH + "px";
    camera.zoom = clamp(Math.min(viewW / 820, viewH / 610), .58, 1.05);
  }
  function hideHint() {
    if (hintHidden) return;
    hintHidden = true;
    setTimeout(() => hint.classList.add("fade"), 1700);
  }
  function setupInput() {
    addEventListener("resize", resize);
    addEventListener("keydown", e => { keys[e.code] = true; hideHint(); if (e.code === "Space") { e.preventDefault(); activateAnchor(); } });
    addEventListener("keyup", e => { keys[e.code] = false; });
    canvas.addEventListener("pointerdown", e => { pointer.active = true; pointer.sx = pointer.x = e.clientX; pointer.sy = pointer.y = e.clientY; canvas.setPointerCapture(e.pointerId); hideHint(); wakeAudio(); });
    canvas.addEventListener("pointermove", e => { if (pointer.active) { pointer.x = e.clientX; pointer.y = e.clientY; } });
    const end = () => { pointer.active = false; };
    canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
    anchorBtn.addEventListener("click", () => { wakeAudio(); activateAnchor(); hideHint(); });
    resetBtn.addEventListener("click", () => {
      if (!resetArmed) { resetArmed = true; showToast("↻  Tap again to begin this little world again", 2.6); setTimeout(() => resetArmed = false, 3000); return; }
      localStorage.removeItem(SAVE_KEY); location.reload();
    });
  }
  function wakeAudio() {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
  }
  function chirp(blob, mood = "hello") {
    if (!audio) return;
    const base = { Pip: 680, Pebble: 330, Sprout: 520, Toasty: 440, You: 570 }[blob.name] || 500;
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = mood === "fear" ? "sawtooth" : "sine";
    osc.frequency.setValueAtTime(base, audio.currentTime);
    osc.frequency.exponentialRampToValueAtTime(base * (mood === "fear" ? .65 : 1.25), audio.currentTime + .13);
    gain.gain.setValueAtTime(.0001, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.07, audio.currentTime + .015); gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + .18);
    osc.connect(gain).connect(audio.destination); osc.start(); osc.stop(audio.currentTime + .2);
  }
  function setBubble(b, kind, seconds = 2.2) { b.bubble = kind; b.bubbleT = seconds; }
  function showToast(message, seconds = 2.4) { toast.textContent = message; toast.classList.remove("hidden"); toastTimer = seconds; }
  function meet(b) {
    if (save.met[b.name]) return;
    save.met[b.name] = true; save.trust[b.name] = Math.max(save.trust[b.name], .08); b.metPulse = 1; setBubble(b, "hello"); chirp(b); burst(b.x, b.y, b.color, 9); persist(); renderMemory();
  }
  function activateAnchor() {
    if (anchorCd > 0 || anchorT > 0) return;
    anchorT = 1.1; anchorCd = 4.6;
    anchorBtn.classList.add("active");
    burst(player.x, player.y, player.color, 14);
  }
  function beginTether(target) {
    if (tether || (target === reconnectBlock && elapsed < reconnectUntil)) return;
    if (target !== seed) meet(target);
    tether = target;
    tetherTTL = 2.4;
    if (target !== seed) { setBubble(target, target.role === "pebble" ? "question" : "heart", 1.1); chirp(target); }
  }
  function releaseTether(blockReconnect = true) {
    if (!tether) return;
    if (blockReconnect) { reconnectBlock = tether; reconnectUntil = elapsed + .8; }
    tether = null;
    tetherTTL = 0;
  }
  function renderMemory() {
    memoryRow.innerHTML = residents.map(b => `<div class="memory-face${save.met[b.name] ? " met" : ""}" style="background:${b.color}" title="${b.name}">${save.trust[b.name] >= .45 ? '<span class="heart">♥</span>' : ""}</div>`).join("");
  }
  function readInput() {
    let x = 0, y = 0;
    if (keys.KeyA || keys.ArrowLeft) x -= 1; if (keys.KeyD || keys.ArrowRight) x += 1; if (keys.KeyW || keys.ArrowUp) y -= 1; if (keys.KeyS || keys.ArrowDown) y += 1;
    if (!x && !y && pointer.active) { x = pointer.x - pointer.sx; y = pointer.y - pointer.sy; if (Math.hypot(x, y) < 9) x = y = 0; }
    const len = Math.hypot(x, y); return len ? { x: x / len, y: y / len, mag: Math.min(1, len / 70 || 1) } : { x: 0, y: 0, mag: 0 };
  }
  function updateBlobMotion(b, dt, input, max = 245) {
    const oldX = b.x, oldY = b.y, anchored = b === player && anchorT > 0;
    if (input.mag && !anchored) {
      const desired = Math.atan2(input.y, input.x); let turn = desired - b.heading;
      while (turn > Math.PI) turn -= Math.PI * 2; while (turn < -Math.PI) turn += Math.PI * 2;
      b.heading += clamp(turn, -8 * dt, 8 * dt);
      b.vx += Math.cos(b.heading) * 760 * input.mag * dt; b.vy += Math.sin(b.heading) * 760 * input.mag * dt;
    }
    const damp = Math.exp(-(anchored ? 13 : 4.2) * dt); b.vx *= damp; b.vy *= damp;
    const speed = Math.hypot(b.vx, b.vy); if (speed > max) { b.vx *= max / speed; b.vy *= max / speed; }
    b.x = clamp(b.x + b.vx * dt, b.r + 35, WORLD.w - b.r - 35); b.y = clamp(b.y + b.vy * dt, b.r + 35, WORLD.h - b.r - 35);
    blockRiver(b, oldX, oldY);
    const moved = Math.hypot(b.vx, b.vy); if (!input.mag && moved > 8) b.heading = Math.atan2(b.vy, b.vx);
    b.footPhase += dt * (4 + moved * .05); b.squish = Math.max(0, b.squish - dt * 3.5);
  }
  function steer(b, tx, ty, speed, dt) {
    const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy) || 1;
    b.vx += dx / d * speed * dt * 4; b.vy += dy / d * speed * dt * 4;
  }
  function updateResident(b, dt) {
    b.aiT -= dt; b.bubbleT -= dt; b.metPulse = Math.max(0, b.metPulse - dt * 1.8); b.celebrateT = Math.max(0, b.celebrateT - dt);
    if (b.bubbleT <= 0) b.bubble = null;
    const pd = dist(player, b); if (pd < 170) meet(b);
    if (b.role === "pip") updatePip(b, dt);
    if (b.role === "pebble") updatePebble(b, dt, pd);
    if (b.role === "sprout") updateSprout(b, dt, pd);
    if (b.role === "toasty") updateToasty(b, dt, pd);
    updateBlobMotion(b, dt, { x: 0, y: 0, mag: 0 }, b.role === "pebble" ? 185 : 150);
  }
  function updatePip(b, dt) {
    if (save.seedPlanted) {
      const a = elapsed * .45; steer(b, garden.x + Math.cos(a) * 92, garden.y + Math.sin(a) * 72, 46, dt);
      if (b.aiT <= 0) { b.aiT = 7; setBubble(b, "memory", 2.4); }
      return;
    }
    const sd = dist(b, seed);
    if (Math.hypot(seed.vx, seed.vy) > 25 || dist(player, seed) < 115) { steer(b, seed.x - 46, seed.y + 10, 80, dt); if (b.aiT <= 0) { b.aiT = 3; setBubble(b, "heart", 1); } }
    else if (b.aiT <= 0) { b.aiT = 5.4; setBubble(b, "seedDream", 2.8); steer(b, seed.x - 55, seed.y, 85, dt); b.vx -= 65; }
    else if (sd > 130) steer(b, b.homeX, b.homeY, 30, dt);
  }
  function updatePebble(b, dt, pd) {
    const playerSpeed = Math.hypot(player.vx, player.vy);
    if (pd < 135 && playerSpeed > 145) { const dx = b.x - player.x, dy = b.y - player.y, d = pd || 1; b.vx += dx / d * 210 * dt * 8; b.vy += dy / d * 210 * dt * 8; setBubble(b, "fear", 1.3); b.calmT = 0; }
    else if (pd < 145 && playerSpeed < 55) { b.calmT += dt; if (b.calmT > 2.1) { meet(b); save.trust.Pebble = clamp(save.trust.Pebble + dt * .045, 0, 1); if (!b.bubble) setBubble(b, "heart", 1); steer(b, player.x, player.y, 24, dt); persist(); } }
    else { b.calmT = Math.max(0, b.calmT - dt); if (dist(b, { x: b.homeX, y: b.homeY }) > 65) steer(b, b.homeX, b.homeY, 28, dt); }
  }
  function updateSprout(b, dt, pd) {
    if (!save.seedPlanted && (save.trust.Sprout > .18 || dist(player, seed) < 150)) steer(b, seed.x + 45, seed.y - 15, 52, dt);
    else if (save.trust.Sprout > .25 && pd > 115 && pd < 430) steer(b, player.x, player.y, 42, dt);
    else { const a = elapsed * .22 + 2; steer(b, b.homeX + Math.cos(a) * 85, b.homeY + Math.sin(a) * 65, 25, dt); }
    if (b.aiT <= 0) { b.aiT = 5 + Math.random() * 4; setBubble(b, "leaf", 1.6); }
  }
  function updateToasty(b, dt, pd) {
    const a = elapsed * .55; steer(b, 1510 + Math.cos(a) * 135, 765 + Math.sin(a * 1.2) * 95, 46, dt);
    if (pd < 180 && save.trust.Toasty > .12) { const q = Math.atan2(b.y - player.y, b.x - player.x) + dt * 2; steer(b, player.x + Math.cos(q) * 105, player.y + Math.sin(q) * 105, 80, dt); }
    if (b.aiT <= 0) { b.aiT = 4.5 + Math.random() * 3; setBubble(b, "warm", 1.8); }
  }
  function resolveBlobCollision(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r, d = Math.hypot(dx, dy) || 1; if (d >= min) return;
    const nx = dx / d, ny = dy / d, overlap = min - d, aShare = a === player && anchorT > 0 ? .08 : .5, bShare = 1 - aShare; a.x -= nx * overlap * aShare; a.y -= ny * overlap * aShare; b.x += nx * overlap * bShare; b.y += ny * overlap * bShare;
    const impact = Math.hypot(a.vx - b.vx, a.vy - b.vy); b.vx += nx * impact * .28; b.vy += ny * impact * .28;
    if (a === player && b !== player) {
      meet(b);
      if (!tether) beginTether(b);
      if (tether === b) tetherTTL = 2.4;
      if (impact < 85) { save.trust[b.name] = clamp(save.trust[b.name] + .012, 0, 1); }
      else if (impact > 190 && b.role === "pebble") save.trust[b.name] = clamp(save.trust[b.name] - .025, 0, 1);
    }
  }
  function resolveSeedCollision(b, dt) {
    if (save.seedPlanted) return;
    const dx = seed.x - b.x, dy = seed.y - b.y, d = Math.hypot(dx, dy) || 1, min = seed.r + b.r; if (d >= min) return;
    const nx = dx / d, ny = dy / d, overlap = min - d; seed.x += nx * overlap; seed.y += ny * overlap;
    const power = b === player ? 1 : b.role === "pip" ? .38 : b.role === "sprout" ? .23 : .12;
    seed.vx += (b.vx * .55 + nx * 70) * power; seed.vy += (b.vy * .55 + ny * 70) * power;
    if (b === player) {
      if (!tether) beginTether(seed);
      if (tether === seed) tetherTTL = 2.4;
      if (Math.hypot(b.vx, b.vy) > 35) { meet(residents[0]); save.trust.Pip = clamp(save.trust.Pip + dt * .12, 0, 1); }
    }
  }
  function updateSeed(dt) {
    if (save.seedPlanted) return;
    seed.vx *= Math.exp(-3.2 * dt); seed.vy *= Math.exp(-3.2 * dt); seed.x = clamp(seed.x + seed.vx * dt, seed.r + 30, WORLD.w - seed.r - 30); seed.y = clamp(seed.y + seed.vy * dt, seed.r + 30, WORLD.h - seed.r - 30); seed.angle += Math.hypot(seed.vx, seed.vy) * dt / seed.r;
    if (inRiver(seed)) {
      seed.riverT += dt; seed.vx *= .88; seed.vy *= .88;
      if (tether === seed) releaseTether(true);
      if (seed.riverT > 1.15) { seed.x = SEED_HOME.x; seed.y = SEED_HOME.y; seed.vx = seed.vy = 0; seed.riverT = 0; setBubble(residents[0], "seedDream", 2.2); }
      return;
    }
    seed.riverT = 0;
    if (Math.hypot(seed.x - garden.x, seed.y - garden.y) < garden.holeR) plantSeed();
  }
  function plantSeed() {
    save.seedPlanted = true; save.trust.Pip = Math.max(save.trust.Pip, .68); save.trust.Sprout = Math.max(save.trust.Sprout, .38); seed.x = garden.x; seed.y = garden.y; seed.vx = seed.vy = 0; persist(); renderMemory();
    for (const b of residents) { b.celebrateT = 4; setBubble(b, b.role === "pip" ? "memory" : "heart", 3); }
    burst(garden.x, garden.y, "#f7d86c", 55); chirp(residents[0]); showToast("🌱  Pip will remember this.", 4);
  }
  function updateTether(dt) {
    if (!tether) return;
    tetherTTL -= dt;
    if (tetherTTL <= 0) { releaseTether(false); return; }
    const d = dist(player, tether); if (d > 390) { if (tether !== seed) setBubble(tether, "fear", 1.1); releaseTether(true); return; }
    const dx = tether.x - player.x, dy = tether.y - player.y, len = d || 1, stretch = Math.max(0, d - 95), f = stretch * 2.2;
    const anchorMul = anchorT > 0 ? .12 : 1;
    player.vx += dx / len * f * dt * anchorMul; player.vy += dy / len * f * dt * anchorMul; tether.vx -= dx / len * f * dt * .8; tether.vy -= dy / len * f * dt * .8;
    if (tether !== seed && stretch < 45) { save.trust[tether.name] = clamp(save.trust[tether.name] + dt * .012, 0, 1); }
  }
  function burst(x, y, color, count, hearts = false) { for (let i = 0; i < count; i++) { const a = Math.random() * Math.PI * 2, s = 35 + Math.random() * 120; particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: .6 + Math.random() * .7, color, hearts }); } }
  function updateParticles(dt) { for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.life -= dt; if (p.life <= 0) particles.splice(i, 1); else { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .95; p.vy = p.vy * .95 - 14 * dt; } } }
  function update(dt) {
    elapsed += dt; if (toastTimer > 0 && (toastTimer -= dt) <= 0) toast.classList.add("hidden");
    anchorT = Math.max(0, anchorT - dt); anchorCd = Math.max(0, anchorCd - dt); anchorBtn.classList.toggle("active", anchorT > 0);
    updateBlobMotion(player, dt, readInput(), 260);
    for (const b of residents) updateResident(b, dt);
    for (const b of residents) { resolveBlobCollision(player, b); resolveSeedCollision(b, dt); }
    for (let i = 0; i < residents.length; i++) for (let j = i + 1; j < residents.length; j++) resolveBlobCollision(residents[i], residents[j]);
    resolveSeedCollision(player, dt); updateSeed(dt); updateTether(dt); updateParticles(dt);
    const padX = viewW / camera.zoom / 2, padY = viewH / camera.zoom / 2;
    camera.x += (clamp(player.x, padX, WORLD.w - padX) - camera.x) * Math.min(1, dt * 3.4); camera.y += (clamp(player.y, padY, WORLD.h - padY) - camera.y) * Math.min(1, dt * 3.4);
    for (const b of [player, ...residents]) { b.blinkIn -= dt; if (b.blinkIn <= 0) { b.blink = .13; b.blinkIn = 2 + Math.random() * 4; } b.blink = Math.max(0, b.blink - dt); }
  }
  function worldTransform() { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.translate(viewW / 2, viewH / 2); ctx.scale(camera.zoom, camera.zoom); ctx.translate(-camera.x, -camera.y); }
  function draw() {
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.fillStyle = "#b8df9e"; ctx.fillRect(0,0,viewW,viewH); worldTransform(); drawMeadow(); drawTether(); drawSeedAndGarden();
    for (const b of residents) drawBlob(b); drawBlob(player); drawParticles();
  }
  function drawMeadow() {
    ctx.fillStyle="#a9d78e"; ctx.fillRect(0,0,WORLD.w,WORLD.h);
    ctx.fillStyle="rgba(255,255,210,.18)"; ctx.beginPath(); ctx.ellipse(680,610,560,390,-.12,0,Math.PI*2); ctx.fill();
    const river = []; for (let y = -40; y <= WORLD.h + 40; y += 40) river.push({ y, x: riverCenter(y) });
    ctx.beginPath(); river.forEach((p,i)=>{const x=p.x-108;if(i)ctx.lineTo(x,p.y);else ctx.moveTo(x,p.y)}); [...river].reverse().forEach(p=>ctx.lineTo(p.x+108,p.y)); ctx.closePath(); ctx.fillStyle="#75bddb"; ctx.fill();
    ctx.strokeStyle="rgba(255,255,255,.36)";ctx.lineWidth=6;ctx.setLineDash([24,34]);ctx.beginPath();river.forEach((p,i)=>{if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y)});ctx.stroke();ctx.setLineDash([]);
    const bridgeX=riverCenter(587);ctx.fillStyle="#d7bc80";ctx.fillRect(bridgeX-160,535,320,105);ctx.fillStyle="#9b7648";for(let i=0;i<8;i++)ctx.fillRect(bridgeX-150+i*40,540,27,95);
    ctx.fillStyle="#8ac679";ctx.beginPath();ctx.ellipse(garden.x,garden.y,garden.r*1.25,garden.r,.15,0,Math.PI*2);ctx.fill();ctx.strokeStyle="rgba(73,112,64,.25)";ctx.lineWidth=7;ctx.stroke();
    if(!save.seedPlanted){const pulse=2+2*Math.sin(elapsed*3);ctx.fillStyle="#8b6243";ctx.beginPath();ctx.ellipse(garden.x,garden.y+3,garden.holeR+9,garden.holeR*.7+7,0,0,Math.PI*2);ctx.fill();ctx.fillStyle="#4b3428";ctx.beginPath();ctx.ellipse(garden.x,garden.y,garden.holeR,garden.holeR*.62,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle=`rgba(255,240,180,${.42+.18*Math.sin(elapsed*3)})`;ctx.lineWidth=3+pulse;ctx.stroke()}
    for(const f of flowers){if(Math.hypot(f.x-garden.x,f.y-garden.y)<140)continue;ctx.fillStyle=f.c;ctx.beginPath();ctx.arc(f.x,f.y,4,0,Math.PI*2);ctx.fill();ctx.fillStyle="#6aaf64";ctx.fillRect(f.x-1,f.y+3,2,7)}
    drawTree(190,980,1.2);drawTree(300,1030,.8);drawTree(1660,220,1.1);drawTree(1750,330,.8);drawTree(120,150,.9);
    for(const [x,y,r] of [[250,330,52],[380,240,33],[1460,750,42],[1600,850,30]]){ctx.fillStyle="rgba(43,48,64,.13)";ctx.beginPath();ctx.ellipse(x+5,y+8,r,r*.68,-.2,0,Math.PI*2);ctx.fill();ctx.fillStyle="#9b8a79";ctx.beginPath();ctx.ellipse(x,y,r,r*.68,-.2,0,Math.PI*2);ctx.fill();ctx.fillStyle="rgba(255,255,255,.22)";ctx.beginPath();ctx.ellipse(x-r*.22,y-r*.18,r*.32,r*.14,-.25,0,Math.PI*2);ctx.fill()}
    for(const f of fireflies){const glow=.35+.35*Math.sin(elapsed*3+f.p);ctx.fillStyle=`rgba(255,226,104,${glow})`;ctx.beginPath();ctx.arc(f.x+Math.sin(elapsed+f.p)*9,f.y+Math.cos(elapsed*.8+f.p)*8,5,0,Math.PI*2);ctx.fill()}
  }
  function drawTree(x,y,s){ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.fillStyle="#795b43";ctx.fillRect(-13,-60,26,85);ctx.fillStyle="#5da468";for(const [a,b,r] of [[-30,-68,48],[20,-82,55],[48,-45,42],[-45,-32,40]]){ctx.beginPath();ctx.arc(a,b,r,0,Math.PI*2);ctx.fill()}ctx.restore()}
  function drawSeedAndGarden() {
    if (save.seedPlanted) { drawPlant(garden.x,garden.y,1+.05*Math.sin(elapsed*2)); return; }
    if(seed.riverT>0){ctx.strokeStyle=`rgba(255,255,255,${.7-seed.riverT*.45})`;ctx.lineWidth=4;ctx.beginPath();ctx.ellipse(seed.x,seed.y,18+seed.riverT*30,8+seed.riverT*12,0,0,Math.PI*2);ctx.stroke()}
    ctx.save();ctx.translate(seed.x,seed.y);ctx.rotate(seed.angle);ctx.scale(1-seed.riverT*.35,1-seed.riverT*.35);ctx.fillStyle="#8a5c35";ctx.strokeStyle="#563820";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,-seed.r);ctx.bezierCurveTo(seed.r*.95,-seed.r*.45,seed.r*.8,seed.r*.7,0,seed.r);ctx.bezierCurveTo(-seed.r*.8,seed.r*.7,-seed.r*.95,-seed.r*.45,0,-seed.r);ctx.fill();ctx.stroke();ctx.strokeStyle="rgba(255,244,210,.48)";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-2,-seed.r*.62);ctx.quadraticCurveTo(5,0,-1,seed.r*.6);ctx.stroke();ctx.restore();
  }
  function drawPlant(x,y,s){ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.strokeStyle="#477f4d";ctx.lineWidth=10;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(0,22);ctx.quadraticCurveTo(-8,-28,5,-78);ctx.stroke();ctx.fillStyle="#67b56b";ctx.beginPath();ctx.ellipse(-24,-35,29,15,-.45,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(25,-58,31,16,.45,0,Math.PI*2);ctx.fill();ctx.fillStyle="#f3be5c";ctx.beginPath();ctx.arc(6,-83,16,0,Math.PI*2);ctx.fill();ctx.restore()}
  function drawTether(){if(!tether)return;const t=.55+.15*Math.sin(elapsed*6);ctx.strokeStyle=`rgba(255,255,255,${t})`;ctx.lineWidth=8;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(player.x,player.y);const mx=(player.x+tether.x)/2,my=(player.y+tether.y)/2;ctx.quadraticCurveTo(mx,my+14,tether.x,tether.y);ctx.stroke();ctx.strokeStyle="rgba(239,118,87,.5)";ctx.lineWidth=3;ctx.stroke()}
  function drawBlob(b) {
    const speed=Math.hypot(b.vx,b.vy),speedNorm=Math.min(1,speed/338),bounce=b.celebrateT>0?Math.abs(Math.sin(elapsed*8))*10:0,pulse=1+b.metPulse*.18,anchored=b===player&&anchorT>0;
    ctx.save();ctx.translate(b.x,b.y-bounce);ctx.fillStyle="rgba(43,48,64,.1)";ctx.beginPath();ctx.ellipse(0,b.r*.55,b.r*.85,b.r*.32,0,0,Math.PI*2);ctx.fill();ctx.rotate(b.heading);ctx.scale(pulse*(1+speedNorm*.13-b.squish*.22),pulse*(1-speedNorm*.1+b.squish*.22));
    const footColor=shade(b.color,-35);for(const side of [-1,1]){const kick=Math.sin(b.footPhase+(side>0?0:Math.PI))*(.25+speedNorm*.5);ctx.fillStyle=footColor;ctx.beginPath();ctx.ellipse(-b.r*.55+kick*b.r*.28,side*b.r*.55,b.r*.24,b.r*.17,side*.5,0,Math.PI*2);ctx.fill()}
    ctx.beginPath();for(let i=0;i<=12;i++){const a=i/12*Math.PI*2,wob=1+.045*Math.sin(a*3+elapsed*5+b.wobble)+.03*Math.sin(a*5-elapsed*3.4+b.wobble*2),rr=b.r*wob,x=Math.cos(a)*rr,y=Math.sin(a)*rr;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y)}ctx.closePath();ctx.fillStyle=anchored?shade(b.color,-30):b.color;ctx.fill();ctx.lineWidth=Math.max(2.5,b.r*.09);ctx.strokeStyle=shade(b.color,-45);ctx.stroke();
    ctx.fillStyle="rgba(255,255,255,.22)";ctx.beginPath();ctx.ellipse(-b.r*.25,-b.r*.3,b.r*.42,b.r*.3,-.5,0,Math.PI*2);ctx.fill();
    const ex=b.r*.42,eyeR=Math.max(2.5,b.r*.13);for(const side of [-1,1]){const ey=side*b.r*.26;if(b.blink){ctx.strokeStyle=COLORS.ink;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(ex-eyeR,ey);ctx.lineTo(ex+eyeR,ey);ctx.stroke()}else{ctx.fillStyle=COLORS.ink;ctx.beginPath();ctx.arc(ex,ey,eyeR,0,Math.PI*2);ctx.fill();ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(ex+eyeR*.3,ey-eyeR*.3,eyeR*.35,0,Math.PI*2);ctx.fill()}}
    ctx.strokeStyle=COLORS.ink;ctx.lineWidth=Math.max(1.5,b.r*.04);ctx.beginPath();ctx.arc(ex+b.r*.12,0,Math.max(1.5,b.r*.06),.15*Math.PI,.85*Math.PI);ctx.stroke();
    if(b.role==="sprout"){ctx.fillStyle="#4f9c58";ctx.beginPath();ctx.ellipse(-b.r*.15,-b.r*.88,14,7,-.55,0,Math.PI*2);ctx.fill()}
    if(b.role==="toasty"){ctx.fillStyle="#f5c356";ctx.beginPath();ctx.arc(-b.r*.25,-b.r*.7,5,0,Math.PI*2);ctx.fill()}
    if(anchored){ctx.fillStyle="rgba(255,255,255,.65)";for(let i=0;i<5;i++){const a=i/5*Math.PI*2+elapsed*.5;ctx.beginPath();ctx.arc(Math.cos(a)*b.r*.7,Math.sin(a)*b.r*.7,b.r*.08,0,Math.PI*2);ctx.fill()}}
    ctx.restore();
    if(b.name!=="You"){ctx.font="800 12px ui-rounded,system-ui";ctx.textAlign="center";ctx.fillStyle="rgba(41,48,68,.62)";ctx.fillText(b.name,b.x,b.y+b.r+19)}
    if(b.bubble) drawBubble(b);
  }
  function drawBubble(b){
    const x=b.x,y=b.y-b.r-66,w=76,h=53;ctx.fillStyle="rgba(255,253,245,.94)";ctx.strokeStyle="rgba(43,48,64,.12)";ctx.lineWidth=3;roundRect(x-w/2,y-h/2,w,h,17);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(x-8,y+h/2-2);ctx.lineTo(x+2,y+h/2+13);ctx.lineTo(x+11,y+h/2-2);ctx.fill();ctx.save();ctx.translate(x,y);
    if(b.bubble==="heart"||b.bubble==="hello"){
      drawHeart(0,1,13,b.bubble==="hello"?"#f3ba52":"#e95c67");if(b.bubble==="hello"){ctx.strokeStyle="#6a7687";ctx.lineWidth=3;ctx.beginPath();ctx.arc(-22,0,7,-1.2,1.2);ctx.stroke();ctx.beginPath();ctx.arc(22,0,7,1.9,4.4);ctx.stroke()}
    }else if(b.bubble==="seedDream"){
      ctx.fillStyle="#76523b";ctx.beginPath();ctx.ellipse(-23,0,6,11,.35,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#7b8890";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-11,0);ctx.lineTo(7,0);ctx.moveTo(2,-5);ctx.lineTo(8,0);ctx.lineTo(2,5);ctx.stroke();ctx.fillStyle="#4b3428";ctx.beginPath();ctx.ellipse(23,3,12,7,0,0,Math.PI*2);ctx.fill();
    }else if(b.bubble==="memory"){
      ctx.strokeStyle="#4d8a53";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,12);ctx.lineTo(0,-9);ctx.stroke();ctx.fillStyle="#72bd70";ctx.beginPath();ctx.ellipse(-8,-7,9,5,-.5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(8,-12,9,5,.5,0,Math.PI*2);ctx.fill();drawHeart(25,9,6,"#e95c67");
    }else if(b.bubble==="fear"){ctx.fillStyle="#6783a1";ctx.font="bold 28px system-ui";ctx.textAlign="center";ctx.fillText("!",0,10)}else if(b.bubble==="warm"){ctx.fillStyle="#f2ae42";ctx.beginPath();ctx.moveTo(0,-17);ctx.quadraticCurveTo(18,0,0,17);ctx.quadraticCurveTo(-18,0,0,-17);ctx.fill()}else if(b.bubble==="leaf"){ctx.fillStyle="#69b76d";ctx.beginPath();ctx.ellipse(0,0,18,10,-.5,0,Math.PI*2);ctx.fill()}else{ctx.fillStyle="#657080";ctx.font="bold 24px system-ui";ctx.textAlign="center";ctx.fillText("?",0,9)}ctx.restore()
  }
  function roundRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
  function drawHeart(x,y,s,c){ctx.save();ctx.translate(x,y);ctx.scale(s/18,s/18);ctx.fillStyle=c;ctx.beginPath();ctx.moveTo(0,14);ctx.bezierCurveTo(-26,-2,-14,-20,0,-8);ctx.bezierCurveTo(14,-20,26,-2,0,14);ctx.fill();ctx.restore()}
  function drawParticles(){for(const p of particles){ctx.globalAlpha=clamp(p.life,0,1);if(p.hearts)drawHeart(p.x,p.y,7,p.color);else{ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,3+p.life*2,0,Math.PI*2);ctx.fill()}}ctx.globalAlpha=1}
  function frame(now){const dt=Math.min(.033,(now-last)/1000||.016);last=now;update(dt);draw();requestAnimationFrame(frame)}
  resize();setupInput();renderMemory();
  const pip=residents[0];setTimeout(()=>setBubble(pip,save.seedPlanted?"memory":"seedDream",3.2),700);
  if(save.seedPlanted)showToast("🌱  The garden remembers.",2.8);
  requestAnimationFrame(frame);
})();
