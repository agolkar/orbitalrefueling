// src/render/clients.js
// Procedural models of the three fictional clients, one per scenario, on a common docking
// interface (see the header of src/render/models.js). Client in LVLH axes: +x towards the
// servicer (the aft face with the docking interface), y along-track, wings along z.

import * as THREE from 'three';
import { CAPTURE, ARM } from '../config.js';
import { makeCrinkleBump, makeCellTexture, makeRadiatorTexture, materials, cellMaterial, osrMaterial, box, rod, cylX, dish, enableShadows } from './modelKit.js';

// ---------------------------------------------------------------------------
// Clients

// Materials only the clients use.
function clientMaterials(m) {
  const crinkle = makeCrinkleBump(90210);
  const radiatorTex = makeRadiatorTexture();
  return {
    silverMli: new THREE.MeshStandardMaterial({ color: 0xc6cbd2, metalness: 0.5, roughness: 0.42, bumpMap: crinkle, bumpScale: 1.4 }),
    goldMli: new THREE.MeshStandardMaterial({ color: 0xd9ad4f, metalness: 0.55, roughness: 0.4, bumpMap: crinkle, bumpScale: 1.5 }),
    radiator: (u, v) => {
      const t = radiatorTex.clone();
      t.repeat.set(u, v);
      t.needsUpdate = true;
      return new THREE.MeshStandardMaterial({ map: t, metalness: 0.05, roughness: 0.55 });
    },
    cells: (palette, u, v) => {
      const t = makeCellTexture(palette);
      t.repeat.set(u, v);
      return new THREE.MeshStandardMaterial({ map: t, metalness: 0.35, roughness: 0.3 });
    },
    ...m
  };
}

// The docking interface on the aft face (x = AFT), the same on every client because the capture,
// the arm and the tank models depend on it: foil heat shield, launch adapter ring, engine nozzle
// and the capped service valve.
function buildDockingInterface(m, AFT) {
  const g = new THREE.Group();
  g.name = 'dockingInterface';
  const RING = CAPTURE.ringPlaneAboveClientCmM; // 1.80 m

  g.add(cylX(CAPTURE.ringRadiusM - 0.035, 0.01, AFT + 0.005, 0, 0, m.foil, 64));
  const ringWall = new THREE.Mesh(
    new THREE.CylinderGeometry(CAPTURE.ringRadiusM, CAPTURE.ringRadiusM, RING - AFT, 64, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xd6dadf, metalness: 0.85, roughness: 0.28, side: THREE.DoubleSide })
  );
  ringWall.rotation.z = -Math.PI / 2;
  ringWall.position.set((AFT + RING) / 2, 0, 0);
  g.add(ringWall);
  const ringLip = new THREE.Mesh(new THREE.TorusGeometry(CAPTURE.ringRadiusM, 0.014, 12, 64), m.aluminium);
  ringLip.rotation.y = Math.PI / 2;
  ringLip.position.set(RING, 0, 0);
  g.add(ringLip);

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
  g.add(bell);
  g.add(cylX(0.03, 0.12, 1.68, 0, 0, m.niobium, 24));
  const exitLip = new THREE.Mesh(new THREE.TorusGeometry(re, 0.006, 8, 48), m.aluminium);
  exitLip.rotation.y = Math.PI / 2;
  exitLip.position.set(RING + CAPTURE.nozzleExitProtrusionM, 0, 0);
  g.add(exitLip);

  // Service valve on the aft face, 0.85 m from the engine axis at 60 deg azimuth (from +y
  // towards +z): amber boot, aluminium body, dark cap.
  const valveAng = ARM.valveAzimuthDeg * Math.PI / 180;
  const vy = ARM.valveOffsetFromLaeAxisM * Math.cos(valveAng);
  const vz = ARM.valveOffsetFromLaeAxisM * Math.sin(valveAng);
  g.add(cylX(0.08, 0.03, AFT + 0.015, vy, vz, m.amber, 24));
  g.add(cylX(0.055, 0.10, AFT + 0.05, vy, vz, m.aluminium, 24));
  // Fill port in the valve face: the target of the tool once the cap is off.
  g.add(cylX(0.018, 0.004, AFT + ARM.valveBracketHeightM + 0.001, vy, vz, m.dark, 20));
  const portRing = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 8, 32), m.amber);
  portRing.rotation.y = Math.PI / 2;
  portRing.position.set(AFT + ARM.valveBracketHeightM + 0.001, vy, vz);
  g.add(portRing);
  // The cap is red-anodised, like ground-handling covers, so it reads in the tool camera.
  const capMat = new THREE.MeshStandardMaterial({ color: 0xa3362a, metalness: 0.35, roughness: 0.45 });
  const valveCap = cylX(ARM.capRadiusM, ARM.capHeightM, AFT + ARM.valveBracketHeightM + ARM.capHeightM / 2, vy, vz, capMat, 24);
  valveCap.name = 'valveCap';
  g.add(valveCap);
  // A grip bar across the top of the cap (the cylinder axis is local Y, the top is local -Y), so
  // its rotation shows while the tool unscrews it.
  const grip = box(0.10, 0.008, 0.018, m.aluminium);
  grip.position.set(0, -ARM.capHeightM / 2 - 0.004, 0);
  valveCap.add(grip);
  const capRing = new THREE.Mesh(new THREE.TorusGeometry(ARM.capRadiusM - 0.008, 0.004, 8, 40), m.amber);
  capRing.rotation.x = Math.PI / 2;
  capRing.position.set(0, -ARM.capHeightM / 2 - 0.001, 0);
  valveCap.add(capRing);
  return { group: g, valveCap };
}

