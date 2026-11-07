// src/render/models.js
// Procedural models of the two fictional spacecraft and the approach axis.
//
// Servicer: octagonal bus in white beta cloth with black multi-layer insulation (MLI) on the
// chamfers, silver optical solar reflector (OSR) radiators on top and bottom, amber Kapton RCS
// pods on the corners, two roll-out solar blankets, a docking mechanism with a central probe
// and three capture legs with foot pads.
// Client: retired communications satellite with a charcoal MLI bus, silver OSR radiators on
// the north and south faces, an amber band, two unequal white reflectors, four-panel solar
// wings on graphite yokes, and on the aft face a bare aluminium launch adapter ring around a
// foil heat shield and the apogee engine nozzle.
//
// The capture geometry (ring, nozzle, probe, stanchions) comes from config CAPTURE and is
// unchanged by the styling. Servicer in body axes (+X docking axis, +Y left, +Z up); client
// in LVLH axes (+x towards the servicer, wings along z).

import * as THREE from 'three';
import { CAPTURE, CHASER, ARM } from '../config.js';
import { THRUSTER_LAYOUT } from './effects.js';

// ---------------------------------------------------------------------------
// Canvas textures

function makeCanvasTexture(size, draw, srgb = true) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Crinkled MLI: soft blotches and creases, used as a bump map.
function makeCrinkleBump(seed = 424242) {
  return makeCanvasTexture(512, (ctx, s) => {
    const rand = rng(seed);
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 220; i += 1) {
      const x = rand() * s;
      const y = rand() * s;
      const r = 8 + rand() * 26;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const v = 96 + Math.floor(rand() * 96);
      g.addColorStop(0, `rgb(${v},${v},${v})`);
      g.addColorStop(1, 'rgba(128,128,128,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < 70; i += 1) {
      ctx.strokeStyle = rand() < 0.5 ? 'rgba(40,40,40,0.55)' : 'rgba(210,210,210,0.45)';
      ctx.beginPath();
      let x = rand() * s;
      let y = rand() * s;
      ctx.moveTo(x, y);
      for (let k = 0; k < 3; k += 1) {
        x += (rand() - 0.5) * 60;
        y += (rand() - 0.5) * 60;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, false);
}

// White beta cloth with a quilted stitch pattern.
function makeBetaClothTexture() {
  return makeCanvasTexture(512, (ctx, s) => {
    const rand = rng(77);
    ctx.fillStyle = '#e4e0d6';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 400; i += 1) {
      const v = 214 + Math.floor(rand() * 26);
      ctx.fillStyle = `rgba(${v},${v - 3},${v - 10},0.35)`;
      ctx.fillRect(rand() * s, rand() * s, 3 + rand() * 10, 3 + rand() * 10);
    }
    ctx.strokeStyle = 'rgba(150,145,132,0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    const step = 64;
    for (let k = -s; k <= 2 * s; k += step) {
      ctx.beginPath();
      ctx.moveTo(k, 0);
      ctx.lineTo(k + s, s);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(k, s);
      ctx.lineTo(k + s, 0);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(120,116,104,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2);
  });
}

// Silver OSR tiles with dark gaps.
function makeOsrTexture() {
  return makeCanvasTexture(512, (ctx, s) => {
    const rand = rng(1234);
    ctx.fillStyle = '#3a3f46';
    ctx.fillRect(0, 0, s, s);
    const n = 16;
    const c = s / n;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const v = 176 + Math.floor(rand() * 26);
        ctx.fillStyle = `rgb(${v},${v + 5},${v + 12})`;
        ctx.fillRect(i * c + 1.5, j * c + 1.5, c - 3, c - 3);
      }
    }
  });
}

// Solar cells: dark violet cells with silver bus bars.
function makeCellTexture() {
  return makeCanvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#08070d';
    ctx.fillRect(0, 0, s, s);
    const n = 8;
    const c = s / n;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const x = i * c + 2;
        const y = j * c + 2;
        const g = ctx.createLinearGradient(x, y, x + c, y + c);
        g.addColorStop(0, '#3b3274');
        g.addColorStop(0.55, '#29234f');
        g.addColorStop(1, '#3a316f');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, c - 4, c - 4);
        ctx.fillStyle = 'rgba(160,166,178,0.85)';
        ctx.fillRect(x, y + (c - 4) / 3, c - 4, 1.5);
        ctx.fillRect(x, y + (2 * (c - 4)) / 3, c - 4, 1.5);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Materials

function materials() {
  const crinkle = makeCrinkleBump();
  const cellTex = makeCellTexture();
  const osrTex = makeOsrTexture();
  const betaTex = makeBetaClothTexture();
  return {
    beta: new THREE.MeshStandardMaterial({ map: betaTex, roughness: 0.88, metalness: 0.0 }),
    blackMli: new THREE.MeshStandardMaterial({ color: 0x3c4047, metalness: 0.35, roughness: 0.5, bumpMap: crinkle, bumpScale: 1.6 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xc06e1e, metalness: 0.55, roughness: 0.36, bumpMap: crinkle, bumpScale: 1.2 }),
    foil: new THREE.MeshStandardMaterial({ color: 0xc9cdd3, metalness: 0.92, roughness: 0.3, bumpMap: crinkle, bumpScale: 0.8 }),
    aluminium: new THREE.MeshStandardMaterial({ color: 0xd6dadf, metalness: 0.85, roughness: 0.28 }),
    graphite: new THREE.MeshStandardMaterial({ color: 0x2a2d32, metalness: 0.25, roughness: 0.55 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.6, roughness: 0.45 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x07080b, metalness: 0.9, roughness: 0.05 }),
    paint: new THREE.MeshStandardMaterial({ color: 0xf1f0ea, metalness: 0.05, roughness: 0.6, side: THREE.DoubleSide }),
    niobium: new THREE.MeshStandardMaterial({ color: 0x40454f, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide }),
    cellBack: new THREE.MeshStandardMaterial({ color: 0x4a4e55, metalness: 0.3, roughness: 0.8 }),
    led: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 1.5 }),
    cellTex,
    osrTex
  };
}

