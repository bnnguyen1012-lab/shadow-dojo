'use strict';
// 'use strict' makes JavaScript catch mistakes that would otherwise fail silently
// Always good practice to put this at the top of your JS file


// ================================================================
// STEP 1: GET THE CANVAS
// The canvas is our drawing board — all game visuals go here
// ================================================================

// getElementById finds an HTML element using its id attribute
const canvas = document.getElementById('game-canvas');

// getContext('2d') gives us the 2D drawing tool
// We store it in ctx — we'll use ctx.fillRect(), ctx.arc() etc to draw
const ctx = canvas.getContext('2d');

// This function sizes the canvas to fill the screen minus the 66px HUD
function resize() {
  canvas.width  = window.innerWidth;        // full window width
  canvas.height = window.innerHeight - 66;  // full height minus the HUD bar
}

resize(); // run it immediately when the page loads

// run it again whenever the user resizes their browser window
window.addEventListener('resize', resize);


// ================================================================
// STEP 2: 3D PROJECTION
// The arena lives in 3D world space: x=left/right, z=near/far, y=height
// proj() converts those 3D world coordinates into 2D screen pixels
// This is what creates the perspective / 3rd person look
// ================================================================

const AW = 900; // arena width in "world units" (we made up this measurement)
const AD = 420; // arena depth in world units

// proj() takes a 3D world position and returns a 2D screen position
function proj(wx, wy, wz) {
  // t goes from 0 (front of arena, near camera) to 1 (back of arena, far)
  const t = wz / AD;

  // things farther away (bigger t) converge toward the center — that's perspective
  const sx = canvas.width * 0.5 + (wx - AW / 2) * (0.88 - t * 0.18);

  // things farther away appear higher on screen (wz effect)
  // jumping lifts the character upward (wy effect)
  const sy = canvas.height * 0.86 - wz * 0.52 - wy * 1.05;

  // return both screen coordinates as an object with sx and sy properties
  return { sx, sy };
}

// fighters farther away should look smaller — returns a number between 0.62 and 1.0
function dscale(wz) {
  return 0.62 + (1 - wz / AD) * 0.38;
}


// ================================================================
// STEP 3: ATTACK DATA
// This object holds all the stats for each attack
// ================================================================

// MOVES is an object — each key is an attack name, each value is its stats
const MOVES = {
  punch:  { dmg: 7,  reach: 115, stCost: 8,  cd: 340,  label: 'PUNCH',      col: '#ffcc44' },
  // dmg = damage dealt to the enemy
  // reach = how close you need to be for the hit to register (world units)
  // stCost = how much stamina this move costs
  // cd = cooldown in milliseconds before you can use it again
  // label = text shown at the bottom of the screen
  // col = color of the glow effect

  hpunch: { dmg: 18, reach: 125, stCost: 22, cd: 680,  label: 'HARD PUNCH', col: '#ff8800' },
  kick:   { dmg: 14, reach: 145, stCost: 15, cd: 540,  label: 'KICK',       col: '#ff4444' },
  choke:  { dmg: 5,  reach: 82,  stCost: 28, cd: 1200, label: 'CHOKE GRAB', col: '#cc44ff' },
};


// ================================================================
// STEP 4: KEYBOARD AND MOUSE INPUT
// ================================================================

// K stores which keyboard keys are currently held down
// example: if you hold W, then K['w'] = true
const K = {};

// MB stores which mouse buttons are held: l=left, r=right
const MB = { l: false, r: false };

// runs every time ANY key is pressed down
window.addEventListener('keydown', e => {
  K[e.key.toLowerCase()] = true;       // mark this key as held
  if (e.key === ' ') e.preventDefault(); // stop spacebar scrolling the page
});

// runs every time ANY key is released
window.addEventListener('keyup', e => {
  K[e.key.toLowerCase()] = false; // mark this key as no longer held
});

// runs when a mouse button is pressed down on the canvas
canvas.addEventListener('mousedown', e => {
  e.preventDefault(); // stop the browser's default right-click menu
  if (e.button === 0) MB.l = true;  // 0 = left mouse button
  if (e.button === 2) MB.r = true;  // 2 = right mouse button

  // only trigger attacks when the game is actually in the fighting phase
  if (phase === 'fighting') {
    // tryMove returns true if the attack started successfully
    if (e.button === 0 && player.tryMove('punch'))  showLabel('PUNCH',      MOVES.punch.col);
    if (e.button === 2 && player.tryMove('hpunch')) showLabel('HARD PUNCH', MOVES.hpunch.col);
  }
});

// runs when a mouse button is released
canvas.addEventListener('mouseup', e => {
  if (e.button === 0) MB.l = false;
  if (e.button === 2) MB.r = false;
});

// completely disable the right-click context menu on the canvas
canvas.addEventListener('contextmenu', e => e.preventDefault());

// K and M are single-press attacks (not held), handled in keydown
window.addEventListener('keydown', e => {
  if (phase !== 'fighting') return; // do nothing if not in a fight
  if (e.key.toLowerCase() === 'k' && player.tryMove('kick'))  showLabel('KICK',       MOVES.kick.col);
  if (e.key.toLowerCase() === 'm' && player.tryMove('choke')) showLabel('CHOKE GRAB', MOVES.choke.col);
});


// ================================================================
// STEP 5: FIGHTER CLASS
// A class is a blueprint/template for creating objects
// We use this blueprint to create both the player and the CPU
// ================================================================

class Fighter {