// Small thruster blocks on the corners of the aft face (out of the arm's reach).
function aftCornerThrusters(g, m, AFT, halfY, halfZ, mat, size = 0.18) {
  for (const sy of [1, -1]) {
    for (const sz of [1, -1]) {
      const blk = box(size, size + 0.02, size + 0.02, mat);
      blk.position.set(AFT - size / 2 - 0.01, sy * (halfY - 0.12), sz * (halfZ - 0.12));
      g.add(blk);
      g.add(rod([AFT - 0.1, sy * (halfY - 0.02), sz * (halfZ - 0.12)], [AFT - 0.1, sy * (halfY + 0.07), sz * (halfZ - 0.12)], 0.012, 0.028, m.niobium));
    }
  }
}

// A solar wing along +z (s = 1) or -z (s = -1) on a pivot at (x0, 0, s * root): a yoke, then
// panels (width along x, length along z). The cells face +y before the pivot turns about z.
function solarWing(g, m, { s, x0, root, yoke, panels, panelX, panelZ, cellsMat, vYoke = true }) {
  const pivot = new THREE.Group();
  pivot.position.set(x0, 0, s * root);
  const gap = 0.05;
  if (vYoke) {
    pivot.add(rod([0, 0, 0], [0.45 * panelX, 0, s * yoke], 0.035, 0.035, m.graphite));
    pivot.add(rod([0, 0, 0], [-0.45 * panelX, 0, s * yoke], 0.035, 0.035, m.graphite));
    pivot.add(rod([-0.48 * panelX, 0, s * yoke], [0.48 * panelX, 0, s * yoke], 0.03, 0.03, m.graphite));
  } else {
    pivot.add(rod([0, 0, 0], [0, 0, s * yoke], 0.045, 0.045, m.graphite));
    pivot.add(rod([-0.48 * panelX, 0, s * yoke], [0.48 * panelX, 0, s * yoke], 0.03, 0.03, m.graphite));
  }
  for (let i = 0; i < panels; i += 1) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(panelX, 0.03, panelZ), [
      m.cellBack, m.cellBack, cellsMat, m.cellBack, m.cellBack, m.cellBack
    ]);
    panel.position.set(0, 0, s * (yoke + gap + i * (panelZ + gap) + panelZ / 2));
    pivot.add(panel);
  }
  g.add(pivot);
  return pivot;
}

// Wing angle that turns the cells towards the Sun (sun direction in the client frame).
function sunAngle(sunLocal) {
  return Math.atan2(-sunLocal.x, sunLocal.y);
}

