import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { makeNoise2D } from 'open-simplex-noise';

const noise2D = makeNoise2D(Date.now());

// === Scene Setup ===
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa0d8f1);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('gameCanvas') as HTMLCanvasElement,
  antialias: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);

// === Lighting ===
const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);
const sunLight = new THREE.DirectionalLight(0xffffff, 0.5);
sunLight.position.set(10, 20, 10);
scene.add(sunLight);

// === Player & Camera State ===
const playerPivot = new THREE.Object3D();
scene.add(playerPivot);
const controls = new PointerLockControls(camera, document.body);
document.body.addEventListener('click', () => controls.lock());

let thirdPerson = false;
const playerMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.6, 1.8, 0.6),
  new THREE.MeshLambertMaterial({ color: 0x6a0dad })
);
playerMesh.visible = false;
scene.add(playerMesh);

// === Materials ===
const stoneMaterial = new THREE.MeshLambertMaterial({ color: 0x9F9E9F });
const grassMaterial = new THREE.MeshLambertMaterial({ color: 0x40ee95 });
const waterMaterial = new THREE.MeshLambertMaterial({ color: 0x44bfd2, transparent: true, opacity: 0.6 });
const logMaterial = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
const leafMaterial = new THREE.MeshLambertMaterial({ color: 0x228b22 });

// === Highlight ===
const highlightPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(1.01, 1.01),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
);
highlightPlane.raycast = () => null;
scene.add(highlightPlane);

const raycaster = new THREE.Raycaster();
raycaster.far = 10;

// === World Data ===
const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 3;
const blockMap = new Set<string>();
const activeChunks = new Map<string, THREE.Group>();
const waterMeshes: THREE.InstancedMesh[] = [];

function addSolid(x: number, y: number, z: number) {
  blockMap.add(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`);
}

function isSolid(x: number, y: number, z: number) {
  return blockMap.has(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`);
}

function generateChunk(cx: number, cz: number) {
  const key = `${cx},${cz}`;
  const chunkGroup = new THREE.Group();
  const geo = new THREE.BoxGeometry(1, 1, 1);

  const stone = new THREE.InstancedMesh(geo, stoneMaterial, 2000);
  const water = new THREE.InstancedMesh(geo, waterMaterial, 500);
  const grass = new THREE.InstancedMesh(geo, grassMaterial, 300);
  const logs = new THREE.InstancedMesh(geo, logMaterial, 200);
  const leaves = new THREE.InstancedMesh(geo, leafMaterial, 3000);

  const dummy = new THREE.Object3D();
  let si = 0, wi = 0, gi = 0, li = 0, fi = 0;

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const h = Math.max(1, Math.floor((noise2D(wx * 0.08, wz * 0.08) + 1) * 4));

      for (let y = 0; y <= h; y++) {
        dummy.position.set(wx, y, wz); dummy.updateMatrix();
        if (y < h) {
          stone.setMatrixAt(si++, dummy.matrix);
          addSolid(wx, y, wz);
        } else if (h <= 3) {
          for(let wy=h; wy<=3; wy++){
            dummy.position.set(wx, wy, wz); dummy.updateMatrix();
            water.setMatrixAt(wi++, dummy.matrix);
          }
        } else {
          grass.setMatrixAt(gi++, dummy.matrix);
          addSolid(wx, h, wz);
        }
      }

      if (h > 3 && (noise2D(wx * 0.4, wz * 0.4) + 1) / 2 > 0.88) {
        for (let i = 1; i <= 3; i++) {
          dummy.position.set(wx, h + i, wz); dummy.updateMatrix();
          logs.setMatrixAt(li++, dummy.matrix); addSolid(wx, h + i, wz);
        }
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
          dummy.position.set(wx+dx, h+3, wz+dz); dummy.updateMatrix();
          leaves.setMatrixAt(fi++, dummy.matrix); addSolid(wx + dx, h + 3, wz + dz);
        }
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          dummy.position.set(wx + dx, h + 4, wz + dz); dummy.updateMatrix();
          leaves.setMatrixAt(fi++, dummy.matrix); addSolid(wx + dx, h + 4, wz + dz);
        }
        dummy.position.set(wx, h+5, wz); dummy.updateMatrix();
        leaves.setMatrixAt(fi++, dummy.matrix); addSolid(wx, h + 5, wz);
      }
    }
  }

  stone.count = si; water.count = wi; grass.count = gi; logs.count = li; leaves.count = fi;
  chunkGroup.add(stone, water, grass, logs, leaves);
  waterMeshes.push(water);
  scene.add(chunkGroup);
  activeChunks.set(key, chunkGroup);
}