  // constructor() runs when you write: new Fighter(...)
  // wx, wz = starting world position, col = color, facing = which way they face
  constructor(wx, wz, col, facing) {

    // world position
    this.wx = wx;  // x = left/right in the arena
    this.wz = wz;  // z = near/far in the arena
    this.wy = 0;   // y = height above ground (0 = on the ground)

    // velocity — how fast we're moving in each direction
    this.vx = 0;   // left/right speed
    this.vz = 0;   // forward/back speed
    this.vy = 0;   // up/down speed (used for jumping and gravity)

    this.col    = col;     // the color we draw this fighter
    this.facing = facing;  // 1 = facing right, -1 = facing left

    this.hp = 100; // health points — reaching 0 means KO
    this.st = 100; // stamina — spent on attacks, slowly refills

    this.jumping  = false; // is this fighter currently in the air?
    this.blocking = false; // is this fighter holding the block button?
    this.dead     = false; // has this fighter been KO'd?

    // attack state
    this.atkName  = null;  // which attack is active right now (null = none)
    this.atkTimer = 0;     // how many milliseconds are left in the hit window
    this.atkHit   = false; // did this swing already hit someone? (stops double hits)

    // each move has its own cooldown timer counting down in ms
    this.cds = { punch: 0, hpunch: 0, kick: 0, choke: 0 };

    // choke hold (special attack that locks both fighters together)
    this.choking    = false; // are we currently in a choke hold?
    this.chokeRef   = null;  // reference to the other fighter we're choking
    this.chokeTimer = 0;     // how many ms are left in the choke hold

    // animation frame counter — loops from 0 to 59
    this.frame     = 0;
    this.frameTick = 0; // time accumulator between frame steps

    // screen shake when hit
    this.shakeT = 0;   // how many ms of shake remain
    this.shX    = 0;   // random horizontal offset during shake
    this.shY    = 0;   // random vertical offset during shake
  }

  // calculate straight-line distance to another fighter (ignores height)
  // Math.hypot is Pythagoras: sqrt(dx*dx + dz*dz)
  dist(o) {
    return Math.hypot(this.wx - o.wx, this.wz - o.wz);
  }

  // try to start an attack — returns true if it worked, false if it couldn't
  tryMove(name) {
    const m = MOVES[name]; // look up this attack's stats

    if (this.atkTimer > 0)   return false; // already mid-attack
    if (this.cds[name] > 0)  return false; // this move is still on cooldown
    if (this.st < m.stCost)  return false; // not enough stamina
    if (this.choking)        return false; // busy choking someone

    // all checks passed — start the attack!
    this.atkName  = name;
    this.atkTimer = m.cd * 0.45; // hit window = 45% of the total cooldown
    this.atkHit   = false;       // hasn't hit anyone yet this swing
    this.cds[name] = m.cd;       // put this move on cooldown
    this.st = Math.max(0, this.st - m.stCost); // spend stamina, never below 0
    return true;
  }

  // make the fighter jump
  jump() {
    if (!this.jumping && !this.choking) {
      this.vy = 400;       // positive vy = moving upward
      this.jumping = true;
      spawnDust(this.wx, this.wz); // dust puff at their feet
    }
  }

  // update() runs every frame to move the fighter and tick all timers
  // dt = delta time = seconds since last frame (keeps physics consistent at any FPS)
  update(dt) {

    // gravity: pull wy back down toward 0 (the ground)
    this.vy -= 880 * dt;  // gravity pulls at 880 units per second squared
    this.wy = Math.max(0, this.wy + this.vy * dt); // move up/down, never below 0

    // landed on the ground
    if (this.wy === 0) {
      this.vy = 0;          // stop falling
      this.jumping = false; // no longer jumping
    }

    // horizontal movement
    this.wx += this.vx * dt;
    this.wz += this.vz * dt;

    // friction: multiply by 0.72 each frame so we slow down naturally
    // 0.72 means we keep 72% of our speed each frame
    this.vx *= 0.72;
    this.vz *= 0.72;

    // keep fighter inside arena walls
    // Math.max prevents going below the minimum, Math.min prevents going above max
    this.wx = Math.max(50, Math.min(AW - 50, this.wx));
    this.wz = Math.max(20, Math.min(AD - 20, this.wz));

    // count down the attack hit window
    if (this.atkTimer > 0) {
      this.atkTimer -= dt * 1000; // dt is seconds, atkTimer is ms, so * 1000
      if (this.atkTimer <= 0) {
        this.atkTimer = 0;
        this.atkName  = null; // attack is finished
      }
    }

    // count down all move cooldowns
    for (const k in this.cds) {
      // 'for in' loops through each key in the object
      if (this.cds[k] > 0) this.cds[k] = Math.max(0, this.cds[k] - dt * 1000);
    }

    // choke hold — keep the victim locked next to us
    if (this.choking && this.chokeTimer > 0) {
      this.chokeTimer -= dt * 1000;
      if (this.chokeRef) {
        // force the victim to stay 55 units in front of us
        this.chokeRef.wx = this.wx + this.facing * 55;
        this.chokeRef.wz = this.wz;
      }
      if (this.chokeTimer <= 0) {
        this.choking  = false; // choke is over
        this.chokeRef = null;
        this.atkName  = null;
      }
    }

    // slowly refill stamina when not attacking
    if (!this.atkName && !this.choking) {
      this.st = Math.min(100, this.st + 16 * dt); // add 16 per second, max 100
    }

    // screen shake: apply random offsets while shake timer counts down
    if (this.shakeT > 0) {
      this.shakeT -= dt * 1000;
      // Math.random() returns 0 to 1, subtracting 0.5 makes it -0.5 to 0.5
      this.shX = (Math.random() - 0.5) * 9;
      this.shY = (Math.random() - 0.5) * 5;
    } else {
      this.shX = 0; // no shake, no offset
      this.shY = 0;
    }

    // advance animation frame counter
    this.frameTick += dt;
    if (this.frameTick > 0.07) {       // every 0.07 seconds
      this.frameTick = 0;
      this.frame = (this.frame + 1) % 60; // increment, wrap back to 0 after 59
    }
  }

