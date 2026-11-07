// src/render/scene.js
// Two-pass renderer setup: background scene (Earth, Sun, stars) and foreground scene.

import * as THREE from 'three';
import { CONFIG, R_E, ORBITS } from '../config.js';
import {
  sunDirectionAtTime,
  solarVisibility,
  earthshineFactor,
  earthOrientationLVLH
} from '../physics/environment.js';

const KM = 1000;

// LVLH (x radial, y along-track, z orbit normal) to scene (x, y, z) = (y, x, -z)
export const LVLH_TO_SCENE = new THREE.Quaternion(Math.SQRT1_2, Math.SQRT1_2, 0, 0);

const SPHERE_TO_ECEF = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, -1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1
);

const LVLH_TO_SCENE_M = new THREE.Matrix4().set(
  0, 1, 0, 0,
  1, 0, 0, 0,
  0, 0, -1, 0,
  0, 0, 0, 1
);

function makeStars(count) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let seed = 987654321;
  const rand = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i += 1) {
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    const z = u;
    positions[i * 3 + 0] = x * 90000;
    positions[i * 3 + 1] = y * 90000;
    positions[i * 3 + 2] = z * 90000;
    const b = 0.25 + 0.75 * Math.pow(rand(), 3);
    colors[i * 3 + 0] = b;
    colors[i * 3 + 1] = b;
    colors[i * 3 + 2] = b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.6,
    sizeAttenuation: false,
    vertexColors: true,
    depthWrite: false,
    transparent: true,
    opacity: 0.85
  });
  return new THREE.Points(geo, mat);
}