function updateChunks() {
  const px = Math.floor(playerPivot.position.x / CHUNK_SIZE);
  const pz = Math.floor(playerPivot.position.z / CHUNK_SIZE);
  for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
    for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
      if (!activeChunks.has(`${px + dx},${pz + dz}`)) generateChunk(px + dx, pz + dz);
    }
  }
}

const keys: Record<string, boolean> = {};
let velocityY = 0, isGrounded = false;
window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === 'p') {
    thirdPerson = !thirdPerson;
    playerMesh.visible = thirdPerson;
  }
});
window.addEventListener('keyup', (e) => keys[e.key.toLowerCase()] = false);

function animate() {
  requestAnimationFrame(animate);
  updateChunks();

  // Water Wobble Logic
  const time = Date.now() * 0.002;
  waterMeshes.forEach(m => {
    m.position.y = Math.sin(time) * 0.1;
  });

  const forward = new THREE.Vector3(); camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
  const right = new THREE.Vector3().crossVectors(camera.up, forward).negate();
  const move = new THREE.Vector3(0, 0, 0);
  if (keys['w']) move.add(forward); if (keys['s']) move.add(forward.clone().negate());
  if (keys['a']) move.add(right.clone().negate()); if (keys['d']) move.add(right);

  if (move.lengthSq() > 0) {
    const speed = 0.15;
    const nextX = playerPivot.position.x + move.normalize().x * speed;
    const nextZ = playerPivot.position.z + move.z * speed;
    const curY = playerPivot.position.y;

    const isStep = isSolid(nextX, Math.floor(curY - 0.5), nextZ);
    const isWall = isSolid(nextX, Math.floor(curY + 0.5), nextZ);

    if (!isStep) {
      playerPivot.position.x = nextX;
      playerPivot.position.z = nextZ;
    } else if (isStep && !isWall) {
      playerPivot.position.set(nextX, Math.floor(curY - 0.5) + 1.8, nextZ);
    }
  }

  velocityY -= 0.01;
  playerPivot.position.y += velocityY;

  if (isSolid(playerPivot.position.x, playerPivot.position.y - 1.0, playerPivot.position.z)) {
    playerPivot.position.y = Math.floor(playerPivot.position.y - 1.0) + 1.8;
    velocityY = 0;
    isGrounded = true;
  } else {
    isGrounded = false;
  }

  if (keys[' '] && isGrounded) { velocityY = 0.22; isGrounded = false; }

  // Third Person View Logic
  playerMesh.position.copy(playerPivot.position).y -= 0.9;
  if (move.lengthSq() > 0) playerMesh.rotation.y = Math.atan2(move.x, move.z);

  if (thirdPerson) {
    const backDir = forward.clone().negate();
    camera.position.copy(playerPivot.position).addScaledVector(backDir, 5).add(new THREE.Vector3(0, 3, 0));
    camera.lookAt(playerPivot.position);
  } else {
    camera.position.copy(playerPivot.position).add(new THREE.Vector3(0, 0.6, 0));
  }

  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const intersects = raycaster.intersectObjects(scene.children, true);
  if (intersects.length > 0 && intersects[0].object !== playerMesh) {
    const hit = intersects[0];
    if (hit.object instanceof THREE.InstancedMesh) {
      const m = new THREE.Matrix4(); hit.object.getMatrixAt(hit.instanceId!, m);
      const normal = hit.face!.normal.clone().transformDirection(hit.object.matrixWorld);
      highlightPlane.position.setFromMatrixPosition(m).add(normal.multiplyScalar(0.505));
      highlightPlane.lookAt(highlightPlane.position.clone().add(normal));
      highlightPlane.visible = true;
    }
  } else { highlightPlane.visible = false; }

  renderer.render(scene, camera);
}

playerPivot.position.set(0, 20, 0);
animate();