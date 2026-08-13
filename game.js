/* =====================================================================
   Blob.io — v2: Arena Physics & Environmental Gameplay
   ---------------------------------------------------------------------
   Philosophy shift from v1:
   - NO absorption. Nobody eats anybody.
   - Size = mass, momentum, push/pull force, and a damage buffer.
   - Eliminations come from the ENVIRONMENT: lava, spikes, acid,
     bottomless pits, and the arena edge.
   - The tether is the core combat verb: drag, swing, anchor-slingshot.

   Architecture notes:
   - Hazards are data-defined per map and instantiated through
     HAZARD_TYPES factories exposing update/render/contains/
     onEnter/onStay/onExit. New hazards = new factory + map entry.
   - Abilities live in an ABILITIES registry (anchor is the first one)
     so dash/shove/grapple can be added without refactoring.
   - Entity state stays flat + serializable for a future network layer.
   ===================================================================== */

"use strict";

/* =====================================================================
   1. CONSTANTS
   ===================================================================== */

const EDGE_KILL_MARGIN = 0.8;

const BOT_COUNT = 34;
const PELLET_COUNT = 240;
const PELLET_R = 6;

const START_RADIUS = 26;
const MIN_RADIUS = 15;          // shrink to this => pop
const MAX_RADIUS = 92;
const PELLET_GROWTH_AREA = 110;

// movement feel — momentum-forward tuning
const BASE_SPEED = 270;
const BASE_ACCEL = 950;
const BASE_TURN = 8.0;
const FRICTION = 2.6;

const RESTITUTION = 0.42;
// size = power: bigger blobs hit and pull harder (eat to get stronger)
const PUSH_POWER_SCALE = 0.5;   // impulse bonus per unit of size ratio
const PUSH_POWER_CAP = 2.2;
const TETHER_POWER_SCALE = 0.35; // tether force bonus from the larger blob
const TETHER_POWER_CAP = 1.8;
const EXCESS_SPEED_DECAY = 6;   // impact overspeed decays (not hard-clamped)

// temporary connections
const CONNECT_TTL = 2.0;
const CONNECT_REST_MUL = 1.18;
const CONNECT_BREAK_MUL = 1.95;
const CONNECT_SPRING = 15;
const CONNECT_DAMP = 3.0;
const RECONNECT_COOLDOWN = 1.0;
const EDGE_TENSION_MUL = 1.4;   // tethers pull harder near the rim

// anchor ability
const ANCHOR_DURATION = 1.1;
const ANCHOR_COOLDOWN = 3.5;
const ANCHOR_MASS_MUL = 5.0;

// hazard tuning
const LAVA_DPS_AREA = 1250;     // area drained per second in lava
const LAVA_PULL = 170;          // suction toward pool center, scales with depth
const ACID_DPS_AREA = 380;
const ACID_SPEED_MUL = 0.55;
const ACID_TETHER_DECAY = 3.0;  // tethers dissolve 3x faster in acid
const SPIKE_SPEED_THRESHOLD = 190;
const SPIKE_FAST_DAMAGE = 520;  // area chunk on a fast hit
const SPIKE_SLOW_DAMAGE = 60;
const SPIKE_BOUNCE = 1.15;
const SPIKE_HIT_COOLDOWN = 0.5;
const PIT_GRAVITY = 120;
const ICE_FRICTION_MUL = 0.10;
const ICE_ACCEL_MUL = 0.35;
const MUD_FRICTION_MUL = 3.4;
const MUD_SPEED_MUL = 0.45;
const MUD_ACCEL_MUL = 0.7;

// scoring
const SCORE_PELLET = 10;
const SCORE_DRAIN_PER_AREA = 0.05; // damage costs score (lava ~60/s, acid ~20/s)
const SCORE_SURVIVE_PER_SEC = 2;
const SCORE_HAZARD_KO = 250;    // opponent dies to a hazard after your contact
const SCORE_EDGE_KO = 150;
const KILL_CREDIT_WINDOW = 2.0;

const BOT_RESPAWN_DELAY = 3.0;

const BOT_NAMES = [
  "Noodle", "Bloop", "Grub", "Wob", "Momo", "Tanklet", "Zippy", "Chonk",
  "Pebble", "Squish", "Dumpling", "Beep", "Glorp", "Mochi", "Wiggle",
  "Bumper", "Snacc", "Puddle", "Jelly", "Boop", "Nugget", "Splat",
  "Doodle", "Truffle", "Pip", "Blorbo", "Munch", "Sprout", "Gumbo",
  "Waddle", "Fidget", "Plop", "Toasty", "Crumb", "Bopper", "Squab"
];

const BOT_COLORS = [
  "#5ec8e5", "#8fd66a", "#f7b955", "#c58ef2", "#f78fb3", "#6ee7c8",
  "#f2a25c", "#7fa8f5", "#e8d24b", "#f56d6d", "#5fd6a8", "#d98fe0",
  "#8ce07a", "#f5c76d", "#6dc9f5", "#f58fd0"
];

const PLAYER_COLOR = "#ff7a5c";

/* =====================================================================
   2. MAP DEFINITIONS (data-driven hazard placement)
   ===================================================================== */

const MAPS = {
  caldera: {
    name: "Caldera",
    arenaR: 2000,
    floor: "#eaf6ee",
    hazards: [
      { type: "lava",   x: 0,     y: -700,  r: 250 },
      { type: "lava",   x: 640,   y: 540,   r: 195 },
      { type: "lava",   x: -760,  y: 360,   r: 165 },
      { type: "pit",    x: 920,   y: -520,  r: 130 },
      { type: "acid",   x: -430,  y: -190,  r: 175 },
      { type: "acid",   x: 300,   y: 1000,  r: 145 },
      { type: "spikes", x: 1220,  y: 220,   r: 90 },
      { type: "spikes", x: -320,  y: 1120,  r: 80 },
      { type: "spikes", x: -1220, y: 660,   r: 78 },
      { type: "spikes", x: -1080, y: -640,  r: 85 },
      { type: "ice",    x: -940,  y: -1060, r: 300 },
      { type: "ice",    x: 1070,  y: 920,   r: 260 },
      { type: "mud",    x: 520,   y: -1220, r: 260 },
      { type: "mud",    x: -1360, y: -110,  r: 215 }
    ]
  }
};

let currentMap = MAPS.caldera;
let ARENA_R = currentMap.arenaR;

/* =====================================================================
   3. GAME STATE
   ===================================================================== */

let canvas, ctx, DPR = 1;
let viewW = 0, viewH = 0;

let player = null;
let blobs = [];
let pellets = [];
let hazards = [];
let connections = [];
let pairCooldowns = {};
let particles = [];
let floaters = [];
let respawnQueue = [];
let edgeCracks = [];      // decorative rim cracks, built once per map

let camera = { x: 0, y: 0, zoom: 1 };
let shakeMag = 0;
let elapsed = 0;
let running = false;
let nextId = 1;
let surviveAccum = 0;

/* =====================================================================
   4. ENTITY CREATION
   ===================================================================== */

function areaOf(r) { return Math.PI * r * r; }
function radiusOf(area) { return Math.sqrt(area / Math.PI); }

function makeBlob(opts) {
  const r = opts.radius ?? START_RADIUS;
  return {
    id: nextId++,
    type: opts.type,
    name: opts.name,
    x: opts.x, y: opts.y,
    vx: 0, vy: 0,
    radius: r,
    mass: areaOf(r),
    heading: Math.random() * Math.PI * 2,
    speed: 0,
    color: opts.color,
    score: 0,
    state: "alive",

    inX: 0, inY: 0, inMag: 0,

    // ability slots (anchor for now; dash/shove/etc. later)
    anchorT: 0,
    anchorCd: 0,
    thrustMul: 1,   // >1 = committing momentum (charge, drag); decays to 1

    // per-frame terrain modifiers, reset each frame before hazard pass
    mods: { friction: 1, accel: 1, speed: 1 },
    insideHazards: new Set(),
    spikeCd: 0,
    burnT: 0,       // visual: recently burned
    acidT: 0,       // visual: recently dissolved

    // character animation
    wobbleSeed: Math.random() * 100,
    footPhase: Math.random() * 10,
    blink: 0,
    blinkTimer: 1 + Math.random() * 4,
    squish: 0,

    ai: opts.type === "bot" ? {
      mode: "wander",
      target: null,
      wanderAngle: Math.random() * Math.PI * 2,
      thinkTimer: 0,
      aggression: Math.random(),
      caution: 0.6 + Math.random() * 0.6   // hazard avoidance weight
    } : null,

    lastContactId: 0,
    lastContactTime: -99
  };
}