// Retired relay satellite (GEO graveyard orbit, cooperative).
function buildRelayClient(m, AFT) {
  const g = new THREE.Group();
  g.name = 'client-relay';
  const BX = 3.5;
  const BY = 2.8;
  const BZ = 2.8;

  // Bus: charcoal MLI, OSR radiators on the north and south (+/-z) faces.
  const osrNS = osrMaterial(m, 3, 3);
  g.add(new THREE.Mesh(new THREE.BoxGeometry(BX, BY, BZ), [
    m.blackMli, m.blackMli, m.blackMli, m.blackMli, osrNS, osrNS
  ]));

  // Amber band around the bus.
  const bandX = -0.55;
  for (const s of [1, -1]) {
    const by = box(0.14, 0.02, BZ + 0.04, m.amber);
    by.position.set(bandX, s * (BY / 2 + 0.01), 0);
    g.add(by);
    const bz = box(0.14, BY + 0.04, 0.02, m.amber);
    bz.position.set(bandX, 0, s * (BZ / 2 + 0.01));
    g.add(bz);
  }

  // Corner RCS blocks on the aft face and two omni antennas.
  aftCornerThrusters(g, m, AFT, BY / 2, BZ / 2, m.amber);
  for (const sy of [1, -1]) {
    g.add(rod([AFT, sy * 1.05, -1.05], [AFT + 0.55, sy * 1.05, -1.05], 0.01, 0.01, m.aluminium, 8));
    const bicone = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 12), m.paint);
    bicone.rotation.z = -Math.PI / 2;
    bicone.position.set(AFT + 0.59, sy * 1.05, -1.05);
    g.add(bicone);
  }

  // Earth deck (-x): feed horns and a small steerable dish on a tower.
  for (const [y, z] of [[0.55, 0.45], [-0.55, 0.45], [0.0, 0.95]]) {
    g.add(rod([-AFT, y, z], [-AFT - 0.32, y * 1.15, z], 0.04, 0.13, m.foil, 20));
  }
  g.add(rod([-AFT, 0.2, -0.7], [-AFT - 0.55, 0.2, -0.7], 0.06, 0.06, m.aluminium));
  g.add(dish(0.42, [-AFT - 0.58, 0.2, -0.7], [-1, 0, 0], m.paint));

  // Two unequal white reflectors on hinge arms, facing the Earth deck feeds.
  g.add(rod([-0.4, BY / 2, 0.3], [-1.0, BY / 2 + 0.75, 0.3], 0.04, 0.04, m.graphite));
  g.add(dish(1.25, [-1.15, BY / 2 + 1.0, 0.3], [-0.6, -0.8, 0], m.paint));
  g.add(rod([0.1, -BY / 2, -0.4], [-0.4, -BY / 2 - 0.55, -0.4], 0.04, 0.04, m.graphite));
  g.add(dish(0.82, [-0.55, -BY / 2 - 0.75, -0.4], [-0.7, 0.71, 0], m.paint));

  // Solar wings on +/-z: graphite V yoke, four panels with hinge gaps.
  const cells = cellMaterial(m, 2, 2.4);
  const wingP = solarWing(g, m, { s: 1, x0: 0, root: BZ / 2, yoke: 1.6, panels: 4, panelX: 2.5, panelZ: 3.05, cellsMat: cells });
  const wingN = solarWing(g, m, { s: -1, x0: 0, root: BZ / 2, yoke: 1.6, panels: 4, panelX: 2.5, panelZ: 3.05, cellsMat: cells });

  function trackSun(sunLocal) {
    const a = sunAngle(sunLocal);
    wingP.rotation.z = a;
    wingN.rotation.z = a;
  }
  return { group: g, trackSun };
}