function cellMaterial(m, repeatU, repeatV) {
  const t = m.cellTex.clone();
  t.repeat.set(repeatU, repeatV);
  t.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map: t, metalness: 0.35, roughness: 0.3 });
}

function osrMaterial(m, repeatU, repeatV) {
  const t = m.osrTex.clone();
  t.repeat.set(repeatU, repeatV);
  t.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map: t, metalness: 0.95, roughness: 0.12 });
}

// ---------------------------------------------------------------------------
// Geometry helpers

function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

// Cylinder whose axis runs from point a to point b.
function rod(a, b, rTop, rBottom, mat, seg = 12) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, len, seg), mat);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.position.copy(va).add(vb).multiplyScalar(0.5);
  return mesh;
}

// Cylinder along the X axis, centred at x.
function cylX(r, len, x, y, z, mat, seg = 32) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  mesh.rotation.z = Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

// Shallow dish whose concave side faces `facing`, with its apex at `apex`.
function dish(rimRadius, apex, facing, mat) {
  const theta = 0.5;
  const rs = rimRadius / Math.sin(theta);
  const geo = new THREE.SphereGeometry(rs, 32, 6, 0, Math.PI * 2, 0, theta);
  geo.translate(0, -rs, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...facing).normalize().negate());
  mesh.position.set(...apex);
  return mesh;
}

// Octagon (half-size h, chamfer leg c) as a flat cap facing +X or -X.
function octagonCap(h, c, facingPlusX, mat) {
  const shape = new THREE.Shape();
  const pts = [
    [h, h - c], [h - c, h], [-(h - c), h], [-h, h - c],
    [-h, -(h - c)], [-(h - c), -h], [h - c, -h], [h, -(h - c)]
  ];
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i += 1) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  const basis = facingPlusX
    ? new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0))
    : new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0));
  geo.applyMatrix4(basis);
  return new THREE.Mesh(geo, mat);
}