function randomArenaPoint(margin) {
  const a = Math.random() * Math.PI * 2;
  const d = Math.sqrt(Math.random()) * (ARENA_R - margin);
  return { x: Math.cos(a) * d, y: Math.sin(a) * d };
}

function pointInDeadlyHazard(x, y, pad) {
  for (const h of hazards) {
    if (!h.deadly) continue;
    const dx = x - h.x, dy = y - h.y;
    if (dx * dx + dy * dy < (h.r + pad) * (h.r + pad)) return true;
  }
  return false;
}

function safeSpawnPoint(margin, avoid, avoidDist) {
  for (let i = 0; i < 40; i++) {
    const p = randomArenaPoint(margin);
    if (pointInDeadlyHazard(p.x, p.y, 60)) continue;
    if (avoid) {
      const dx = avoid.x - p.x, dy = avoid.y - p.y;
      if (dx * dx + dy * dy < avoidDist * avoidDist) continue;
    }
    return p;
  }
  return randomArenaPoint(margin);
}

function makePellet() {
  for (let i = 0; i < 30; i++) {
    const p = randomArenaPoint(60);
    if (!pointInDeadlyHazard(p.x, p.y, 20)) {
      return { x: p.x, y: p.y, r: PELLET_R, hue: 100 + Math.random() * 200, pulse: Math.random() * Math.PI * 2 };
    }
  }
  const p = randomArenaPoint(60);
  return { x: p.x, y: p.y, r: PELLET_R, hue: 100 + Math.random() * 200, pulse: Math.random() * Math.PI * 2 };
}

function buildEdgeCracks() {
  edgeCracks = [];
  for (let i = 0; i < 42; i++) {
    const a = Math.random() * Math.PI * 2;
    const len = 40 + Math.random() * 120;
    const inward = 10 + Math.random() * 60;
    const r0 = ARENA_R - inward;
    const pts = [];
    let cx = Math.cos(a) * r0, cy = Math.sin(a) * r0;
    let dir = a + Math.PI + (Math.random() - 0.5) * 1.2;
    const segs = 3 + Math.floor(Math.random() * 3);
    pts.push([cx, cy]);
    for (let s = 0; s < segs; s++) {
      dir += (Math.random() - 0.5) * 1.1;
      cx += Math.cos(dir) * (len / segs);
      cy += Math.sin(dir) * (len / segs);
      pts.push([cx, cy]);
    }
    edgeCracks.push(pts);
  }
}

function initGame() {
  ARENA_R = currentMap.arenaR;
  blobs = [];
  pellets = [];
  connections = [];
  pairCooldowns = {};
  particles = [];
  floaters = [];
  respawnQueue = [];
  elapsed = 0;
  surviveAccum = 0;
  shakeMag = 0;

  hazards = currentMap.hazards.map(def => HAZARD_TYPES[def.type].create(def));
  buildEdgeCracks();

  const start = safeSpawnPoint(ARENA_R * 0.5, null, 0);
  player = makeBlob({
    type: "player", name: "You",
    x: start.x, y: start.y,
    radius: START_RADIUS, color: PLAYER_COLOR
  });
  blobs.push(player);

  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  for (let i = 0; i < BOT_COUNT; i++) {
    const p = safeSpawnPoint(80, player, 260);
    blobs.push(makeBlob({
      type: "bot",
      name: names[i % names.length],
      x: p.x, y: p.y,
      radius: 18 + Math.random() * 22,
      color: BOT_COLORS[i % BOT_COLORS.length]
    }));
  }

  for (let i = 0; i < PELLET_COUNT; i++) pellets.push(makePellet());

  camera.x = player.x;
  camera.y = player.y;
  camera.zoom = 1;
  running = true;
}

/* =====================================================================
   5. ABILITIES (registry — anchor first, more slot in later)
   ===================================================================== */

const ABILITIES = {
  anchor: {
    duration: ANCHOR_DURATION,
    cooldown: ANCHOR_COOLDOWN,
    tryActivate(b) {
      if (b.anchorCd > 0 || b.anchorT > 0) return false;
      b.anchorT = this.duration;
      b.anchorCd = this.cooldown + this.duration;
      spawnRing(b.x, b.y, b.radius, b.color);
      return true;
    },
    isActive(b) { return b.anchorT > 0; }
  }
  // future: dash, shove, grapplePull, tetherRelease, shield, ...
};

/* =====================================================================
   6. HAZARD SYSTEM
   Factories return objects with a uniform interface:
   { type, x, y, r, deadly, update(dt), render(ctx),
     contains(blob), onEnter(blob), onStay(blob, dt), onExit(blob) }
   ===================================================================== */

function centerInside(h, b, frac) {
  const dx = b.x - h.x, dy = b.y - h.y;
  const rr = h.r * (frac ?? 1);
  return dx * dx + dy * dy < rr * rr;
}

function overlaps(h, b) {
  const dx = b.x - h.x, dy = b.y - h.y;
  const rr = h.r + b.radius;
  return dx * dx + dy * dy < rr * rr;
}