// Earth observation satellite (500 km low Earth orbit, cooperative). A compact silver bus whose
// aft face carries the docking interface; under it a telescope looks at the Earth through an
// oblique sunshade. One three-panel wing on -z, two star trackers, a downlink dish and a
// magnetometer boom.
function buildObserverClient(m, AFT) {
  const g = new THREE.Group();
  g.name = 'client-observer';
  const XB = -0.55; // m, bottom of the bus (nadir side)
  const HY = 1.2;
  const HZ = 1.2;
  const HX = (AFT - XB) / 2;
  const XC = (AFT + XB) / 2;

  // Bus: silver MLI, white radiators on the +/-y faces, black MLI on the nadir face.
  const rad = m.radiator(1, 1);
  const bus = new THREE.Mesh(new THREE.BoxGeometry(2 * HX, 2 * HY, 2 * HZ), [
    m.silverMli, m.blackMli, rad, rad, m.silverMli, m.silverMli
  ]);
  bus.position.x = XC;
  g.add(bus);
  // A dark seam between the platform and the payload module.
  const seam = box(0.06, 2 * HY + 0.02, 2 * HZ + 0.02, m.graphite);
  seam.position.x = XB + 0.55;
  g.add(seam);

  aftCornerThrusters(g, m, AFT, HY, HZ, m.aluminium, 0.14);
  // GNSS antennas on the zenith deck, away from the arm.
  for (const az of [210, 330]) {
    const a = az * Math.PI / 180;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.paint);
    dome.rotation.z = -Math.PI / 2;
    dome.position.set(AFT, Math.cos(a), Math.sin(a));
    g.add(dome);
  }

  // Telescope under the bus: black MLI barrel, aluminium rings, a white sunshade cut at an angle.
  const TR = 0.72;
  const T0 = XB;
  const T1 = -2.0;
  g.add(cylX(TR, T0 - T1, (T0 + T1) / 2, 0, 0, m.blackMli, 48));
  for (const x of [T0 - 0.05, (T0 + T1) / 2, T1 + 0.04]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(TR + 0.01, 0.012, 8, 48), m.aluminium);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = x;
    g.add(ring);
  }
  const shadeLen = 0.75;
  const shadeGeo = new THREE.CylinderGeometry(TR + 0.04, TR + 0.04, shadeLen, 48, 6, true);
  const pos = shadeGeo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    // Cylinder axis is local y; local +y becomes -x (nadir). Slant the open end: longer on one side.
    const y = pos.getY(i);
    const ang = Math.atan2(pos.getZ(i), pos.getX(i));
    const u = (y + shadeLen / 2) / shadeLen;
    pos.setY(i, y + u * 0.55 * (Math.cos(ang) - 1) * 0.5);
  }
  shadeGeo.computeVertexNormals();
  const shade = new THREE.Mesh(shadeGeo, m.paint);
  shade.rotation.z = Math.PI / 2;
  shade.position.x = T1 - shadeLen / 2;
  g.add(shade);
  // Black baffle inside and the dark aperture.
  g.add(cylX(TR - 0.02, 0.01, T1 + 0.02, 0, 0, m.lens, 48));
  const baffle = new THREE.Mesh(new THREE.CylinderGeometry(TR - 0.01, TR - 0.01, shadeLen, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.95, side: THREE.BackSide }));
  baffle.rotation.z = Math.PI / 2;
  baffle.position.x = T1 - shadeLen / 2;
  g.add(baffle);

  // Gold payload interface plate between the bus and the telescope.
  g.add(cylX(0.98, 0.04, XB - 0.02, 0, 0, m.goldMli, 48));

  // Downlink dish on a short post at a nadir corner, and two star trackers on the +z face.
  g.add(rod([XB, 0.95, -0.95], [XB - 0.3, 0.95, -0.95], 0.03, 0.03, m.aluminium));
  g.add(dish(0.2, [XB - 0.32, 0.95, -0.95], [-1, 0, 0], m.paint));
  for (const y of [-0.45, 0.45]) {
    const st = rod([1.2, y, HZ], [1.35, y, HZ + 0.22], 0.06, 0.06, m.aluminium, 16);
    g.add(st);
    g.add(rod([1.35, y, HZ + 0.22], [1.43, y, HZ + 0.34], 0.085, 0.06, m.dark, 16));
  }
  // Magnetometer boom along +y with the sensor at its tip.
  g.add(rod([0.4, HY, 0.6], [0.4, HY + 1.6, 0.6], 0.015, 0.015, m.graphite, 8));
  const mag = box(0.08, 0.08, 0.08, m.paint);
  mag.position.set(0.4, HY + 1.64, 0.6);
  g.add(mag);

  // One wing on -z: single-strut yoke, three panels.
  const cells = m.cells('slate', 1.5, 2);
  const wing = solarWing(g, m, { s: -1, x0: XC, root: HZ, yoke: 1.0, panels: 3, panelX: 1.9, panelZ: 2.4, cellsMat: cells, vYoke: false });

  function trackSun(sunLocal) {
    wing.rotation.z = sunAngle(sunLocal);
  }
  return { group: g, trackSun };
}

