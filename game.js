// Initialize Kaplay
kaplay({
    background: [0, 0, 0],
    debug: true,
});

setCursor("none");

// --- CONSTANTS ---
const MOVE_SPEED = 180;
const SPRINT_SPEED = 340;
const SNEAK_SPEED = 120; // New Sneak Speed
const DASH_SPEED = 1200;
const DASH_TIME = 0.15;

const NEON_WHITE = rgb(240, 255, 255);
const NEON_BLUE = rgb(0, 255, 255);
const NEON_RED = rgb(255, 50, 50);
const NEON_YELLOW = rgb(255, 255, 100);

// Combat Constants
const ATTACK_COST = 10;
const PARRY_COST = 20;
const PARRY_WINDOW = 0.2;
const STUN_DURATION = 2.0;
const IMPACT_FREEZE = 0.05;

// Level
const TILE = 80;
const NEON_GREEN = rgb(0, 255, 100);
const LEVEL_MAP = [
    "WWWWWWWWWWWWWWWWWWWW",
    "W....WW............W",
    "W.P..WW............W",
    "W....WW............W",
    "W......W...WW......W",
    "WWWW...W...WW......W",
    "W......W...........W",
    "W......WWWW..WWWWWWW",
    "W..................W",
    "W.......WW.........W",
    "WWWWWW..WW...WW....W",
    "W............WW..E.W",
    "W............WW....W",
    "WWWWWWWWWWWWWWWWWWWW",
];

// Sound Placeholders — uncomment and set your file paths
loadSound("sfx_attack", "sounds/attack.mp3");
loadSound("sfx_parry", "sounds/parry.mp3");
loadSound("sfx_kill", "sounds/kill.mp3");
loadSound("sfx_parry_initial", "sounds/parry_initial.mp3");

// --- CUSTOM COMPONENTS ---

function neonShape() {
    return {
        id: "neonShape",
        require: ["pos", "rotate", "opacity"],
        draw() {
            // 1. Calculate Stamina Color & Height
            // Get stamina from the parent object (default to 100 if missing)
            const cur = this.stamina ?? 100;
            const max = 100;
            const pct = cur / max;

            // Lerp Color: Blue (Full) -> Red (Empty)
            const barColor = NEON_RED.lerp(NEON_BLUE, pct);

            // Calculate height (Max height is 35)
            const barHeight = 35 * pct;

            // FIX: Multiply by the entity's opacity to respect transparency (e.g. during death)
            const masterOpacity = this.opacity ?? 1;

            // 2. Draw Stamina Bar (Filled Rect inside)
            drawRect({
                width: 35,
                height: barHeight,
                pos: vec2(0, 17.5), // Start at bottom center
                anchor: "bot",      // Anchor at bottom so it grows up
                color: barColor,
                opacity: 0.6 * masterOpacity,
            });

            // 3. Draw Outer Frame (The original box)
            drawRect({
                width: 35, height: 35,
                pos: vec2(0, 0),
                anchor: "center",
                color: rgb(0, 0, 0),
                outline: { color: NEON_WHITE, width: 4 },
                fill: false,
                opacity: masterOpacity
            });

            // 4. Draw Direction Pointer
            drawLine({
                p1: vec2(0, 0), p2: vec2(-17, 0), // Pointing right
                width: 4, color: NEON_WHITE,
                opacity: masterOpacity
            });
        }
    };
}

function wobblyMovement() {
    let t = 0;
    return {
        id: "wobblyMovement",
        require: ["scale"],
        update() {
            const isMoving = isKeyDown("w") || isKeyDown("a") || isKeyDown("s") || isKeyDown("d");
            // Reduce wobble intensity when sneaking
            const intensity = isKeyDown("z") ? 0.05 : 0.15;

            if (isMoving) {
                t += dt() * 20;
                const stretch = Math.sin(t) * intensity;
                this.scale = vec2(1 + stretch, 1 - stretch);
            } else {
                this.scale = this.scale.lerp(vec2(1, 1), dt() * 10);
                t = 0;
            }
        }
    };
}

