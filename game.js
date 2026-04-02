import nipplejs from 'nipplejs';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const scoreEl = document.getElementById('score');
const finalScoreEl = document.getElementById('final-score');
const livesContainer = document.getElementById('lives-container');
const shootBtn = document.getElementById('shoot-btn');
const volumeBtn = document.getElementById('volume-btn');
const shieldBtn = document.getElementById('shield-btn');
const shieldFill = document.getElementById('shield-fill');

// Game state
let gameRunning = false;
let score = 0;
let lives = 5;
let lastTime = 0;
let nextEnemyTime = 0;
let nextCloudTime = 0;

// Shield state
let shieldActive = false;
let shieldTime = 0; // seconds remaining while active
const SHIELD_DURATION = 3.0; // seconds
let shieldCooldown = 0; // seconds remaining until can activate
const SHIELD_COOLDOWN = 5.0; // seconds

// Assets
const ASSETS = {
    player: '/enemy_plane.png',
    enemy: '/enemy_plane.png',
    cloud: 'cloud.png',
    catFace: '/cat_face.png',
    engine: 'engine.mp3',
    shoot: 'shoot.mp3',
    explosion: 'explosion.mp3',
    meow: 'meow.mp3'
};

const images = {};
const sounds = {};
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
// mute state
let muted = false;
// reflect saved preference if available
try {
    const saved = localStorage.getItem('gp_muted');
    if (saved !== null) muted = saved === '1';
} catch(e) {}

async function loadAssets() {
    const loadImg = (src) => new Promise((res) => {
        const img = new Image();
        img.src = src;
        img.onload = () => res(img);
    });

    const loadSound = async (src) => {
        const response = await fetch(src);
        const arrayBuffer = await response.arrayBuffer();
        return await audioCtx.decodeAudioData(arrayBuffer);
    };

    images.player = await loadImg(ASSETS.player);
    images.enemy = await loadImg(ASSETS.enemy);
    images.cloud = await loadImg(ASSETS.cloud);
    images.catFace = await loadImg(ASSETS.catFace);
    
    sounds.shoot = await loadSound(ASSETS.shoot);
    sounds.explosion = await loadSound(ASSETS.explosion);
    sounds.meow = await loadSound(ASSETS.meow);
    sounds.engine = await loadSound(ASSETS.engine);
}

function playSound(buffer, loop = false) {
    if (!audioCtx || !buffer) return;
    if (muted) return null;
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.loop = loop;
    source.start(0);
    return source;
}

// Player object
const player = {
    x: 100,
    y: 0,
    width: 110,
    height: 110,
    speed: 6,
    dx: 0,
    dy: 0,
    bullets: [],
    lastShot: 0,
    shootDelay: 250,
    angle: 0
};

let enemies = [];
let clouds = [];
let particles = [];
let counterMissiles = []; // new: counter missiles spawned by player's fire
let engineSoundSource = null;

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (!gameRunning) {
        player.y = canvas.height / 2 - player.height / 2;
    }
}

window.addEventListener('resize', resize);
resize();

// Mobile controls
let joystick = null;
function setupJoystick() {
    const options = {
        zone: document.getElementById('joystick-zone'),
        mode: 'static',
        position: { left: '60px', bottom: '60px' },
        color: 'white'
    };
    joystick = nipplejs.create(options);
    
    joystick.on('move', (evt, data) => {
        if (data.vector) {
            player.dx = data.vector.x * player.speed;
            player.dy = -data.vector.y * player.speed;
            player.angle = Math.atan2(-data.vector.y, data.vector.x) * 0.1;
        }
    });

    joystick.on('end', () => {
        player.dx = 0;
        player.dy = 0;
        player.angle = 0;
    });
}

// Shooting
function shoot() {
    const now = Date.now();
    if (now - player.lastShot > player.shootDelay) {
        // regular bullet
        player.bullets.push({
            x: player.x + player.width - 10,
            y: player.y + player.height / 2,
            speed: 10,
            radius: 4
        });

        // spawn a counter-missile that drops from above and homes on nearest enemy missile
        // position it roughly above the player with a tiny horizontal variance
        const spawnX = player.x + player.width / 2 + (Math.random() - 0.5) * 60;
        counterMissiles.push({
            x: spawnX,
            y: -30,
            speed: 6,
            turnSpeed: 0.08,
            target: null,
            life: 8 // seconds-ish, removed if out of bounds
        });

        player.lastShot = now;
        playSound(sounds.shoot);
    }
}

shootBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (gameRunning) shoot();
});

// Shield controls
function activateShield() {
    if (!gameRunning) return;
    if (shieldCooldown > 0 || shieldActive) return;
    shieldActive = true;
    shieldTime = SHIELD_DURATION;
    shieldCooldown = SHIELD_COOLDOWN;
    updateShieldUI();
    // small feedback sound (meow used)
    if (!muted) playSound(sounds.meow);
}
if (shieldBtn) {
    shieldBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        activateShield();
    });
    shieldBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        activateShield();
    }, {passive:false});
}

// Input for desktop
const keys = {};
window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Space') shoot();
    if (e.code === 'KeyE') activateShield();
});
window.addEventListener('keyup', (e) => keys[e.code] = false);

function handleKeyboard() {
    player.dx = 0;
    player.dy = 0;
    if (keys['ArrowUp'] || keys['KeyW']) player.dy = -player.speed;
    if (keys['ArrowDown'] || keys['KeyS']) player.dy = player.speed;
    if (keys['ArrowLeft'] || keys['KeyA']) player.dx = -player.speed;
    if (keys['ArrowRight'] || keys['KeyD']) player.dx = player.speed;
    
    if (player.dy !== 0) {
        player.angle = (player.dy > 0 ? 0.1 : -0.1);
    } else {
        player.angle = 0;
    }
}

