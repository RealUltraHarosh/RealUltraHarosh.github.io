// Initialize Kaplay
kaplay({
    background: [0, 0, 0],
    debug: true,
});

setCursor("none");

// --- CONSTANTS ---
const MOVE_SPEED = 200;
const SPRINT_SPEED = 350;
const DASH_SPEED = 1200;
const DASH_TIME = 0.15;

const NEON_WHITE = rgb(240, 255, 255);
const NEON_BLUE = rgb(0, 255, 255);
const NEON_RED = rgb(255, 50, 50);

// --- CUSTOM COMPONENTS ---

function neonShape() {
    return {
        id: "neonShape",
        require: ["pos", "rotate"],
        draw() {
            drawRect({
                width: 35, height: 35,
                pos: vec2(0, 0),
                anchor: "center",
                color: rgb(0, 0, 0),
                outline: { color: NEON_WHITE, width: 4 },
                fill: true
            });
            drawLine({
                p1: vec2(0, 0), p2: vec2(-17, 0),
                width: 4, color: NEON_WHITE,
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
            if (isMoving) {
                t += dt() * 20;
                const stretch = Math.sin(t) * 0.15;
                this.scale = vec2(1 + stretch, 1 - stretch);
            } else {
                this.scale = this.scale.lerp(vec2(1, 1), dt() * 10);
                t = 0;
            }
        }
    };
}

// --- PULSE SYSTEM ---

function spawnPulse(position, maxRadius, duration, isEcho = false) {
    add([
        pos(position),
        anchor("center"),
        "pulse",
        {
            radius: 0,
            opacity: 1,
            hitList: new Set(),
            update() {
                // Expand radius and fade out
                this.radius += (maxRadius / duration) * dt();
                this.opacity -= (1 / duration) * dt();

                if (this.opacity <= 0) {
                    destroy(this);
                    return;
                }

                // CHECK WALLS: Distance-based "Reveal" (Safer than isColliding)
                const walls = get("wall");
                for (const w of walls) {
                    if (this.hitList.has(w.id)) continue;

                    const d = w.pos.dist(this.pos);
                    // If the expanding ring edge is passing over the wall
                    if (d < this.radius) {
                        this.hitList.add(w.id);
                        w.reveal(); // Trigger reveal on wall
                        
                        if (!isEcho) {
                            // Small echo pulse
                            spawnPulse(w.pos, maxRadius * 0.4, duration * 0.5, true);
                        }
                    }
                }
            },
            draw() {
                drawCircle({
                    radius: this.radius,
                    fill: false,
                    outline: { 
                        color: isEcho ? NEON_WHITE : NEON_BLUE, 
                        width: isEcho ? 2 : 4 
                    },
                    opacity: this.opacity
                });
            }
        }
    ]);
}

// --- GAME OBJECTS ---

const crosshair = add([
    pos(0,0), z(100), fixed(),
    {
        draw() {
            drawLine({ p1: vec2(-10, 0), p2: vec2(10, 0), width: 2, color: NEON_BLUE });
            drawLine({ p1: vec2(0, -10), p2: vec2(0, 10), width: 2, color: NEON_BLUE });
            drawCircle({ radius: 4, fill: false, outline: { color: NEON_BLUE, width: 2 }})
        },
        update() { this.pos = mousePos(); }
    }
]);

const player = add([
    pos(center()),
    anchor("center"),
    rotate(0),
    scale(1),
    area({ shape: new Rect(vec2(-17,-17), 35, 35) }),
    neonShape(),
    wobblyMovement(),
    "player",
    {
        stepTimer: 0,
        isDashing: false,
        dashTimer: 0,
    }
]);

// Helper to spawn walls
// --- UPDATED WALL FUNCTION ---
function addWall(x, y) {
    return add([
        pos(x, y),
        rect(80, 80),
        area(),
        anchor("center"),
        opacity(0), // <--- FIX: Makes the default Kaplay rectangle invisible
        "wall",
        {
            revOpacity: 0,
            reveal() { 
                this.revOpacity = 1; 
            },
            update() {
                // Fades out over time
                this.revOpacity = Math.max(0, this.revOpacity - dt() * 0.8);
            },
            draw() {
                // Only draws if the pulse has hit it
                if (this.revOpacity > 0.01) {
                    drawRect({
                        width: 80, 
                        height: 80,
                        anchor: "center",
                        fill: false, // Set to true if you want solid blocks
                        outline: { color: NEON_WHITE, width: 4 },
                        opacity: this.revOpacity 
                    });
                    
                    // Optional: Subtle white glow inside
                    drawRect({
                        width: 76,
                        height: 76,
                        anchor: "center",
                        color: NEON_WHITE,
                        opacity: this.revOpacity * 0.1
                    });
                }
            }
        }
    ]);
}

// Spawn some test walls
for(let i=0; i<12; i++) {
    addWall(rand(100, width()-100), rand(100, height()-100));
}

// --- MAIN LOOP ---

onUpdate(() => {
    let speed = MOVE_SPEED;
    let stepInterval = 0.5;
    let pulseSize = 180;

    const input = vec2(0, 0);
    if (isKeyDown("w")) input.y = -1;
    if (isKeyDown("s")) input.y = 1;
    if (isKeyDown("a")) input.x = -1;
    if (isKeyDown("d")) input.x = 1;

    if (player.isDashing) {
        player.dashTimer -= dt();
        if (player.dashTimer <= 0) player.isDashing = false;
        speed = DASH_SPEED;
    } else if (isKeyDown("shift")) {
        speed = SPRINT_SPEED;
        stepInterval = 0.3;
        pulseSize = 280;
    }

    if (isKeyPressed("space") && !player.isDashing && input.len() > 0) {
        player.isDashing = true;
        player.dashTimer = DASH_TIME;
        spawnPulse(player.pos, 550, 0.6);
        shake(3);
    }

    if (input.len() > 0) {
        player.move(input.unit().scale(speed));
        if (!player.isDashing) {
            player.stepTimer += dt();
            if (player.stepTimer >= stepInterval) {
                spawnPulse(player.pos, pulseSize, 0.8);
                player.stepTimer = 0;
            }
        }
    }

    const worldMousePos = toWorld(mousePos());
    player.angle = player.pos.angle(worldMousePos);

    // Balanced Camera
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

            const gridSize = 80; // Slightly tighter grid
            const screenW = width();
            const screenH = height();
            const cam = camPos();
            
            // Calculate offsets to keep grid infinite
            const offsetX = cam.x % gridSize;
            const offsetY = cam.y % gridSize;

            for (let x = -offsetX; x < screenW; x += gridSize) {
                for (let y = -offsetY; y < screenH; y += gridSize) {
                    const worldP = toWorld(vec2(x, y));
                    
                    for (const p of activePulses) {
                        const d = worldP.dist(p.pos);
                        
                        // 1. Check if point is INSIDE the circle
                        if (d < p.radius) {
                            // Calculate a "shimmer" based on distance to edge
                            const edgeDist = Math.abs(d - p.radius);
                            const isEdge = edgeDist < 30;
                            
                            drawCircle({
                                pos: vec2(x, y),
                                radius: isEdge ? 2.5 : 1.5, // Brighter dots on the expanding ring
                                color: isEdge ? NEON_BLUE : rgb(30, 30, 60),
                                // Inside is faint, edge is bright
                                opacity: isEdge ? p.opacity : p.opacity * 0.3 
                            });
                        }
                    }
                }
            }
        }
    }
]);