const HAZARD_TYPES = {

  /* ---- LAVA: constant burn, gentle center pull, pops the lingerers ---- */
  lava: {
    create(def) {
      return {
        type: "lava", x: def.x, y: def.y, r: def.r, deadly: true,
        update(dt) {},
        contains(b) { return centerInside(this, b, 1); },
        onEnter(b) {
          spawnBurst(b.x, b.y, "#ff9d45", 6);
          if (b === player) shakeMag = Math.max(shakeMag, 6);
        },
        onStay(b, dt) {
          b.burnT = 0.35;
          b.mods.speed *= 0.7;
          b.mods.accel *= 0.7;    // sluggish in the melt — escapes cost commitment
          // suction scales with depth: rim is escapable, the middle is not
          const dx = this.x - b.x, dy = this.y - b.y;
          const d = Math.hypot(dx, dy) || 1;
          const depth = 1 - d / this.r;                 // 0 at rim, 1 at center
          const pull = LAVA_PULL * (0.4 + depth * 2.2);
          b.vx += (dx / d) * pull * dt;
          b.vy += (dy / d) * pull * dt;
          damage(b, LAVA_DPS_AREA * dt, "lava");
          if (Math.random() < dt * 8) {
            spawnBurst(b.x + (Math.random() - 0.5) * b.radius, b.y + (Math.random() - 0.5) * b.radius, "#ff7a30", 1);
          }
          if (b === player) shakeMag = Math.max(shakeMag, 3);
        },
        onExit(b) {},
        render(c) { renderLava(c, this); }
      };
    }
  },

  /* ---- SPIKES: burst momentum, snap tethers, chunk damage at speed ---- */
  spikes: {
    create(def) {
      return {
        type: "spikes", x: def.x, y: def.y, r: def.r, deadly: true,
        update(dt) {},
        contains(b) { return overlaps(this, b); },
        onEnter(b) {
          if (b.spikeCd > 0) return;
          b.spikeCd = SPIKE_HIT_COOLDOWN;
          const dx = b.x - this.x, dy = b.y - this.y;
          const d = Math.hypot(dx, dy) || 1;
          const nx = dx / d, ny = dy / d;
          const spd = Math.hypot(b.vx, b.vy);

          if (spd > SPIKE_SPEED_THRESHOLD) {
            // violent hit: reflect + amplify, break tethers, big chunk
            const vn = b.vx * nx + b.vy * ny;
            b.vx = (b.vx - 2 * vn * nx) * SPIKE_BOUNCE;
            b.vy = (b.vy - 2 * vn * ny) * SPIKE_BOUNCE;
            breakTethersOf(b);
            damage(b, SPIKE_FAST_DAMAGE * (0.6 + spd / 600), "spikes");
            b.squish = 1;
            spawnBurst(b.x, b.y, b.color, 10);
            spawnBurst(b.x, b.y, "#aab2bd", 6);
            if (b === player) shakeMag = Math.max(shakeMag, 10);
          } else {
            // grazing contact: shove out, sting
            b.vx += nx * 160; b.vy += ny * 160;
            damage(b, SPIKE_SLOW_DAMAGE, "spikes");
            spawnBurst(b.x, b.y, "#aab2bd", 3);
          }
        },
        onStay(b, dt) {
          // keep pushing intruders out so nobody rests on spikes
          const dx = b.x - this.x, dy = b.y - this.y;
          const d = Math.hypot(dx, dy) || 1;
          b.vx += (dx / d) * 420 * dt;
          b.vy += (dy / d) * 420 * dt;
        },
        onExit(b) {},
        render(c) { renderSpikes(c, this); }
      };
    }
  },

  /* ---- ACID: slow dissolve, slow movement, melts tethers ---- */
  acid: {
    create(def) {
      return {
        type: "acid", x: def.x, y: def.y, r: def.r, deadly: true,
        update(dt) {},
        contains(b) { return centerInside(this, b, 1); },
        onEnter(b) { spawnBurst(b.x, b.y, "#a3e05a", 5); },
        onStay(b, dt) {
          b.acidT = 0.35;
          b.mods.speed *= ACID_SPEED_MUL;
          b.mods.accel *= 0.55;   // swampy immediately, not just capped
          damage(b, ACID_DPS_AREA * dt, "acid");
        },
        onExit(b) {},
        render(c) { renderAcid(c, this); }
      };
    }
  },

  /* ---- PIT: inner gravity well, instant elimination at the throat ---- */
  pit: {
    create(def) {
      return {
        type: "pit", x: def.x, y: def.y, r: def.r, deadly: true,
        update(dt) {},
        contains(b) { return centerInside(this, b, 1.6); },  // gravity zone
        onEnter(b) {},
        onStay(b, dt) {
          const dx = this.x - b.x, dy = this.y - b.y;
          const d = Math.hypot(dx, dy) || 1;
          // gravity ramps toward the throat
          const g = PIT_GRAVITY * (1.6 - d / this.r);
          b.vx += (dx / d) * Math.max(0, g) * dt * 4;
          b.vy += (dy / d) * Math.max(0, g) * dt * 4;
          if (d < this.r * 0.62) {
            killBlob(b, "gone!", "fell into the void", hazardKillerOf(b));
          }
        },
        onExit(b) {},
        render(c) { renderPit(c, this); }
      };
    }
  },

  /* ---- ICE: terrain — near-zero friction, weak steering ---- */
  ice: {
    create(def) {
      return {
        type: "ice", x: def.x, y: def.y, r: def.r, deadly: false,
        update(dt) {},
        contains(b) { return centerInside(this, b, 1); },
        onEnter(b) {},
        onStay(b, dt) {
          b.mods.friction *= ICE_FRICTION_MUL;
          b.mods.accel *= ICE_ACCEL_MUL;
        },
        onExit(b) {},
        render(c) { renderIce(c, this); }
      };
    }
  },

  /* ---- MUD: terrain — heavy drag, great anchor ground ---- */
  mud: {
    create(def) {
      return {
        type: "mud", x: def.x, y: def.y, r: def.r, deadly: false,
        update(dt) {},
        contains(b) { return centerInside(this, b, 1); },
        onEnter(b) {},
        onStay(b, dt) {
          b.mods.friction *= MUD_FRICTION_MUL;
          b.mods.speed *= MUD_SPEED_MUL;
          b.mods.accel *= MUD_ACCEL_MUL;
        },
        onExit(b) {},
        render(c) { renderMud(c, this); }
      };
    }
  }
};

function updateHazards(dt) {
  for (const h of hazards) h.update(dt);

  for (const b of blobs) {
    if (b.state !== "alive") continue;
    b.mods.friction = 1; b.mods.accel = 1; b.mods.speed = 1;
    if (b.spikeCd > 0) b.spikeCd -= dt;
    if (b.burnT > 0) b.burnT -= dt;
    if (b.acidT > 0) b.acidT -= dt;

    for (const h of hazards) {
      const inside = h.contains(b);
      const was = b.insideHazards.has(h);
      if (inside && !was) { b.insideHazards.add(h); h.onEnter(b); }
      if (inside) h.onStay(b, dt);
      if (!inside && was) { b.insideHazards.delete(h); h.onExit(b); }
      if (b.state !== "alive") break;
    }
  }
}

function damage(b, area, source) {
  if (b.state !== "alive") return;
  // losing body costs score too — the leaderboard reflects the beating
  const drain = area * SCORE_DRAIN_PER_AREA;
  b.score = Math.max(0, b.score - drain);
  if (b === player) {
    b.drainAccum = (b.drainAccum || 0) + drain;
    if (b.drainAccum >= 15) {
      addFloater(b.x, b.y - b.radius - 14, "-" + Math.floor(b.drainAccum), "#e05a3e");
      b.drainAccum = 0;
    }
  }
  const newArea = areaOf(b.radius) - area;
  if (newArea <= areaOf(MIN_RADIUS)) {
    const reasons = {
      lava: "melted in lava",
      acid: "dissolved in acid",
      spikes: "popped on the spikes"
    };
    const titles = { lava: "melted!", acid: "dissolved!", spikes: "spiked!" };
    killBlob(b, titles[source] || "popped!", reasons[source] || "popped", hazardKillerOf(b));
    return;
  }
  b.radius = radiusOf(newArea);
  b.mass = areaOf(b.radius);
}

function hazardKillerOf(b) {
  if (elapsed - b.lastContactTime <= KILL_CREDIT_WINDOW) {
    const k = blobs.find(o => o.id === b.lastContactId && o.state === "alive");
    return k || null;
  }
  return null;
}

function nearestDeadlyHazard(x, y) {
  let best = null, bestD = Infinity;
  for (const h of hazards) {
    if (!h.deadly) continue;
    const d = Math.hypot(h.x - x, h.y - y) - h.r;
    if (d < bestD) { best = h; bestD = d; }
  }
  return { hazard: best, dist: bestD };
}

/* =====================================================================
   7. INPUT HANDLING
   ===================================================================== */

const keys = {};
let pointer = { active: false, sx: 0, sy: 0, x: 0, y: 0 };
let anchorHeld = false;
let hintFaded = false;