  // called when this fighter gets hit by an attack
  takeHit(dmg, fromWX) {
    // blocking reduces damage to 10% of original
    const d = this.blocking ? Math.round(dmg * 0.1) : dmg;
    this.hp = Math.max(0, this.hp - d); // reduce health, never below 0

    // knockback: push this fighter away from where the attack came from
    const dir = this.wx > fromWX ? 1 : -1; // +1 if we're to the right, -1 if left
    this.vx = dir * (this.blocking ? 80 : 220); // less knockback when blocking
    if (!this.blocking) this.vy = 100;           // small upward bounce

    this.shakeT = this.blocking ? 80 : 260; // start screen shake

    spawnSparks(this.wx, this.wz, this.wy + 60, this.blocking); // hit particles

    if (this.hp <= 0) this.dead = true; // they're knocked out
  }

  // draw() paints this fighter onto the canvas every frame
  draw() {
    const sc = dscale(this.wz); // scale: smaller if farther away

    // get the screen position, with shake offsets applied
    const { sx, sy } = proj(this.wx + this.shX, this.wy + this.shY, this.wz);

    // ── GROUND SHADOW ──
    // shadow sits on the ground (wy=0) and fades as fighter jumps higher
    const { sx: gx, sy: gy } = proj(this.wx, 0, this.wz);
    ctx.save(); // save() stores current drawing settings
    ctx.globalAlpha = 0.35 * (1 - this.wy / 320); // shadow fades when airborne
    ctx.beginPath();
    ctx.ellipse(gx, gy, 26 * sc, 8 * sc, 0, 0, Math.PI * 2); // oval shape
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore(); // restore() resets to the settings before save()

    ctx.save();
    ctx.translate(sx, sy); // move the drawing origin to the fighter's screen pos

    // flip the canvas horizontally if this fighter faces left
    if (this.facing < 0) ctx.scale(-1, 1);

    // semi-transparent when blocking
    ctx.globalAlpha = this.blocking ? 0.5 : 1.0;

    const h = 88 * sc; // total figure height in pixels

    // idle bobbing: Math.sin creates a smooth wave between -1 and 1
    const bob = Math.sin(this.frame * 0.2) * 2 * sc;

    // body landmark Y positions (negative = upward because canvas Y goes down)
    const Fy  = 0;              // feet level
    const Ky  = -h * 0.27;     // knees
    const Hy  = -h * 0.50;     // hips
    const Sy  = -h * 0.73 + bob; // shoulders (bob applied here)
    const Ny  = -h * 0.83 + bob; // neck
    const HdY = -h * 0.95 + bob; // head center
    const hr  = 13 * sc;         // head radius

    // set up the line drawing style
    ctx.strokeStyle = this.col; // use this fighter's color
    ctx.lineWidth   = 5 * sc;   // line thickness scales with distance
    ctx.lineCap     = 'round';  // rounded line endings
    ctx.lineJoin    = 'round';  // rounded corners where lines meet

    // ── LEGS ──
    let lkx, lfx, rkx, rfx; // left-knee-x, left-foot-x, right-knee-x, right-foot-x

    if (this.atkName === 'kick') {
      // kick: front leg extends far forward
      lkx = -8*sc;  lfx = -12*sc;
      rkx = 24*sc;  rfx = 54*sc;
    } else if (this.jumping) {
      // jump: tuck legs up
      lkx = -14*sc; lfx = -8*sc;
      rkx = 14*sc;  rfx = 8*sc;
    } else {
      // walking cycle: sine wave makes legs swing back and forth
      const ls = Math.sin(this.frame * 0.15) * 10 * sc;
      lkx = -9*sc;  lfx = -14*sc - ls; // left leg swings one way
      rkx = 9*sc;   rfx = 14*sc  + ls; // right leg swings the other
    }

    // draw left leg: hip → knee → foot
    ctx.beginPath();
    ctx.moveTo(0, Hy); // start at hip
    ctx.lineTo(lkx, Ky); // down to knee
    ctx.lineTo(lfx, Fy); // down to foot
    ctx.stroke(); // actually draw the lines

    // draw right leg: hip → knee → foot
    ctx.beginPath();
    ctx.moveTo(0, Hy);
    ctx.lineTo(rkx, Ky);
    ctx.lineTo(rfx, Fy);
    ctx.stroke();

    // ── TORSO ──
    ctx.beginPath();
    ctx.moveTo(0, Ny); // top of torso (neck)
    ctx.lineTo(0, Hy); // bottom of torso (hips)
    ctx.stroke();

    // ── ARMS ──
    let lax, lay, rax, ray; // left-arm end x/y, right-arm end x/y

    if (this.choking) {
      lax = 28*sc;  lay = Sy + 6*sc;  // both arms reach forward to grab
      rax = 30*sc;  ray = Sy - 4*sc;
    } else if (this.atkName === 'punch') {
      lax = -18*sc; lay = Sy + 14*sc; // back arm stays back
      rax = 46*sc;  ray = Sy + 6*sc;  // front arm jabs forward
    } else if (this.atkName === 'hpunch') {
      lax = -22*sc; lay = Sy + 20*sc; // wider swing, arm swings from further back
      rax = 52*sc;  ray = Sy + 2*sc;
    } else if (this.blocking) {
      lax = 10*sc;  lay = HdY + 6*sc;  // arms cross in front of face
      rax = 14*sc;  ray = HdY + 18*sc;
    } else {
      // idle guard: small swing matching the walk animation
      const sw = Math.sin(this.frame * 0.15) * 9 * sc;
      lax = -18*sc; lay = Sy + 18*sc + sw;
      rax = 18*sc;  ray = Sy + 18*sc - sw;
    }

    // draw left arm: shoulder → hand
    ctx.beginPath();
    ctx.moveTo(0, Sy); // start at shoulder
    ctx.lineTo(lax, lay); // to hand position
    ctx.stroke();

    // draw right arm: shoulder → hand
    ctx.beginPath();
    ctx.moveTo(0, Sy);
    ctx.lineTo(rax, ray);
    ctx.stroke();

    // ── HEAD ──
    ctx.beginPath();
    ctx.arc(0, HdY, hr, 0, Math.PI * 2); // full circle (0 to 2π radians = 360°)
    ctx.fillStyle = this.col;
    ctx.fill();
    ctx.stroke();

    // eye dot so you can tell which way they're facing
    ctx.beginPath();
    ctx.arc(hr * 0.45, HdY - hr * 0.1, hr * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fill();

    // ── ATTACK GLOW EFFECTS ──
    if (this.atkName === 'punch') {
      glowCircle(rax, ray, 10*sc, 'rgba(255,220,80,.65)'); // yellow at fist
    }
    if (this.atkName === 'hpunch') {
      glowCircle(rax, ray, 15*sc, 'rgba(255,120,20,.7)');  // orange at fist
      glowRing(rax, ray, 24*sc, 'rgba(255,120,20,.3)');    // outer ring
    }
    if (this.atkName === 'kick') {
      glowCircle(rfx, Ky + 12*sc, 14*sc, 'rgba(255,60,60,.65)'); // red at foot
    }
    if (this.choking) {
      glowCircle(rax, ray, 16*sc, 'rgba(180,60,255,.55)'); // purple choke glow
      glowRing(rax, ray, 28*sc, 'rgba(180,60,255,.25)');   // outer ring
    }

    // blue shield ring when blocking
    if (this.blocking) {
      glowRing(0, -h * 0.5, 42*sc, 'rgba(100,200,255,.45)');
    }

    ctx.globalAlpha = 1; // always reset opacity so other things draw normally
    ctx.restore();       // undo the translate and scale from ctx.save()
  }
}


// ================================================================
// STEP 6: DRAWING HELPER FUNCTIONS
// Used inside Fighter.draw() to draw the attack glow effects
// ================================================================

// draws a filled colored circle (solid glow at fist/foot)
function glowCircle(x, y, r, col) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2); // full circle
  ctx.fillStyle = col;
  ctx.fill(); // fill with color but no outline
}

