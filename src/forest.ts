import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import nipplejs from 'nipplejs';
import { makeNoise2D } from 'open-simplex-noise';

const noise2D = makeNoise2D(Date.now());

// === Scene Setup ===
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa0d8f1);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);

const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('gameCanvas') as HTMLCanvasElement,
});
renderer.setSize(window.innerWidth, window.innerHeight);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// === Controls ===
const controls = new PointerLockControls(camera, document.body);
scene.add(controls.object);

document.body.addEventListener('click', () => controls.lock());

// === Materials (color-only) ===
const waterMaterial = new THREE.MeshBasicMaterial({ color: 0x44bfd2 });
const grassMaterial = new THREE.MeshBasicMaterial({ color: 0x40ee95 });
const logMaterial = new THREE.MeshBasicMaterial({ color: 0x8b5a2b });
const leafMaterial = new THREE.MeshBasicMaterial({ color: 0x228b22 });

// === Chunk System ===
const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 3;
const MAX_HEIGHT = 8;

const terrainHeightMap = new Map<string, number>();

type ChunkData = {
  water: THREE.InstancedMesh;
  grass: THREE.InstancedMesh;
  logs: THREE.InstancedMesh;
  leaves: THREE.InstancedMesh;
};

const loadedChunks = new Map<string, ChunkData>();

function chunkKey(cx: number, cz: number) {
  return `${cx},${cz}`;
}

// === Tree Generator ===
function placeTreeInChunk(
  logs: THREE.InstancedMesh,
  leaves: THREE.InstancedMesh,
  logIndexRef: { value: number },
  leafIndexRef: { value: number },
  worldX: number,
  baseY: number,
  worldZ: number,
  dummy: THREE.Object3D
) {
  for (let i = 0; i < 3; i++) {
    dummy.position.set(worldX, baseY + i, worldZ);
    dummy.updateMatrix();
    logs.setMatrixAt(logIndexRef.value++, dummy.matrix);
  }

  const topY = baseY + 3;

  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      dummy.position.set(worldX + dx, topY, worldZ + dz);
      dummy.updateMatrix();
      leaves.setMatrixAt(leafIndexRef.value++, dummy.matrix);
    }
  }

  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      dummy.position.set(worldX + dx, topY + 1, worldZ + dz);
      dummy.updateMatrix();
      leaves.setMatrixAt(leafIndexRef.value++, dummy.matrix);
    }
  }

  dummy.position.set(worldX, topY + 2, worldZ);
  dummy.updateMatrix();
  leaves.setMatrixAt(leafIndexRef.value++, dummy.matrix);
}

// === Chunk Generator ===
function generateChunk(cx: number, cz: number) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);

  const water = new THREE.InstancedMesh(geometry, waterMaterial, CHUNK_SIZE * CHUNK_SIZE * MAX_HEIGHT);
  const grass = new THREE.InstancedMesh(geometry, grassMaterial, CHUNK_SIZE * CHUNK_SIZE * MAX_HEIGHT);
  const logs = new THREE.InstancedMesh(geometry, logMaterial, CHUNK_SIZE * CHUNK_SIZE);
  const leaves = new THREE.InstancedMesh(geometry, leafMaterial, CHUNK_SIZE * CHUNK_SIZE * 10);

  const dummy = new THREE.Object3D();

  let wi = 0;
  let gi = 0;
  const logIndexRef = { value: 0 };
  const leafIndexRef = { value: 0 };

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;

      const rawHeight = noise2D(wx * 0.1, wz * 0.1);
      const height = Math.floor((rawHeight + 1) * (MAX_HEIGHT / 2));

      terrainHeightMap.set(`${wx},${wz}`, height);

      for (let y = 0; y <= height; y++) {
        dummy.position.set(wx, y, wz);
        dummy.updateMatrix();

        if (y <= 3) water.setMatrixAt(wi++, dummy.matrix);
        else grass.setMatrixAt(gi++, dummy.matrix);
      }

      const isSuitableForTree = height > 3;
      const treeNoise = noise2D(wx * 0.2, wz * 0.2);
      const chance = (treeNoise + 1) / 2;

      if (isSuitableForTree && chance > 0.85) {
        placeTreeInChunk(logs, leaves, logIndexRef, leafIndexRef, wx, height + 1, wz, dummy);
      }
    }
  }

  water.count = wi;
  grass.count = gi;
  logs.count = logIndexRef.value;
  leaves.count = leafIndexRef.value;

  scene.add(water, grass, logs, leaves);
  loadedChunks.set(chunkKey(cx, cz), { water, grass, logs, leaves });
}

let lastChunkX = Infinity;
let lastChunkZ = Infinity;

function updateChunks() {
  const px = Math.floor(controls.object.position.x);
  const pz = Math.floor(controls.object.position.z);
  const cx = Math.floor(px / CHUNK_SIZE);
  const cz = Math.floor(pz / CHUNK_SIZE);

  if (cx === lastChunkX && cz === lastChunkZ) return;
  lastChunkX = cx;
  lastChunkZ = cz;

  for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
    for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
      const key = chunkKey(cx + dx, cz + dz);
      if (!loadedChunks.has(key)) generateChunk(cx + dx, cz + dz);
    }
  }
}

// === Player Spawn ===
camera.position.set(0, 30, 0);

// === Movement & Physics ===
const keysPressed: Record<string, boolean> = {};
let velocityY = 0;
const gravity = -0.01;
let isGrounded = true;
let sprintMultiplier = 1;

window.addEventListener('keydown', (e) => {
  keysPressed[e.key.toLowerCase()] = true;
  if (e.key === 'Shift') sprintMultiplier = 2;
  if (e.key === ' ' && isGrounded) {
    velocityY = 0.2;
    isGrounded = false;
  }
});

window.addEventListener('keyup', (e) => {
  keysPressed[e.key.toLowerCase()] = false;
  if (e.key === 'Shift') sprintMultiplier = 1;
});

// === NippleJS Joystick ===
let joyX = 0;
let joyZ = 0;

const joystick = nipplejs.create({
  zone: document.body,
  mode: 'static',
  position: { left: '80px', bottom: '50%' },
  color: '#000000',
  size: 120
});

joystick.on('move', (evt, data) => {
  const angle = data.angle.radian;
  const force = data.force;

  joyX = Math.cos(angle) * force;
  joyZ = -Math.sin(angle) * force;
});

joystick.on('end', () => {
  joyX = 0;
  joyZ = 0;
});

console.log("animating");

// === Animation Loop ===
function animate() {
  requestAnimationFrame(animate);

  updateChunks();

  const baseSpeed = 0.1;
  const moveSpeed = baseSpeed * sprintMultiplier;
  const direction = new THREE.Vector3();

  if (keysPressed['w']) direction.z -= 1;
  if (keysPressed['s']) direction.z += 1;
  if (keysPressed['a']) direction.x -= 1;
  if (keysPressed['d']) direction.x += 1;

  direction.x += joyX;
  direction.z += joyZ;

  if (direction.lengthSq() > 0) {
    direction.normalize();
    direction.applyEuler(camera.rotation);
    controls.object.position.addScaledVector(direction, moveSpeed);
  }

  velocityY += gravity;
  controls.object.position.y += velocityY;

  const px = Math.round(controls.object.position.x);
  const pz = Math.round(controls.object.position.z);
  const terrainY = terrainHeightMap.get(`${px},${pz}`) ?? 0;
  const groundY = terrainY + 1.6;

  if (controls.object.position.y <= groundY) {
    controls.object.position.y = groundY;
    velocityY = 0;
    isGrounded = true;
  }

  renderer.render(scene, camera);
}

animate();