function setupInput() {
  window.addEventListener("keydown", e => {
    keys[e.code] = true;
    if (e.code === "Space") { anchorHeld = true; e.preventDefault(); }
    fadeHint();
  });
  window.addEventListener("keyup", e => {
    keys[e.code] = false;
    if (e.code === "Space") anchorHeld = false;
  });

  canvas.addEventListener("pointerdown", e => {
    pointer.active = true;
    pointer.sx = pointer.x = e.clientX;
    pointer.sy = pointer.y = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    fadeHint();
  });
  canvas.addEventListener("pointermove", e => {
    if (!pointer.active) return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  });
  const endPointer = () => { pointer.active = false; };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  const btn = document.getElementById("anchorBtn");
  btn.addEventListener("pointerdown", e => { anchorHeld = true; e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener("pointerup",   () => { anchorHeld = false; });
  btn.addEventListener("pointerleave",() => { anchorHeld = false; });

  document.getElementById("restartBtn").addEventListener("click", () => {
    document.getElementById("deathOverlay").classList.add("hidden");
    initGame();
  });
}

function fadeHint() {
  if (hintFaded) return;
  hintFaded = true;
  setTimeout(() => document.getElementById("hint").classList.add("fade"), 4000);
}

function readPlayerInput() {
  if (!player || player.state !== "alive") return;

  let ix = 0, iy = 0;
  if (keys["KeyW"] || keys["ArrowUp"])    iy -= 1;
  if (keys["KeyS"] || keys["ArrowDown"])  iy += 1;
  if (keys["KeyA"] || keys["ArrowLeft"])  ix -= 1;
  if (keys["KeyD"] || keys["ArrowRight"]) ix += 1;

  let mag = 0;
  if (ix !== 0 || iy !== 0) {
    const len = Math.hypot(ix, iy);
    ix /= len; iy /= len;
    mag = 1;
  } else if (pointer.active) {
    const dx = pointer.x - pointer.sx;
    const dy = pointer.y - pointer.sy;
    const len = Math.hypot(dx, dy);
    if (len > 8) {
      ix = dx / len; iy = dy / len;
      mag = Math.min(1, len / 70);
    }
  }

  player.inX = ix; player.inY = iy; player.inMag = mag;

  if (anchorHeld) ABILITIES.anchor.tryActivate(player);
}

/* =====================================================================
   8. BOT AI — hazard-aware
   Modes: wander / seek / flee / hunt / drag / escape
   - avoid deadly hazards (weighted by personality "caution")
   - when tethered: drag opponents toward hazards, or escape + anchor
     if they're the ones being dragged
   ===================================================================== */

function connectionPartner(b) {
  for (const c of connections) {
    if (c.a === b) return c.b;
    if (c.b === b) return c.a;
  }
  return null;
}

function updateBotAI(b, dt) {
  const ai = b.ai;
  ai.thinkTimer -= dt;

  const partner = connectionPartner(b);

  if (ai.thinkTimer <= 0) {
    ai.thinkTimer = 0.22 + Math.random() * 0.25;

    if (partner && partner.state === "alive") {
      // tethered: fight over position
      const nearMe = nearestDeadlyHazard(b.x, b.y);
      const nearThem = nearestDeadlyHazard(partner.x, partner.y);
      const iAmInDanger = nearMe.dist < 200 + b.radius;
      const theyAreCloser = nearThem.dist < nearMe.dist;

      if (iAmInDanger && !theyAreCloser) {
        ai.mode = "escape"; ai.target = partner;
      } else if (nearThem.hazard && nearThem.dist < 520 && ai.aggression > 0.3) {
        ai.mode = "drag"; ai.target = partner; ai.dragHazard = nearThem.hazard;
      } else {
        ai.mode = "escape"; ai.target = partner;
      }
    } else {
      // free roam
      let threat = null, threatD = Infinity;
      let prey = null, preyD = Infinity;
      for (const o of blobs) {
        if (o === b || o.state !== "alive") continue;
        const d = Math.hypot(o.x - b.x, o.y - b.y);
        // "threat" now = anyone notably heavier who is close (they push harder)
        if (o.mass > b.mass * 1.6 && d < 240 + b.radius * 2 && d < threatD) {
          threat = o; threatD = d;
        }
        if (d < 460 && d < preyD) { prey = o; preyD = d; }
      }

      if (threat && ai.aggression < 0.75) {
        ai.mode = "flee"; ai.target = threat;
      } else if (prey && ai.aggression > 0.55 && Math.random() < 0.6) {
        // hunt: close distance to start a tether, ideally near a hazard
        ai.mode = "hunt"; ai.target = prey;
      } else {
        let best = null, bestD = 520 * 520;
        for (const p of pellets) {
          const dx = p.x - b.x, dy = p.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD) { best = p; bestD = d2; }
        }
        if (best) { ai.mode = "seek"; ai.target = best; }
        else { ai.mode = "wander"; ai.target = null; }
      }

      if (ai.mode === "wander") ai.wanderAngle += (Math.random() - 0.5) * 1.6;
    }
  }

  // ---- steering vector from mode ----
  let ix = 0, iy = 0;

  if (ai.mode === "flee" && ai.target && ai.target.state === "alive") {
    ix = b.x - ai.target.x; iy = b.y - ai.target.y;

  } else if (ai.mode === "hunt" && ai.target && ai.target.state === "alive") {
    ix = ai.target.x - b.x; iy = ai.target.y - b.y;
    // CHARGE: if the target sits between us and a hazard, ram them into it
    const nt = nearestDeadlyHazard(ai.target.x, ai.target.y);
    if (nt.hazard && nt.dist < 500) {
      const toT = Math.hypot(ix, iy) || 1;
      const thx = nt.hazard.x - ai.target.x, thy = nt.hazard.y - ai.target.y;
      const thd = Math.hypot(thx, thy) || 1;
      const align = (ix / toT) * (thx / thd) + (iy / toT) * (thy / thd);
      if (align > 0.65) b.thrustMul = 1.9;   // full-commit ram
    }

  } else if (ai.mode === "drag" && partner && ai.dragHazard) {
    // skirt the hazard rim so the tether swings the partner inward
    const h = ai.dragHazard;
    const dx = b.x - h.x, dy = b.y - h.y;
    const d = Math.hypot(dx, dy) || 1;
    const rimX = h.x + (dx / d) * (h.r + b.radius + 40);
    const rimY = h.y + (dy / d) * (h.r + b.radius + 40);
    // orbit direction: whichever tangent moves the partner toward the hazard
    const tx = -dy / d, ty = dx / d;
    const toPartnerX = partner.x - b.x, toPartnerY = partner.y - b.y;
    const side = (tx * toPartnerX + ty * toPartnerY) > 0 ? -1 : 1;
    ix = (rimX - b.x) * 1.2 + tx * side * 220;
    iy = (rimY - b.y) * 1.2 + ty * side * 220;
    b.thrustMul = Math.max(b.thrustMul, 1.35);   // lean hard into the drag

    // slingshot: if partner is already flying toward the hazard, anchor
    const phx = h.x - partner.x, phy = h.y - partner.y;
    const phd = Math.hypot(phx, phy) || 1;
    const closing = (partner.vx * phx + partner.vy * phy) / phd;
    if (closing > 200) ABILITIES.anchor.tryActivate(b);

  } else if (ai.mode === "escape" && partner) {
    // run from the nearest hazard, and from the partner a bit
    const nm = nearestDeadlyHazard(b.x, b.y);
    if (nm.hazard) {
      ix = (b.x - nm.hazard.x); iy = (b.y - nm.hazard.y);
    }
    ix += (b.x - partner.x) * 0.4;
    iy += (b.y - partner.y) * 0.4;

    // being dragged toward danger fast? dig in
    if (nm.hazard) {
      const hx = nm.hazard.x - b.x, hy = nm.hazard.y - b.y;
      const hd = Math.hypot(hx, hy) || 1;
      const closing = (b.vx * hx + b.vy * hy) / hd;
      if (closing > 170 && nm.dist < 320) ABILITIES.anchor.tryActivate(b);
    }

  } else if ((ai.mode === "seek") && ai.target) {
    ix = ai.target.x - b.x; iy = ai.target.y - b.y;
  }

  if (ai.mode === "wander") {
    ix = Math.cos(ai.wanderAngle); iy = Math.sin(ai.wanderAngle);
  }

  // ---- deadly hazard avoidance (personality-weighted) ----
  // panic (flee) and target fixation (hunt) degrade judgment — this is
  // what turns pressure into environmental eliminations
  const panicMul = ai.mode === "flee" ? 0.3 : ai.mode === "hunt" ? 0.5 : 1;
  const dragTarget = ai.mode === "drag" ? ai.dragHazard : null;
  for (const h of hazards) {
    if (!h.deadly) continue;
    const dx = b.x - h.x, dy = b.y - h.y;
    const d = Math.hypot(dx, dy) || 1;
    const zone = h.r + b.radius * 2 + 110;
    if (d < zone) {
      const w = (1 - d / zone) * 900 * ai.caution * panicMul * (h === dragTarget ? 0.3 : 1);
      ix += (dx / d) * w;
      iy += (dy / d) * w;
    }
  }

  // ---- edge avoidance (also weaker under pressure: corners exist) ----
  const dc = Math.hypot(b.x, b.y);
  const edgeZone = ARENA_R - b.radius * 4 - 60;
  if (dc > edgeZone) {
    const edgeMul = (ai.mode === "flee" || ai.mode === "escape") ? 0.5 : 1;
    const w = Math.min(1, (dc - edgeZone) / 160) * 2.2 * edgeMul;
    ix += (-b.x / dc) * w * 300;
    iy += (-b.y / dc) * w * 300;
  }

  const len = Math.hypot(ix, iy);
  if (len > 0.001) {
    b.inX = ix / len; b.inY = iy / len;
    b.inMag = (ai.mode === "flee" || ai.mode === "escape" || ai.mode === "drag") ? 1 : 0.85;
  } else {
    b.inMag = 0;
  }
}

/* =====================================================================
   9. PHYSICS (momentum-forward movement, terrain mods, arena boundary)
   ===================================================================== */

function sizeFactor(b) { return START_RADIUS / b.radius; }

function effMass(b) {
  return b.mass * (b.anchorT > 0 ? ANCHOR_MASS_MUL : 1);
}

function updateMovement(b, dt) {
  const sf = sizeFactor(b);
  const maxSpeed = BASE_SPEED * Math.pow(sf, 0.35) * b.mods.speed;
  const accel = BASE_ACCEL * Math.pow(sf, 0.22) * b.mods.accel;
  const turnRate = BASE_TURN * Math.pow(sf, 0.55);

  if (b.inMag > 0.01) {
    const desired = Math.atan2(b.inY, b.inX);
    let diff = desired - b.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = turnRate * dt;
    b.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));
  }

  const anchored = b.anchorT > 0;
  const thrust = anchored ? 0 : accel * b.inMag * b.thrustMul;
  b.vx += Math.cos(b.heading) * thrust * dt;
  b.vy += Math.sin(b.heading) * thrust * dt;
  b.thrustMul = Math.max(1, b.thrustMul - dt * 2.2);   // commitment decays

  // momentum emphasis: bigger blobs shed less speed per second
  const massDrag = Math.pow(sf, 0.22);           // <1 for big blobs
  const fr = FRICTION * massDrag * b.mods.friction * (anchored ? 4.5 : 1);
  const damp = Math.max(0, 1 - fr * dt);
  b.vx *= damp;
  b.vy *= damp;

  b.speed = Math.hypot(b.vx, b.vy);
  const cap = anchored ? maxSpeed * 0.3 : maxSpeed * 1.8 * Math.sqrt(b.thrustMul);
  if (b.speed > cap) {
    if (anchored) {
      b.vx *= cap / b.speed; b.vy *= cap / b.speed; b.speed = cap;   // anchor kills momentum hard
    } else {
      // decay only the EXCESS: big hits carry, thrust alone still can't sustain it
      const newSpeed = cap + (b.speed - cap) * Math.exp(-EXCESS_SPEED_DECAY * dt);
      const s = newSpeed / b.speed;
      b.vx *= s; b.vy *= s; b.speed = newSpeed;
    }
  }

  b.x += b.vx * dt;
  b.y += b.vy * dt;

  if (b.anchorT > 0) b.anchorT -= dt;
  if (b.anchorCd > 0) b.anchorCd -= dt;
  if (b.squish > 0) b.squish = Math.max(0, b.squish - dt * 3.5);

  b.blinkTimer -= dt;
  if (b.blinkTimer <= 0) { b.blink = 0.14; b.blinkTimer = 2 + Math.random() * 4; }
  if (b.blink > 0) b.blink -= dt;

  b.footPhase += dt * (4 + b.speed * 0.05);

  // arena boundary: saturating spring. Slow drift and deliberate
  // self-walking are always repelled (force plateau exceeds thrust),
  // but a committed SHOVE carries enough momentum to breach it.
  const dc = Math.hypot(b.x, b.y);
  if (dc > ARENA_R - b.radius) {
    const over = dc - (ARENA_R - b.radius);
    const nx = b.x / dc, ny = b.y / dc;
    const push = Math.min(over, 12) * 14;      // plateau: exceeds max self-thrust
    b.vx -= nx * push * dt * 8;
    b.vy -= ny * push * dt * 8;

    // outward-velocity damping: the discriminator between DRIVING (safe —
    // thrust can't beat plateau + damping) and being THROWN (ballistic
    // momentum punches through before it decays)
    const vOut = b.vx * nx + b.vy * ny;
    if (vOut > 0) {
      const k = Math.min(1, 16 * dt);
      b.vx -= nx * vOut * k;
      b.vy -= ny * vOut * k;
    }

    // dust + shake near the rim
    if (Math.random() < dt * 10) spawnBurst(b.x, b.y, "#c9b8a0", 1);
    if (b === player) shakeMag = Math.max(shakeMag, Math.min(8, over * 0.15));

    // lethal once the CENTER crosses the rim: a committed shove carries
    // you over, a slow graze gets pushed back by the spring first
    if (dc > ARENA_R) {
      killBlob(b, "yeeted!", "pushed out of the arena", hazardKillerOf(b), SCORE_EDGE_KO);
    }
  }
}