// draws an outlined circle with no fill (outer glow ring)
function glowRing(x, y, r, col) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = col;
  ctx.lineWidth = 3;
  ctx.stroke(); // outline only, no fill
}


// ================================================================
// STEP 7: PARTICLE SYSTEM
// Particles are tiny dots that fly out on hits and jumps
// We store all active particles in an array and update them each frame
// ================================================================

let particles = []; // starts empty — particles are added during gameplay

// spawnSparks creates hit spark particles at a world position
function spawnSparks(wx, wz, wh, isBlock) {
  const col   = isBlock ? '#7ec8e3' : (Math.random() < 0.5 ? '#ffcc44' : '#ff8822');
  // blocked hits = blue, normal hits = yellow or orange (random)

  const count = isBlock ? 5 : 14; // fewer sparks if the hit was blocked

  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2; // random angle (0 to 360 degrees)
    const s = 60 + Math.random() * 130;   // random speed

    particles.push({ // add a new particle object to the array
      wx,                          // world x position
      wz,                          // world z position
      wh,                          // world height
      vwx: Math.cos(a) * s,        // x velocity (cos gives x component of angle)
      vwz: Math.sin(a) * s * 0.3, // z velocity (scaled down for perspective feel)
      vwh: 60 + Math.random() * 110, // upward velocity
      life:  1,                    // starts fully visible (1.0), fades to 0
      decay: 0.045 + Math.random() * 0.04, // how fast it fades (random for variety)
      size:  3 + Math.random() * 5,         // radius in pixels
      col,                         // the color
    });
  }
}

// spawnDust creates dust puffs when a fighter jumps
function spawnDust(wx, wz) {
  for (let i = 0; i < 7; i++) {
    particles.push({
      wx, wz, wh: 2,
      vwx: (Math.random() - 0.5) * 80,  // random left/right drift
      vwz: (Math.random() - 0.5) * 30,
      vwh: 20 + Math.random() * 40,     // upward
      life: 1, decay: 0.055,
      size: 5 + Math.random() * 7,
      col: 'rgba(200,175,120,.8)',       // dusty brown-grey color
    });
  }
}

