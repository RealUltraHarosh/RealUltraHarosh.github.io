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
            const intensity = isKeyDown("control") ? 0.05 : 0.15;

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
        "player",
        {
            stamina: 100,
            maxStamina: 100,
            stepTimer: 0,
            isDashing: false,
            dashTimer: 0,
            isExhausted: false,
            isDead: false,
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

    // Spawn some test walls
    for (let i = 0; i < 12; i++) {
        addWall(rand(100, width() - 100), rand(100, height() - 100));
    }

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
                state: "patrol", // patrol, chase, search, return
                speed: 100,
                lastHeardPos: null,
                searchTimer: 0,
                pulseTimer: 0,
                revealOpacity: 0,

                hear(location) {
                    // AI FIX: Allow updating target even if already chasing (retargeting)
                    this.state = "chase";
                    this.lastHeardPos = location.clone();
                    this.speed = 220;
                },

                reveal() {
                    this.revealOpacity = 1;
                },

                draw() {
                    // Draw Sentinel Triangle
                    if (this.revealOpacity > 0.01) {
                        drawPolygon({
                            pts: [vec2(-20, 20), vec2(20, 20), vec2(0, -30)],
                            fill: false,
                            outline: { color: NEON_RED, width: 4 },
                            opacity: this.revealOpacity
                        });
                        // Inner glow
                        drawPolygon({
                            pts: [vec2(-16, 16), vec2(16, 16), vec2(0, -24)],
                            color: NEON_RED,
                            opacity: this.revealOpacity * 0.2,
                            fill: true
                        });
                    }
                },

                update() {
                    // Update visibility
                    this.opacity = this.revealOpacity;
                    this.revealOpacity = Math.max(0, this.revealOpacity - dt() * 0.5);

                    // Pulse Effect while moving
                    if (this.state !== "idle") {
                        this.pulseTimer += dt();
                        // More frequent pulses when chasing
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
                                            // Expand effect
                                            scale: vec2(1 + (0.5 - this.life) * 2)
                                        });
                                    }

                                }
                            ]);
                            this.pulseTimer = 0;
                        }
                    }

                    // Collision with player
                    if (player.exists() && this.pos.dist(player.pos) < 40 && !player.isDead) {
                        shatterPlayer();
                    }

                    // State Logic
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
                            const dir = this.lastHeardPos.sub(this.pos).unit();
                            this.move(dir.scale(this.speed));
                            this.angle = this.pos.angle(this.lastHeardPos) + 90;

                            if (this.pos.dist(this.lastHeardPos) < 20) {
                                this.state = "search";
                                this.searchTimer = 2;
                            }
                        }
                    }
                    else if (this.state === "search") {
                        this.searchTimer -= dt();
                        if (this.searchTimer <= 0) {
                            // Ping! Sentinel search pulse — red color, with self-exclusion & player detection
                            spawnPulse(this.pos, 300, 0.5, false, this, NEON_RED);

                            // Return to patrol (Hearing logic logic is now handled in spawnPulse hitting the player and calling hear())
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

    // Test Sentinel
    addSentinel([
        vec2(200, 200),
        vec2(width() - 200, 200),
        vec2(width() - 200, height() - 200),
        vec2(200, height() - 200)
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
        const isSneaking = isKeyDown("control");
        const isDashPressed = isKeyPressed("space");

        let currentSpeed = MOVE_SPEED;
        let pulseInterval = 0.7;
        let pulseSize = 180;
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

        // 5. Aim & Camera
        const worldMousePos = toWorld(mousePos());
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

// Start the game
go("game");