/* =====================================================================
   10. COLLISIONS (blob-blob push, pellets) — no absorption anymore
   ===================================================================== */

function updateCollisions(dt) {
  for (let i = 0; i < blobs.length; i++) {
    const a = blobs[i];
    if (a.state !== "alive") continue;
    for (let j = i + 1; j < blobs.length; j++) {
      const b = blobs[j];
      if (b.state !== "alive") continue;

      const dx = b.x - a.x, dy = b.y - a.y;
      const rSum = a.radius + b.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rSum * rSum) continue;

      const d = Math.sqrt(d2) || 0.001;
      const nx = dx / d, ny = dy / d;

      const ma = effMass(a), mb = effMass(b);
      const totalM = ma + mb;

      const overlap = rSum - d;
      const sepA = overlap * (mb / totalM);
      const sepB = overlap * (ma / totalM);
      a.x -= nx * sepA; a.y -= ny * sepA;
      b.x += nx * sepB; b.y += ny * sepB;

      const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
      const velN = rvx * nx + rvy * ny;
      if (velN < 0) {
        // bigger blob in the pair amplifies the exchange: growth buys punch
        const ratio = Math.max(a.radius, b.radius) / Math.min(a.radius, b.radius);
        const powerMul = Math.min(PUSH_POWER_CAP, 1 + (ratio - 1) * PUSH_POWER_SCALE);
        const imp = -(1 + RESTITUTION) * velN / (1 / ma + 1 / mb) * powerMul;
        a.vx -= (imp / ma) * nx; a.vy -= (imp / ma) * ny;
        b.vx += (imp / mb) * nx; b.vy += (imp / mb) * ny;

        const velT = rvx * -ny + rvy * nx;
        const spin = velT * 0.0035;
        a.heading += spin * (mb / totalM) * 2;
        b.heading += spin * (ma / totalM) * 2;

        const hit = Math.min(1, -velN / 400);
        a.squish = Math.min(1, a.squish + hit * (mb / totalM) * 1.6);
        b.squish = Math.min(1, b.squish + hit * (ma / totalM) * 1.6);
      }

      a.lastContactId = b.id; a.lastContactTime = elapsed;
      b.lastContactId = a.id; b.lastContactTime = elapsed;

      tryConnect(a, b);
    }
  }

  for (const b of blobs) {
    if (b.state !== "alive") continue;
    for (let k = pellets.length - 1; k >= 0; k--) {
      const p = pellets[k];
      const dx = p.x - b.x, dy = p.y - b.y;
      const rr = b.radius + p.r;
      if (dx * dx + dy * dy < rr * rr) {
        pellets[k] = makePellet();
        grow(b, PELLET_GROWTH_AREA);
        b.score += SCORE_PELLET;
        if (b === player) addFloater(b.x, b.y - b.radius, "+" + SCORE_PELLET, "#7a8a7f");
      }
    }
  }
}

function grow(b, area) {
  const newArea = Math.min(areaOf(MAX_RADIUS), areaOf(b.radius) + area);
  b.radius = Math.max(MIN_RADIUS, radiusOf(newArea));
  b.mass = areaOf(b.radius);
}

function killBlob(b, title, reason, killer, koScore) {
  if (b.state !== "alive") return;
  b.state = "dead";
  spawnBurst(b.x, b.y, b.color, Math.floor(8 + b.radius * 0.3));

  if (killer) {
    killer.score += koScore ?? SCORE_HAZARD_KO;
    if (killer === player) {
      addFloater(player.x, player.y - player.radius, b.name + " KO! +" + (koScore ?? SCORE_HAZARD_KO), PLAYER_COLOR);
    }
  }

  connections = connections.filter(c => c.a !== b && c.b !== b);
  b.insideHazards.clear();

  if (b.type === "bot") {
    respawnQueue.push({ name: b.name, color: b.color, t: BOT_RESPAWN_DELAY });
  } else {
    running = false;
    showDeath(title, reason);
  }
}

