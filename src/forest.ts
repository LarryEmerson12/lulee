import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import nipplejs from 'nipplejs';
import { makeNoise2D } from 'open-simplex-noise';

const noise2D = makeNoise2D(Date.now());

// === Scene Setup ===
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa0d8f1);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('gameCanvas') as HTMLCanvasElement,
  antialias: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(ambientLight, dirLight);

// === Player Systems ===
const playerPivot = new THREE.Object3D(); 
scene.add(playerPivot);

const controls = new PointerLockControls(camera, document.body);
document.body.addEventListener('click', () => controls.lock());

// === Materials ===
const grassMaterial = new THREE.MeshBasicMaterial({ color: 0x40ee95 });
const waterMaterial = new THREE.MeshBasicMaterial({ color: 0x44bfd2 });
const logMaterial = new THREE.MeshBasicMaterial({ color: 0x8b5a2b });
const leafMaterial = new THREE.MeshBasicMaterial({ color: 0x228b22 });

const playerMesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1.6, 1),
  new THREE.MeshStandardMaterial({ color: 0x6a0dad })
);
scene.add(playerMesh);

// === Single Face Darkness Highlight ===
// Instead of a box, we use a flat plane to only darken the visible face
const highlightPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(1.01, 1.01), // Slightly larger to prevent Z-fighting
  new THREE.MeshBasicMaterial({ 
    color: 0x000000, 
    transparent: true, 
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false
  })
);
highlightPlane.visible = false;
scene.add(highlightPlane);

const raycaster = new THREE.Raycaster();
raycaster.far = 10;

// === Infinite Terrain System ===
const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 3;
const MAX_HEIGHT = 8;
const terrainHeightMap = new Map<string, number>();
const loadedChunks = new Set<string>();

function chunkKey(cx: number, cz: number) { return `${cx},${cz}`; }

function generateChunk(cx: number, cz: number) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const water = new THREE.InstancedMesh(geo, waterMaterial, CHUNK_SIZE * CHUNK_SIZE * 4);
  const grass = new THREE.InstancedMesh(geo, grassMaterial, CHUNK_SIZE * CHUNK_SIZE * MAX_HEIGHT);
  const logs = new THREE.InstancedMesh(geo, logMaterial, 1000); 
  const leaves = new THREE.InstancedMesh(geo, leafMaterial, 10000);
  const dummy = new THREE.Object3D();

  let wi = 0, gi = 0, li = 0, fi = 0;

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const h = Math.floor((noise2D(wx * 0.1, wz * 0.1) + 1) * (MAX_HEIGHT / 2));
      terrainHeightMap.set(`${wx},${wz}`, h);

      for (let y = 0; y <= h; y++) {
        dummy.position.set(wx, y, wz); dummy.updateMatrix();
        if (y <= 3) water.setMatrixAt(wi++, dummy.matrix);
        else grass.setMatrixAt(gi++, dummy.matrix);
      }

      // TREES: 0.85 threshold for Minecraft-style density
      const treeNoise = (noise2D(wx * 0.4, wz * 0.4) + 1) / 2;
      if (h > 3 && treeNoise > 0.85) {
        for(let i = 1; i <= 3; i++) { 
           dummy.position.set(wx, h + i, wz); dummy.updateMatrix(); logs.setMatrixAt(li++, dummy.matrix); 
        }
        for(let dx = -2; dx <= 2; dx++) {
          for(let dz = -2; dz <= 2; dz++) {
            dummy.position.set(wx + dx, h + 3, wz + dz); dummy.updateMatrix(); leaves.setMatrixAt(fi++, dummy.matrix);
          }
        }
        for(let dx = -1; dx <= 1; dx++) {
          for(let dz = -1; dz <= 1; dz++) {
            dummy.position.set(wx + dx, h + 4, wz + dz); dummy.updateMatrix(); leaves.setMatrixAt(fi++, dummy.matrix);
          }
        }
        dummy.position.set(wx, h + 5, wz); dummy.updateMatrix(); leaves.setMatrixAt(fi++, dummy.matrix);
      }
    }
  }
  water.count = wi; grass.count = gi; logs.count = li; leaves.count = fi;
  scene.add(water, grass, logs, leaves);
  loadedChunks.add(chunkKey(cx, cz));
}