function combatVisuals() {
    return {
        id: "combatVisuals",
        require: ["pos", "rotate", "opacity"],
        draw() {
            const op = this.opacity ?? 1;
            if (this.combatState === "parry") {
                // Shield arc in front of player
                drawLine({
                    p1: vec2(-28, -14),
                    p2: vec2(-28, 14),
                    width: 5,
                    color: NEON_YELLOW,
                    opacity: 0.9 * op
                });
                drawCircle({
                    pos: vec2(-28, 0),
                    radius: 16,
                    fill: false,
                    outline: { color: NEON_YELLOW, width: 2 },
                    opacity: 0.4 * op
                });
            }
            else if (this.combatState === "attack") {
                // Dagger thrust line
                drawLine({
                    p1: vec2(-17, 0),
                    p2: vec2(-50, 0),
                    width: 3,
                    color: NEON_BLUE,
                    opacity: 0.8 * op
                });
            }
        }
    };
}

// --- HELPER FUNCTIONS ---

function impactFreeze(duration) {
    debug.timeScale = 0;
    setTimeout(() => { debug.timeScale = 1; }, duration * 1000);
}

function spawnVisionCone(origin, aimAngleRad, range, arcDeg, duration) {
    const halfArcRad = (arcDeg / 2) * Math.PI / 180;
    add([
        pos(origin),
        anchor("center"),
        "visioncone",
        {
            life: duration,
            opacity: 0.8,
            hitList: new Set(),
            update() {
                this.life -= dt();
                this.opacity = this.life / duration;
                if (this.life <= 0) { destroy(this); return; }

                // Reveal walls and sentinels inside the cone
                const all = [...get("wall"), ...get("sentinel")];
                for (const e of all) {
                    if (this.hitList.has(e.id)) continue;
                    const d = e.pos.dist(this.pos);
                    if (d > range) continue;

                    const toEntity = Math.atan2(e.pos.y - this.pos.y, e.pos.x - this.pos.x);
                    let diff = toEntity - aimAngleRad;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    while (diff < -Math.PI) diff += Math.PI * 2;

                    if (Math.abs(diff) < halfArcRad) {
                        this.hitList.add(e.id);
                        if (e.reveal) e.reveal();
                    }
                }
            },
            draw() {
                // Cone as polygon fan
                const pts = [vec2(0, 0)];
                const steps = 10;
                for (let i = 0; i <= steps; i++) {
                    const a = aimAngleRad - halfArcRad + (i / steps) * (halfArcRad * 2);
                    pts.push(vec2(Math.cos(a) * range, Math.sin(a) * range));
                }
                drawPolygon({
                    pts: pts,
                    color: NEON_BLUE,
                    opacity: this.opacity * 0.12,
                    fill: true
                });
                drawPolygon({
                    pts: pts,
                    fill: false,
                    outline: { color: NEON_BLUE, width: 2 },
                    opacity: this.opacity * 0.5
                });
            }
        }
    ]);
}

// --- PULSE SYSTEM ---