// tickParticles runs every frame to move, draw, and remove particles
function tickParticles(dt) {
  // loop BACKWARDS — if we removed items going forward, we'd skip some
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; // get the particle at this position

    // move the particle using its velocity
    p.wx  += p.vwx * dt;
    p.wz  += p.vwz * dt;
    p.wh  += p.vwh * dt;
    p.vwh -= 300 * dt;  // gravity pulls the particle down

    if (p.wh < 0) p.wh = 0; // stop at floor level

    p.life -= p.decay; // reduce life each frame

    if (p.life <= 0) {
      particles.splice(i, 1); // remove dead particle (splice removes 1 item at index i)
      continue;               // skip the rest of this loop iteration
    }

    // project 3D world position to 2D screen pixel
    const { sx, sy } = proj(p.wx, p.wh, p.wz);
    const sc = dscale(p.wz); // scale based on depth

    ctx.globalAlpha = p.life; // opacity = how much life is left
    ctx.beginPath();
    ctx.arc(sx, sy, p.size * p.life * sc, 0, Math.PI * 2); // shrinks as it fades
    ctx.fillStyle = p.col;
    ctx.fill();
  }
  ctx.globalAlpha = 1; // always reset after drawing particles
}


// ================================================================
// STEP 8: DRAW THE ARENA BACKGROUND
// Draws the arena floor, back wall, crowd, and lights every frame
// ================================================================

function drawBG() {
  const W = canvas.width;
  const H = canvas.height;

  // ── sky gradient ──
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.5);
  sky.addColorStop(0, '#050510'); // very dark blue at the top
  sky.addColorStop(1, '#14082a'); // slightly purple further down
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H); // fill the entire canvas with the sky

  // ── back wall ── project its 4 corners to screen space
  const wBL = proj(0,   180, AD); // bottom-left of wall
  const wBR = proj(AW,  180, AD); // bottom-right
  const wTL = proj(0,   0,   AD); // top-left
  const wTR = proj(AW,  0,   AD); // top-right

  ctx.beginPath();
  ctx.moveTo(wBL.sx, wBL.sy);  // go to bottom-left
  ctx.lineTo(wBR.sx, wBR.sy);  // line to bottom-right
  ctx.lineTo(wTR.sx, wTR.sy);  // line to top-right
  ctx.lineTo(wTL.sx, wTL.sy);  // line to top-left
  ctx.closePath();              // connect back to the start

  const wg = ctx.createLinearGradient(0, wTL.sy, 0, wBL.sy);
  wg.addColorStop(0, '#1a0a28');
  wg.addColorStop(1, '#0a0514');
  ctx.fillStyle = wg;
  ctx.fill();

  // ── lantern glows ──
  drawLantern(W * 0.18, H * 0.22, '#ff5010'); // left lantern
  drawLantern(W * 0.82, H * 0.20, '#ff3510'); // right lantern
  drawLantern(W * 0.50, H * 0.16, '#ffaa20'); // center lantern

  // ── crowd silhouettes ──
  ctx.fillStyle = '#06060a'; // almost black
  for (let i = 0; i < 40; i++) {
    const cwx = (i / 40) * AW + 10; // spread people evenly across the width
    const ph  = 38 + (i % 5) * 11;  // varying heights for variety (% = remainder)
    const p1  = proj(cwx, 0,  AD * 0.93); // feet on ground
    const p2  = proj(cwx, ph, AD * 0.93); // top of their head
    const pw  = 12 + (i % 3) * 5;         // varying widths

    ctx.fillRect(p1.sx - pw / 2, p2.sy, pw, p1.sy - p2.sy); // body rectangle
    ctx.beginPath(); ctx.arc(p1.sx, p2.sy - 7, 6, 0, Math.PI * 2); ctx.fill(); // head circle
  }

  // ── arena floor ── four projected corners form a quadrilateral
  const fl = [
    proj(0,  0, 0),   // front-left corner
    proj(AW, 0, 0),   // front-right corner
    proj(AW, 0, AD),  // back-right corner
    proj(0,  0, AD),  // back-left corner
  ];

  ctx.beginPath();
  ctx.moveTo(fl[0].sx, fl[0].sy);
  fl.forEach(c => ctx.lineTo(c.sx, c.sy)); // draw line to each corner
  ctx.closePath();

  const fg = ctx.createLinearGradient(0, fl[3].sy, 0, fl[0].sy);
  fg.addColorStop(0, '#1a0e06');
  fg.addColorStop(1, '#0d0805');
  ctx.fillStyle = fg;
  ctx.fill();

  // ── floor grid lines ──
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth   = 1;

  // lines going into the distance (vertical perspective lines)
  for (let xi = 0; xi <= 8; xi++) {
    const wx = xi * (AW / 8); // evenly spaced
    const n  = proj(wx, 0, 0);   // near end
    const f  = proj(wx, 0, AD);  // far end
    ctx.beginPath(); ctx.moveTo(n.sx, n.sy); ctx.lineTo(f.sx, f.sy); ctx.stroke();
  }

  // lines going across (horizontal perspective lines)
  for (let zi = 0; zi <= 5; zi++) {
    const wz = zi * (AD / 5);
    const l  = proj(0,  0, wz); // left end
    const r  = proj(AW, 0, wz); // right end
    ctx.beginPath(); ctx.moveTo(l.sx, l.sy); ctx.lineTo(r.sx, r.sy); ctx.stroke();
  }

  // ── front cage edge ──
  const fe0 = proj(0,  0, 0);
  const fe1 = proj(AW, 0, 0);
  ctx.beginPath(); ctx.moveTo(fe0.sx, fe0.sy); ctx.lineTo(fe1.sx, fe1.sy);
  ctx.strokeStyle = 'rgba(200,155,70,.5)'; // golden color
  ctx.lineWidth   = 3;
  ctx.stroke();
}