// Older communications satellite that lost its attitude control (GEO graveyard orbit,
// non-cooperative). Gold MLI bus wider than deep, white radiators on the north and south faces, an
// antenna tower on the Earth deck, a large reflector on a long boom, a flat antenna panel, and two
// three-panel wings that no longer track the Sun: they stopped at different angles.
function buildDerelictClient(m, AFT) {
  const g = new THREE.Group();
  g.name = 'client-derelict';
  const BX = 3.5;
  const HY = 1.7;
  const HZ = 1.2;

  const rad = m.radiator(2, 1.5);
  g.add(new THREE.Mesh(new THREE.BoxGeometry(BX, 2 * HY, 2 * HZ), [
    m.goldMli, m.goldMli, m.goldMli, m.goldMli, rad, rad
  ]));
  // Black MLI skirt around the Earth end of the bus.
  for (const s of [1, -1]) {
    const by = box(0.3, 0.02, 2 * HZ + 0.04, m.blackMli);
    by.position.set(-AFT + 0.15, s * (HY + 0.01), 0);
    g.add(by);
    const bz = box(0.3, 2 * HY + 0.04, 0.02, m.blackMli);
    bz.position.set(-AFT + 0.15, 0, s * (HZ + 0.01));
    g.add(bz);
  }
  aftCornerThrusters(g, m, AFT, HY, HZ, m.aluminium, 0.16);

  // Earth deck (-x): antenna tower with a steerable dish, and feed horns around it.
  const tower = box(0.8, 0.8, 0.8, m.goldMli);
  tower.position.x = -AFT - 0.4;
  g.add(tower);
  g.add(rod([-AFT - 0.8, 0, 0], [-AFT - 1.05, 0, 0], 0.07, 0.07, m.aluminium));
  g.add(dish(0.45, [-AFT - 1.08, 0, 0], [-1, 0, 0], m.paint));
  for (const [y, z] of [[0.9, 0.7], [-0.9, 0.7], [0.9, -0.7], [-0.9, -0.7]]) {
    g.add(rod([-AFT, y, z], [-AFT - 0.28, y * 1.08, z * 1.08], 0.035, 0.11, m.foil, 20));
  }

  // Large reflector on a long boom along +y, facing the feeds on the Earth deck.
  g.add(rod([-0.3, HY, 0], [-0.3, HY + 2.4, 0], 0.05, 0.05, m.graphite));
  g.add(rod([-0.3, HY + 2.4, 0], [-0.5, HY + 2.85, 0], 0.04, 0.04, m.graphite));
  g.add(dish(1.6, [-0.55, HY + 3.1, 0], [-0.45, -0.89, 0], m.paint));
  // Flat antenna panel on a short arm on -y, tilted towards the Earth.
  g.add(rod([-0.3, -HY, 0], [-0.3, -HY - 0.45, 0], 0.04, 0.04, m.graphite));
  const panel = box(1.6, 0.07, 1.2, m.paint);
  panel.position.set(-0.45, -HY - 0.62, 0);
  panel.rotation.z = -0.6;
  g.add(panel);

  // Wings on +/-z, stopped at different angles.
  const cells = m.cells('blue', 2, 2.2);
  const wingP = solarWing(g, m, { s: 1, x0: -0.2, root: HZ, yoke: 1.0, panels: 3, panelX: 2.6, panelZ: 3.0, cellsMat: cells, vYoke: false });
  const wingN = solarWing(g, m, { s: -1, x0: -0.2, root: HZ, yoke: 1.0, panels: 3, panelX: 2.6, panelZ: 3.0, cellsMat: cells, vYoke: false });
  // Angles chosen with the mass model: the major axis of inertia stays within 1 deg of the engine axis.
  // The cells face away from the Earth deck (+pi turns a wing over without changing its inertia).
  wingP.rotation.z = 0.7 + Math.PI;
  wingN.rotation.z = 1.2 + Math.PI;

  return { group: g, trackSun: null };
}

// The client of the scenario. setDesign switches between the three models; the docking interface
// (and the valve cap the docked levels animate) stays the same object.
export function buildTarget(design = 'relay') {
  const root = new THREE.Group();
  root.name = 'target';
  const m = clientMaterials(materials());
  const AFT = CAPTURE.zenithDeckAboveClientCmM; // 1.75 m, aft face (zenith deck) above the client CM

  const iface = buildDockingInterface(m, AFT);
  root.add(iface.group);
  const designs = {
    relay: buildRelayClient(m, AFT),
    observer: buildObserverClient(m, AFT),
    derelict: buildDerelictClient(m, AFT)
  };
  for (const d of Object.values(designs)) root.add(d.group);
  enableShadows(root);

  let current = null;
  let currentId = null;
  function setDesign(id) {
    currentId = designs[id] ? id : 'relay';
    current = designs[currentId];
    for (const d of Object.values(designs)) d.group.visible = d === current;
  }
  setDesign(design);

  function trackSun(sunLocal) {
    if (current.trackSun) current.trackSun(sunLocal);
  }

  return { root, trackSun, valveCap: iface.valveCap, setDesign, get design() { return currentId; } };
}

