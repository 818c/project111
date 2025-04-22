// --- Керування: оголошуємо змінні на самому початку ---
const keys = {};
let pointerLocked = false;
let yaw = 0; // Кут огляду (радіани)
let uiAmmo, uiReload; // --- UI ---
let bullets = []; // --- Bullet system ---

// --- Фізика та константи ---
const GRAVITY = -0.9;
const MOVE_SPEED = 2.5;
const JUMP_POWER = 12;
const MAP_SIZE = { x: 1400, z: 1000 };

// --- Зброя ---
const MAGAZINE_SIZE = 30;
let ammo = MAGAZINE_SIZE;
let isReloading = false;
let canShoot = true;

// --- Вороги ---
const ENEMY_HP = 3;
const ENEMY_RESPAWN = 2500; // мс
const ENEMY_COUNT = 5;
let enemies = [];

// --- Three.js базова 3D-сцена ---
let scene, camera, renderer;
let player, playerVelocity = new THREE.Vector3(), canJump = false;
let obstacles = [];

init();
animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb4e7b0);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 2000);
    camera.position.set(0, 35, -60);
    camera.lookAt(0, 10, 0);

    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(50, 100, -50);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    // Поле
    const fieldGeo = new THREE.PlaneGeometry(MAP_SIZE.x, MAP_SIZE.z);
    const fieldMat = new THREE.MeshLambertMaterial({color: 0xb4e7b0});
    const field = new THREE.Mesh(fieldGeo, fieldMat);
    field.rotation.x = -Math.PI/2;
    field.position.y = 0;
    scene.add(field);

    // Персонаж (куб) — спавн у вільній точці
    let spawnPos = getFreePlayerSpawn();
    const playerGeo = new THREE.BoxGeometry(10, 20, 10);
    const playerMat = new THREE.MeshLambertMaterial({color: 0x444444});
    player = new THREE.Mesh(playerGeo, playerMat);
    player.position.set(spawnPos.x, 10, spawnPos.z);
    scene.add(player);

    // АК-47 (простий box у руках)
    const akGeo = new THREE.BoxGeometry(13, 2.5, 2.5);
    const akMat = new THREE.MeshLambertMaterial({color: 0x222200});
    player.ak = new THREE.Mesh(akGeo, akMat);
    player.ak.position.set(0, 3, 8); // трохи вище центру, попереду
    player.ak.castShadow = true;
    player.add(player.ak);

    // Перешкоди (рандомно + кілька великих)
    addObstacle(0, 10, 0, 40, 20, 300);
    addObstacle(350, 10, 200, 100, 20, 40);
    addObstacle(-400, 10, -200, 60, 20, 100);
    addObstacle(600, 10, 400, 80, 20, 80);
    addObstacle(-600, 10, 300, 60, 20, 60);
    for (let i = 0; i < 8; i++) {
        addObstacle(
            Math.random()*MAP_SIZE.x-MAP_SIZE.x/2,
            10,
            Math.random()*MAP_SIZE.z-MAP_SIZE.z/2,
            30+Math.random()*50, 20, 30+Math.random()*50
        );
    }

    renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    renderer.domElement.addEventListener('click', () => {
        renderer.domElement.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
        pointerLocked = document.pointerLockElement === renderer.domElement;
    });

    window.addEventListener('resize', onWindowResize);

    // --- Вороги ---
    for (let i = 0; i < ENEMY_COUNT; i++) {
        spawnEnemy();
    }

    // --- UI ---
    createUI();
}

function getFreePlayerSpawn() {
    // Пошук вільної точки для гравця (не в перешкоді)
    let x, z, safe = false;
    for (let attempt = 0; attempt < 100 && !safe; attempt++) {
        x = Math.random()*MAP_SIZE.x - MAP_SIZE.x/2;
        z = Math.random()*MAP_SIZE.z - MAP_SIZE.z/2;
        safe = true;
        for (const obs of obstacles) {
            const dx = Math.abs(x - obs.position.x);
            const dz = Math.abs(z - obs.position.z);
            if (dx < obs.geometry.parameters.width/2 + 12 && dz < obs.geometry.parameters.depth/2 + 12) {
                safe = false;
                break;
            }
        }
    }
    return {x, z};
}

function addObstacle(x, y, z, w, h, d) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshLambertMaterial({color: 0x8b5e3c});
    const box = new THREE.Mesh(geo, mat);
    box.position.set(x, y, z);
    scene.add(box);
    obstacles.push(box);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

document.addEventListener('keydown', e => {
    keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === 'r') reload();
});
document.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
document.addEventListener('mousemove', e => {
    if (pointerLocked) {
        yaw -= e.movementX * 0.01;
    }
});
document.addEventListener('mousedown', e => {
    if (pointerLocked && e.button === 0) shoot();
});