function updateChunks() {
  const cx = Math.floor(playerPivot.position.x / CHUNK_SIZE);
  const cz = Math.floor(playerPivot.position.z / CHUNK_SIZE);
  for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
    for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
      const key = chunkKey(cx + dx, cz + dz);
      if (!loadedChunks.has(key)) generateChunk(cx + dx, cz + dz);
    }
  }
}

// === Movement State ===
const keysPressed: Record<string, boolean> = {};
let velocityY = 0, isGrounded = true, sprint = 1, thirdPerson = false;

window.addEventListener('keydown', (e) => {
  keysPressed[e.key.toLowerCase()] = true;
  if (e.key === 'Shift') sprint = 2;
  if (e.key === ' ' && isGrounded) { velocityY = 0.22; isGrounded = false; }
  if (e.key.toLowerCase() === 'p') { thirdPerson = !thirdPerson; playerMesh.visible = thirdPerson; }
});
window.addEventListener('keyup', (e) => {
  keysPressed[e.key.toLowerCase()] = false;
  if (e.key === 'Shift') sprint = 1;
});

let joyX = 0, joyZ = 0;
const joystick = nipplejs.create({
  zone: document.body, mode: 'static', position: { left: '80px', top: '50%' }, color: 'white', size: 100
});
joystick.on('move', (e, d) => { joyX = Math.cos(d.angle.radian) * d.force; joyZ = -Math.sin(d.angle.radian) * d.force; });
joystick.on('end', () => { joyX = 0; joyZ = 0; });

// === Animation Loop ===
function animate() {
  requestAnimationFrame(animate);
  updateChunks();

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0; forward.normalize();
  const right = new THREE.Vector3().crossVectors(camera.up, forward).negate(); 

  const moveVec = new THREE.Vector3(0, 0, 0);
  if (keysPressed['w']) moveVec.add(forward);
  if (keysPressed['s']) moveVec.add(forward.clone().negate());
  if (keysPressed['a']) moveVec.add(right.clone().negate());
  if (keysPressed['d']) moveVec.add(right);
  moveVec.add(forward.clone().multiplyScalar(-joyZ));
  moveVec.add(right.clone().multiplyScalar(joyX));

  if (moveVec.lengthSq() > 0) {
    moveVec.normalize();
    playerPivot.position.addScaledVector(moveVec, 0.15 * sprint);
  }

  velocityY -= 0.01;
  playerPivot.position.y += velocityY;
  const terrainY = terrainHeightMap.get(`${Math.floor(playerPivot.position.x)},${Math.floor(playerPivot.position.z)}`) ?? 0;
  if (playerPivot.position.y <= terrainY + 0.8) {
    playerPivot.position.y = terrainY + 0.8;
    velocityY = 0; isGrounded = true;
  }

  playerMesh.position.copy(playerPivot.position);
  playerMesh.rotation.y = Math.atan2(forward.x, forward.z);

  if (thirdPerson) {
    const backDir = forward.clone().negate();
    camera.position.copy(playerPivot.position).addScaledVector(backDir, 7).add(new THREE.Vector3(0, 4, 0));
    camera.lookAt(playerPivot.position.clone().add(new THREE.Vector3(0, 1.2, 0)));
  } else {
    camera.position.copy(playerPivot.position).add(new THREE.Vector3(0, 0.6, 0));
  }

  // === CORRECTED FACE-ONLY HIGHLIGHT ===
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const intersects = raycaster.intersectObjects(scene.children, true);
  let found = false;
  
  for (const intersect of intersects) {
    if (intersect.object instanceof THREE.InstancedMesh && intersect.object !== playerMesh) {
      const matrix = new THREE.Matrix4();
      intersect.object.getMatrixAt(intersect.instanceId!, matrix);
      
      const blockPos = new THREE.Vector3();
      blockPos.setFromMatrixPosition(matrix);

      // Get the normal of the hit face to determine which way to point the plane
      const normal = intersect.face!.normal.clone();
      normal.transformDirection(intersect.object.matrixWorld);

      // Position the plane slightly offset from the block face
      highlightPlane.position.copy(blockPos).add(normal.clone().multiplyScalar(0.505));
      
      // Rotate plane to match face
      highlightPlane.lookAt(highlightPlane.position.clone().add(normal));

      highlightPlane.visible = true;
      found = true;
      break;
    }
  }
  if (!found) highlightPlane.visible = false;

  renderer.render(scene, camera);
}

playerPivot.position.set(0, 10, 0);
animate();