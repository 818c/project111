import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
const ENEMY_HP = 100;
const ENEMY_RESPAWN = 2500; // мс
const ENEMY_COUNT = 5;
let enemies = [];

// --- Three.js базова 3D-сцена ---
let scene, camera, renderer;
let player, playerVelocity = new THREE.Vector3(), canJump = false;
let obstacles = [];
let playerModel = null;

const loader = new GLTFLoader();
const models = {
    tree: null,
    rock: null,
    fence: null,
    enemy: null
};

const clock = new THREE.Clock();

function loadPlayerModel() {
    return new Promise((resolve, reject) => {
        loader.load(
            './models/character/character.glb',
            (gltf) => {
                console.log('Model loaded successfully:', gltf);
                playerModel = gltf.scene;
                
                // Логуємо структуру моделі
                console.log('Model children:', playerModel.children);
                
                // Встановлюємо розмір і позицію
                playerModel.scale.set(15, 15, 15); // Збільшуємо в 3 рази
                playerModel.position.y = 0; // Фіксуємо позицію по Y
                
                // Перевіряємо наявність mesh
                playerModel.traverse((child) => {
                    if (child.isMesh) {
                        console.log('Found mesh:', child);
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });
                
                resolve();
            },
            (xhr) => {
                console.log((xhr.loaded / xhr.total * 100) + '% loaded');
            },
            (error) => {
                console.error('Error loading model:', error);
                reject(error);
            }
        );
    });
}

function loadPistolModel() {
    return new Promise((resolve, reject) => {
        loader.load(
            './models/weapons/pistol.glb',
            (gltf) => {
                const pistolModel = gltf.scene;
                
                // Логуємо структуру моделі для аналізу
                console.log('Pistol model structure:', gltf);
                
                // Проходимо по всіх мешах моделі
                pistolModel.traverse((child) => {
                    if (child.isMesh) {
                        console.log('Found mesh:', child.name);
                        // Налаштовуємо меш
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });
                
                // Збільшуємо розмір
                pistolModel.scale.set(4.5, 4.5, 4.5);
                
                // Спроба 1: встановлюємо позицію ближче
                pistolModel.position.set(-0.5, 0, 0.2);
                
                // Спроба 2: якщо є батьківський об'єкт, налаштовуємо його
                if (pistolModel.parent) {
                    pistolModel.parent.position.set(0, 0, 0);
                }
                
                // Повертаємо на 180 градусів
                pistolModel.rotation.y = Math.PI;
                
                // Додаємо допоміжну геометрію для візуалізації позиції
                const helper = new THREE.BoxHelper(pistolModel, 0xff0000);
                pistolModel.add(helper);
                
                resolve(pistolModel);
            },
            (xhr) => {
                console.log('Pistol: ' + (xhr.loaded / xhr.total * 100) + '% loaded');
            },
            reject
        );
    });
}

function loadEnemyModel() {
    return new Promise((resolve, reject) => {
        loader.load(
            './models/character/cappuccino_ballerina.glb',
            (gltf) => {
                const enemyModel = gltf.scene;
                // Встановлюємо такий самий розмір, як у героя
                enemyModel.scale.set(15, 15, 15);
                
                // Перевіряємо наявність анімацій
                if (gltf.animations && gltf.animations.length > 0) {
                    console.log('Enemy animations:', gltf.animations);
                    const mixer = new THREE.AnimationMixer(enemyModel);
                    const action = mixer.clipAction(gltf.animations[0]);
                    // Сповільнюємо анімацію вдвічі
                    action.timeScale = 0.5;
                    action.play();
                    enemyModel.mixer = mixer;
                }
                
                resolve(enemyModel);
            },
            (xhr) => {
                console.log('Enemy: ' + (xhr.loaded / xhr.total * 100) + '% loaded');
            },
            reject
        );
    });
}

function loadModels() {
    return new Promise((resolve, reject) => {
        const loadingManager = new THREE.LoadingManager();
        loadingManager.onLoad = () => resolve();
        
        // Завантажуємо дерево
        loader.load(
            './models/environment/tree.glb',
            (gltf) => {
                models.tree = gltf.scene;
                models.tree.scale.set(5, 5, 5);
            },
            undefined,
            reject
        );

        // Завантажуємо камінь
        loader.load(
            './models/environment/rock.glb',
            (gltf) => {
                models.rock = gltf.scene;
                models.rock.scale.set(3, 3, 3);
            },
            undefined,
            reject
        );

        // Завантажуємо паркан
        loader.load(
            './models/environment/fence.glb',
            (gltf) => {
                models.fence = gltf.scene;
                models.fence.scale.set(4, 4, 4);
            },
            undefined,
            reject
        );

        // Завантажуємо модель ворога
        loader.load(
            './models/character/cappuccino_ballerina.glb',
            (gltf) => {
                models.enemy = gltf.scene;
                models.enemy.scale.set(4, 4, 4); // Масштаб можна буде налаштувати
            },
            undefined,
            reject
        );
    });
}

function placeEnvironmentObjects() {
    // Розставляємо дерева
    for (let i = 0; i < 20; i++) {
        if (models.tree) {
            const tree = models.tree.clone();
            const x = (Math.random() - 0.5) * MAP_SIZE.x;
            const z = (Math.random() - 0.5) * MAP_SIZE.z;
            tree.position.set(x, 0, z);
            tree.rotation.y = Math.random() * Math.PI * 2;
            scene.add(tree);
        }
    }

    // Розставляємо каміння
    for (let i = 0; i < 15; i++) {
        if (models.rock) {
            const rock = models.rock.clone();
            const x = (Math.random() - 0.5) * MAP_SIZE.x;
            const z = (Math.random() - 0.5) * MAP_SIZE.z;
            rock.position.set(x, 0, z);
            rock.rotation.y = Math.random() * Math.PI * 2;
            scene.add(rock);
        }
    }

    // Створюємо огорожу по периметру
    if (models.fence) {
        const fenceSegments = 40;
        const segmentLength = MAP_SIZE.x / fenceSegments;
        
        for (let i = 0; i < fenceSegments; i++) {
            // Північна сторона
            const fenceN = models.fence.clone();
            fenceN.position.set(-MAP_SIZE.x/2 + i*segmentLength, 0, -MAP_SIZE.z/2);
            scene.add(fenceN);
            
            // Південна сторона
            const fenceS = models.fence.clone();
            fenceS.position.set(-MAP_SIZE.x/2 + i*segmentLength, 0, MAP_SIZE.z/2);
            fenceS.rotation.y = Math.PI;
            scene.add(fenceS);
        }
    }
}

async function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb4e7b0);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 2000);
    camera.position.set(0, 35, -60);
    camera.lookAt(0, 10, 0);

    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(50, 100, -50);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    // Створюємо градієнтну текстуру для підлоги
    const groundCanvas = document.createElement('canvas');
    groundCanvas.width = 512;
    groundCanvas.height = 512;
    const ctx = groundCanvas.getContext('2d');
    
    // Створюємо градієнт
    const gradient = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
    gradient.addColorStop(0, '#4a934a');   // Світло-зелений в центрі
    gradient.addColorStop(1, '#2d5a2d');   // Темно-зелений по краях
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
    
    const groundTexture = new THREE.CanvasTexture(groundCanvas);
    groundTexture.wrapS = THREE.RepeatWrapping;
    groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.repeat.set(100, 100);
    
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(MAP_SIZE.x, MAP_SIZE.z),
        new THREE.MeshLambertMaterial({ 
            map: groundTexture,
            side: THREE.DoubleSide 
        })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Гравець
    try {
        await loadPlayerModel();
        player = playerModel;  // Використовуємо завантажену модель
        let pos = getFreePlayerSpawn();
        player.position.set(pos.x, 11, pos.z);
        scene.add(player);

        // Завантажуємо і додаємо пістолет
        try {
            const pistol = await loadPistolModel();
            // Створюємо порожній контейнер для пістолета
            const weaponContainer = new THREE.Object3D();
            weaponContainer.position.set(-0.5, 0, 0.2);
            weaponContainer.add(pistol);
            player.add(weaponContainer);
            player.weapon = pistol; // Зберігаємо посилання на зброю
        } catch (error) {
            console.error('Error loading pistol model:', error);
            // Якщо модель не завантажилась, використовуємо простий куб
            const akGeo = new THREE.BoxGeometry(1, 1, 8);
            const akMat = new THREE.MeshLambertMaterial({color: 0x111111});
            const ak = new THREE.Mesh(akGeo, akMat);
            ak.position.set(3, 0, 2);
            player.add(ak);
            player.weapon = ak;
        }
    } catch (error) {
        console.error('Error loading player model:', error);
        // Якщо модель не завантажилась, використовуємо простий куб
        const playerGeo = new THREE.BoxGeometry(12, 22, 12);
        const playerMat = new THREE.MeshLambertMaterial({color: 0x00ff00});
        player = new THREE.Mesh(playerGeo, playerMat);
        let pos = getFreePlayerSpawn();
        player.position.set(pos.x, 11, pos.z);
        scene.add(player);
    }

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

    try {
        await loadModels();
        placeEnvironmentObjects();
    } catch (error) {
        console.error('Error loading models:', error);
    }
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

    // --- Логічний рух відносно камери ---
    let forward = new THREE.Vector3(0, 0, 1);
    let right = new THREE.Vector3(-1, 0, 0);  // Змінили з (1, 0, 0) на (-1, 0, 0)
    forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    right.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    
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
    updateEnemies();

    // --- Оновлення куль ---
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        bullet.mesh.position.addScaledVector(bullet.dir, 16);
        bullet.lifetime -= 16;
        // Перевірка зіткнень з ворогами
        for (const enemy of enemies) {
            if (!enemy.isEnemy) continue;
            if (bullet.mesh.position.distanceTo(enemy.position) < 10) {
                enemy.hp--;
                if (enemy.hp <= 0) {
                    scene.remove(enemy);
                    enemies.splice(enemies.indexOf(enemy), 1);
                }
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
async function spawnEnemy() {
    try {
        const enemyModel = await loadEnemyModel();
        const enemy = enemyModel.clone();
        
        const spawnPos = getFreeEnemySpawn();
        enemy.position.set(spawnPos.x, 11, spawnPos.z);
        
        enemy.isEnemy = true;
        enemy.hp = ENEMY_HP;
        enemy.speed = 0.35; // Зменшуємо швидкість вдвічі (було 0.7)
        
        scene.add(enemy);
        enemies.push(enemy);
        
    } catch (error) {
        console.error('Error spawning enemy:', error);
        // Fallback до червоного куба
        const enemy = new THREE.Mesh(
            new THREE.BoxGeometry(8, 20, 8),
            new THREE.MeshLambertMaterial({color: 0xff0000})
        );
        const spawnPos = getFreeEnemySpawn();
        enemy.position.set(spawnPos.x, 11, spawnPos.z);
        enemy.isEnemy = true;
        enemy.hp = ENEMY_HP;
        enemy.speed = 0.35; // Тут також зменшуємо швидкість
        scene.add(enemy);
        enemies.push(enemy);
    }
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

function updateEnemies() {
    const delta = clock.getDelta();
    
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        if (enemy.hp <= 0) {
            scene.remove(enemy);
            enemies.splice(i, 1);
            continue;
        }

        // Оновлюємо анімацію
        if (enemy.mixer) {
            enemy.mixer.update(delta);
        }

        // Рух до гравця
        const dir = new THREE.Vector3();
        dir.subVectors(player.position, enemy.position).normalize();
        
        // Плавний поворот до гравця
        const targetRotation = Math.atan2(dir.x, dir.z);
        const currentRotation = enemy.rotation.y;
        const rotationDiff = targetRotation - currentRotation;
        
        // Нормалізуємо різницю кутів
        const normalizedDiff = Math.atan2(Math.sin(rotationDiff), Math.cos(rotationDiff));
        enemy.rotation.y += normalizedDiff * 0.1; // Плавний поворот
        
        // Рух вперед
        enemy.position.x += dir.x * enemy.speed;
        enemy.position.z += dir.z * enemy.speed;
    }
}

// --- Стрільба ---
function shoot() {
    if (!canShoot || isReloading || ammo <= 0) return;
    ammo--;
    canShoot = false;
    setTimeout(() => { canShoot = true; }, 120);
    
    // Отримуємо позицію дула пістолета
    const gunWorldPos = new THREE.Vector3();
    player.weapon.getWorldPosition(gunWorldPos);
    
    // Додаємо невеликий зсув, щоб кулі вилітали з дула
    const offset = new THREE.Vector3(
        Math.sin(yaw) * 2,  // Зсув вперед
        0,                  // Висота залишається такою ж
        Math.cos(yaw) * 2   // Зсув вбік
    );
    gunWorldPos.add(offset);
    
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

init();
animate();