function animate() {
    requestAnimationFrame(animate);

    player.rotation.y = yaw;

    // --- Логічний рух по локальній осі персонажа ---
    let forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    let right = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    let moveDir = new THREE.Vector3();
    if (keys['w']) moveDir.add(forward);
    if (keys['s']) moveDir.sub(forward);
    if (keys['d']) moveDir.add(right);
    if (keys['a']) moveDir.sub(right);
    if (moveDir.length() > 0) {
        moveDir.normalize();
        let nextPos = player.position.clone().addScaledVector(moveDir, MOVE_SPEED);
        if (!checkObstacleCollision(nextPos)) {
            player.position.copy(nextPos);
        }
    }

    playerVelocity.y += GRAVITY;
    player.position.y += playerVelocity.y * 0.5;
    if (player.position.y <= 10) {
        player.position.y = 10;
        playerVelocity.y = 0;
        canJump = true;
    }
    if (keys[' '] && canJump) {
        playerVelocity.y = JUMP_POWER;
        canJump = false;
    }

    // Камера слідує за гравцем (third person)
    const camOffset = new THREE.Vector3(0, 30, -60).applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
    camera.position.copy(player.position).add(camOffset);
    camera.lookAt(player.position.x, player.position.y + 5, player.position.z);

    // --- Оновлення ворогів ---
    for (const enemy of enemies) {
        if (enemy.active) {
            enemy.mesh.visible = true;
            // Зомбі-рух до гравця
            let toPlayer = player.position.clone().sub(enemy.mesh.position);
            toPlayer.y = 0;
            if (toPlayer.length() > 2) {
                toPlayer.normalize();
                let next = enemy.mesh.position.clone().addScaledVector(toPlayer, 0.7);
                if (!checkObstacleCollision(next)) {
                    enemy.mesh.position.copy(next);
                }
            }
        } else {
            enemy.mesh.visible = false;
        }
    }

    // --- Оновлення куль ---
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        bullet.mesh.position.addScaledVector(bullet.dir, 16);
        bullet.lifetime -= 16;
        // Перевірка зіткнень з ворогами
        for (const enemy of enemies) {
            if (!enemy.active) continue;
            if (bullet.mesh.position.distanceTo(enemy.mesh.position) < 10) {
                enemy.hp--;
                if (enemy.hp <= 0) respawnEnemy(enemy);
                scene.remove(bullet.mesh);
                bullets.splice(i, 1);
                break;
            }
        }
        // Якщо куля вилетіла за межі карти або час життя вичерпано
        if (bullet.lifetime <= 0 ||
            Math.abs(bullet.mesh.position.x) > MAP_SIZE.x/2+50 ||
            Math.abs(bullet.mesh.position.z) > MAP_SIZE.z/2+50) {
            scene.remove(bullet.mesh);
            bullets.splice(i, 1);
        }
    }

    renderer.render(scene, camera);
    updateUI();
}

// --- Вороги ---
function spawnEnemy() {
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(12, 22, 12),
        new THREE.MeshLambertMaterial({color: 0xff3333})
    );
    let pos = getFreeEnemySpawn();
    mesh.position.set(pos.x, 11, pos.z);
    scene.add(mesh);
    enemies.push({ mesh, hp: ENEMY_HP, active: true, respawnTimer: 0 });
}

function getFreeEnemySpawn() {
    // Спавн у межах карти, не надто близько до гравця
    let x, z;
    do {
        x = Math.random()*MAP_SIZE.x - MAP_SIZE.x/2;
        z = Math.random()*MAP_SIZE.z - MAP_SIZE.z/2;
    } while (player && player.position.distanceTo(new THREE.Vector3(x, 10, z)) < 150);
    return {x, z};
}

function respawnEnemy(enemy) {
    enemy.active = false;
    setTimeout(() => {
        let pos = getFreeEnemySpawn();
        enemy.mesh.position.set(pos.x, 11, pos.z);
        enemy.hp = ENEMY_HP;
        enemy.active = true;
    }, ENEMY_RESPAWN);
}

// --- Стрільба ---
function shoot() {
    if (!canShoot || isReloading || ammo <= 0) return;
    ammo--;
    canShoot = false;
    setTimeout(() => { canShoot = true; }, 120);
    // Куля вилітає з дула АК-47
    const gunWorldPos = new THREE.Vector3();
    player.ak.getWorldPosition(gunWorldPos);
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const bulletGeo = new THREE.SphereGeometry(1.2, 8, 8);
    const bulletMat = new THREE.MeshLambertMaterial({color: 0xf9e79f});
    const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat);
    bulletMesh.position.copy(gunWorldPos);
    scene.add(bulletMesh);
    bullets.push({mesh: bulletMesh, dir: dir.clone(), lifetime: 1100});
}

function reload() {
    if (ammo === MAGAZINE_SIZE || isReloading) return;
    isReloading = true;
    setTimeout(() => {
        ammo = MAGAZINE_SIZE;
        isReloading = false;
    }, 1200);
}

// --- Колізія з перешкодами ---
function checkObstacleCollision(pos) {
    for (const obs of obstacles) {
        const dx = Math.abs(pos.x - obs.position.x);
        const dz = Math.abs(pos.z - obs.position.z);
        if (dx < obs.geometry.parameters.width/2 + 6 && dz < obs.geometry.parameters.depth/2 + 6) {
            return true;
        }
    }
    return false;
}

// --- UI ---
function createUI() {
    uiAmmo = document.createElement('div');
    uiAmmo.style.position = 'fixed';
    uiAmmo.style.right = '30px';
    uiAmmo.style.bottom = '30px';
    uiAmmo.style.fontSize = '2em';
    uiAmmo.style.color = '#fff';
    uiAmmo.style.fontFamily = 'monospace';
    uiAmmo.style.textShadow = '1px 1px 4px #000';
    document.body.appendChild(uiAmmo);
    uiReload = document.createElement('div');
    uiReload.style.position = 'fixed';
    uiReload.style.right = '30px';
    uiReload.style.bottom = '70px';
    uiReload.style.fontSize = '1.2em';
    uiReload.style.color = '#ff0';
    uiReload.style.fontFamily = 'monospace';
    uiReload.style.textShadow = '1px 1px 4px #000';
    document.body.appendChild(uiReload);
}
function updateUI() {
    uiAmmo.innerText = `АК-47: ${ammo}/${MAGAZINE_SIZE}`;
    uiReload.innerText = isReloading ? 'Перезарядка...' : '';
}