function makeProceduralEarthTexture(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, '#0b2a55');
  grad.addColorStop(0.5, '#1f5fa0');
  grad.addColorStop(1, '#0b2a55');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let seed = 1234567;
  const rand = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 220; i += 1) {
    const cx = rand() * canvas.width;
    const cy = canvas.height * (0.2 + rand() * 0.6);
    const r = 8 + rand() * 40;
    ctx.beginPath();
    ctx.fillStyle = rand() < 0.5 ? '#2f6b3a' : '#3a7a4a';
    ctx.ellipse(cx, cy, r * 1.6, r, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 80; i += 1) {
    const cx = rand() * canvas.width;
    const cy = canvas.height * (0.1 + rand() * 0.8);
    const r = 10 + rand() * 30;
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.ellipse(cx, cy, r * 1.4, r * 0.6, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function makeEarthTexture() {
  const loader = new THREE.TextureLoader();
  return new Promise((resolve) => {
    loader.load(
      './assets/earth_day.jpg',
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        resolve(tex);
      },
      undefined,
      () => resolve(makeProceduralEarthTexture(1024))
    );
  });
}

export function buildScene({ orbit: orbitAtStart, renderer, startLocalSolarTimeHours: startHoursAtStart }) {
  // The orbit and the start time can change at run time (scenario switch, setOrbit below).
  let orbit = orbitAtStart;
  const backgroundScene = new THREE.Scene();
  backgroundScene.background = new THREE.Color(0x000000);

  const foregroundScene = new THREE.Scene();

  // Background camera: copies orientation and FOV from foreground camera each frame.
  const backgroundCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1e9);
  backgroundCamera.position.set(0, 0, 0);

  // Foreground camera.
  const foregroundCamera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000);
  foregroundCamera.position.set(0, 0, 30);

  // Earth in the background scene, in kilometres.
  const earthRadiusKm = R_E / KM;
  const earthGeo = new THREE.SphereGeometry(earthRadiusKm, 96, 64);
  const earthMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.0
  });
  const earth = new THREE.Mesh(earthGeo, earthMat);
  earth.position.set(0, -orbit.aM / KM, 0);
  backgroundScene.add(earth);

  // Atmosphere glow: a slightly larger sphere with additive blending.
  const atmoGeo = new THREE.SphereGeometry(earthRadiusKm * 1.025, 96, 64);
  const atmoMat = new THREE.MeshBasicMaterial({
    color: 0x4a86ff,
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide
  });
  const atmosphere = new THREE.Mesh(atmoGeo, atmoMat);
  atmosphere.position.copy(earth.position);
  backgroundScene.add(atmosphere);

  // Background light: the Earth needs a light in its own scene.
  const bgSunLight = new THREE.DirectionalLight(0xffffff, 3.0);
  backgroundScene.add(bgSunLight);
  backgroundScene.add(bgSunLight.target);

  // Sun: a directional light in the foreground scene plus a small emissive disk in the background.
  const sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.near = 0.1;
  sunLight.shadow.camera.far = 200;
  sunLight.shadow.camera.left = -30;
  sunLight.shadow.camera.right = 30;
  sunLight.shadow.camera.top = 30;
  sunLight.shadow.camera.bottom = -30;
  sunLight.shadow.bias = -0.0005;
  foregroundScene.add(sunLight);
  foregroundScene.add(sunLight.target);

  const sunDiskRadiusKm = 90000 * Math.tan(CONFIG.SUN_ANGULAR_RADIUS_RAD);
  const sunDiskGeo = new THREE.SphereGeometry(sunDiskRadiusKm, 24, 16);
  const sunDiskMat = new THREE.MeshBasicMaterial({ color: 0xfff4d0 });
  const sunDisk = new THREE.Mesh(sunDiskGeo, sunDiskMat);
  backgroundScene.add(sunDisk);

  // Earthshine: a second directional light from the Earth direction (below the vehicles).
  const earthshineLight = new THREE.DirectionalLight(0x9bb8ff, 0.0);
  earthshineLight.position.set(0, -100, 0);
  foregroundScene.add(earthshineLight);
  foregroundScene.add(earthshineLight.target);

  // Stars.
  const stars = makeStars(3000);
  backgroundScene.add(stars);

  // Earth texture (async).
  makeEarthTexture().then((tex) => {
    earthMat.map = tex;
    earthMat.needsUpdate = true;
  });

  // Environment state.
  let betaRad = orbit.defaultBetaRad;
  let startLocalSolarTimeHours = startHoursAtStart !== undefined && startHoursAtStart !== null
    ? startHoursAtStart
    : CONFIG.ENVIRONMENT.geoStartLocalSolarTimeHours;

  const tmpSun = new THREE.Vector3();
  const tmpEarthDir = new THREE.Vector3();
  const lvlhFromEcef = new THREE.Matrix4();
  const earthM = new THREE.Matrix4();

  // PMREM reflections.
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  let envTexture = null;
  let lastEnvWallS = -Infinity;
  const lastEnvSun = new THREE.Vector3();

  // simTimeS: mission elapsed time, which runs faster under time warp; it drives the Sun,
  // the Earth and the sky. wallTimeS: real time, which paces the reflection map refresh.
  function updateEnvironment(simTimeS, wallTimeS = simTimeS) {
    const elapsedS = simTimeS;
    const sunLVLH = sunDirectionAtTime(betaRad, startLocalSolarTimeHours, orbit.nRadPerS, elapsedS);
    // Scene = (y, x, -z).
    tmpSun.set(sunLVLH.y, sunLVLH.x, -sunLVLH.z).normalize();

    // Sun light direction: from the Sun toward the vehicles.
    sunLight.position.copy(tmpSun).multiplyScalar(100);
    sunLight.target.position.set(0, 0, 0);

    // Background Sun light: from the Sun toward the Earth.
    bgSunLight.position.copy(tmpSun).multiplyScalar(100);
    bgSunLight.target.position.set(0, 0, 0);

    // Sun disk position in the background scene.
    sunDisk.position.copy(tmpSun).multiplyScalar(90000);

    // Earthshine direction: from Earth toward the vehicles.
    tmpEarthDir.set(0, -1, 0);
    earthshineLight.position.copy(tmpEarthDir).multiplyScalar(100);
    earthshineLight.target.position.set(0, 0, 0);

    // Visibility of the Sun from the vehicle position.
    const posFromEarth = { x: orbit.aM, y: 0, z: 0 };
    const vis = solarVisibility(posFromEarth, sunLVLH);
    sunLight.intensity = 3.0 * vis;
    bgSunLight.intensity = 3.0 * vis;
    sunDiskMat.color.setRGB(vis, vis * 0.95, vis * 0.82);

    const es = earthshineFactor(posFromEarth, sunLVLH);
    earthshineLight.intensity = 0.6 * es;

    // Earth orientation from earthOrientationLVLH.
    const R = earthOrientationLVLH(orbit, elapsedS);
    lvlhFromEcef.set(
      R[0][0], R[0][1], R[0][2], 0,
      R[1][0], R[1][1], R[1][2], 0,
      R[2][0], R[2][1], R[2][2], 0,
      0, 0, 0, 1
    );
    earthM.copy(LVLH_TO_SCENE_M).multiply(lvlhFromEcef).multiply(SPHERE_TO_ECEF);
    earth.quaternion.setFromRotationMatrix(earthM);

    // The inertial sky turns about the orbit normal at -n in LVLH, which is +n about scene +z.
    stars.rotation.z = orbit.nRadPerS * elapsedS;

    // Stars follow exposure: fade with sunlight.
    stars.material.opacity = vis > 0.5 ? 0.15 : 0.85;

    // PMREM refresh at the start, then every 10 s of real time, or after 1 s of real time
    // once the Sun has moved more than 2 deg (time warp).
    const wallSince = wallTimeS - lastEnvWallS;
    const sunMoved = lastEnvSun.lengthSq() > 0 ? lastEnvSun.angleTo(tmpSun) : Math.PI;
    if (wallSince >= 10 || (wallSince >= 1 && sunMoved > 2 * Math.PI / 180)) {
      lastEnvWallS = wallTimeS;
      lastEnvSun.copy(tmpSun);
      sunDisk.visible = false;
      stars.visible = false;
      const newTex = pmrem.fromScene(backgroundScene, 0, 1, 2e5).texture;
      if (envTexture) envTexture.dispose();
      envTexture = newTex;
      foregroundScene.environment = envTexture;
      sunDisk.visible = true;
      stars.visible = true;
    }
  }

  updateEnvironment(0);

  // Switch to another orbit or start time: moves the Earth, resets the Sun and the reflections.
  function setOrbit(newOrbit, newStartLocalSolarTimeHours) {
    orbit = newOrbit;
    betaRad = orbit.defaultBetaRad;
    startLocalSolarTimeHours = newStartLocalSolarTimeHours !== undefined && newStartLocalSolarTimeHours !== null
      ? newStartLocalSolarTimeHours
      : CONFIG.ENVIRONMENT.geoStartLocalSolarTimeHours;
    earth.position.set(0, -orbit.aM / KM, 0);
    atmosphere.position.copy(earth.position);
    lastEnvWallS = -Infinity;
    lastEnvSun.set(0, 0, 0);
    updateEnvironment(0);
  }

  return {
    setOrbit,
    backgroundScene,
    backgroundCamera,
    foregroundScene,
    foregroundCamera,
    sunLight,
    earthshineLight,
    updateEnvironment
  };
}