function sweepDead() {
  blobs = blobs.filter(b => b.state === "alive" || b === player);
}

function updateRespawns(dt) {
  for (let i = respawnQueue.length - 1; i >= 0; i--) {
    const r = respawnQueue[i];
    r.t -= dt;
    if (r.t <= 0) {
      const p = safeSpawnPoint(100, player, 400);
      blobs.push(makeBlob({
        type: "bot", name: r.name,
        x: p.x, y: p.y,
        radius: 18 + Math.random() * 10,
        color: r.color
      }));
      respawnQueue.splice(i, 1);
    }
  }
}

/* =====================================================================
   11. CONNECTIONS (tethers — the combat verb)
   ===================================================================== */

function pairKey(a, b) {
  return a.id < b.id ? a.id + "-" + b.id : b.id + "-" + a.id;
}

function tryConnect(a, b) {
  const key = pairKey(a, b);
  if ((pairCooldowns[key] || 0) > elapsed) return;
  if (connections.some(c => c.key === key)) return;

  connections.push({
    key, a, b,
    ttl: CONNECT_TTL,
    rest: (a.radius + b.radius) * CONNECT_REST_MUL
  });
}

function breakTethersOf(b) {
  for (const c of connections) {
    if (c.a === b || c.b === b) pairCooldowns[c.key] = elapsed + RECONNECT_COOLDOWN;
  }
  connections = connections.filter(c => c.a !== b && c.b !== b);
}

function connectionInAcid(c) {
  const mx = (c.a.x + c.b.x) / 2, my = (c.a.y + c.b.y) / 2;
  for (const h of hazards) {
    if (h.type !== "acid") continue;
    const dx = mx - h.x, dy = my - h.y;
    if (dx * dx + dy * dy < h.r * h.r) return true;
  }
  return false;
}

function updateConnections(dt) {
  for (let i = connections.length - 1; i >= 0; i--) {
    const c = connections[i];

    // acid melts tethers fast
    c.ttl -= dt * (connectionInAcid(c) ? ACID_TETHER_DECAY : 1);

    const a = c.a, b = c.b;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 0.001;

    const snapped = d > c.rest * CONNECT_BREAK_MUL;
    const expired = c.ttl <= 0 || a.state !== "alive" || b.state !== "alive";

    if (snapped || expired) {
      pairCooldowns[c.key] = elapsed + RECONNECT_COOLDOWN;
      if (snapped) {
        spawnBurst((a.x + b.x) / 2, (a.y + b.y) / 2, "#ffffff", 5);
      }
      connections.splice(i, 1);
      continue;
    }

    // refresh contact attribution while tethered
    a.lastContactId = b.id; a.lastContactTime = elapsed;
    b.lastContactId = a.id; b.lastContactTime = elapsed;

    const nx = dx / d, ny = dy / d;
    const stretch = d - c.rest;
    const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    const relN = rvx * nx + rvy * ny;

    const life = Math.min(1, c.ttl / CONNECT_TTL + 0.35);

    // extra tension near the rim: edge fights feel taut
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const edgeFactor = Math.hypot(mx, my) > ARENA_R * 0.82 ? EDGE_TENSION_MUL : 1;

    const sizePower = Math.min(TETHER_POWER_CAP,
      1 + (Math.max(a.radius, b.radius) / START_RADIUS - 1) * TETHER_POWER_SCALE);
    const f = (stretch * CONNECT_SPRING + relN * CONNECT_DAMP) * life * edgeFactor * sizePower;

    const ma = effMass(a), mb = effMass(b);
    const inv = 1 / ma + 1 / mb;
    const impulse = f / inv * dt;

    a.vx += (impulse / ma) * nx; a.vy += (impulse / ma) * ny;
    b.vx -= (impulse / mb) * nx; b.vy -= (impulse / mb) * ny;
  }
}

/* =====================================================================
   12. PARTICLES + FLOATING TEXT
   ===================================================================== */

function spawnBurst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 60 + Math.random() * 220;
    particles.push({
      x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.4 + Math.random() * 0.4,
      maxLife: 0.8,
      size: 3 + Math.random() * 5,
      color
    });
  }
}

function spawnRing(x, y, r, color) {
  particles.push({ x, y, vx: 0, vy: 0, life: 0.45, maxLife: 0.45, size: r, color, ring: true });
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.94; p.vy *= 0.94;
    if (p.ring) p.size += dt * 220;
  }
}

function addFloater(x, y, text, color) {
  floaters.push({ x, y, text, color, life: 1.1 });
}

function updateFloaters(dt) {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.life -= dt;
    f.y -= 34 * dt;
    if (f.life <= 0) floaters.splice(i, 1);
  }
}

/* =====================================================================
   13. RENDERING
   ===================================================================== */

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  canvas.width = viewW * DPR;
  canvas.height = viewH * DPR;
}

function updateCamera(dt) {
  if (!player) return;
  const targetZoom = Math.max(0.6, Math.min(1.1, Math.pow(START_RADIUS / player.radius, 0.28)));
  camera.zoom += (targetZoom - camera.zoom) * Math.min(1, dt * 2);
  camera.x += (player.x - camera.x) * Math.min(1, dt * 5);
  camera.y += (player.y - camera.y) * Math.min(1, dt * 5);
  shakeMag = Math.max(0, shakeMag - dt * 22);
}

function worldToScreenSetup() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const ox = (Math.random() - 0.5) * 2 * shakeMag;
  const oy = (Math.random() - 0.5) * 2 * shakeMag;
  ctx.translate(viewW / 2 + ox, viewH / 2 + oy);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = "#dff0e4";
  ctx.fillRect(0, 0, viewW, viewH);

  worldToScreenSetup();

  drawArena();
  for (const h of hazards) h.render(ctx);
  drawPellets();
  drawConnections();

  const sorted = [...blobs].sort((a, b) => a.radius - b.radius);
  for (const b of sorted) if (b.state === "alive") drawBlob(b);

  drawParticles();
  drawFloaters();
}

function drawArena() {
  // outside = void
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_R + 3000, 0, Math.PI * 2);
  ctx.arc(0, 0, ARENA_R, 0, Math.PI * 2, true);
  ctx.fillStyle = "rgba(120, 90, 80, 0.18)";
  ctx.fill();
  ctx.restore();

  // playfield
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_R, 0, Math.PI * 2);
  ctx.fillStyle = currentMap.floor;
  ctx.fill();

  // warning band inside the rim
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_R - 45, 0, Math.PI * 2);
  ctx.lineWidth = 90;
  ctx.strokeStyle = "rgba(224, 90, 62, 0.10)";
  ctx.stroke();

  // dot grid near camera
  const grid = 130;
  const half = Math.max(viewW, viewH) / camera.zoom * 0.65;
  const x0 = Math.floor((camera.x - half) / grid) * grid;
  const x1 = camera.x + half;
  const y0 = Math.floor((camera.y - half) / grid) * grid;
  const y1 = camera.y + half;
  ctx.fillStyle = "rgba(43, 48, 64, 0.06)";
  for (let x = x0; x < x1; x += grid) {
    for (let y = y0; y < y1; y += grid) {
      if (x * x + y * y < ARENA_R * ARENA_R) {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // cracks near the rim
  ctx.strokeStyle = "rgba(43, 48, 64, 0.13)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (const crack of edgeCracks) {
    ctx.beginPath();
    ctx.moveTo(crack[0][0], crack[0][1]);
    for (let i = 1; i < crack.length; i++) ctx.lineTo(crack[i][0], crack[i][1]);
    ctx.stroke();
  }

  // rim
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_R, 0, Math.PI * 2);
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(224, 90, 62, 0.55)";
  ctx.setLineDash([26, 20]);
  ctx.stroke();
  ctx.setLineDash([]);
}

/* ---- hazard renderers (deterministic animation, no per-bubble state) ---- */

