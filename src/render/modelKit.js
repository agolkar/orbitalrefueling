// src/render/modelKit.js
// Shared pieces of the procedural spacecraft models: canvas textures (multi-layer insulation
// crinkles, beta cloth, radiator tiles, solar cells), materials and geometry helpers.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Canvas textures

export function makeCanvasTexture(size, draw, srgb = true) {
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

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Crinkled MLI: soft blotches and creases, used as a bump map.
export function makeCrinkleBump(seed = 424242) {
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
export function makeBetaClothTexture() {
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
export function makeOsrTexture() {
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

// Solar cells with silver bus bars. The palette sets the cell colour: dark violet for the servicer
// and the relay satellite, slate for the Earth observer, deep blue for the non-cooperative client.
export const CELL_PALETTES = {
  violet: ['#08070d', '#3b3274', '#29234f', '#3a316f'],
  slate: ['#090b0f', '#33405a', '#222c40', '#313d56'],
  blue: ['#05080f', '#1f3a74', '#142650', '#1c356b']
};
export function makeCellTexture(palette = 'violet') {
  const [bg, c0, c1, c2] = CELL_PALETTES[palette];
  return makeCanvasTexture(512, (ctx, s) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, s, s);
    const n = 8;
    const c = s / n;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const x = i * c + 2;
        const y = j * c + 2;
        const g = ctx.createLinearGradient(x, y, x + c, y + c);
        g.addColorStop(0, c0);
        g.addColorStop(0.55, c1);
        g.addColorStop(1, c2);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, c - 4, c - 4);
        ctx.fillStyle = 'rgba(160,166,178,0.85)';
        ctx.fillRect(x, y + (c - 4) / 3, c - 4, 1.5);
        ctx.fillRect(x, y + (2 * (c - 4)) / 3, c - 4, 1.5);
      }
    }
  });
}

// White-painted radiator with the faint lines of the heat pipes under the paint.
export function makeRadiatorTexture() {
  return makeCanvasTexture(512, (ctx, s) => {
    const rand = rng(31337);
    ctx.fillStyle = '#e9e8e2';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 300; i += 1) {
      const v = 222 + Math.floor(rand() * 22);
      ctx.fillStyle = `rgba(${v},${v},${v - 6},0.4)`;
      ctx.fillRect(rand() * s, rand() * s, 2 + rand() * 8, 2 + rand() * 8);
    }
    ctx.strokeStyle = 'rgba(150,150,145,0.45)';
    ctx.lineWidth = 3;
    for (let k = 1; k < 8; k += 1) {
      ctx.beginPath();
      ctx.moveTo(k * s / 8, 0);
      ctx.lineTo(k * s / 8, s);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(110,110,105,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2);
  });
}

// ---------------------------------------------------------------------------
// Materials

export function materials() {
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

export function cellMaterial(m, repeatU, repeatV) {
  const t = m.cellTex.clone();
  t.repeat.set(repeatU, repeatV);
  t.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map: t, metalness: 0.35, roughness: 0.3 });
}

export function osrMaterial(m, repeatU, repeatV) {
  const t = m.osrTex.clone();
  t.repeat.set(repeatU, repeatV);
  t.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map: t, metalness: 0.95, roughness: 0.12 });
}

// ---------------------------------------------------------------------------
// Geometry helpers

export function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

// Cylinder whose axis runs from point a to point b.
export function rod(a, b, rTop, rBottom, mat, seg = 12) {
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
export function cylX(r, len, x, y, z, mat, seg = 32) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  mesh.rotation.z = Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

// Shallow dish whose concave side faces `facing`, with its apex at `apex`.
export function dish(rimRadius, apex, facing, mat) {
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
export function octagonCap(h, c, facingPlusX, mat) {
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

export function enableShadows(root) {
  root.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
}