// draws a soft glowing light circle (like a lantern or spotlight)
function drawLantern(sx, sy, col) {
  // createRadialGradient makes a gradient that fades from center outward
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 150);
  g.addColorStop(0,    col + 'bb'); // colored at center (bb = ~73% opacity in hex)
  g.addColorStop(0.35, col + '33'); // mostly faded at 35%
  g.addColorStop(1,    'transparent'); // fully gone at the edge
  ctx.fillStyle = g;
  ctx.fillRect(sx - 150, sy - 150, 300, 300); // fill a square big enough for the circle
}


// ================================================================
// STEP 9: GAME STATE VARIABLES
// These variables track the current state of the entire game
// ================================================================

let player;        // the player's Fighter object (created fresh each round)
let cpu;           // the cpu's Fighter object

let round    = 1;  // current round number
let pWins    = 0;  // how many rounds the player has won
let cWins    = 0;  // how many rounds the cpu has won
let timer    = 60; // countdown in seconds
let timerID  = null; // stores the setInterval ID so we can cancel it later

// phase tells us what's happening right now
// possible values: 'idle', 'countdown', 'fighting', 'roundover', 'gameover'
let phase = 'idle';

let rafID = null; // stores the requestAnimationFrame ID
let lastT = 0;    // timestamp of the previous frame (for calculating dt)

let cpuT      = 0; // timer controlling how often CPU AI makes a decision
let chokeTick = 0; // accumulates time to deal tick damage during choke


// ================================================================
// STEP 10: HUD UPDATE
// Called every frame to sync the health bars and numbers
// ================================================================

function updateHUD() {
  // set each bar's width as a percentage of max HP (100hp = 100% wide)
  document.getElementById('p-hp-bar').style.width   = player.hp + '%';
  document.getElementById('cpu-hp-bar').style.width = cpu.hp    + '%';
  document.getElementById('p-st-bar').style.width   = player.st + '%';
  document.getElementById('cpu-st-bar').style.width = cpu.st    + '%';

  // update the number labels next to the bars
  document.getElementById('p-hp-num').textContent = player.hp;
  document.getElementById('c-hp-num').textContent = cpu.hp;

  // Math.ceil rounds up: 59.3 becomes 60 so the display stays clean
  const s  = Math.ceil(timer);
  const td = document.getElementById('timer-txt');
  td.textContent = s;

  // classList.toggle adds the class if the condition is true, removes it if false
  td.classList.toggle('urgent', s <= 10); // turns red and pulses under 10 seconds

  document.getElementById('round-txt').textContent = 'ROUND ' + round;
}


// ================================================================
// STEP 11: MOVE LABEL (the text that flashes at the bottom)
// ================================================================

let labelT = 0; // countdown in ms until the label fades

// show a colored attack label at the bottom of the screen
function showLabel(text, col) {
  const el = document.getElementById('move-label');
  el.textContent  = text;
  el.style.color  = col;
  el.style.textShadow = '0 0 14px ' + col; // glow that matches the color
  el.style.opacity = '1';  // make it visible
  labelT = 1000;            // will fade after 1 second
}

// tick the label countdown every frame
function tickLabel(dt) {
  if (labelT > 0) {
    labelT -= dt * 1000; // subtract elapsed ms
    if (labelT <= 0) document.getElementById('move-label').style.opacity = '0';
  }
}


// ================================================================
// STEP 12: SHOW ROUND MESSAGES (FIGHT!, K.O.!, TIME!)
// ================================================================

// showMsg shows the big centered text
// The trick: remove element from DOM then re-add it — this restarts the CSS animation
function showMsg(text, ko, ms) {
  if (ms === undefined) ms = 1800; // default: show for 1.8 seconds

  const el  = document.getElementById('round-msg');
  const par = el.parentNode; // the parent element that contains round-msg

  par.removeChild(el);       // remove from page — this kills any running animation
  el.textContent   = text;
  el.className     = ko ? 'ko' : ''; // 'ko' class = red styling
  el.style.display = 'block';        // make it visible
  par.appendChild(el);               // re-add it — animation restarts from scratch!

  setTimeout(() => { el.style.display = 'none'; }, ms); // hide after ms milliseconds
}


// ================================================================
// STEP 13: SCREEN SWITCHER
// ================================================================

// hides all screens then shows the one with the matching id
function showScreen(id) {
  // forEach loops through each item in the array and runs the function
  ['start-screen', 'game-screen', 'gameover-screen'].forEach(s => {
    document.getElementById(s).classList.add('hidden'); // hide all three
  });
  document.getElementById(id).classList.remove('hidden'); // show the chosen one
}


// ================================================================
// STEP 14: GO TO LOBBY
// Called by both lobby buttons (in-game and gameover screen)
// Stops everything and returns to the start screen
// ================================================================

function goToLobby() {
  if (rafID) cancelAnimationFrame(rafID); // stop the game loop
  clearInterval(timerID);                  // stop the countdown timer
  particles = [];                          // clear all particles
  phase     = 'idle';                      // reset the phase
  showScreen('start-screen');              // go back to the start screen
}


// ================================================================
// STEP 15: HIT DETECTION
// Checks if an attacker's punch/kick/choke hit the defender
// ================================================================