function renderLava(c, h) {
  const g = c.createRadialGradient(h.x, h.y, h.r * 0.15, h.x, h.y, h.r);
  g.addColorStop(0, "#ffd056");
  g.addColorStop(0.45, "#ff8a3d");
  g.addColorStop(1, "#e0512e");
  c.beginPath();
  c.arc(h.x, h.y, h.r, 0, Math.PI * 2);
  c.fillStyle = g;
  c.fill();
  // glow rim
  c.lineWidth = 14;
  c.strokeStyle = "rgba(255, 140, 60, 0.35)";
  c.stroke();
  c.lineWidth = 5;
  c.strokeStyle = "#c23e22";
  c.stroke();

  // bubbles: deterministic from index+time
  for (let i = 0; i < 10; i++) {
    const seed = i * 37.7 + h.x * 0.01;
    const ph = (((elapsed * (0.4 + (i % 3) * 0.18) + seed) % 1) + 1) % 1;  // positive modulo: seed can be negative (pool at x<0)
    const ang = seed * 2.4;
    const dist = (0.15 + ((seed * 13) % 1) * 0.7) * h.r;
    const bx = h.x + Math.cos(ang) * dist;
    const by = h.y + Math.sin(ang) * dist;
    const br = (3 + (i % 4) * 3) * (0.4 + ph);
    c.beginPath();
    c.arc(bx, by, br, 0, Math.PI * 2);
    c.fillStyle = "rgba(255, 214, 120, " + (0.55 * (1 - ph)) + ")";
    c.fill();
  }
}

function renderSpikes(c, h) {
  c.beginPath();
  c.arc(h.x, h.y, h.r, 0, Math.PI * 2);
  c.fillStyle = "#c9ccd4";
  c.fill();
  c.lineWidth = 4;
  c.strokeStyle = "#9aa0ac";
  c.stroke();

  // triangle spikes in rings
  c.fillStyle = "#7d8494";
  const rings = [[0.35, 5], [0.72, 9]];
  for (const [rf, n] of rings) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rf * 4;
      const cx = h.x + Math.cos(a) * h.r * rf;
      const cy = h.y + Math.sin(a) * h.r * rf;
      const s = h.r * 0.16;
      c.beginPath();
      c.moveTo(cx, cy - s);
      c.lineTo(cx + s * 0.75, cy + s * 0.6);
      c.lineTo(cx - s * 0.75, cy + s * 0.6);
      c.closePath();
      c.fill();
    }
  }
  // center spike
  const s = h.r * 0.22;
  c.beginPath();
  c.moveTo(h.x, h.y - s);
  c.lineTo(h.x + s * 0.75, h.y + s * 0.6);
  c.lineTo(h.x - s * 0.75, h.y + s * 0.6);
  c.closePath();
  c.fillStyle = "#666d7d";
  c.fill();
}

function renderAcid(c, h) {
  // wobbly-edged pool
  c.beginPath();
  const N = 18;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rr = h.r * (1 + 0.04 * Math.sin(a * 4 + elapsed * 1.6));
    const px = h.x + Math.cos(a) * rr;
    const py = h.y + Math.sin(a) * rr;
    if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.closePath();
  const g = c.createRadialGradient(h.x, h.y, h.r * 0.2, h.x, h.y, h.r);
  g.addColorStop(0, "#c8f06a");
  g.addColorStop(1, "#7fbf3f");
  c.fillStyle = g;
  c.fill();
  c.lineWidth = 5;
  c.strokeStyle = "#5f9c2e";
  c.stroke();

  for (let i = 0; i < 7; i++) {
    const seed = i * 51.3 + h.y * 0.01;
    const ph = (((elapsed * (0.3 + (i % 3) * 0.15) + seed) % 1) + 1) % 1;  // positive modulo: seed can be negative (pool at y<0)
    const ang = seed * 3.1;
    const dist = ((seed * 7) % 1) * 0.75 * h.r;
    c.beginPath();
    c.arc(h.x + Math.cos(ang) * dist, h.y + Math.sin(ang) * dist, (2 + (i % 3) * 2.5) * (0.5 + ph), 0, Math.PI * 2);
    c.fillStyle = "rgba(235, 255, 190, " + (0.5 * (1 - ph)) + ")";
    c.fill();
  }
}

function renderPit(c, h) {
  // outer gravity hint
  c.beginPath();
  c.arc(h.x, h.y, h.r * 1.6, 0, Math.PI * 2);
  c.fillStyle = "rgba(43, 48, 64, 0.06)";
  c.fill();

  const g = c.createRadialGradient(h.x, h.y, h.r * 0.1, h.x, h.y, h.r);
  g.addColorStop(0, "#0c0e16");
  g.addColorStop(0.65, "#232838");
  g.addColorStop(1, "#3d4356");
  c.beginPath();
  c.arc(h.x, h.y, h.r, 0, Math.PI * 2);
  c.fillStyle = g;
  c.fill();
  c.lineWidth = 6;
  c.strokeStyle = "#2b3040";
  c.stroke();

  // swirl lines
  c.strokeStyle = "rgba(255,255,255,0.10)";
  c.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    const a0 = elapsed * 0.8 + i * 2.1;
    c.beginPath();
    c.arc(h.x, h.y, h.r * (0.35 + i * 0.2), a0, a0 + 2.4);
    c.stroke();
  }
}

function renderIce(c, h) {
  c.beginPath();
  c.arc(h.x, h.y, h.r, 0, Math.PI * 2);
  c.fillStyle = "rgba(190, 230, 250, 0.75)";
  c.fill();
  c.lineWidth = 5;
  c.strokeStyle = "rgba(140, 200, 235, 0.8)";
  c.stroke();

  // sheen streaks
  c.strokeStyle = "rgba(255,255,255,0.55)";
  c.lineWidth = 4;
  c.lineCap = "round";
  for (let i = 0; i < 4; i++) {
    const seed = i * 29 + h.x * 0.02;
    const ang = seed;
    const dist = ((seed * 5) % 1) * 0.6 * h.r;
    const cx = h.x + Math.cos(ang) * dist;
    const cy = h.y + Math.sin(ang) * dist;
    c.beginPath();
    c.moveTo(cx - h.r * 0.18, cy + h.r * 0.06);
    c.lineTo(cx + h.r * 0.18, cy - h.r * 0.06);
    c.stroke();
  }
}

function renderMud(c, h) {
  c.beginPath();
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rr = h.r * (1 + 0.05 * Math.sin(a * 3 + h.x));
    const px = h.x + Math.cos(a) * rr;
    const py = h.y + Math.sin(a) * rr;
    if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.closePath();
  c.fillStyle = "#b08d5f";
  c.fill();
  c.lineWidth = 5;
  c.strokeStyle = "#8f6f45";
  c.stroke();

  c.fillStyle = "rgba(120, 90, 55, 0.5)";
  for (let i = 0; i < 9; i++) {
    const seed = i * 43 + h.y * 0.03;
    const ang = seed * 1.7;
    const dist = ((seed * 11) % 1) * 0.8 * h.r;
    c.beginPath();
    c.arc(h.x + Math.cos(ang) * dist, h.y + Math.sin(ang) * dist, 4 + (i % 3) * 3, 0, Math.PI * 2);
    c.fill();
  }
}

function drawPellets() {
  for (const p of pellets) {
    const pr = p.r * (1 + 0.12 * Math.sin(elapsed * 3 + p.pulse));
    ctx.beginPath();
    ctx.arc(p.x, p.y, pr, 0, Math.PI * 2);
    ctx.fillStyle = "hsl(" + p.hue + ", 65%, 62%)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x - pr * 0.3, p.y - pr * 0.3, pr * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fill();
  }
}

function drawConnections() {
  for (const c of connections) {
    const a = c.a, b = c.b;
    const t = Math.max(0, Math.min(1, c.ttl / CONNECT_TTL));
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;

    const stretch = Math.max(0, d / c.rest - 1);
    const sag = (1 - Math.min(1, stretch * 2)) * 16 * Math.sin(elapsed * 9 + c.a.id);
    const px = -dy / d, py = dx / d;

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(mx + px * sag, my + py * sag, b.x, b.y);
    ctx.lineWidth = 2 + 6 * t;
    ctx.strokeStyle = "rgba(255, 255, 255, " + (0.35 + 0.45 * t) + ")";
    ctx.lineCap = "round";
    ctx.stroke();

    ctx.lineWidth = 1 + 3 * t;
    ctx.strokeStyle = hexToRgba(a.color, 0.5 * t + 0.15);
    ctx.stroke();

    for (const e of [a, b]) {
      ctx.beginPath();
      ctx.arc(e.x + (mx - e.x) * 0.12, e.y + (my - e.y) * 0.12, (3 + 4 * t), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255," + (0.5 * t + 0.2) + ")";
      ctx.fill();
    }
  }
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return "rgb(" + r + "," + g + "," + b + ")";
}

