/*
 * МИШКА — остров ягод и рыбалки
 * Three.js r147 (UMD, WebGL1-fallback — работает на старых iPhone)
 * Модель: Grizzly Bear by freddy1231 (Sketchfab, CC-BY 4.0)
 */
/* global THREE */
(function () {
  'use strict';

  // ---------------------------------------------------------------- utils
  var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  function lerpAngle(a, b, t) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }
  function damp(t, k, dt) { return 1 - Math.exp(-k * dt); } // factor for exp smoothing

  var IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  var UA = navigator.userAgent;
  var iOS = /iPad|iPhone|iPod/.test(UA) || (/Macintosh/.test(UA) && IS_TOUCH);

  // ---------------------------------------------------------------- audio
  var Sfx = {
    ctx: null, master: null, noiseBuf: null, enabled: true,
    unlock: function () {
      if (this.ctx) { if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume(); return; }
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        var len = this.ctx.sampleRate * 0.4;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        var d = this.noiseBuf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { this.ctx = null; }
    },
    _env: function (gain, t0, a, peak, dur) {
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + a);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    },
    tone: function (freq, dur, type, vol, freqEnd) {
      if (!this.ctx || !this.enabled) return;
      var t0 = this.ctx.currentTime;
      var o = this.ctx.createOscillator();
      var g = this.ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
      this._env(g, t0, 0.012, vol || 0.2, dur);
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + dur + 0.05);
    },
    noise: function (dur, vol, fStart, fEnd, q) {
      if (!this.ctx || !this.enabled) return;
      var t0 = this.ctx.currentTime;
      var src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      var f = this.ctx.createBiquadFilter();
      f.type = 'bandpass'; f.Q.value = q || 1.2;
      f.frequency.setValueAtTime(fStart, t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd), t0 + dur);
      var g = this.ctx.createGain();
      this._env(g, t0, 0.01, vol, dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t0); src.stop(t0 + dur + 0.05);
    },
    pop: function () { this.tone(520, 0.09, 'sine', 0.22, 900); },
    berry: function () { this.tone(740, 0.07, 'sine', 0.2, 1050); this.tone(1100, 0.06, 'triangle', 0.12, 1400); },
    munch: function () { this.noise(0.09, 0.24, 900, 350, 1.5); },
    splash: function () { this.noise(0.32, 0.3, 1400, 300, 0.9); this.tone(300, 0.15, 'sine', 0.1, 90); },
    bite: function () { this.tone(880, 0.07, 'square', 0.14); this.tone(1245, 0.09, 'square', 0.14); },
    win: function () {
      var self = this;
      [523, 659, 784, 1047].forEach(function (f, i) {
        setTimeout(function () { self.tone(f, 0.16, 'triangle', 0.18); }, i * 95);
      });
    },
    fail: function () { this.tone(330, 0.22, 'sawtooth', 0.1, 170); },
    chirp: function () {
      var self = this;
      var f = 2200 + Math.random() * 900;
      this.tone(f, 0.06, 'sine', 0.045, f * 1.3);
      setTimeout(function () { self.tone(f * 1.12, 0.05, 'sine', 0.04, f * 0.9); }, 90);
    }
  };

  // ---------------------------------------------------------------- dom
  var el = function (id) { return document.getElementById(id); };
  var dom = {
    cntBerry: el('cntBerry'), cntFish: el('cntFish'),
    satietyFill: el('satietyFill'), questText: el('questText'),
    hint: el('hint'), toast: el('toast'),
    joyZone: el('joyZone'), joyBase: el('joyBase'), joyStick: el('joyStick'), joyHint: el('joyHint'),
    btnAct: el('btnAct'), btnActText: el('btnActText'),
    btnSound: el('btnSound'), loader: el('loader'), bar: el('bar'),
    loadTip: el('loadTip'), btnPlay: el('btnPlay'), errBox: el('errBox')
  };

  var toastTimer = null;
  function showToast(text, dur) {
    dom.toast.textContent = text;
    dom.toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { dom.toast.classList.remove('show'); }, dur || 2600);
  }
  function showHint(text) {
    if (text) { dom.hint.textContent = text; dom.hint.classList.add('show'); }
    else dom.hint.classList.remove('show');
  }
  function fatal(msg) {
    dom.errBox.style.display = 'block';
    dom.errBox.textContent = msg;
  }
  window.addEventListener('error', function (e) {
    if (!window.__bear) dom.loadTip.textContent = 'Ошибка загрузки: ' + (e.message || 'неизвестно');
  });

  // ---------------------------------------------------------------- constants
  var WORLD_R = 23.0;          // граница ходьбы
  var POND = { x: 7.5, z: -8, r: 4.6 };
  var POND_KEEP = 5.0;         // мишка не заходит ближе
  var BEAR_SCALE = 0.42;
  var BEAR_SPEED = 2.5;

  var COL = {
    skyTop: 0x6fc3ef, skyMid: 0xbfe8f7, skyLow: 0xffe3a8,
    fog: 0xcfebf5,
    grass: 0x7ecb5a, grass2: 0x69bd4c, grass3: 0x93d96e,
    ocean: 0x58c2e8, pond: 0x49b7e0, pondDeep: 0x2f92c4,
    sand: 0xf2dca0,
    trunk: 0x8a5a38, leaf1: 0x4e9e3f, leaf2: 0x5cb04a, leaf3: 0xf2a0c4, leafPink2: 0xf7b8d4,
    berryR: 0xe8452a, berryO: 0xff9c41, berryB: 0x6a8cf0,
    flower1: 0xffffff, flower2: 0xffd23e, flower3: 0xff8ab8,
    stone: 0xb4aca0, mushCap: 0xe8452a, mushStem: 0xfff6e8,
    fish: 0xff9c41,
    mountain1: 0xa9d8bb, mountain2: 0x93c9d6, mountain3: 0xb7dcc3
  };
  var hex2lin = function (h) { return new THREE.Color(h).convertSRGBToLinear(); };

  // ---------------------------------------------------------------- renderer & scene
  var canvas = el('c3d');
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: 'default' });
  } catch (e) {
    fatal('WebGL недоступен на этом устройстве. Обнови iOS или открой игру в другом браузере.');
    return;
  }
  var DPR_CAP = IS_TOUCH ? 1.4 : 2;
  var pixelRatio = Math.min(window.devicePixelRatio || 1, DPR_CAP);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;

  var scene = new THREE.Scene();
  scene.fog = new THREE.Fog(hex2lin(COL.fog).getHex(), 20, 46);
  scene.background = hex2lin(COL.fog);

  var camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 130);

  var hemi = new THREE.HemisphereLight(0xfff3d6, 0x7ecb5a, 0.95);
  hemi.color.convertSRGBToLinear(); hemi.groundColor.convertSRGBToLinear();
  scene.add(hemi);
  var sunLight = new THREE.DirectionalLight(0xfff2cc, 0.85);
  sunLight.color.convertSRGBToLinear();
  sunLight.position.set(6, 10, 4);
  scene.add(sunLight);

  // ---------------------------------------------------------------- geometry helpers
  var sharedLambert = new THREE.MeshLambertMaterial({ vertexColors: true });

  function tint(geo, hex, jitter) {
    var c = hex2lin(hex);
    var n = geo.attributes.position.count;
    var arr = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var j = jitter ? (1 - jitter + Math.random() * jitter * 2) : 1;
      arr[i * 3] = c.r * j; arr[i * 3 + 1] = c.g * j; arr[i * 3 + 2] = c.b * j;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  }
  function flat(geo) {
    var g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    return g;
  }
  function prep(geo) { geo.deleteAttribute('uv'); return geo; }
  function mergeGeos(list) {
    var norm = [];
    for (var i = 0; i < list.length; i++) norm.push(list[i].index ? list[i].toNonIndexed() : list[i]);
    var out = THREE.BufferGeometryUtils.mergeBufferGeometries(norm, false);
    if (!out) throw new Error('merge failed');
    return out;
  }
  function mat4(x, y, z, ry, s, rx, rz) {
    var m = new THREE.Matrix4();
    var q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
    var sc = new THREE.Vector3(s, s, s);
    m.compose(new THREE.Vector3(x, y, z), q, sc);
    return m;
  }

  // ---------------------------------------------------------------- sky, sun, clouds
  (function buildSky() {
    var geo = new THREE.SphereGeometry(72, 24, 16);
    var pos = geo.attributes.position;
    var colors = new Float32Array(pos.count * 3);
    var cTop = hex2lin(COL.skyTop), cMid = hex2lin(COL.skyMid), cLow = hex2lin(COL.skyLow);
    for (var i = 0; i < pos.count; i++) {
      var y = pos.getY(i) / 72;
      var c;
      if (y < 0) {
        var t = clamp(1 + y * 3, 0, 1);
        c = cLow.clone().lerp(cMid, t * 0.4);
      } else {
        var t2 = Math.pow(clamp(y * 1.6, 0, 1), 0.8);
        c = cMid.clone().lerp(cTop, t2);
      }
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    var mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false
    }));
    mesh.renderOrder = -2;
    scene.add(mesh);
  })();

  function makeGlowSprite(size, inner, outer) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    var g = cv.getContext('2d');
    var grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.55, outer);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    var tex = new THREE.CanvasTexture(cv);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false, transparent: true }));
    sp.scale.set(size, size, 1);
    return sp;
  }
  var sunSprite = makeGlowSprite(16, 'rgba(255,244,200,1)', 'rgba(255,214,130,0.55)');
  sunSprite.position.set(-20, 22, -34);
  scene.add(sunSprite);

  var clouds = [];
  (function buildClouds() {
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    var g = cv.getContext('2d');
    function puff(x, y, r, a) {
      var grad = g.createRadialGradient(x, y, r * 0.2, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,' + a + ')');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    puff(88, 74, 52, 0.95); puff(140, 62, 62, 0.9); puff(184, 76, 46, 0.85); puff(120, 84, 44, 0.8);
    var tex = new THREE.CanvasTexture(cv);
    for (var i = 0; i < 5; i++) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false, transparent: true, opacity: 0.9 }));
      var s = 9 + Math.random() * 7;
      sp.scale.set(s, s * 0.5, 1);
      sp.position.set(-30 + Math.random() * 60, 9 + Math.random() * 6, -30 + Math.random() * 55);
      scene.add(sp);
      clouds.push(sp);
    }
  })();

  // ---------------------------------------------------------------- world storage
  var WORLD = { bushes: [], trees: [], butterflies: [], fish: [], emitters: [], rings: [], regrow: [] };

  // ---------------------------------------------------------------- ground, ocean, pond
  (function buildGround() {
    var geo = new THREE.RingGeometry(0.001, 24.6, 48, 14);
    geo.rotateX(-Math.PI / 2);
    prep(geo);
    var pos = geo.attributes.position;
    var colors = new Float32Array(pos.count * 3);
    var g1 = hex2lin(COL.grass), g2 = hex2lin(COL.grass2), g3 = hex2lin(COL.grass3);
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i);
      var n = Math.sin(x * 0.55 + Math.sin(z * 0.7) * 1.3) * 0.5 + Math.sin(z * 0.42 + x * 0.31) * 0.5;
      var c = g1.clone();
      if (n > 0.25) c.lerp(g3, clamp((n - 0.25) * 1.8, 0, 1));
      else if (n < -0.2) c.lerp(g2, clamp((-n - 0.2) * 1.6, 0, 1));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    scene.add(new THREE.Mesh(geo, sharedLambert));

    // океан
    var ocean = new THREE.Mesh(prep(new THREE.CircleGeometry(78, 56).rotateX(-Math.PI / 2)),
      new THREE.MeshLambertMaterial({ color: hex2lin(COL.ocean) }));
    ocean.position.y = -0.06;
    scene.add(ocean);

    // прибой у берегов острова
    WORLD.foam1 = new THREE.Mesh(prep(new THREE.RingGeometry(24.4, 25.7, 52).rotateX(-Math.PI / 2)),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
    WORLD.foam1.position.y = -0.01;
    scene.add(WORLD.foam1);
    WORLD.foam2 = new THREE.Mesh(prep(new THREE.RingGeometry(25.7, 28.2, 52).rotateX(-Math.PI / 2)),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }));
    WORLD.foam2.position.y = -0.02;
    scene.add(WORLD.foam2);

    // песок вокруг пруда
    var sand = new THREE.Mesh(prep(new THREE.RingGeometry(POND.r - 0.7, POND.r + 1.5, 36).rotateX(-Math.PI / 2)),
      new THREE.MeshLambertMaterial({ color: hex2lin(COL.sand) }));
    sand.position.set(POND.x, 0.012, POND.z);
    scene.add(sand);

    // вода пруда
    WORLD.pondWater = new THREE.Mesh(prep(new THREE.CircleGeometry(POND.r, 36).rotateX(-Math.PI / 2)),
      new THREE.MeshLambertMaterial({
        color: hex2lin(COL.pond), transparent: true, opacity: 0.85, depthWrite: false
      }));
    WORLD.pondWater.position.set(POND.x, 0.03, POND.z);
    WORLD.pondWater.renderOrder = 3;
    scene.add(WORLD.pondWater);
    var deep = new THREE.Mesh(prep(new THREE.CircleGeometry(POND.r * 0.62, 28).rotateX(-Math.PI / 2)),
      new THREE.MeshBasicMaterial({ color: hex2lin(COL.pondDeep), transparent: true, opacity: 0.55, depthWrite: false }));
    deep.position.set(POND.x, 0.025, POND.z);
    deep.renderOrder = 3;
    scene.add(deep);

    // блики на воде
    var sparkGeo = new THREE.BufferGeometry();
    var pts = new Float32Array(26 * 3);
    for (var s = 0; s < 26; s++) {
      var a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * POND.r * 0.85;
      pts[s * 3] = POND.x + Math.cos(a) * r;
      pts[s * 3 + 1] = 0.05;
      pts[s * 3 + 2] = POND.z + Math.sin(a) * r;
    }
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    WORLD.sparkles = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
      color: 0xffffff, size: 0.075, transparent: true, opacity: 0.75, depthWrite: false, sizeAttenuation: true
    }));
    WORLD.sparkles.renderOrder = 4;
    scene.add(WORLD.sparkles);
  })();

  // ---------------------------------------------------------------- flora & world objects (см. WORLD выше)

  // ---------------------------------------------------------------- trees / bushes / props (merged)
  (function buildFlora() {
    var treeGeos = [];
    var bushPositions = [
      { x: -3.5, z: 8, type: 0 }, { x: 4.5, z: 7.5, type: 1 }, { x: -9, z: 3, type: 0 },
      { x: 11, z: 2, type: 2 }, { x: -5, z: -6, type: 2 }, { x: -13, z: -8, type: 1 },
      { x: 13, z: 11, type: 0 }, { x: -2, z: 14, type: 1 }
    ];
    var berryCols = [COL.berryR, COL.berryO, COL.berryB];

    function farEnough(x, z, minD) {
      for (var i = 0; i < bushPositions.length; i++) {
        var dx = x - bushPositions[i].x, dz = z - bushPositions[i].z;
        if (dx * dx + dz * dz < minD * minD) return false;
      }
      var pdx = x - POND.x, pdz = z - POND.z;
      if (pdx * pdx + pdz * pdz < (POND.r + 2.4) * (POND.r + 2.4)) return false;
      var sd = Math.sqrt(x * x + z * z);
      if (sd < 2.2 || sd > WORLD_R + 1) return false;
      return true;
    }

    // деревья: кольцом у кромки + несколько внутри
    var treeSpots = [];
    var N = 16, tries = 0;
    while (treeSpots.length < N && tries < 400) {
      tries++;
      var a = (treeSpots.length / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      var r = 14.5 + Math.random() * 7;
      var x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!farEnough(x, z, 3.2)) continue;
      var ok = true;
      for (var k = 0; k < treeSpots.length; k++) {
        var dx = x - treeSpots[k].x, dz = z - treeSpots[k].z;
        if (dx * dx + dz * dz < 3.4 * 3.4) { ok = false; break; }
      }
      if (ok) treeSpots.push({ x: x, z: z });
    }
    var inner = [[-11, 10], [8, -3], [-7, -12], [16, 6]];
    for (var q = 0; q < inner.length; q++) {
      if (farEnough(inner[q][0], inner[q][1], 3.2)) treeSpots.push({ x: inner[q][0], z: inner[q][1] });
    }

    for (var t = 0; t < treeSpots.length; t++) {
      var sp = treeSpots[t];
      var h = 1.5 + Math.random() * 0.9;
      var trunk = prep(new THREE.CylinderGeometry(0.13, 0.2, h, 7));
      trunk.applyMatrix4(mat4(sp.x, h / 2, sp.z, 0, 1));
      tint(trunk, COL.trunk, 0.08);
      treeGeos.push(trunk);
      var pink = Math.random() < 0.22;
      var leafCol = pink ? COL.leaf3 : (Math.random() < 0.5 ? COL.leaf1 : COL.leaf2);
      var cy = h + 0.45;
      for (var b = 0; b < 3; b++) {
        var rad = 0.85 - b * 0.18 + Math.random() * 0.12;
        var can = flat(prep(new THREE.IcosahedronGeometry(rad, 0)));
        can.applyMatrix4(mat4(
          sp.x + (Math.random() - 0.5) * 0.5,
          cy + b * 0.62 + Math.random() * 0.15,
          sp.z + (Math.random() - 0.5) * 0.5,
          Math.random() * 3, 1));
        tint(can, pink ? (b === 1 ? COL.leafPink2 : leafCol) : leafCol, 0.1);
        treeGeos.push(can);
      }
      WORLD.trees.push({ x: sp.x, z: sp.z, r: 0.75, pink: pink });
    }

    // кусты (статичная часть) + ягоды отдельными мешами
    var bushGeos = [];
    var bushSphere = new THREE.SphereGeometry(0.5, 9, 7);
    var berryTemplate = [[0.3, 0.72, 0.2], [-0.34, 0.52, 0.3], [0.46, 0.44, -0.22], [-0.12, 0.78, -0.38]];
    var berrySphere = new THREE.SphereGeometry(0.1, 8, 6);

    for (var i2 = 0; i2 < bushPositions.length; i2++) {
      var bp = bushPositions[i2];
      var s = 0.9 + Math.random() * 0.35;
      var g1b = flat(prep(bushSphere.clone()));
      g1b.applyMatrix4(mat4(bp.x, 0.38 * s, bp.z, Math.random() * 3, s * 1.05));
      tint(g1b, 0x3f8f33, 0.08);
      bushGeos.push(g1b);
      var g2b = flat(prep(bushSphere.clone()));
      g2b.applyMatrix4(mat4(bp.x + 0.32, 0.3 * s, bp.z - 0.22, Math.random() * 3, s * 0.72));
      tint(g2b, 0x4a9e3c, 0.08);
      bushGeos.push(g2b);
      var g3b = flat(prep(bushSphere.clone()));
      g3b.applyMatrix4(mat4(bp.x - 0.3, 0.28 * s, bp.z + 0.2, Math.random() * 3, s * 0.68));
      tint(g3b, 0x357f2b, 0.08);
      bushGeos.push(g3b);

      // ягоды: один меш на куст
      var parts = [];
      var bcol = hex2lin(berryCols[bp.type]);
      for (var bI = 0; bI < 4; bI++) {
        var off = berryTemplate[bI];
        var bg = prep(berrySphere.clone());
        bg.applyMatrix4(mat4(bp.x + off[0] * s, off[1] * s + 0.12, bp.z + off[2] * s, 0, 1));
        var n2 = bg.attributes.position.count;
        var colArr = new Float32Array(n2 * 3);
        for (var v = 0; v < n2; v++) { colArr[v * 3] = bcol.r; colArr[v * 3 + 1] = bcol.g; colArr[v * 3 + 2] = bcol.b; }
        bg.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
        parts.push(bg);
      }
      var berryMesh = new THREE.Mesh(mergeGeos(parts), sharedLambert);
      scene.add(berryMesh);
      WORLD.bushes.push({
        x: bp.x, z: bp.z, r: 0.85 * s + 0.55, type: bp.type,
        berries: berryMesh, ready: true, regrowT: 0, harvested: false
      });
    }

    scene.add(new THREE.Mesh(mergeGeos(treeGeos), sharedLambert));
    scene.add(new THREE.Mesh(mergeGeos(bushGeos), sharedLambert));
  })();

  (function buildProps() {
    var geos = [];
    // трава
    for (var i = 0; i < 64; i++) {
      var a = Math.random() * Math.PI * 2, r = 2 + Math.sqrt(Math.random()) * 20;
      var x = Math.cos(a) * r, z = Math.sin(a) * r;
      var pdx = x - POND.x, pdz = z - POND.z;
      if (pdx * pdx + pdz * pdz < (POND.r + 1.2) * (POND.r + 1.2)) continue;
      var h = 0.22 + Math.random() * 0.3;
      var g = prep(new THREE.ConeGeometry(0.045 + Math.random() * 0.03, h, 4));
      g.applyMatrix4(mat4(x, h / 2, z, Math.random() * 3, 1, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3));
      tint(g, Math.random() < 0.5 ? 0x5fb84a : 0x74cf58, 0.12);
      geos.push(g);
    }
    // цветы
    var flowerCols = [COL.flower1, COL.flower2, COL.flower3, COL.flower2];
    for (var f = 0; f < 34; f++) {
      var a2 = Math.random() * Math.PI * 2, r2 = 2.5 + Math.sqrt(Math.random()) * 18;
      var x2 = Math.cos(a2) * r2, z2 = Math.sin(a2) * r2;
      var pdx2 = x2 - POND.x, pdz2 = z2 - POND.z;
      if (pdx2 * pdx2 + pdz2 * pdz2 < (POND.r + 1.0) * (POND.r + 1.0)) continue;
      var stem = prep(new THREE.CylinderGeometry(0.016, 0.02, 0.3, 5));
      stem.applyMatrix4(mat4(x2, 0.15, z2, 0, 1));
      tint(stem, 0x4a9e3c, 0.05);
      geos.push(stem);
      var head = prep(new THREE.SphereGeometry(0.07, 7, 6));
      head.applyMatrix4(mat4(x2, 0.33, z2, 0, 1));
      tint(head, flowerCols[Math.floor(Math.random() * flowerCols.length)], 0.06);
      geos.push(head);
    }
    // камни
    for (var st = 0; st < 9; st++) {
      var a3 = Math.random() * Math.PI * 2, r3 = 4 + Math.sqrt(Math.random()) * 17;
      var x3 = Math.cos(a3) * r3, z3 = Math.sin(a3) * r3;
      var pdx3 = x3 - POND.x, pdz3 = z3 - POND.z;
      if (pdx3 * pdx3 + pdz3 * pdz3 < (POND.r + 1.4) * (POND.r + 1.4)) continue;
      var s3 = 0.14 + Math.random() * 0.3;
      var sg = flat(prep(new THREE.IcosahedronGeometry(s3, 0)));
      sg.applyMatrix4(mat4(x3, s3 * 0.55, z3, Math.random() * 3, 1, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4));
      tint(sg, COL.stone, 0.1);
      geos.push(sg);
    }
    // грибы у деревьев
    for (var m = 0; m < 7; m++) {
      var tr = WORLD.trees[Math.floor(Math.random() * WORLD.trees.length)];
      if (!tr) break;
      var mx = tr.x + (Math.random() - 0.5) * 1.6, mz = tr.z + (Math.random() - 0.5) * 1.6;
      if (Math.sqrt(mx * mx + mz * mz) > WORLD_R) continue;
      var stem2 = prep(new THREE.CylinderGeometry(0.035, 0.045, 0.14, 6));
      stem2.applyMatrix4(mat4(mx, 0.07, mz, 0, 1));
      tint(stem2, COL.mushStem, 0.04);
      geos.push(stem2);
      var cap = prep(new THREE.SphereGeometry(0.09, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55));
      cap.applyMatrix4(mat4(mx, 0.13, mz, Math.random() * 3, 1));
      tint(cap, COL.mushCap, 0.07);
      geos.push(cap);
    }
    if (geos.length) scene.add(new THREE.Mesh(mergeGeos(geos), sharedLambert));
  })();

  // тени-пятна под объектами (без shadow maps — экономно для старых GPU)
  (function buildShadows() {
    var geos = [];
    function blob(x, z, r) {
      var g = prep(new THREE.CircleGeometry(r, 12));
      g.rotateX(-Math.PI / 2);
      g.applyMatrix4(mat4(x, 0.008, z, 0, 1));
      var n = g.attributes.position.count;
      var arr = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) { arr[i * 3] = 0; arr[i * 3 + 1] = 0; arr[i * 3 + 2] = 0; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      geos.push(g);
    }
    for (var t = 0; t < WORLD.trees.length; t++) blob(WORLD.trees[t].x, WORLD.trees[t].z, 0.95);
    for (var b = 0; b < WORLD.bushes.length; b++) blob(WORLD.bushes[b].x, WORLD.bushes[b].z, 0.7);
    var mesh = new THREE.Mesh(mergeGeos(geos), new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.16, depthWrite: false
    }));
    mesh.renderOrder = 1;
    scene.add(mesh);
  })();

  // горы на горизонте
  (function buildMountains() {
    var geos = [];
    var cols = [COL.mountain1, COL.mountain2, COL.mountain3];
    for (var i = 0; i < 13; i++) {
      var a = (i / 13) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      var r = 36 + Math.random() * 10;
      var h = 7 + Math.random() * 8;
      var rad = 5 + Math.random() * 4;
      var g = flat(prep(new THREE.ConeGeometry(rad, h, 6)));
      g.applyMatrix4(mat4(Math.cos(a) * r, h / 2 - 0.4, Math.sin(a) * r, Math.random() * 3, 1));
      tint(g, cols[i % cols.length], 0.05);
      geos.push(g);
    }
    scene.add(new THREE.Mesh(mergeGeos(geos), sharedLambert));
  })();

  // кувшинки
  var lilies = [];
  (function buildLilies() {
    for (var i = 0; i < 3; i++) {
      var a = Math.random() * Math.PI * 2, r = 1.6 + Math.random() * 2.2;
      var m = new THREE.Mesh(prep(new THREE.CircleGeometry(0.28 + Math.random() * 0.14, 9).rotateX(-Math.PI / 2)),
        new THREE.MeshLambertMaterial({ color: hex2lin(0x4aa545) }));
      m.position.set(POND.x + Math.cos(a) * r, 0.045, POND.z + Math.sin(a) * r);
      scene.add(m);
      lilies.push({ m: m, ph: Math.random() * 6 });
    }
  })();

  // рыбы в пруду
  var fishMat = new THREE.MeshLambertMaterial({ color: hex2lin(COL.fish) });
  var fishGeo = (function () {
    var body = prep(new THREE.SphereGeometry(0.14, 9, 7));
    body.scale(0.75, 0.8, 1.7);
    var tail = prep(new THREE.ConeGeometry(0.1, 0.18, 6));
    tail.rotateX(Math.PI / 2);
    tail.applyMatrix4(mat4(0, 0, -0.27, 0, 1));
    return mergeGeos([body, tail]);
  })();
  (function buildFish() {
    for (var i = 0; i < 3; i++) {
      var m = new THREE.Mesh(fishGeo, fishMat);
      scene.add(m);
      WORLD.fish.push({
        m: m, r: 1.4 + i * 0.85, speed: (0.5 + Math.random() * 0.4) * (i % 2 ? 1 : -1),
        ph: Math.random() * 6, y: -0.16 - i * 0.05
      });
    }
  })();

  // бабочки
  (function buildButterflies() {
    var cols = [0xff8ab8, 0xffd23e, 0x8fd0ff, 0xc9a0ff];
    var wingGeo = prep(new THREE.PlaneGeometry(0.16, 0.22));
    wingGeo.translate(0.08, 0, 0);
    wingGeo.rotateX(-Math.PI / 2);
    for (var i = 0; i < 5; i++) {
      var mat = new THREE.MeshLambertMaterial({ color: hex2lin(cols[i % cols.length]), side: THREE.DoubleSide });
      var grp = new THREE.Group();
      var wl = new THREE.Mesh(wingGeo, mat);
      var wr = new THREE.Mesh(wingGeo, mat);
      wr.scale.x = -1;
      grp.add(wl); grp.add(wr);
      var a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 14;
      grp.position.set(Math.cos(a) * r, 0.9, Math.sin(a) * r);
      scene.add(grp);
      WORLD.butterflies.push({ g: grp, wl: wl, wr: wr, a: Math.random() * 6, r: r, cx: 0, cz: 0, ph: Math.random() * 6, sp: 0.25 + Math.random() * 0.3 });
    }
  })();

  // ---------------------------------------------------------------- particles & rings
  function makeEmitter(count, size) {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    var mat = new THREE.PointsMaterial({ color: 0xffffff, size: size || 0.09, transparent: true, opacity: 1, depthWrite: false, sizeAttenuation: true });
    var pts = new THREE.Points(geo, mat);
    pts.visible = false;
    pts.renderOrder = 5;
    pts.frustumCulled = false;
    scene.add(pts);
    return { pts: pts, vel: new Float32Array(count * 3), life: 0, max: 0.6, count: count, active: false };
  }
  for (var eI = 0; eI < 8; eI++) WORLD.emitters.push(makeEmitter(14, 0.085));

  function burst(x, y, z, color, power) {
    var em = null;
    for (var i = 0; i < WORLD.emitters.length; i++) if (!WORLD.emitters[i].active) { em = WORLD.emitters[i]; break; }
    if (!em) em = WORLD.emitters[0];
    em.active = true; em.life = em.max;
    em.pts.material.color.set(hex2lin(color));
    em.pts.material.opacity = 1;
    var pos = em.pts.geometry.attributes.position;
    for (var p = 0; p < em.count; p++) {
      pos.setXYZ(p, x, y, z);
      var a = Math.random() * Math.PI * 2;
      var up = 1.6 + Math.random() * 1.8;
      var sp = (power || 1) * (0.5 + Math.random());
      em.vel[p * 3] = Math.cos(a) * sp;
      em.vel[p * 3 + 1] = up;
      em.vel[p * 3 + 2] = Math.sin(a) * sp;
    }
    pos.needsUpdate = true;
    em.pts.visible = true;
  }
  function makeRing() {
    var m = new THREE.Mesh(prep(new THREE.RingGeometry(0.16, 0.24, 22).rotateX(-Math.PI / 2)),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
    m.visible = false;
    m.renderOrder = 4;
    scene.add(m);
    return { m: m, life: 0 };
  }
  for (var rI = 0; rI < 4; rI++) WORLD.rings.push(makeRing());
  function splashRing(x, z, big) {
    var rg = null;
    for (var i = 0; i < WORLD.rings.length; i++) if (WORLD.rings[i].life <= 0) { rg = WORLD.rings[i]; break; }
    if (!rg) rg = WORLD.rings[0];
    rg.life = 0.55;
    rg.max = 0.55;
    rg.big = big || 1;
    rg.m.position.set(x, 0.05, z);
    rg.m.scale.set(1, 1, 1);
    rg.m.material.opacity = 0.85;
    rg.m.visible = true;
  }

  // ---------------------------------------------------------------- bear
  var bear = {
    group: new THREE.Group(), inner: null, mixer: null, actions: {},
    current: '', state: 'free', actType: '', actBush: null,
    yaw: Math.atan2(POND.x - 0, POND.z - 13),
    pos: new THREE.Vector3(0, 0, 13),
    speed: 0, satiety: 70, handBone: null, fishInPaw: null
  };
  scene.add(bear.group);

  var shadowGroup = new THREE.Group();
  var shadowMesh = new THREE.Mesh(prep(new THREE.CircleGeometry(0.5, 14).rotateX(-Math.PI / 2)),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  shadowMesh.scale.set(1.5, 1, 1.05);
  shadowMesh.renderOrder = 1;
  shadowGroup.add(shadowMesh);
  scene.add(shadowGroup);

  // поплавок
  var bobber = new THREE.Group();
  var bb1 = new THREE.Mesh(prep(new THREE.SphereGeometry(0.075, 8, 6)),
    new THREE.MeshLambertMaterial({ color: hex2lin(0xffffff) }));
  var bb2 = new THREE.Mesh(prep(new THREE.SphereGeometry(0.075, 8, 6)),
    new THREE.MeshLambertMaterial({ color: hex2lin(0xe8452a) }));
  bb2.scale.set(1, 0.72, 1);
  bb2.position.y = 0.035;
  bobber.add(bb1); bobber.add(bb2);
  bobber.visible = false;
  scene.add(bobber);
  var bobberPos = new THREE.Vector3();

  // ---------------------------------------------------------------- save / quests
  var SAVE_KEY = 'bear_game_save_v1';
  var save = { b: 0, f: 0, q: 0, qp: 0, s: 70, tut: 0 };
  try {
    var raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed.b === 'number') save = parsed;
    }
  } catch (e) { /* private mode */ }
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
  }
  save.s = clamp(save.s, 0, 100);

  var QUESTS = [
    { kind: 'berry', n: 3, text: 'Собери 3 ягоды с кустов' },
    { kind: 'fish', n: 1, text: 'Поймай рыбку в пруду' },
    { kind: 'berry', n: 7, text: 'Собери ещё 7 ягод' },
    { kind: 'fish', n: 2, text: 'Поймай 2 рыбки' },
    { kind: 'berry', n: 12, text: 'Большой урожай: 12 ягод' },
    { kind: 'fish', n: 3, text: 'Настоящий рыбак: 3 рыбки' },
    { kind: 'satiety', n: 100, text: 'Накорми мишку досыта — 100% сытости' }
  ];
  function updateQuestHud() {
    if (save.q >= QUESTS.length) {
      dom.questText.textContent = 'Гуляй, собирай ягоды и рыбачь сколько хочешь!';
    } else {
      var q = QUESTS[save.q];
      var prog = q.kind === 'satiety' ? Math.round(save.s) + '%' : (save.qp + ' / ' + q.n);
      dom.questText.textContent = q.text + ' (' + prog + ')';
    }
  }
  function questEvent(kind) {
    if (save.q >= QUESTS.length) return;
    var q = QUESTS[save.q];
    if (q.kind !== kind) return;
    save.qp++;
    if (save.qp >= q.n) {
      save.qp = 0;
      save.q++;
      persist();
      updateQuestHud();
      Sfx.win();
      showToast('Задание выполнено! Молодец, мишка!', 3200);
      setTimeout(function () {
        if (bear.state === 'free') { startAction('cheer'); }
      }, 900);
      burst(bear.pos.x, 1.2, bear.pos.z, 0xffd23e, 1.4);
      burst(bear.pos.x, 1.2, bear.pos.z, 0xff8ab8, 1.2);
    } else persist();
    updateQuestHud();
  }

  function addBerries(n) {
    save.b += n; save.s = clamp(save.s + n * 9, 0, 100);
    dom.cntBerry.textContent = save.b;
    dom.satietyFill.style.width = save.s + '%';
    persist(); questEvent('berry');
  }
  function addFish(n) {
    save.f += n; save.s = clamp(save.s + n * 32, 0, 100);
    dom.cntFish.textContent = save.f;
    dom.satietyFill.style.width = save.s + '%';
    persist(); questEvent('fish');
  }

  // ---------------------------------------------------------------- animation setup
  function setupAnimations(data) {
    bear.mixer = new THREE.AnimationMixer(bear.inner);
    for (var i = 0; i < data.clips.length; i++) {
      var c = data.clips[i];
      var tracks = [];
      for (var j = 0; j < c.tracks.length; j++) {
        var t = c.tracks[j];
        if (t.path === 'quaternion') {
          tracks.push(new THREE.QuaternionKeyframeTrack(t.bone + '.quaternion', t.times, t.values));
        } else {
          tracks.push(new THREE.VectorKeyframeTrack(t.bone + '.position', t.times, t.values));
        }
      }
      var clip = new THREE.AnimationClip(c.name, c.duration, tracks);
      var act = bear.mixer.clipAction(clip);
      act.loop = c.loop ? THREE.LoopRepeat : THREE.LoopOnce;
      if (!c.loop) act.clampWhenFinished = true;
      bear.actions[c.name] = act;
    }
    bear.mixer.addEventListener('finished', function (e) {
      var name = null;
      for (var k in bear.actions) if (bear.actions[k] === e.action) name = k;
      if (name === 'eat') endAction();
      else if (name === 'fish_cast') { bear.actType = 'waitfish'; playAction('idle'); }
      else if (name === 'fish_catch') { detachFish(); startAction('cheer'); }
      else if (name === 'cheer') endAction();
    });
  }
  function playAction(name, fade) {
    if (bear.current === name) return;
    var f = fade === undefined ? 0.22 : fade;
    if (bear.current && bear.actions[bear.current]) bear.actions[bear.current].fadeOut(f);
    var a = bear.actions[name];
    if (!a) return;
    a.reset().fadeIn(f).play();
    bear.current = name;
  }
  function startAction(type, arg) {
    bear.state = 'act';
    bear.actType = type;
    bear.actBush = arg || null;
    if (type === 'eat') { bear._m1 = false; bear._m2 = false; bear._m3 = false; playAction('eat'); }
    else if (type === 'cast') { playAction('fish_cast'); }
    else if (type === 'catch') { playAction('fish_catch'); }
    else if (type === 'cheer') { playAction('cheer'); }
  }
  function endAction() {
    bear.state = 'free';
    bear.actType = '';
    bear.actBush = null;
    playAction('idle');
    cancelFishing(true);
  }
  function attachFish() {
    if (!bear.handBone || bear.fishInPaw) return;
    bear.fishInPaw = new THREE.Mesh(fishGeo, fishMat);
    bear.fishInPaw.scale.set(0.85, 0.85, 0.85);
    bear.fishInPaw.position.set(0.02, 0.1, 0.16);
    bear.fishInPaw.rotation.set(-1.1, 0.3, 0.4);
    bear.handBone.add(bear.fishInPaw);
  }
  function detachFish() {
    if (bear.fishInPaw) {
      var wp = new THREE.Vector3();
      bear.fishInPaw.getWorldPosition(wp);
      bear.handBone.remove(bear.fishInPaw);
      bear.fishInPaw = null;
      burst(wp.x, wp.y, wp.z, 0x9fd8ff, 0.8);
    }
  }

  // ---------------------------------------------------------------- fishing logic
  var fishing = { waiting: false, waitT: 0, biteActive: false, biteT: 0 };
  function cancelFishing(silent) {
    fishing.waiting = false; fishing.biteActive = false;
    bobber.visible = false;
    if (!silent) showToast('Мишка ушёл с рыбалки', 1800);
    if (bear.actType === 'waitfish') { bear.state = 'free'; bear.actType = ''; playAction('idle'); }
  }
  function pondDist(x, z) {
    var dx = x - POND.x, dz = z - POND.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
  function nearShore() {
    var d = pondDist(bear.pos.x, bear.pos.z);
    return d > POND_KEEP && d < POND_KEEP + 1.6;
  }
  function startCast() {
    startAction('cast');
    var dx = POND.x - bear.pos.x, dz = POND.z - bear.pos.z;
    var d = Math.sqrt(dx * dx + dz * dz) || 1;
    bobberPos.set(POND.x - (dx / d) * 2.6, 0.05, POND.z - (dz / d) * 2.6);
    // повернуть мишку к воде
    bear.yaw = Math.atan2(dx, dz);
    bear.group.rotation.y = bear.yaw;
    fishing.waiting = false;
    fishing.castShown = false;
  }
  function doCatch() {
    fishing.biteActive = false;
    fishing.waiting = false;
    bobber.visible = false;
    splashRing(bobberPos.x, bobberPos.z, 1.4);
    Sfx.splash();
    startAction('catch');
    setTimeout(function () { attachFish(); }, 420);
    setTimeout(function () {
      addFish(1);
      showToast('Улов! Рыбка поймана', 2400);
    }, 700);
    if (save.tut === 2) { save.tut = 3; persist(); showHint(null); }
  }

  // ---------------------------------------------------------------- berries logic
  function nearestReadyBush(maxD) {
    var best = null, bd = maxD * maxD;
    for (var i = 0; i < WORLD.bushes.length; i++) {
      var b = WORLD.bushes[i];
      if (!b.ready) continue;
      var dx = bear.pos.x - b.x, dz = bear.pos.z - b.z;
      var d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = b; }
    }
    return best;
  }

  // ---------------------------------------------------------------- controls
  var joy = { active: false, id: -1, x: 0, y: 0, cx: 0, cy: 0 };
  var keys = {};
  var joyRadius = 46;

  function joyShow(x, y) {
    dom.joyBase.style.display = 'block';
    dom.joyStick.style.display = 'block';
    dom.joyBase.style.left = (x - 54) + 'px';
    dom.joyBase.style.top = (y - 54) + 'px';
    dom.joyStick.style.left = (x - 26) + 'px';
    dom.joyStick.style.top = (y - 26) + 'px';
  }
  function joyMove(x, y) {
    var dx = x - joy.cx, dy = y - joy.cy;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > joyRadius) { dx = dx / d * joyRadius; dy = dy / d * joyRadius; }
    joy.x = dx / joyRadius; joy.y = dy / joyRadius;
    dom.joyStick.style.left = (joy.cx + dx - 26) + 'px';
    dom.joyStick.style.top = (joy.cy + dy - 26) + 'px';
  }
  function joyReset() {
    joy.active = false; joy.id = -1; joy.x = 0; joy.y = 0;
    dom.joyBase.style.display = 'none';
    dom.joyStick.style.display = 'none';
  }
  dom.joyZone.addEventListener('touchstart', function (e) {
    e.preventDefault();
    if (joy.active) return;
    var t = e.changedTouches[0];
    joy.active = true; joy.id = t.identifier;
    joy.cx = t.clientX; joy.cy = t.clientY;
    joyShow(joy.cx, joy.cy);
    dom.joyHint.classList.add('hidden');
  }, { passive: false });
  dom.joyZone.addEventListener('touchmove', function (e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (t.identifier === joy.id) joyMove(t.clientX, t.clientY);
    }
  }, { passive: false });
  function onTouchEnd(e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joy.id) joyReset();
    }
  }
  dom.joyZone.addEventListener('touchend', onTouchEnd, { passive: false });
  dom.joyZone.addEventListener('touchcancel', onTouchEnd, { passive: false });

  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    dom.joyHint.classList.add('hidden');
    if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') { e.preventDefault(); doAction(); }
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });

  var actFired = false;
  function onActPress(e) {
    e.preventDefault();
    if (actFired) return;
    actFired = true;
    setTimeout(function () { actFired = false; }, 350);
    doAction();
  }
  dom.btnAct.addEventListener('touchstart', onActPress, { passive: false });
  dom.btnAct.addEventListener('mousedown', onActPress);

  dom.btnSound.addEventListener('click', function () {
    Sfx.enabled = !Sfx.enabled;
    dom.btnSound.classList.toggle('off', !Sfx.enabled);
    if (Sfx.enabled) Sfx.pop();
  });

  // ---------------------------------------------------------------- action button logic
  function doAction() {
    if (!GAME.started) return;
    if (bear.actType === 'waitfish') {
      if (fishing.biteActive) doCatch();
      return;
    }
    if (bear.state !== 'free') return;
    var b = nearestReadyBush(1.55);
    if (b) {
      // повернуться к кусту
      bear.yaw = Math.atan2(b.x - bear.pos.x, b.z - bear.pos.z);
      startAction('eat', b);
      return;
    }
    if (nearShore()) { startCast(); return; }
  }

  function updateActionButton() {
    var show = false, label = '', bite = false;
    if (bear.actType === 'waitfish') {
      show = true;
      if (fishing.biteActive) { label = 'ТЯНИ!'; bite = true; }
      else label = 'Ловим…';
    } else if (bear.state === 'free') {
      if (nearestReadyBush(1.55)) { show = true; label = 'Собрать'; }
      else if (nearShore()) { show = true; label = 'Ловить'; }
    }
    if (show) {
      dom.btnAct.classList.add('show');
      dom.btnAct.classList.toggle('bite', bite);
      if (dom.btnActText.textContent !== label) dom.btnActText.textContent = label;
    } else {
      dom.btnAct.classList.remove('show', 'bite');
    }
  }

  // ---------------------------------------------------------------- camera
  var camYaw = bear.yaw, camPos = new THREE.Vector3(0, 4, 6), camTarget = new THREE.Vector3();
  var _tmpV = new THREE.Vector3();
  function updateCamera(dt) {
    camYaw = lerpAngle(camYaw, bear.yaw, damp(0, 2.0, dt));
    var aspect = camera.aspect;
    var dist = aspect < 0.8 ? 6.6 : (aspect < 1.1 ? 5.8 : 5.2);
    var h = aspect < 0.8 ? 4.1 : 3.5;
    var fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    camPos.set(bear.pos.x - fx * dist, h, bear.pos.z - fz * dist);
    var r = Math.sqrt(camPos.x * camPos.x + camPos.z * camPos.z);
    if (r > 29) { camPos.x *= 29 / r; camPos.z *= 29 / r; }
    camera.position.lerp(camPos, damp(0, 5, dt));
    _tmpV.set(bear.pos.x + fx * 0.8, 0.85, bear.pos.z + fz * 0.8);
    camTarget.lerp(_tmpV, damp(0, 6, dt));
    camera.lookAt(camTarget);
  }

  // ---------------------------------------------------------------- main loop
  var clock = new THREE.Clock();
  var fpsAcc = 0, fpsFrames = 0, fpsCool = 0;
  var chirpT = 5;
  var satietyHintT = 0;
  var edgeWarned = false;

  function tick() {
    requestAnimationFrame(tick);
    var dt = clamp(clock.getDelta(), 0.0001, 0.05);
    var t = clock.elapsedTime;

    // --- input
    var ix = joy.x, iy = joy.y;
    if (keys['KeyW'] || keys['ArrowUp']) iy -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) iy += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
    var mag = Math.sqrt(ix * ix + iy * iy);
    if (mag > 1) { ix /= mag; iy /= mag; mag = 1; }

    // --- bear movement
    if (bear.state === 'free' && mag > 0.14 && GAME.started) {
      var fx = Math.sin(camYaw), fz = Math.cos(camYaw);
      var rx = -fz, rz = fx;
      var mx = fx * (-iy) + rx * ix;
      var mz = fz * (-iy) + rz * ix;
      var ml = Math.sqrt(mx * mx + mz * mz) || 1;
      mx /= ml; mz /= ml;
      var spd = BEAR_SPEED * (save.s > 0 ? 1 : 0.65) * clamp(mag * 1.4, 0.45, 1);
      var targetYaw = Math.atan2(mx, mz);
      bear.yaw = lerpAngle(bear.yaw, targetYaw, damp(0, 10, dt));
      bear.pos.x += Math.sin(bear.yaw) * spd * dt;
      bear.pos.z += Math.cos(bear.yaw) * spd * dt;
      bear.speed = spd;
      if (!bear.debugPose) playAction('walk');
      if (save.tut === 0) { save.tut = 1; persist(); showHint('Подойди к кусту с ягодами и нажми «Собрать»'); }
      if (fishing.waiting) cancelFishing(false);
    } else if (bear.state === 'free') {
      bear.speed = 0;
      if (!bear.debugPose) playAction('idle');
    }

    // границы острова
    var rr = Math.sqrt(bear.pos.x * bear.pos.x + bear.pos.z * bear.pos.z);
    if (rr > WORLD_R) {
      bear.pos.x *= WORLD_R / rr; bear.pos.z *= WORLD_R / rr;
      if (!edgeWarned) { edgeWarned = true; showToast('Мишка не умеет плавать — гуляй по острову', 2200); }
    }
    // пруд
    var pd = pondDist(bear.pos.x, bear.pos.z);
    if (pd < POND_KEEP) {
      bear.pos.x = POND.x + (bear.pos.x - POND.x) / pd * POND_KEEP;
      bear.pos.z = POND.z + (bear.pos.z - POND.z) / pd * POND_KEEP;
    }

    bear.group.position.copy(bear.pos);
    bear.group.rotation.y = bear.yaw;
    shadowGroup.position.set(bear.pos.x, 0, bear.pos.z);
    shadowGroup.rotation.y = bear.yaw;

    // --- mixer
    if (bear.mixer) {
      var ts = bear.current === 'walk' ? clamp(0.7 + bear.speed / BEAR_SPEED * 0.5, 0.75, 1.25) : 1;
      bear.mixer.timeScale = ts;
      bear.mixer.update(dt);
    }

    // eat: съедание в момент чавканья
    if (bear.actType === 'eat' && bear.actBush && !bear.actBush.harvested && bear.actions['eat'] && bear.actions['eat'].time >= 0.72) {
      var b = bear.actBush;
      b.harvested = true;
      b.ready = false;
      b.regrowT = 26;
      var mesh = b.berries;
      mesh.visible = false;
      burst(b.x, 0.7, b.z, [0xe8452a, 0xff9c41, 0x6a8cf0][b.type], 1);
      Sfx.berry();
      addBerries(3);
      if (save.tut === 1) { save.tut = 2; persist(); showHint('Иди к пруду (там, где вода) и нажми «Ловить» на берегу'); }
    }
    // munch sounds
    if (bear.actType === 'eat') {
      var et = bear.actions['eat'] ? bear.actions['eat'].time : 0;
      if (et >= 0.75 && !bear._m1) { bear._m1 = true; Sfx.munch(); }
      if (et >= 1.1 && !bear._m2) { bear._m2 = true; Sfx.munch(); }
      if (et >= 1.45 && !bear._m3) { bear._m3 = true; Sfx.munch(); }
    }

    // fishing timers
    if (bear.actType === 'waitfish') {
      bobber.visible = true;
      bobber.position.set(bobberPos.x, 0.05 + Math.sin(t * 3.1) * 0.02, bobberPos.z);
      bobber.rotation.z = Math.sin(t * 2.2) * 0.12;
      if (!fishing.waiting) {
        fishing.waiting = true;
        fishing.waitT = 2 + Math.random() * 3.5;
      } else if (!fishing.biteActive) {
        fishing.waitT -= dt;
        if (fishing.waitT <= 0) {
          fishing.biteActive = true;
          fishing.biteT = 1.4;
          Sfx.bite();
          splashRing(bobberPos.x, bobberPos.z, 1);
          burst(bobberPos.x, 0.15, bobberPos.z, 0x9fd8ff, 0.5);
        }
      } else {
        fishing.biteT -= dt;
        bobber.position.y = 0.02 + Math.abs(Math.sin(t * 14)) * 0.06;
        if (fishing.biteT <= 0) {
          fishing.biteActive = false;
          fishing.waiting = false;
          bobber.visible = false;
          Sfx.fail();
          showToast('Рыба сорвалась… попробуй ещё!', 2200);
          bear.state = 'free'; bear.actType = '';
          playAction('idle');
        }
      }
    }

    // satiety decay
    save.s = clamp(save.s - 0.1 * dt * 1.2, 0, 100);
    dom.satietyFill.style.width = save.s + '%';
    if (save.s < 25) {
      satietyHintT -= dt;
      if (satietyHintT <= 0) { satietyHintT = 22; showToast('Мишка проголодался! Собери ягоды или поймай рыбу', 2800); }
    }

    // regrow berries
    for (var ri = 0; ri < WORLD.bushes.length; ri++) {
      var rb = WORLD.bushes[ri];
      if (!rb.ready && rb.harvested) {
        rb.regrowT -= dt;
        if (rb.regrowT <= 0) {
          rb.ready = true; rb.harvested = false;
          rb.berries.visible = true;
          rb.berries.scale.set(0.01, 0.01, 0.01);
          burst(rb.x, 0.6, rb.z, 0xffffff, 0.4);
        }
      }
      if (rb.ready && rb.berries.scale.x < 1) {
        var s2 = Math.min(1, rb.berries.scale.x + dt * 3.2);
        var k = 1 + Math.sin(s2 * Math.PI) * 0.25;
        rb.berries.scale.set(s2 * k, s2 * k, s2 * k);
      }
    }

    // --- world anims
    for (var fi = 0; fi < WORLD.fish.length; fi++) {
      var F = WORLD.fish[fi];
      F.ph += F.speed * dt;
      var fx2 = POND.x + Math.cos(F.ph) * F.r, fz2 = POND.z + Math.sin(F.ph) * F.r;
      var dx2 = fx2 - F.m.position.x, dz2 = fz2 - F.m.position.z;
      F.m.position.set(fx2, F.y + Math.sin(t * 2 + fi) * 0.03, fz2);
      if (Math.abs(dx2) + Math.abs(dz2) > 0.0001) F.m.rotation.y = Math.atan2(dx2, dz2);
      F.m.rotation.z = Math.sin(t * 6 + fi) * 0.15;
    }
    for (var bi = 0; bi < WORLD.butterflies.length; bi++) {
      var B = WORLD.butterflies[bi];
      B.a += B.sp * dt;
      var bx = Math.cos(B.a) * B.r, bz = Math.sin(B.a) * B.r;
      var by = 0.9 + Math.sin(t * 2.1 + B.ph) * 0.3;
      var bdx = bx - B.g.position.x, bdz = bz - B.g.position.z;
      B.g.position.set(bx, by, bz);
      if (Math.abs(bdx) + Math.abs(bdz) > 0.0001) B.g.rotation.y = Math.atan2(bdx, bdz);
      var flap = Math.sin(t * 16 + B.ph) * 0.75;
      B.wl.rotation.y = flap;
      B.wr.rotation.y = -flap;
    }
    for (var ci = 0; ci < clouds.length; ci++) {
      clouds[ci].position.x += dt * 0.22;
      if (clouds[ci].position.x > 42) clouds[ci].position.x = -42;
    }
    WORLD.foam1.material.opacity = 0.45 + Math.sin(t * 1.3) * 0.12;
    WORLD.foam1.scale.setScalar(1 + Math.sin(t * 1.3) * 0.006);
    WORLD.foam2.material.opacity = 0.13 + Math.sin(t * 0.9 + 1) * 0.06;
    WORLD.sparkles.material.opacity = 0.5 + Math.sin(t * 2.2) * 0.25;
    for (var li = 0; li < lilies.length; li++) {
      lilies[li].m.position.y = 0.045 + Math.sin(t * 1.8 + lilies[li].ph) * 0.012;
      lilies[li].m.rotation.y += dt * 0.1;
    }
    sunSprite.position.set(bear.pos.x - 22, 24, bear.pos.z - 36);

    // particles
    for (var ei = 0; ei < WORLD.emitters.length; ei++) {
      var E = WORLD.emitters[ei];
      if (!E.active) continue;
      E.life -= dt;
      if (E.life <= 0) { E.active = false; E.pts.visible = false; continue; }
      var p = E.pts.geometry.attributes.position;
      for (var pi = 0; pi < E.count; pi++) {
        p.setXYZ(pi,
          p.getX(pi) + E.vel[pi * 3] * dt,
          p.getY(pi) + E.vel[pi * 3 + 1] * dt,
          p.getZ(pi) + E.vel[pi * 3 + 2] * dt);
        E.vel[pi * 3 + 1] -= 4.2 * dt;
      }
      p.needsUpdate = true;
      E.pts.material.opacity = clamp(E.life / E.max, 0, 1);
    }
    for (var gi = 0; gi < WORLD.rings.length; gi++) {
      var G = WORLD.rings[gi];
      if (G.life > 0) {
        G.life -= dt;
        var k2 = 1 - G.life / G.max;
        G.m.scale.setScalar(1 + k2 * 5 * (G.big || 1));
        G.m.material.opacity = 0.85 * (1 - k2);
        if (G.life <= 0) G.m.visible = false;
      }
    }

    // chirps
    chirpT -= dt;
    if (chirpT <= 0) { chirpT = 7 + Math.random() * 9; if (GAME.started) Sfx.chirp(); }

    // camera
    updateCamera(dt);

    // action button
    updateActionButton();

    // --- adaptive pixel ratio
    fpsAcc += dt; fpsFrames++;
    fpsCool -= dt;
    if (fpsAcc >= 2.5) {
      var fps = fpsFrames / fpsAcc;
      fpsAcc = 0; fpsFrames = 0;
      if (fps < 26 && pixelRatio > 0.72 && fpsCool <= 0) {
        pixelRatio = Math.max(0.7, pixelRatio - 0.2);
        renderer.setPixelRatio(pixelRatio);
        fpsCool = 5;
      }
    }

    renderer.render(scene, camera);
  }

  // ---------------------------------------------------------------- resize
  function onResize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', function () { setTimeout(onResize, 300); });
  if (window.visualViewport && window.visualViewport.addEventListener) {
    window.visualViewport.addEventListener('resize', onResize);
  }

  // context lost (старые iOS любят выгружать WebGL)
  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    fatal('Графика перезагружена устройством. Обнови страницу, чтобы продолжить.');
  }, false);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) persist();
  });

  // ---------------------------------------------------------------- boot
  var GAME = { started: false, ready: false };

  var manager = new THREE.LoadingManager();
  manager.onProgress = function (url, loaded, total) {
    dom.bar.style.width = Math.round(loaded / total * 78) + '%';
  };

  window.__bear = {
    game: GAME, bear: bear, world: WORLD, scene: scene, camera: camera, renderer: renderer,
    fishing: fishing,
    forceBite: function () { if (bear.actType === 'waitfish') fishing.waitT = 0.01; },
    debugCatch: function () { if (bear.actType === 'waitfish') { fishing.biteActive = true; doCatch(); } },
    teleport: function (x, z) { bear.pos.set(x, 0, z); cancelFishing(true); },
    pose: function (clip, time) {
      if (!bear.mixer) return;
      bear.debugPose = true;
      for (var k in bear.actions) bear.actions[k].stop();
      var a = bear.actions[clip];
      if (!a) return;
      a.reset().play();
      a.timeScale = 0;
      a.time = clamp(time || 0, 0, a.getClip().duration - 0.001);
      bear.current = clip;
      bear.poseClip = clip;
      bear.mixer.update(0.016);
    },
    resume: function () {
      bear.debugPose = false;
      bear.poseClip = null;
      for (var k in bear.actions) bear.actions[k].timeScale = 1;
      bear.current = '';
      playAction('idle', 0);
    },
    stats: function () {
      return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    }
  };

  dom.bar.style.width = '10%';
  var glbDone = false, animsDone = false, animsData = null;

  function tryFinalize() {
    if (!glbDone || !animsDone) return;
    GAME.ready = true;
    dom.bar.style.width = '100%';
    dom.loadTip.textContent = 'Готово!';
    dom.btnPlay.classList.add('show');
  }

  var MODEL_URL = null;
  try { MODEL_URL = new URLSearchParams(location.search).get('model'); } catch (e) {}
  if (!MODEL_URL) MODEL_URL = 'models/bear.glb';
  new THREE.GLTFLoader(manager).load(MODEL_URL, function (gltf) {
    var inner = gltf.scene;
    inner.scale.setScalar(BEAR_SCALE);
    bear.group.add(inner);
    bear.inner = inner;
    // лёгкие материалы для старых GPU
    inner.traverse(function (o) {
      if (o.isMesh && o.material) {
        var src = Array.isArray(o.material) ? o.material[0] : o.material;
        var m = new THREE.MeshLambertMaterial();
        if (src.map) { m.map = src.map; }
        m.side = THREE.FrontSide;
        if (src.transparent) { m.alphaTest = 0.45; m.transparent = false; }
        o.material = m;
        o.frustumCulled = false;
      }
      if (o.isBone && o.name === 'RightHand_061') bear.handBone = o;
    });
    glbDone = true;
    dom.bar.style.width = '82%';
    if (animsData) { setupAnimations(animsData); playAction('idle', 0); }
    tryFinalize();
  }, undefined, function (err) {
    dom.loadTip.textContent = 'Не удалось загрузить модель медведя';
    console.error(err);
  });

  var xhr = new XMLHttpRequest();
  xhr.open('GET', 'js/anims.json?v=3', true);
  xhr.onload = function () {
    try {
      animsData = JSON.parse(xhr.responseText);
      animsDone = true;
      if (bear.inner) { setupAnimations(animsData); playAction('idle', 0); }
      tryFinalize();
    } catch (e) { dom.loadTip.textContent = 'Ошибка анимаций'; }
  };
  xhr.onerror = function () { dom.loadTip.textContent = 'Ошибка загрузки анимаций'; };
  xhr.send();

  function startGame() {
    Sfx.unlock();
    GAME.started = true;
    dom.loader.classList.add('hide');
    if (save.tut === 0) showHint('Веди мишку джойстиком слева');
    else if (save.tut === 1) showHint('Подойди к кусту с ягодами и нажми «Собрать»');
    else if (save.tut === 2) showHint('Иди к пруду и нажми «Ловить» на берегу');
    dom.cntBerry.textContent = save.b;
    dom.cntFish.textContent = save.f;
    dom.satietyFill.style.width = save.s + '%';
    updateQuestHud();
    showToast('Привет! Это твой мишка. Гуляй и веселись!', 3000);
  }
  dom.btnPlay.addEventListener('touchstart', function (e) { e.preventDefault(); startGame(); }, { passive: false });
  dom.btnPlay.addEventListener('click', function (e) { e.preventDefault(); if (!GAME.started) startGame(); });

  tick();
})();