function enableShadows(root) {
  root.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
}

// ---------------------------------------------------------------------------
// Servicer

export function buildChaser() {
  const root = new THREE.Group();
  root.name = 'chaser';
  const m = materials();

  const L = CHASER.busDimensionsM[0]; // 2.5 m along X
  const H = CHASER.busDimensionsM[1] / 2; // 1.0 m half-size
  const C = 0.38; // m, chamfer leg
  const FACE = CHASER.dockingFaceAheadOfCmM; // 1.25 m

  // Octagonal hull: four flats and four chamfers, 2.5 m long.
  const flatW = 2 * (H - C);
  const chamW = C * Math.SQRT2;
  const chamDist = (2 * H - C) / Math.SQRT2;
  const osrTopBottom = osrMaterial(m, 2.5, 1.2);
  for (let k = 0; k < 8; k += 1) {
    const theta = (k * Math.PI) / 4; // 0 = +Y, 90 deg = +Z
    const flat = k % 2 === 0;
    const width = flat ? flatW : chamW;
    const dist = flat ? H : chamDist;
    let mat = m.blackMli;
    if (flat) mat = k === 2 || k === 6 ? osrTopBottom : m.beta;
    const face = box(L, width, 0.02, mat);
    face.rotation.x = theta - Math.PI / 2;
    face.position.set(0, Math.cos(theta) * (dist - 0.01), Math.sin(theta) * (dist - 0.01));
    root.add(face);
  }
  const front = octagonCap(H, C, true, m.blackMli);
  front.position.x = L / 2;
  root.add(front);
  const rear = octagonCap(H, C, false, m.beta);
  rear.position.x = -L / 2;
  root.add(rear);

  // Docking plate and the three capture legs (stanchions) with foot pads. The pads touch the
  // ring when d = stanchion length.
  root.add(cylX(0.74, 0.03, FACE + 0.015, 0, 0, m.aluminium, 48));
  const legLen = CAPTURE.stanchionLengthM;
  for (let i = 0; i < CAPTURE.stanchionCount; i += 1) {
    const ang = (i * CAPTURE.stanchionSpacingDeg * Math.PI) / 180;
    const rootR = 0.68;
    const tipR = CAPTURE.stanchionTipRadiusM;
    const a = [FACE + 0.03, Math.sin(ang) * rootR, Math.cos(ang) * rootR];
    const b = [FACE + legLen - 0.025, Math.sin(ang) * tipR, Math.cos(ang) * tipR];
    root.add(rod(a, b, 0.022, 0.03, m.aluminium));
    root.add(rod(a, [a[0] + 0.09, a[1] * 0.99, a[2] * 0.99], 0.05, 0.055, m.amber));
    root.add(cylX(0.065, 0.025, FACE + legLen - 0.0125, b[1], b[2], m.graphite, 24));
  }

  // Probe: a static amber housing on the plate and a telescoping rod. The rod's back end
  // stays inside the hull up to the full 1.30 m stroke. The stowed tip is 0.15 m ahead of the
  // docking face, as in the capture model.
  root.add(cylX(0.06, 0.10, FACE + 0.05, 0, 0, m.amber, 24));
  const probeGroup = new THREE.Group();
  probeGroup.name = 'probeGroup';
  const tipX = FACE + 0.15;
  probeGroup.add(cylX(0.012, 1.46, tipX - 0.04 - 0.73, 0, 0, m.aluminium, 12));
  probeGroup.add(cylX(CAPTURE.probeTipFoldedDiameterM / 2, 0.04, tipX - 0.02, 0, 0, m.dark, 12));
  root.add(probeGroup);

  // Docking camera pod above the probe (the docking camera sits at body (1.32, 0, 0.15)) and
  // the LED illuminator below it.
  // Both stay behind the camera position so they never cover the image.
  const camPod = box(0.05, 0.09, 0.07, m.graphite);
  camPod.position.set(FACE + 0.025, 0, 0.15);
  root.add(camPod);
  root.add(cylX(0.022, 0.01, FACE + 0.055, 0, 0.15, m.lens, 16));
  const ledPanel = box(0.02, 0.14, 0.06, m.led);
  ledPanel.position.set(FACE + 0.04, 0, -0.3);
  root.add(ledPanel);
  const illuminator = new THREE.SpotLight(0xfff2e0, 8, 60, 0.45, 0.5, 2);
  illuminator.position.set(FACE + 0.07, 0, -0.3);
  const illuminatorTarget = new THREE.Object3D();
  illuminatorTarget.position.set(10, 0, -0.3);
  root.add(illuminatorTarget);
  illuminator.target = illuminatorTarget;
  root.add(illuminator);

  // RCS: amber pods on the chamfers at both ends, and a nozzle at every thruster of the
  // plume layout (src/render/effects.js), pointing along its exhaust.
  for (let k = 1; k < 8; k += 2) {
    const theta = (k * Math.PI) / 4;
    for (const xs of [1, -1]) {
      const pod = box(0.5, 0.22, 0.12, m.amber);
      pod.rotation.x = theta - Math.PI / 2;
      pod.position.set(xs * (L / 2 - 0.25), Math.cos(theta) * (chamDist + 0.06), Math.sin(theta) * (chamDist + 0.06));
      root.add(pod);
    }
  }
  const nozzleGeo = new THREE.CylinderGeometry(0.012, 0.03, 0.07, 12, 1, true);
  for (const t of THRUSTER_LAYOUT) {
    const e = new THREE.Vector3(...t.exhaust).normalize();
    const nz = new THREE.Mesh(nozzleGeo, m.niobium);
    nz.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), e);
    nz.position.set(...t.pos).addScaledVector(e, -0.035);
    root.add(nz);
  }

  // Roll-out solar blankets on the +/-Y flats: drive, yoke, blanket between two edge booms,
  // root bar and tip mandrel. The blanket faces -X before sun tracking rotates it about Y.
  const blanketLen = CHASER.wingTipM - 1.14 - 0.75;
  const blanketW = 1.4;
  const cellsFront = cellMaterial(m, 1, blanketLen / (blanketW * 1.1));
  function buildWing(s) {
    const drive = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.14, 24), m.aluminium);
    drive.position.set(0, s * 1.07, 0);
    root.add(drive);
    const pivot = new THREE.Group();
    pivot.position.set(0, s * 1.14, 0);
    const y0 = s * 0.75;
    const y1 = s * (0.75 + blanketLen);
    pivot.add(rod([0, 0, 0], [0, y0, 0.62], 0.025, 0.025, m.graphite));
    pivot.add(rod([0, 0, 0], [0, y0, -0.62], 0.025, 0.025, m.graphite));
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.008, blanketLen, blanketW), [
      m.cellBack, cellsFront, m.cellBack, m.cellBack, m.cellBack, m.cellBack
    ]);
    blanket.position.set(0, (y0 + y1) / 2, 0);
    pivot.add(blanket);
    for (const zs of [1, -1]) pivot.add(rod([0, y0, zs * 0.72], [0, y1, zs * 0.72], 0.018, 0.018, m.aluminium));
    pivot.add(rod([0, y0, -0.76], [0, y0, 0.76], 0.03, 0.03, m.aluminium));
    pivot.add(rod([0, y1, -0.78], [0, y1, 0.78], 0.05, 0.05, m.graphite));
    root.add(pivot);
    return pivot;
  }
  const wingPivotL = buildWing(1);
  const wingPivotR = buildWing(-1);

  // Sensor head on a short mast at the front top: a lidar window facing forward.
  root.add(rod([FACE - 0.2, -0.45, H], [FACE - 0.2, -0.45, H + 0.22], 0.03, 0.03, m.aluminium));
  root.add(cylX(0.075, 0.12, FACE - 0.17, -0.45, H + 0.28, m.graphite, 24));
  root.add(cylX(0.05, 0.01, FACE - 0.105, -0.45, H + 0.28, m.lens, 24));

  // The refuelling arm stands on the docking plate (src/render/arm.js).

  // Rear: two electric thruster heads and a small high-gain dish on a boom.
  for (const ys of [1, -1]) {
    root.add(cylX(0.13, 0.16, -L / 2 - 0.08, ys * 0.45, -0.35, m.graphite, 32));
    const ringFace = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.025, 10, 32), m.niobium);
    ringFace.rotation.y = Math.PI / 2;
    ringFace.position.set(-L / 2 - 0.17, ys * 0.45, -0.35);
    root.add(ringFace);
  }
  root.add(rod([-0.9, 0.35, H], [-0.9, 0.35, H + 0.45], 0.025, 0.025, m.aluminium));
  root.add(dish(0.32, [-0.9, 0.35, H + 0.48], [-1, 0, 1], m.paint));

  enableShadows(root);

  function trackSun(sunLocal) {
    const ang = Math.atan2(sunLocal.z, -sunLocal.x);
    wingPivotL.rotation.y = ang;
    wingPivotR.rotation.y = ang;
  }

  return { root, probeGroup, trackSun };
}