function update(dt) {
    if (!gameRunning) return;

    // Update shield timers (dt in ms -> convert to seconds)
    const dts = dt * 0.001;
    if (shieldActive) {
        shieldTime -= dts;
        if (shieldTime <= 0) {
            shieldActive = false;
            shieldTime = 0;
        }
    } else {
        if (shieldCooldown > 0) {
            shieldCooldown -= dts;
            if (shieldCooldown < 0) shieldCooldown = 0;
        }
    }
    updateShieldUI();

    // Increase score over time for survival (dt is milliseconds)
    score += Math.floor(dt * 0.01);
    scoreEl.innerText = `Score: ${score}`;

    handleKeyboard();

    // Move player
    player.x += player.dx;
    player.y += player.dy;

    // Constrain player
    player.x = Math.max(0, Math.min(canvas.width - player.width, player.x));
    player.y = Math.max(0, Math.min(canvas.height - player.height, player.y));

    // Update bullets
    player.bullets.forEach((b, i) => {
        b.x += b.speed;
        if (b.x > canvas.width) player.bullets.splice(i, 1);
    });

    // Spawn clouds
    if (Date.now() > nextCloudTime) {
        clouds.push({
            x: canvas.width,
            y: Math.random() * canvas.height,
            speed: 1 + Math.random() * 2,
            scale: 0.5 + Math.random() * 1.5,
            opacity: 0.3 + Math.random() * 0.5
        });
        nextCloudTime = Date.now() + 1000 + Math.random() * 2000;
    }

    // Update clouds
    clouds.forEach((c, i) => {
        c.x -= c.speed;
        if (c.x < -200) clouds.splice(i, 1);
    });

    // Spawn enemies: either a homing missile or a blue enemy plane that drops missiles
    if (Date.now() > nextEnemyTime) {
        if (Math.random() < 0.45) {
            // spawn a blue plane that flies left and occasionally launches missiles
            enemies.push({
                x: canvas.width + 120,
                y: 40 + Math.random() * (canvas.height - 120),
                width: 90,
                height: 40,
                speed: 1.5 + Math.random() * 1.2,
                type: 'plane',
                fireCooldown: 1000 + Math.random() * 2000, // ms until next missile
                lastFire: Date.now()
            });
            nextEnemyTime = Date.now() + 800 + Math.random() * 1200;
        } else {
            // missiles are slimmer, faster, and steer slightly toward the player
            enemies.push({
                x: canvas.width + 50,
                y: Math.random() * (canvas.height - 40),
                width: 40,
                height: 14,
                speed: 4 + Math.random() * 3,
                turnSpeed: 0.02 + Math.random() * 0.03,
                angle: 0,
                isMissile: true
            });
            nextEnemyTime = Date.now() + Math.max(400, 1200 - (score * 10));
        }
    }

    // Update enemies (missiles and planes) and collisions
    enemies.forEach((e, ei) => {
        if (e.isMissile) {
            // homing missile behavior
            const targetX = player.x + player.width / 2;
            const targetY = player.y + player.height / 2;
            const dx = targetX - (e.x + e.width / 2);
            const dy = targetY - (e.y + e.height / 2);
            const desired = Math.atan2(dy, dx);
            let diff = desired - e.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            e.angle += diff * e.turnSpeed;
            e.x += Math.cos(e.angle) * e.speed;
            e.y += Math.sin(e.angle) * e.speed;
        } else if (e.type === 'plane') {
            // plane flies left and periodically fires homing missiles
            e.x -= e.speed;
            // fire logic
            if (Date.now() - e.lastFire > e.fireCooldown) {
                e.lastFire = Date.now();
                // spawn a missile from plane position aimed roughly at player
                const mx = e.x;
                const my = e.y + e.height / 2;
                enemies.push({
                    x: mx - 10,
                    y: my,
                    width: 40,
                    height: 14,
                    speed: 4 + Math.random() * 2,
                    turnSpeed: 0.02 + Math.random() * 0.03,
                    angle: Math.atan2((player.y + player.height/2) - my, (player.x + player.width/2) - mx),
                    isMissile: true
                });
                // small score or sound feedback for enemy firing (optional)
            }
        } else {
            // fallback: move left
            e.x -= e.speed || 2;
        }

        // Check collision with shield first
        if (shieldActive) {
            const px = player.x + player.width / 2;
            const py = player.y + player.height / 2;
            const sx = e.x + e.width / 2;
            const sy = e.y + e.height / 2;
            const dist = Math.hypot(px - sx, py - sy);
            const shieldRadius = Math.max(player.width, player.height) * 0.75;
            if (dist < shieldRadius) {
                enemies.splice(ei, 1);
                createExplosion(sx, sy);
                playSound(sounds.explosion);
                score += 50;
                return;
            }
        }

        // Player collision (if not shielded)
        if (player.x < e.x + e.width && player.x + player.width > e.x &&
            player.y < e.y + e.height && player.y + player.height > e.y) {
            enemies.splice(ei, 1);
            createExplosion(player.x + player.width/2, player.y + player.height/2);
            if (!shieldActive) {
                lives--;
                updateLivesUI();
                playSound(sounds.explosion);
                if (lives <= 0) endGame();
            } else {
                playSound(sounds.explosion);
                score += 30;
            }
        }

        // remove off-screen
        if (e.x < -300 || e.x > canvas.width + 300 || e.y < -200 || e.y > canvas.height + 200) enemies.splice(ei, 1);
    });

    // Update counter-missiles: home on nearest enemy missile
    counterMissiles.forEach((cm, cmi) => {
        cm.life -= dt * 0.001;
        // find nearest enemy missile
        let nearest = null;
        let nearestDist = 1e9;
        enemies.forEach(en => {
            if (!en.isMissile) return;
            const dx = (en.x + en.width/2) - cm.x;
            const dy = (en.y + en.height/2) - cm.y;
            const d = Math.hypot(dx, dy);
            if (d < nearestDist) {
                nearestDist = d;
                nearest = en;
            }
        });

        if (nearest) {
            // steer toward target
            const desired = Math.atan2((nearest.y + nearest.height/2) - cm.y, (nearest.x + nearest.width/2) - cm.x);
            // compute simple angle move by treating velocity as vector
            const vx = Math.cos(desired) * cm.speed;
            const vy = Math.sin(desired) * cm.speed;
            cm.x += vx;
            cm.y += vy;

            // collision with the targeted missile
            if (cm.x > nearest.x && cm.x < nearest.x + nearest.width && cm.y > nearest.y && cm.y < nearest.y + nearest.height) {
                // destroy enemy missile
                const idx = enemies.indexOf(nearest);
                if (idx !== -1) enemies.splice(idx, 1);
                // explosion
                createExplosion(cm.x, cm.y);
                playSound(sounds.explosion);
                // remove counter missile
                counterMissiles.splice(cmi, 1);
            }
        } else {
            // no target, fall down straight
            cm.y += cm.speed;
        }

        // remove if out of bounds or life ended
        if (cm.y > canvas.height + 200 || cm.x < -200 || cm.x > canvas.width + 200 || cm.life <= 0) {
            counterMissiles.splice(cmi, 1);
        }
    });

    // Particles
    particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;
        if (p.life <= 0) particles.splice(i, 1);
    });
}