function spawnPulse(position, maxRadius, duration, isEcho, sourceEntity, pulseColor) {
    // Default values (avoiding default params for clarity)
    if (isEcho === undefined) isEcho = false;
    if (sourceEntity === undefined) sourceEntity = null;
    if (pulseColor === undefined) pulseColor = NEON_BLUE;

    add([
        pos(position),
        anchor("center"),
        "pulse",
        {
            radius: 0,
            opacity: 1,
            hitList: new Set(),
            update() {
                this.radius += (maxRadius / duration) * dt();
                this.opacity -= (1 / duration) * dt();

                if (this.opacity <= 0) {
                    destroy(this);
                    return;
                }

                const walls = get("wall");
                const sentinels = get("sentinel");
                const players = get("player");

                // Check Walls
                for (const w of walls) {
                    if (this.hitList.has(w.id)) continue;

                    const d = w.pos.dist(this.pos);
                    if (d < this.radius + 40) {
                        this.hitList.add(w.id);
                        if (w.reveal) w.reveal();

                        if (!isEcho) {
                            spawnPulse(w.pos, maxRadius * 0.4, duration * 0.5, true);
                        }
                    }
                }

                // Check Sentinels
                for (const s of sentinels) {
                    if (this.hitList.has(s.id)) continue;

                    // Self-exclusion: skip the sentinel that emitted this pulse
                    if (sourceEntity && s === sourceEntity) continue;

                    const d = s.pos.dist(this.pos);
                    if (d < this.radius + 30) {
                        this.hitList.add(s.id);
                        if (s.reveal) s.reveal();
                        if (s.hear && !isEcho) s.hear(position);
                    }
                }

                // Player detection: if a sentinel emitted this pulse, check if it hits the player
                if (sourceEntity && sourceEntity.hear) {
                    for (const p of players) {
                        if (this.hitList.has(p.id)) continue;

                        const d = p.pos.dist(this.pos);
                        if (d < this.radius + 20) {
                            this.hitList.add(p.id);
                            // Tell the sentinel where the player is
                            sourceEntity.hear(p.pos);
                        }
                    }
                }
            },
            draw() {
                drawCircle({
                    radius: this.radius,
                    fill: false,
                    outline: {
                        color: isEcho ? NEON_WHITE : pulseColor,
                        width: isEcho ? 2 : 4
                    },
                    opacity: this.opacity
                });
            }
        }
    ]);
}

// --- GAME OBJECTS ---

// --- MAIN SCENE ---