// checkHit handles punch, hpunch, and kick
function checkHit(atk, def) {
  if (!atk.atkName || atk.atkHit) return; // no attack, or already landed this swing

  // if the distance between fighters is within the attack's reach
  if (atk.dist(def) < MOVES[atk.atkName].reach) {
    atk.atkHit = true; // mark as hit so we don't land it twice
    def.takeHit(MOVES[atk.atkName].dmg, atk.wx); // deal damage
  }
}

// checkChoke handles the special choke grab attack
function checkChoke(atk, def) {
  if (atk.atkName !== 'choke' || atk.atkHit) return; // not a choke, or already hit
  if (def.blocking) return; // can't choke a blocking fighter

  if (atk.dist(def) < MOVES.choke.reach) {
    atk.atkHit    = true;
    atk.choking   = true;     // start the choke hold
    atk.chokeRef  = def;      // remember who we're choking
    atk.chokeTimer = 1500;    // choke lasts 1.5 seconds
    atk.atkTimer  = 1500;     // keep attack state active
    def.takeHit(MOVES.choke.dmg, atk.wx); // initial hit
  }
}

// deal 3 damage every 200ms while the choke is active
function tickChoke(dt) {
  if (!player.choking || !player.chokeRef) return; // no active choke

  chokeTick += dt * 1000; // accumulate time in ms
  if (chokeTick >= 200) { // every 200ms
    chokeTick = 0;
    player.chokeRef.hp = Math.max(0, player.chokeRef.hp - 3); // deal 3 damage
    spawnSparks(player.chokeRef.wx, player.chokeRef.wz, 60, false);
    if (player.chokeRef.hp <= 0) player.chokeRef.dead = true;
  }
}


// ================================================================
// STEP 16: PLAYER INPUT
// Called every frame while fighting to read WASD and F
// ================================================================

function handleInput() {
  if (player.dead || player.choking) return; // can't move if KO'd or choking

  const spd = 255; // player movement speed in world units per second

  if (K['a']) player.vx = -spd; // A = move left (negative x)
  if (K['d']) player.vx =  spd; // D = move right (positive x)
  if (K['w']) player.vz =  spd * 0.6; // W = move into screen (positive z)
  if (K['s']) player.vz = -spd * 0.6; // S = move toward camera (negative z)
  if (K[' ']) player.jump();           // Space = jump

  // !! converts a truthy/falsy value to a proper true/false boolean
  player.blocking = !!K['f']; // F = block (hold to keep blocking)
}


// ================================================================
// STEP 17: CPU AI
// The CPU makes decisions automatically every N seconds
// It gets smarter (faster) each round
// ================================================================

function cpuAI(dt) {
  if (cpu.dead || player.dead || cpu.choking) return; // don't act if busy

  cpuT -= dt;          // count down the decision timer
  if (cpuT > 0) return; // not time to decide yet

  // reset timer — react faster in higher rounds, minimum 0.1s
  cpuT = Math.max(0.1, 0.5 - round * 0.08) + Math.random() * 0.18;

  const d = cpu.dist(player); // how far away is the player?

  // if player is attacking and nearby, maybe block
  if (player.atkName && d < 160) {
    cpu.blocking = Math.random() < 0.28 + round * 0.08; // higher chance later rounds
    return; // that's the CPU's action for this tick
  }
  cpu.blocking = false; // don't block otherwise

  // occasionally jump
  if (Math.random() < 0.06 * round && !cpu.jumping) { cpu.jump(); return; }

  // attack based on distance — closer = more attack options
  if (d < MOVES.choke.reach  && Math.random() < 0.1 * round) { cpu.tryMove('choke');  return; }
  if (d < MOVES.kick.reach   && Math.random() < 0.3)          { cpu.tryMove('kick');   return; }
  if (d < MOVES.hpunch.reach && Math.random() < 0.2)          { cpu.tryMove('hpunch'); return; }
  if (d < MOVES.punch.reach)                                   { cpu.tryMove('punch');  return; }

  // if too far away, chase the player
  const dx  = player.wx - cpu.wx; // difference in x
  const dz  = player.wz - cpu.wz; // difference in z
  const len = Math.hypot(dx, dz) || 1; // total distance (|| 1 avoids dividing by 0)
  const spd = 230 + round * 12;   // slightly faster each round
  cpu.vx = (dx / len) * spd;      // normalize direction then scale by speed
  cpu.vz = (dz / len) * spd;
  cpu.facing = cpu.wx < player.wx ? 1 : -1; // face the player
}


// ================================================================
// STEP 18: MAIN GAME LOOP
// requestAnimationFrame calls this function ~60 times per second
// Each call = one frame of the game
// ================================================================