function createExplosion(x, y) {
    for (let i = 0; i < 15; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10,
            life: 1,
            color: Math.random() > 0.5 ? '#ff9800' : '#333'
        });
    }
}

function updateLivesUI() {
    livesContainer.innerHTML = '';
    for (let i = 0; i < lives; i++) {
        const heart = document.createElement('span');
        heart.className = 'heart';
        heart.innerHTML = '❤';
        livesContainer.appendChild(heart);
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw clouds (background)
    clouds.forEach(c => {
        ctx.globalAlpha = c.opacity;
        ctx.drawImage(images.cloud, c.x, c.y, 200 * c.scale, 100 * c.scale);
    });
    ctx.globalAlpha = 1.0;

    // Draw particles
    particles.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    // Draw bullets
    ctx.fillStyle = '#ffff00';
    player.bullets.forEach(b => {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw player
    ctx.save();
    ctx.translate(player.x + player.width / 2, player.y + player.height / 2);
    ctx.rotate(player.angle);
    
    // Draw the captain with a slight rounded clip for a better look
    const r = 15;
    const w = player.width;
    const h = player.height;
    ctx.beginPath();
    ctx.moveTo(-w/2 + r, -h/2);
    ctx.lineTo(w/2 - r, -h/2);
    ctx.quadraticCurveTo(w/2, -h/2, w/2, -h/2 + r);
    ctx.lineTo(w/2, h/2 - r);
    ctx.quadraticCurveTo(w/2, h/2, w/2 - r, h/2);
    ctx.lineTo(-w/2 + r, h/2);
    ctx.quadraticCurveTo(-w/2, h/2, -w/2, h/2 - r);
    ctx.lineTo(-w/2, -h/2 + r);
    ctx.quadraticCurveTo(-w/2, -h/2, -w/2 + r, -h/2);
    ctx.closePath();
    ctx.clip();

    ctx.drawImage(images.player, -player.width / 2, -player.height / 2, player.width, player.height);

    // Draw cat pilot face on the cockpit (keeps same rotation/transform)
    if (images.catFace) {
        const faceW = player.width * 0.5;
        const faceH = player.height * 0.5;
        // position slightly forward and centered vertically on the plane image
        const faceX = -player.width * 0.1 - faceW / 2;
        const faceY = -faceH / 2;
        ctx.drawImage(images.catFace, faceX, faceY, faceW, faceH);
    }

    ctx.restore();

    // If shield active, draw a glowing circle around player
    if (shieldActive) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = '#66ffff';
        ctx.lineWidth = 10;
        const cx = player.x + player.width / 2;
        const cy = player.y + player.height / 2;
        const rad = Math.max(player.width, player.height) * 0.75;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    // Draw enemies (missiles)
    enemies.forEach(e => {
        if (e.isMissile) {
            // compute angle for drawing
            ctx.save();
            const cx = e.x + e.width / 2;
            const cy = e.y + e.height / 2;
            ctx.translate(cx, cy);
            ctx.rotate(e.angle);
            // missile body
            ctx.fillStyle = '#8b8b8b';
            ctx.fillRect(-e.width/2, -e.height/2, e.width, e.height);
            // nose cone
            ctx.beginPath();
            ctx.moveTo(e.width/2, 0);
            ctx.lineTo(e.width/2 + e.height, -e.height);
            ctx.lineTo(e.width/2 + e.height, e.height);
            ctx.closePath();
            ctx.fillStyle = '#b33';
            ctx.fill();
            // fins
            ctx.fillStyle = '#444';
            ctx.beginPath();
            ctx.moveTo(-e.width/2 + 2, e.height/2);
            ctx.lineTo(-e.width/2 - (e.height), e.height/2 + (e.height/1.5));
            ctx.lineTo(-e.width/2 + 8, e.height/2);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(-e.width/2 + 2, -e.height/2);
            ctx.lineTo(-e.width/2 - (e.height), -e.height/2 - (e.height/1.5));
            ctx.lineTo(-e.width/2 + 8, -e.height/2);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        } else {
            ctx.drawImage(images.enemy, e.x, e.y, e.width, e.height);
        }
    });

    // Draw counter-missiles
    counterMissiles.forEach(cm => {
        ctx.save();
        ctx.translate(cm.x, cm.y);
        // draw small downward-facing red missile / rocket
        ctx.fillStyle = '#e33';
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(6, 6);
        ctx.lineTo(-6, 6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#333';
        ctx.fillRect(-3, 6, 6, 8); // tail
        ctx.restore();
    });
}

function loop(timestamp) {
    const dt = timestamp - lastTime;
    lastTime = timestamp;
    
    update(dt);
    draw();
    requestAnimationFrame(loop);
}

function startGame() {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    
    score = 0;
    lives = 5;
    enemies = [];
    player.bullets = [];
    clouds = [];
    counterMissiles = [];
    scoreEl.innerText = `Score: 0`;
    updateLivesUI();
    
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    gameRunning = true;
    
    if (!muted) playSound(sounds.meow);
    if (engineSoundSource) engineSoundSource.stop();
    engineSoundSource = playSound(sounds.engine, true);
}

function endGame() {
    gameRunning = false;
    gameOverScreen.classList.remove('hidden');
    finalScoreEl.innerText = `Puntaje Final: ${score}`;
    if (engineSoundSource) {
        engineSoundSource.stop();
        engineSoundSource = null;
    }
}

function updateVolumeButton() {
    if (!volumeBtn) return;
    volumeBtn.textContent = muted ? '🔇' : '🔊';
}

function toggleMute() {
    muted = !muted;
    try { localStorage.setItem('gp_muted', muted ? '1' : '0'); } catch(e){}
    // stop engine if muting
    if (muted && engineSoundSource) {
        try { engineSoundSource.stop(); } catch(e){}
        engineSoundSource = null;
    }
    // if unmuting and game running, restart engine loop
    if (!muted && gameRunning && sounds.engine) {
        engineSoundSource = playSound(sounds.engine, true);
    }
    updateVolumeButton();
}

if (volumeBtn) {
    volumeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        toggleMute();
    });
}

function updateShieldUI() {
    if (!shieldFill) return;
    // show fill as fraction of cooldown when not active, or as remaining duration when active
    if (shieldActive) {
        const pct = Math.max(0, Math.min(1, shieldTime / SHIELD_DURATION));
        shieldFill.style.width = `${Math.floor(pct * 100)}%`;
        shieldFill.style.background = 'linear-gradient(90deg,#4ee,#08f)';
        shieldBtn.style.opacity = '0.9';
    } else {
        // show cooldown progress (empty when cooling, full when ready)
        const pct = shieldCooldown > 0 ? Math.max(0, Math.min(1, 1 - shieldCooldown / SHIELD_COOLDOWN)) : 1;
        shieldFill.style.width = `${Math.floor(pct * 100)}%`;
        shieldFill.style.background = shieldCooldown > 0 ? 'linear-gradient(90deg,#888,#444)' : 'linear-gradient(90deg,#4efc9a,#08f)';
        shieldBtn.style.opacity = shieldCooldown > 0 ? '0.6' : '1';
    }
}

loadAssets().then(() => {
    setupJoystick();
    updateLivesUI();
    updateVolumeButton();
    updateShieldUI();
    requestAnimationFrame(loop);
});

startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);