function drawBlob(b) {
  const anchored = b.anchorT > 0;
  const r = b.radius;

  ctx.save();
  ctx.translate(b.x, b.y);

  ctx.beginPath();
  ctx.ellipse(0, r * 0.55, r * 0.85, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(43, 48, 64, 0.10)";
  ctx.fill();

  const speedNorm = Math.min(1, b.speed / (BASE_SPEED * 1.3));
  let stretch = 1 + speedNorm * 0.13 - b.squish * 0.22;
  let squash = 1 - speedNorm * 0.10 + b.squish * 0.22;
  if (anchored) { stretch *= 0.9; squash *= 1.12; }

  ctx.rotate(b.heading);
  ctx.scale(stretch, squash);

  const footColor = shade(b.color, -35);
  for (const side of [-1, 1]) {
    const kick = Math.sin(b.footPhase + (side > 0 ? 0 : Math.PI)) * (0.25 + speedNorm * 0.5);
    ctx.beginPath();
    ctx.ellipse(
      -r * 0.55 + kick * r * 0.28,
      side * r * 0.55,
      r * 0.24, r * 0.17,
      side * 0.5, 0, Math.PI * 2
    );
    ctx.fillStyle = footColor;
    ctx.fill();
  }

  const N = 12;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const wob = 1
      + 0.045 * Math.sin(a * 3 + elapsed * 5 + b.wobbleSeed)
      + 0.03 * Math.sin(a * 5 - elapsed * 3.4 + b.wobbleSeed * 2);
    const rr = r * wob;
    const px = Math.cos(a) * rr;
    const py = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = anchored ? shade(b.color, -30) : b.color;
  ctx.fill();
  ctx.lineWidth = Math.max(2.5, r * 0.09);
  ctx.strokeStyle = shade(b.color, -45);
  ctx.stroke();

  // status tints
  if (b.burnT > 0) {
    ctx.fillStyle = "rgba(255, 90, 20, " + (0.35 * Math.min(1, b.burnT / 0.35)) + ")";
    ctx.fill();
  }
  if (b.acidT > 0) {
    ctx.fillStyle = "rgba(140, 210, 60, " + (0.3 * Math.min(1, b.acidT / 0.35)) + ")";
    ctx.fill();
  }

  if (b.type === "player") {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, r * 0.07);
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.ellipse(-r * 0.25, -r * 0.3, r * 0.42, r * 0.3, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fill();

  const ex = r * 0.42;
  const eyeR = Math.max(2.5, r * 0.13);
  const blinking = b.blink > 0;
  for (const side of [-1, 1]) {
    const eyeY = side * r * 0.26;
    if (blinking) {
      ctx.beginPath();
      ctx.moveTo(ex - eyeR, eyeY);
      ctx.lineTo(ex + eyeR, eyeY);
      ctx.lineWidth = Math.max(2, r * 0.05);
      ctx.strokeStyle = "#2b3040";
      ctx.lineCap = "round";
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2);
      ctx.fillStyle = "#2b3040";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + eyeR * 0.3, eyeY - eyeR * 0.3, eyeR * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }
  }
  ctx.beginPath();
  ctx.arc(ex + r * 0.12, 0, Math.max(1.5, r * 0.06), 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.lineWidth = Math.max(1.5, r * 0.04);
  ctx.strokeStyle = "#2b3040";
  ctx.lineCap = "round";
  ctx.stroke();

  if (anchored) {
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + elapsed * 0.5;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.65, Math.sin(a) * r * 0.65, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();

  if (r > 14) {
    ctx.font = "700 " + Math.max(11, r * 0.32) + "px ui-rounded, 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(43, 48, 64, 0.55)";
    ctx.fillText(b.name, b.x, b.y - r - 8);
  }
}

function drawParticles() {
  for (const p of particles) {
    const t = p.life / p.maxLife;
    if (p.ring) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.lineWidth = 4 * t + 1;
      ctx.strokeStyle = hexToRgba(p.color, 0.5 * t);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(p.color.startsWith("#") ? p.color : "#ffffff", 0.8 * t);
      ctx.fill();
    }
  }
}

function drawFloaters() {
  for (const f of floaters) {
    ctx.font = "900 16px ui-rounded, 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = hexToRgba(f.color.startsWith("#") ? f.color : "#2b3040", Math.min(1, f.life));
    ctx.fillText(f.text, f.x, f.y);
  }
}

/* =====================================================================
   14. UI
   ===================================================================== */

let uiTimer = 0;

function updateUI(dt) {
  uiTimer -= dt;

  const btn = document.getElementById("anchorBtn");
  if (player) {
    const cdTotal = ANCHOR_COOLDOWN + ANCHOR_DURATION;
    const ready = player.anchorCd <= 0;
    btn.classList.toggle("active", player.anchorT > 0);
    btn.classList.toggle("cooling", !ready && player.anchorT <= 0);
    btn.classList.toggle("armed", ready);
    btn.style.setProperty("--cd", ready ? 1 : 1 - player.anchorCd / cdTotal);
  }

  if (uiTimer > 0) return;
  uiTimer = 0.25;

  if (player) {
    document.getElementById("scoreVal").textContent = Math.floor(player.score);
    document.getElementById("sizeVal").textContent = "size " + Math.round(player.radius);
  }

  const list = document.getElementById("lbList");
  const living = blobs.filter(b => b.state === "alive" || b === player);
  const ranked = [...living].sort((a, b) => b.score - a.score);
  let html = "";
  ranked.slice(0, 8).forEach((b, i) => {
    html += "<li" + (b === player ? " class='me'" : "") + ">" +
      "<span class='nm'><span class='dot' style='background:" + b.color + "'></span>" +
      (i + 1) + ". " + b.name + "</span><span>" + Math.floor(b.score) + "</span></li>";
  });
  const myRank = ranked.indexOf(player);
  if (myRank >= 8) {
    html += "<li class='me'><span class='nm'><span class='dot' style='background:" + player.color + "'></span>" +
      (myRank + 1) + ". You</span><span>" + Math.floor(player.score) + "</span></li>";
  }
  list.innerHTML = html;
}

function showDeath(title, reason) {
  document.getElementById("deathTitle").textContent = title;
  document.getElementById("deathReason").textContent = reason;
  document.getElementById("deathScore").textContent = "score " + Math.floor(player.score);
  document.getElementById("deathOverlay").classList.remove("hidden");
}

/* =====================================================================
   15. GAME LOOP
   ===================================================================== */

let lastTime = 0;

function frame(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000 || 0.016);
  lastTime = now;

  if (running) {
    elapsed += dt;

    surviveAccum += dt;
    if (surviveAccum >= 1) {
      surviveAccum -= 1;
      if (player.state === "alive") player.score += SCORE_SURVIVE_PER_SEC;
    }

    readPlayerInput();
    for (const b of blobs) {
      if (b.state !== "alive") continue;
      if (b.type === "bot") updateBotAI(b, dt);
    }
    updateHazards(dt);              // terrain mods + damage before movement
    for (const b of blobs) {
      if (b.state !== "alive") continue;
      updateMovement(b, dt);
    }
    updateCollisions(dt);
    updateConnections(dt);
    sweepDead();
    updateRespawns(dt);
    updateParticles(dt);
    updateFloaters(dt);
    updateCamera(dt);
  } else {
    updateParticles(dt);
    updateFloaters(dt);
  }

  render();
  updateUI(dt);
  requestAnimationFrame(frame);
}

/* ---------- boot ---------- */

window.addEventListener("resize", resize);

window.addEventListener("DOMContentLoaded", () => {
  canvas = document.getElementById("game");
  ctx = canvas.getContext("2d");
  resize();
  setupInput();
  initGame();
  requestAnimationFrame(frame);
});