scene("game", () => {
    setCursor("none");

    // --- GAME OBJECTS ---

    const crosshair = add([
        pos(0, 0), z(100), fixed(),
        {
            draw() {
                drawLine({ p1: vec2(-10, 0), p2: vec2(10, 0), width: 2, color: NEON_BLUE });
                drawLine({ p1: vec2(0, -10), p2: vec2(0, 10), width: 2, color: NEON_BLUE });
                drawCircle({ radius: 4, fill: false, outline: { color: NEON_BLUE, width: 2 } })
            },
            update() { this.pos = mousePos(); }
        }
    ]);

    const player = add([
        pos(center()),
        anchor("center"),
        rotate(0),
        scale(1),
        opacity(1),
        // PHYSICS FIX: Center the hitbox. 
        // Offset minimal is best 
        area({ shape: new Rect(vec2(-0.01, -0.01), 35, 35) }),
        body(), // PHYSICS FIX: Adds physical body for collision resolution
        neonShape(),
        wobblyMovement(),
        combatVisuals(),
        "player",
        {
            stamina: 100,
            maxStamina: 100,
            stepTimer: 0,
            isDashing: false,
            dashTimer: 0,
            isExhausted: false,
            isDead: false,
            // Combat
            combatState: "idle",
            combatTimer: 0,
            parrySuccess: false,
        }
    ]);

    // --- UPDATED WALL FUNCTION ---
    function addWall(x, y) {
        return add([
            pos(x, y),
            rect(80, 80),
            area(),
            body({ isStatic: true }), // PHYSICS FIX: Walls are now static solid bodies
            anchor("center"),
            opacity(0),
            "wall",
            {
                revOpacity: 0,
                reveal() {
                    this.revOpacity = 1;
                },
                update() {
                    this.revOpacity = Math.max(0, this.revOpacity - dt() * 0.8);
                },
                draw() {
                    if (this.revOpacity > 0.01) {
                        drawRect({
                            width: 80,
                            height: 80,
                            anchor: "center",
                            fill: false,
                            outline: { color: NEON_WHITE, width: 4 },
                            opacity: this.revOpacity
                        });

                        // Inner glow
                        drawRect({
                            width: 70, height: 70, anchor: "center",
                            color: NEON_WHITE, opacity: this.revOpacity * 0.1, fill: true
                        });
                    }
                }
            }
        ]);
    }

    // --- EXIT ZONE ---

    function addExit(x, y) {
        return add([
            pos(x, y),
            anchor("center"),
            area({ shape: new Rect(vec2(-30, -30), 60, 60) }),
            opacity(0),
            "wall",
            "exit",
            {
                revOpacity: 0,
                glowTime: 0,
                won: false,
                reveal() { this.revOpacity = 1; },
                update() {
                    this.revOpacity = Math.max(0, this.revOpacity - dt() * 0.8);
                    this.glowTime += dt();
                    if (player.exists() && !player.isDead && this.pos.dist(player.pos) < 40 && !this.won) {
                        this.won = true;
                        showEndScreen();
                    }
                },
                draw() {
                    // Always-visible faint glow
                    drawCircle({
                        radius: 10,
                        color: NEON_GREEN,
                        opacity: 0.25 + Math.sin(this.glowTime * 3) * 0.12,
                    });
                    if (this.revOpacity > 0.01) {
                        drawRect({
                            width: 60, height: 60,
                            anchor: "center",
                            fill: false,
                            outline: { color: NEON_GREEN, width: 3 },
                            opacity: this.revOpacity
                        });
                        drawRect({
                            width: 50, height: 50,
                            anchor: "center",
                            color: NEON_GREEN,
                            opacity: this.revOpacity * 0.1,
                            fill: true
                        });
                    }
                }
            }
        ]);
    }

    // --- LEVEL GENERATION ---

    let spawnPos = vec2(center());

    for (let row = 0; row < LEVEL_MAP.length; row++) {
        for (let col = 0; col < LEVEL_MAP[row].length; col++) {
            const x = col * TILE + TILE / 2;
            const y = row * TILE + TILE / 2;
            const ch = LEVEL_MAP[row][col];
            if (ch === "W") addWall(x, y);
            else if (ch === "P") spawnPos = vec2(x, y);
            else if (ch === "E") addExit(x, y);
        }
    }

    player.pos = spawnPos;
    camPos(spawnPos);

    // --- SENTINEL ENEMY ---

    function addSentinel(points = []) {
        const startPos = points.length > 0 ? points[0] : vec2(rand(100, width() - 100), rand(100, height() - 100));

        return add([
            pos(startPos),
            anchor("center"),
            rotate(0),
            // PHYSICS FIX: Circle shape prevents getting stuck on corners
            // Reverted to Rect for v3001 compatibility
            area({ shape: new Rect(vec2(-15, -15), 30, 30) }),
            body(),
            opacity(0),
            "sentinel",
            {
                points: points,
                curPointIndex: 0,
                state: "patrol", // patrol, chase, lunge_windup, lunge, search, return, stunned
                speed: 100,
                lastHeardPos: null,
                searchTimer: 0,
                pulseTimer: 0,
                revealOpacity: 0,
                // Combat
                lungeTimer: 0,
                lungeDir: null,
                windupTimer: 0,
                stunTimer: 0,
                isStunned: false,

                hear(location) {
                    // Can't hear while stunned or mid-lunge
                    if (this.state === "stunned" || this.state === "lunge" || this.state === "lunge_windup") return;
                    this.state = "chase";
                    this.lastHeardPos = location.clone();
                    this.speed = 220;
                },

                stun() {
                    this.state = "stunned";
                    this.isStunned = true;
                    this.stunTimer = STUN_DURATION;
                    this.revealOpacity = 1;
                    this.speed = 0;
                    this.lungeDir = null;
                },

                echoStun() {
                    // Shorter stun from Echo Strike (0.5s)
                    this.state = "stunned";
                    this.isStunned = true;
                    this.stunTimer = 0.5;
                    this.revealOpacity = 1;
                    this.speed = 0;
                    this.lungeDir = null;
                },

                reveal() {
                    this.revealOpacity = 1;
                },

                draw() {
                    if (this.revealOpacity > 0.01) {
                        drawPolygon({
                            pts: [vec2(-20, 20), vec2(20, 20), vec2(0, -30)],
                            fill: false,
                            outline: { color: this.isStunned ? NEON_YELLOW : NEON_RED, width: 4 },
                            opacity: this.revealOpacity
                        });
                        drawPolygon({
                            pts: [vec2(-16, 16), vec2(16, 16), vec2(0, -24)],
                            color: this.isStunned ? NEON_YELLOW : NEON_RED,
                            opacity: this.revealOpacity * 0.2,
                            fill: true
                        });
                    }
                },

                update() {
                    // Update visibility
                    if (this.state !== "lunge_windup") {
                        this.opacity = this.revealOpacity;
                        this.revealOpacity = Math.max(0, this.revealOpacity - dt() * 0.5);
                    }

                    // Pulse trail while moving (not when stunned)
                    if (this.state !== "idle" && this.state !== "stunned") {
                        this.pulseTimer += dt();
                        const pInterval = this.state === "chase" ? 0.4 : 0.8;
                        if (this.pulseTimer > pInterval) {
                            add([
                                pos(this.pos),
                                anchor("center"),
                                opacity(1),
                                "sentinel_pulse",
                                {
                                    life: 0.5,
                                    update() {
                                        this.life -= dt();
                                        this.opacity = this.life * 2;
                                        if (this.life <= 0) destroy(this);
                                    },
                                    draw() {
                                        drawPolygon({
                                            pts: [vec2(-20, 20), vec2(20, 20), vec2(0, -30)],
                                            fill: false,
                                            outline: { color: NEON_RED, width: 2 },
                                            opacity: this.opacity * 0.5,
                                            scale: vec2(1 + (0.5 - this.life) * 2)
                                        });
                                    }
                                }
                            ]);
                            this.pulseTimer = 0;
                        }
                    }

                    // Kill player on contact (only in normal movement states)
                    if (player.exists() && this.pos.dist(player.pos) < 40 && !player.isDead
                        && this.state !== "lunge_windup" && this.state !== "lunge" && this.state !== "stunned") {
                        shatterPlayer();
                    }

                    // --- STATE MACHINE ---

                    if (this.state === "patrol") {
                        if (this.points.length === 0) {
                            this.points.push(vec2(rand(100, width() - 100), rand(100, height() - 100)));
                        }
                        const target = this.points[this.curPointIndex];
                        const dir = target.sub(this.pos).unit();
                        this.move(dir.scale(this.speed));
                        this.angle = this.pos.angle(target) + 90;
                        if (this.pos.dist(target) < 10) {
                            this.curPointIndex = (this.curPointIndex + 1) % this.points.length;
                        }
                    }
                    else if (this.state === "chase") {
                        if (this.lastHeardPos) {
                            // Lunge trigger: close enough to the player to attack
                            if (player.exists() && !player.isDead && this.pos.dist(player.pos) < 80) {
                                this.state = "lunge_windup";
                                this.windupTimer = 0.4;
                                this.lungeDir = player.pos.sub(this.pos).unit();
                                // Warning cue: red ripple
                                spawnPulse(this.pos, 60, 0.3, false, this, NEON_RED);
                                return;
                            }

                            const dir = this.lastHeardPos.sub(this.pos).unit();
                            this.move(dir.scale(this.speed));
                            this.angle = this.pos.angle(this.lastHeardPos) + 90;
                            if (this.pos.dist(this.lastHeardPos) < 20) {
                                this.state = "search";
                                this.searchTimer = 2;
                            }
                        }
                    }
                    else if (this.state === "lunge_windup") {
                        this.windupTimer -= dt();
                        // Rapid flicker — the parry cue
                        this.revealOpacity = (Math.sin(this.windupTimer * 30) > 0) ? 1 : 0.3;
                        this.opacity = this.revealOpacity;

                        if (this.windupTimer <= 0) {
                            this.state = "lunge";
                            this.lungeTimer = 0.2;
                            // Lock lunge direction to where player IS right now
                            if (player.exists()) {
                                this.lungeDir = player.pos.sub(this.pos).unit();
                            }
                        }
                    }
                    else if (this.state === "lunge") {
                        this.lungeTimer -= dt();
                        this.revealOpacity = 1; // Fully visible during lunge

                        // Dash forward (null guard prevents crash if stunned mid-lunge)
                        if (this.lungeDir) {
                            this.move(this.lungeDir.scale(400));
                        }

                        // Contact check during lunge
                        if (player.exists() && this.pos.dist(player.pos) < 40 && !player.isDead) {
                            if (player.combatState === "parry") {
                                // --- PARRIED! ---
                                player.parrySuccess = true;
                                this.stun();

                                impactFreeze(IMPACT_FREEZE);

                                // Slow-mo then restore
                                setTimeout(() => { debug.timeScale = 0.3; }, IMPACT_FREEZE * 1000);
                                setTimeout(() => { debug.timeScale = 1; }, IMPACT_FREEZE * 1000 + 800);

                                // Perfect Pulse — silent (isEcho=true), white, large
                                spawnPulse(player.pos, 500, 0.8, true, null, NEON_WHITE);

                                play("sfx_parry");
                                shake(10);
                            } else {
                                // Player didn't parry — death
                                shatterPlayer();
                            }
                        }

                        if (this.lungeTimer <= 0 && this.state === "lunge") {
                            this.state = "search";
                            this.searchTimer = 2;
                            this.speed = 100;
                        }
                    }
                    else if (this.state === "stunned") {
                        this.stunTimer -= dt();
                        this.revealOpacity = 1; // Always visible when stunned
                        // Don't move
                        if (this.stunTimer <= 0) {
                            this.isStunned = false;
                            this.state = "return";
                            this.speed = 100;
                        }
                    }
                    else if (this.state === "search") {
                        this.searchTimer -= dt();
                        if (this.searchTimer <= 0) {
                            spawnPulse(this.pos, 300, 0.5, false, this, NEON_RED);
                            this.state = "return";
                        }
                    }
                    else if (this.state === "return") {
                        const target = this.points[this.curPointIndex];
                        const dir = target.sub(this.pos).unit();
                        this.move(dir.scale(this.speed));
                        this.angle = this.pos.angle(target) + 90;
                        if (this.pos.dist(target) < 10) {
                            this.state = "patrol";
                            this.speed = 100;
                        }
                    }
                }
            }
        ]);
    }

    // Sentinels with designed patrol routes
    // Sentinel 1: Patrols upper-right area
    addSentinel([
        vec2(12 * TILE, 2 * TILE),
        vec2(17 * TILE, 2 * TILE),
        vec2(17 * TILE, 5 * TILE),
        vec2(12 * TILE, 5 * TILE),
    ]);
    // Sentinel 2: Patrols lower-left area
    addSentinel([
        vec2(3 * TILE, 9 * TILE),
        vec2(3 * TILE, 12 * TILE),
        vec2(8 * TILE, 12 * TILE),
        vec2(8 * TILE, 9 * TILE),
    ]);

    // --- DEATH SEQUENCE ---

    function shatterPlayer() {
        if (player.isDead) return;
        player.isDead = true;

        // Disable player
        player.opacity = 0; // Hide player visual

        // Spawn shards
        for (let i = 0; i < 15; i++) {
            add([
                pos(player.pos),
                rect(8, 8),
                color(NEON_WHITE),
                anchor("center"),
                rotate(rand(0, 360)),
                opacity(1),
                lifespan(0.5, { fade: 0.5 }),
                move(rand(0, 360), rand(100, 200)),
                "shard"
            ]);
        }

        shake(30);

        wait(1.5, () => {
            go("game");
        });
    }

    // --- ENEMY SHATTER ---

    function shatterSentinel(sentinel) {
        impactFreeze(IMPACT_FREEZE);
        play("sfx_kill");

        const shardPos = sentinel.pos.clone();
        for (let i = 0; i < 12; i++) {
            const ang = rand(0, 360);
            const spd = rand(150, 350);
            add([
                pos(shardPos),
                anchor("center"),
                rotate(rand(0, 360)),
                opacity(1),
                "shard",
                {
                    vel: vec2(Math.cos(ang * Math.PI / 180) * spd, Math.sin(ang * Math.PI / 180) * spd),
                    life: 0.8,
                    update() {
                        this.life -= dt();
                        this.vel.y += 400 * dt(); // Gravity
                        this.pos = this.pos.add(this.vel.scale(dt()));
                        this.opacity = this.life / 0.8;
                        this.angle += 360 * dt();
                        if (this.life <= 0) destroy(this);
                    },
                    draw() {
                        drawPolygon({
                            pts: [vec2(-4, 4), vec2(4, 4), vec2(0, -8)],
                            color: NEON_RED,
                            opacity: this.opacity,
                            fill: true
                        });
                        drawPolygon({
                            pts: [vec2(-4, 4), vec2(4, 4), vec2(0, -8)],
                            fill: false,
                            outline: { color: NEON_RED, width: 2 },
                            opacity: this.opacity
                        });
                    }
                }
            ]);
        }

        shake(15);
        destroy(sentinel);
    }

    // --- MAIN LOOP ---

    onUpdate(() => {
        if (player.isDead) return;

        const input = vec2(0, 0);
        if (isKeyDown("w")) input.y = -1;
        if (isKeyDown("s")) input.y = 1;
        if (isKeyDown("a")) input.x = -1;
        if (isKeyDown("d")) input.x = 1;

        const isMoving = input.len() > 0;
        const isSprinting = isKeyDown("shift");
        const isSneaking = isKeyDown("z");
        const isDashPressed = isKeyPressed("space");

        let currentSpeed = MOVE_SPEED;
        let pulseInterval = 0.5;
        let pulseSize = 100;
        let canPulse = true;

        // --- STAMINA STATE CHECK ---

        // 1. Check for Exhaustion
        if (player.stamina <= 0) {
            player.isExhausted = true;
        }
        // 2. Recovery Threshold (Must reach 20 stamina to stop being exhausted)
        if (player.isExhausted && player.stamina >= 20) {
            player.isExhausted = false;
        }

        // --- MOVEMENT LOGIC ---

        if (player.isDashing) {
            // DASHING (Active)
            player.dashTimer -= dt();
            if (player.dashTimer <= 0) player.isDashing = false;
            currentSpeed = DASH_SPEED;
        }
        else if (isDashPressed && isMoving && player.stamina >= 35) {
            // INITIATE DASH
            player.isDashing = true;
            player.dashTimer = DASH_TIME;
            player.stamina -= 35;
            spawnPulse(player.pos, 550, 0.6);
            shake(3);
            currentSpeed = DASH_SPEED;
        }
        else {
            // Check Sprint condition: Must hold Shift, be moving, have stamina, AND not be exhausted
            if (isSprinting && isMoving && player.stamina > 0 && !player.isExhausted) {
                currentSpeed = SPRINT_SPEED;
                pulseInterval = 0.3;
                pulseSize = 280;
                player.stamina -= 25 * dt(); // Drain
            }
            else if (isSneaking) {
                currentSpeed = SNEAK_SPEED;
                canPulse = false;
                player.stamina += 10 * dt(); // Recover
            }
            else if (isMoving) {
                currentSpeed = MOVE_SPEED;
                player.stamina += 10 * dt(); // Recover
            }
            else {
                currentSpeed = 0; // Standing still
                player.stamina += 20 * dt(); // Fast Recover
            }
        }

        // Final Clamp
        player.stamina = clamp(player.stamina, 0, 100);

        // 4. Apply Movement
        if (isMoving) {
            player.move(input.unit().scale(currentSpeed));

            // Pulse Logic
            if (!player.isDashing && canPulse) {
                player.stepTimer += dt();
                if (player.stepTimer >= pulseInterval) {
                    spawnPulse(player.pos, pulseSize, 0.8);
                    player.stepTimer = 0;
                }
            }
        } else {
            // Reset step timer so next step is immediate
            player.stepTimer = pulseInterval;
        }

        // --- COMBAT ---

        // Tick combat timer
        if (player.combatState !== "idle") {
            player.combatTimer -= dt();
            if (player.combatTimer <= 0) {
                player.combatState = "idle";
                player.combatTimer = 0;
            }
        }

        // Get aim direction (used by both attack types)
        const worldMousePos = toWorld(mousePos());
        const aimDir = worldMousePos.sub(player.pos).unit();
        const aimAngleRad = Math.atan2(aimDir.y, aimDir.x);

        // Attack (Left Click)
        if (isMousePressed("left") && player.combatState === "idle"
            && player.stamina >= ATTACK_COST && !player.isExhausted && !player.isDashing) {

            player.stamina -= ATTACK_COST;
            player.combatState = "attack";
            player.combatTimer = 0.15;
            play("sfx_attack");

            if (isSneaking) {
                // --- SILENT STING ---
                // Short range, zero sound, backstab check
                const range = 50;
                const sentinels = get("sentinel");
                for (const s of sentinels) {
                    const d = s.pos.dist(player.pos);
                    if (d > range) continue;

                    // Must be aiming at sentinel
                    const toSentinel = s.pos.sub(player.pos).unit();
                    const dot = aimDir.x * toSentinel.x + aimDir.y * toSentinel.y;
                    if (dot < 0.5) continue;

                    // Backstab: is player behind or beside the sentinel?
                    const sAngleRad = (s.angle - 90) * Math.PI / 180;
                    const sFacing = vec2(Math.cos(sAngleRad), Math.sin(sAngleRad));
                    const sToPlayer = player.pos.sub(s.pos).unit();
                    const facingDot = sFacing.x * sToPlayer.x + sFacing.y * sToPlayer.y;

                    // facingDot < 0.5 means player is to the side or behind
                    if (facingDot < 0.5 || s.isStunned) {
                        shatterSentinel(s);
                        break;
                    }
                }
            } else {
                // --- ECHO STRIKE ---
                // Directional vision cone (60°), reveals but doesn't alert
                spawnVisionCone(player.pos.clone(), aimAngleRad, 120, 60, 0.4);

                // Check for sentinel hits within cone
                const range = 80;
                const halfArcRad = 30 * Math.PI / 180;
                const sentinels = get("sentinel");
                for (const s of sentinels) {
                    const d = s.pos.dist(player.pos);
                    if (d > range) continue;

                    const toS = Math.atan2(s.pos.y - player.pos.y, s.pos.x - player.pos.x);
                    let diff = toS - aimAngleRad;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    while (diff < -Math.PI) diff += Math.PI * 2;

                    if (Math.abs(diff) < halfArcRad) {
                        if (s.echoStun) s.echoStun();
                    }
                }
            }
        }

        // Parry (Right Click)
        if (isMousePressed("right") && player.combatState === "idle"
            && player.stamina >= PARRY_COST && !player.isExhausted && !player.isDashing) {

            player.stamina -= PARRY_COST;
            player.combatState = "parry";
            player.combatTimer = PARRY_WINDOW;
            player.parrySuccess = false;
            play("sfx_parry_initial");
        }

        // 5. Aim & Camera (worldMousePos already computed in combat section above)
        player.angle = player.pos.angle(worldMousePos);

        const MAX_PEEK = 150;
        const screenCenter = vec2(width() / 2, height() / 2);
        const mPos = mousePos();
        const mousePercentX = (mPos.x - screenCenter.x) / (width() / 2);
        const mousePercentY = (Math.max(mPos.y, 5) - screenCenter.y) / (height() / 2);
        const cameraTarget = player.pos.add(vec2(mousePercentX * MAX_PEEK, mousePercentY * MAX_PEEK));
        camPos(camPos().lerp(cameraTarget, dt() * 8));
    });

    // --- UPDATED SCANNER GRID ---
    add([
        z(-10),
        fixed(),
        {
            draw() {
                const activePulses = get("pulse");
                if (activePulses.length === 0) return;

                const gridSize = 80;
                const screenW = width();
                const screenH = height();
                const cam = camPos();
                const offsetX = cam.x % gridSize;
                const offsetY = cam.y % gridSize;

                for (let x = -offsetX; x < screenW; x += gridSize) {
                    for (let y = -offsetY; y < screenH; y += gridSize) {
                        const worldP = toWorld(vec2(x, y));

                        for (const p of activePulses) {
                            const d = worldP.dist(p.pos);
                            if (d < p.radius) {
                                const edgeDist = Math.abs(d - p.radius);
                                const isEdge = edgeDist < 30;

                                drawCircle({
                                    pos: vec2(x, y),
                                    radius: isEdge ? 2.5 : 1.5,
                                    color: isEdge ? NEON_BLUE : rgb(30, 30, 60),
                                    opacity: isEdge ? p.opacity : p.opacity * 0.3
                                });
                            }
                        }
                    }
                }
            }
        }
    ]);

});

// Game starts when the Play button is clicked (see index.html startGame())