function loop(ts) {
  // ts = timestamp in ms provided by the browser
  // dt = time since last frame in seconds (e.g. 0.016 for 60fps)
  // Math.min caps it at 0.1 so a lag spike doesn't cause fighters to teleport
  const dt = Math.min((ts - lastT) / 1000, 0.1);
  lastT = ts; // remember this frame's time for next frame

  // only run game logic when actually fighting
  if (phase === 'fighting') {
    handleInput();     // read keyboard
    cpuAI(dt);         // CPU thinks and acts

    player.update(dt); // move and update player
    cpu.update(dt);    // move and update CPU

    // both fighters automatically face each other
    player.facing = player.wx < cpu.wx ? 1 : -1;
    if (!cpu.choking) cpu.facing = cpu.wx < player.wx ? 1 : -1;

    // check if any attacks landed
    checkHit(player, cpu);
    checkHit(cpu, player);
    checkChoke(player, cpu);
    checkChoke(cpu, player);
    tickChoke(dt);   // ongoing choke damage

    tickLabel(dt);   // fade out the move label

    // check for round end
    if (player.dead || cpu.dead) endRound('ko');
    else if (timer <= 0)         endRound('timeout');
  }

  // ── DRAW EVERYTHING ──
  ctx.clearRect(0, 0, canvas.width, canvas.height); // wipe the canvas clean

  drawBG(); // draw arena background (goes behind everything)

  // painter's algorithm: draw the fighter with higher wz (farther away) FIRST
  // so the closer fighter renders on top of the farther one
  [player, cpu]
    .filter(Boolean)                     // filter(Boolean) removes null values
    .sort((a, b) => b.wz - a.wz)        // sort: biggest wz first (farther first)
    .forEach(f => f.draw());             // draw each fighter

  tickParticles(dt); // draw and update all particles

  // keep HUD in sync during active phases
  if (phase === 'fighting' || phase === 'countdown' || phase === 'roundover') {
    updateHUD();
  }

  // ask the browser to call loop() again before the next screen repaint
  rafID = requestAnimationFrame(loop);
}


// ================================================================
// STEP 19: GAME FLOW FUNCTIONS
// ================================================================

// startGame resets everything and begins round 1
function startGame() {
  round = 1; pWins = 0; cWins = 0; particles = [];
  showScreen('game-screen');
  resize(); // re-measure canvas now that game-screen is visible
  startRound();
}

// startRound sets up fighters and shows the countdown messages
function startRound() {
  phase = 'countdown'; // not fighting yet

  // create fresh fighters on opposite sides of the arena
  player = new Fighter(AW * 0.3, AD * 0.15, '#f4a261', 1);  // orange, facing right
  cpu    = new Fighter(AW * 0.7, AD * 0.70, '#7ec8e3', -1); // blue, facing left

  timer = 60; cpuT = 0.7; particles = []; chokeTick = 0;

  clearInterval(timerID); // cancel any existing timer first
  // setInterval runs a function every N milliseconds (1000ms = 1 second)
  timerID = setInterval(() => {
    if (phase === 'fighting') timer = Math.max(0, timer - 1); // count down each second
  }, 1000);

  updateHUD(); // show fresh bars immediately

  // show "ROUND X" then "FIGHT!" with delays using setTimeout
  showMsg('ROUND ' + round, false, 1200);
  setTimeout(() => {
    showMsg('FIGHT!', false, 900);
    setTimeout(() => { phase = 'fighting'; }, 950); // start fighting after 950ms
  }, 1300); // wait 1300ms before showing FIGHT!
}

// endRound is called when someone is KO'd or time runs out
function endRound(reason) {
  // guard: don't run twice if called multiple times in the same frame
  if (phase === 'roundover' || phase === 'gameover') return;

  phase = 'roundover';
  clearInterval(timerID); // stop the countdown

  let winner;
  if (reason === 'ko') {
    winner = player.dead ? 'cpu' : 'player'; // whoever isn't dead wins
    showMsg('K.O.!', true, 2000);
  } else {
    // time ran out — whoever has more HP wins
    winner = player.hp > cpu.hp ? 'player' : cpu.hp > player.hp ? 'cpu' : 'draw';
    showMsg('TIME!', false, 2000);
  }

  if (winner === 'player') pWins++;
  else if (winner === 'cpu') cWins++;

  // after 2.6 seconds, go to next round or end the match
  setTimeout(() => {
    // first to 2 wins out of 3 rounds wins the match
    if (pWins >= 2 || cWins >= 2 || round >= 3) endGame();
    else { round++; startRound(); }
  }, 2600);
}

// endGame shows the final result and goes to the gameover screen
function endGame() {
  phase = 'gameover';
  clearInterval(timerID);

  const t = document.getElementById('go-title');
  const s = document.getElementById('go-sub');

  if      (pWins > cWins) { t.textContent = 'VICTORY!'; s.textContent = 'You won '  + pWins + ' - ' + cWins; }
  else if (cWins > pWins) { t.textContent = 'DEFEATED'; s.textContent = 'CPU won '  + cWins + ' - ' + pWins; }
  else                    { t.textContent = 'DRAW';     s.textContent = 'Evenly matched!'; }

  setTimeout(() => showScreen('gameover-screen'), 1600); // short delay before showing
}


// ================================================================
// STEP 20: BUTTON LISTENERS
// addEventListener watches for a specific event (like 'click')
// and calls a function when it happens
// ================================================================

// START FIGHT button on the title screen
document.getElementById('start-btn').addEventListener('click', () => {
  startGame();
  lastT = performance.now(); // performance.now() gives the current time in ms
  rafID = requestAnimationFrame(loop); // start the game loop
});

// PLAY AGAIN button on the gameover screen
document.getElementById('restart-btn').addEventListener('click', () => {
  if (rafID) cancelAnimationFrame(rafID); // stop the old game loop
  clearInterval(timerID);
  particles = []; phase = 'idle';
  startGame();
  lastT = performance.now();
  rafID = requestAnimationFrame(loop); // start a fresh game loop
});

// ← LOBBY button shown during gameplay (top-right corner)
document.getElementById('lobby-btn').addEventListener('click', goToLobby);

// LOBBY button on the gameover screen
document.getElementById('go-lobby-btn').addEventListener('click', goToLobby);


// ================================================================
// STEP 21: SHOW START SCREEN ON PAGE LOAD
// When the file opens in the browser, show the start screen
// ================================================================
showScreen('start-screen');