// ---------------------------------------------------------------------------
// Client

export function buildTarget() {
  const root = new THREE.Group();
  root.name = 'target';
  const m = materials();

  const BX = 3.5;
  const BY = 2.8;
  const BZ = 2.8;
  const AFT = BX / 2; // 1.75 m, aft face (zenith deck) above the client CM
  const RING = CAPTURE.ringPlaneAboveClientCmM; // 1.80 m

  // Bus: charcoal MLI, OSR radiators on the north and south (+/-z) faces.
  const osrNS = osrMaterial(m, 3, 3);
  root.add(new THREE.Mesh(new THREE.BoxGeometry(BX, BY, BZ), [
    m.blackMli, m.blackMli, m.blackMli, m.blackMli, osrNS, osrNS
  ]));

  // Amber band around the bus.
  const bandX = -0.55;
  for (const s of [1, -1]) {
    const by = box(0.14, 0.02, BZ + 0.04, m.amber);
    by.position.set(bandX, s * (BY / 2 + 0.01), 0);
    root.add(by);
    const bz = box(0.14, BY + 0.04, 0.02, m.amber);
    bz.position.set(bandX, 0, s * (BZ / 2 + 0.01));
    root.add(bz);
  }

  // Aft face: foil heat shield inside the ring, bare aluminium ring, apogee engine.
  root.add(cylX(CAPTURE.ringRadiusM - 0.035, 0.01, AFT + 0.005, 0, 0, m.foil, 64));
  const ringWall = new THREE.Mesh(
    new THREE.CylinderGeometry(CAPTURE.ringRadiusM, CAPTURE.ringRadiusM, RING - AFT, 64, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xd6dadf, metalness: 0.85, roughness: 0.28, side: THREE.DoubleSide })
  );
  ringWall.rotation.z = -Math.PI / 2;
  ringWall.position.set((AFT + RING) / 2, 0, 0);
  root.add(ringWall);
  const ringLip = new THREE.Mesh(new THREE.TorusGeometry(CAPTURE.ringRadiusM, 0.014, 12, 64), m.aluminium);
  ringLip.rotation.y = Math.PI / 2;
  ringLip.position.set(RING, 0, 0);
  root.add(ringLip);

  const rt = CAPTURE.laeThroatDiameterM / 2;
  const re = CAPTURE.laeExitDiameterM / 2;
  const Lb = CAPTURE.laeBellLengthM;
  const pts = [];
  for (let k = 0; k <= 24; k += 1) {
    const t = k / 24;
    pts.push(new THREE.Vector2(rt + (re - rt) * Math.pow(t, 0.55), Lb * t));
  }
  const bell = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), m.niobium);
  bell.rotation.z = -Math.PI / 2;
  bell.position.set(RING + CAPTURE.nozzleExitProtrusionM - Lb, 0, 0);
  root.add(bell);
  root.add(cylX(0.03, 0.12, 1.68, 0, 0, m.niobium, 24));
  const exitLip = new THREE.Mesh(new THREE.TorusGeometry(re, 0.006, 8, 48), m.aluminium);
  exitLip.rotation.y = Math.PI / 2;
  exitLip.position.set(RING + CAPTURE.nozzleExitProtrusionM, 0, 0);
  root.add(exitLip);

  // Service valve on the aft face, 0.85 m from the engine axis at 60 deg azimuth (from +y
  // towards +z): amber boot, aluminium body, dark cap.
  const valveAng = ARM.valveAzimuthDeg * Math.PI / 180;
  const vy = ARM.valveOffsetFromLaeAxisM * Math.cos(valveAng);
  const vz = ARM.valveOffsetFromLaeAxisM * Math.sin(valveAng);
  root.add(cylX(0.08, 0.03, AFT + 0.015, vy, vz, m.amber, 24));
  root.add(cylX(0.055, 0.10, AFT + 0.05, vy, vz, m.aluminium, 24));
  // Fill port in the valve face: the target of the tool once the cap is off.
  root.add(cylX(0.018, 0.004, AFT + ARM.valveBracketHeightM + 0.001, vy, vz, m.dark, 20));
  const portRing = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 8, 32), m.amber);
  portRing.rotation.y = Math.PI / 2;
  portRing.position.set(AFT + ARM.valveBracketHeightM + 0.001, vy, vz);
  root.add(portRing);
  // The cap is red-anodised, like ground-handling covers, so it reads in the tool camera.
  const capMat = new THREE.MeshStandardMaterial({ color: 0xa3362a, metalness: 0.35, roughness: 0.45 });
  const valveCap = cylX(ARM.capRadiusM, ARM.capHeightM, AFT + ARM.valveBracketHeightM + ARM.capHeightM / 2, vy, vz, capMat, 24);
  valveCap.name = 'valveCap';
  root.add(valveCap);
  // A grip bar across the top of the cap (the cylinder axis is local Y, the top is local -Y), so
  // its rotation shows while the tool unscrews it.
  const grip = box(0.10, 0.008, 0.018, m.aluminium);
  grip.position.set(0, -ARM.capHeightM / 2 - 0.004, 0);
  valveCap.add(grip);
  const capRing = new THREE.Mesh(new THREE.TorusGeometry(ARM.capRadiusM - 0.008, 0.004, 8, 40), m.amber);
  capRing.rotation.x = Math.PI / 2;
  capRing.position.set(0, -ARM.capHeightM / 2 - 0.001, 0);
  valveCap.add(capRing);

  // Corner RCS blocks on the aft face and two omni antennas.
  for (const sy of [1, -1]) {
    for (const sz of [1, -1]) {
      const blk = box(0.18, 0.2, 0.2, m.amber);
      blk.position.set(AFT - 0.1, sy * (BY / 2 - 0.12), sz * (BZ / 2 - 0.12));
      root.add(blk);
      root.add(rod([AFT - 0.1, sy * (BY / 2 - 0.02), sz * (BZ / 2 - 0.12)], [AFT - 0.1, sy * (BY / 2 + 0.07), sz * (BZ / 2 - 0.12)], 0.012, 0.028, m.niobium));
    }
  }
  for (const sy of [1, -1]) {
    root.add(rod([AFT, sy * 1.05, -1.05], [AFT + 0.55, sy * 1.05, -1.05], 0.01, 0.01, m.aluminium, 8));
    const bicone = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 12), m.paint);
    bicone.rotation.z = -Math.PI / 2;
    bicone.position.set(AFT + 0.59, sy * 1.05, -1.05);
    root.add(bicone);
  }

  // Earth deck (-x): feed horns and a small steerable dish on a tower.
  for (const [y, z] of [[0.55, 0.45], [-0.55, 0.45], [0.0, 0.95]]) {
    root.add(rod([-AFT, y, z], [-AFT - 0.32, y * 1.15, z], 0.04, 0.13, m.foil, 20));
  }
  root.add(rod([-AFT, 0.2, -0.7], [-AFT - 0.55, 0.2, -0.7], 0.06, 0.06, m.aluminium));
  root.add(dish(0.42, [-AFT - 0.58, 0.2, -0.7], [-1, 0, 0], m.paint));

  // Two unequal white reflectors on hinge arms, facing the Earth deck feeds.
  root.add(rod([-0.4, BY / 2, 0.3], [-1.0, BY / 2 + 0.75, 0.3], 0.04, 0.04, m.graphite));
  root.add(dish(1.25, [-1.15, BY / 2 + 1.0, 0.3], [-0.6, -0.8, 0], m.paint));
  root.add(rod([0.1, -BY / 2, -0.4], [-0.4, -BY / 2 - 0.55, -0.4], 0.04, 0.04, m.graphite));
  root.add(dish(0.82, [-0.55, -BY / 2 - 0.75, -0.4], [-0.7, 0.71, 0], m.paint));

  // Solar wings on +/-z: graphite V yoke, four panels with hinge gaps. The cells face +y
  // before sun tracking rotates the wing about z.
  const panelX = 2.5;
  const panelZ = 3.05;
  const gap = 0.05;
  const yokeLen = 1.6;
  const panelCells = cellMaterial(m, 2, 2.4);
  function buildWing(s) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0, s * (BZ / 2));
    pivot.add(rod([0, 0, 0], [0.9, 0, s * yokeLen], 0.035, 0.035, m.graphite));
    pivot.add(rod([0, 0, 0], [-0.9, 0, s * yokeLen], 0.035, 0.035, m.graphite));
    pivot.add(rod([-1.2, 0, s * yokeLen], [1.2, 0, s * yokeLen], 0.03, 0.03, m.graphite));
    for (let i = 0; i < 4; i += 1) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(panelX, 0.03, panelZ), [
        m.cellBack, m.cellBack, panelCells, m.cellBack, m.cellBack, m.cellBack
      ]);
      panel.position.set(0, 0, s * (yokeLen + gap + i * (panelZ + gap) + panelZ / 2));
      pivot.add(panel);
    }
    root.add(pivot);
    return pivot;
  }
  const wingPivotP = buildWing(1);
  const wingPivotN = buildWing(-1);

  enableShadows(root);

  function trackSun(sunLocal) {
    const angP = Math.atan2(-sunLocal.x, sunLocal.y);
    wingPivotP.rotation.z = angP;
    wingPivotN.rotation.z = angP;
  }

  return { root, trackSun, valveCap };
}

// ---------------------------------------------------------------------------
// Approach axis: a dashed teal line along the client's engine axis with ring markers at the
// given distances d from the ring plane. Guidance graphics, not hardware.

export function buildApproachAxis({ fromX, toX, callouts }) {
  const root = new THREE.Group();
  root.name = 'approachAxis';

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, fromX, 0, 0, toX, 0], 3));
  const lineMat = new THREE.LineDashedMaterial({
    color: 0x4fd8d0,
    dashSize: 0.4,
    gapSize: 0.25,
    transparent: true,
    opacity: 0.75,
    depthWrite: false
  });
  const line = new THREE.Line(lineGeo, lineMat);
  line.computeLineDistances();
  root.add(line);

  const markerGeo = new THREE.TorusGeometry(0.15, 0.015, 8, 40);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0x4fd8d0, transparent: true, opacity: 0.85 });
  const markers = [];
  for (const c of callouts) {
    const x = CAPTURE.ringPlaneAboveClientCmM + c.d;
    const r = new THREE.Mesh(markerGeo, markerMat);
    r.rotation.x = Math.PI / 2;
    r.position.set(0, x, 0);
    root.add(r);
    markers.push({ mesh: r, label: c.label, d: c.d });
  }

  return { root, markers };
}
