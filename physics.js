// physics.js — Spring-damper simulation
// Models Yuumi as a mass hanging from the cursor pivot point

const Physics = (() => {

  const state = {
    // Spring constants — tweak these to feel different
    k:       200,   // stiffness  (higher = snappier)
    damping:  14,   // damping    (higher = less bouncy)
    mass:    1.0,   // mass       (higher = more sluggish)

    // Natural hang distance below pivot (pixels)
    restOffsetY: 100,

    // Pivot = where the book/pinch point is (follows cursor when grabbed)
    pivotX: 0,
    pivotY: 0,

    // Mass = Yuumi's body position (lags behind pivot via spring)
    massX: 0,
    massY: 0,

    // Velocity of the mass
    vx: 0,
    vy: 0,
  };

  function init(pivotX, pivotY) {
    state.pivotX = pivotX;
    state.pivotY = pivotY;
    state.massX  = pivotX;
    state.massY  = pivotY + state.restOffsetY;
    state.vx = 0;
    state.vy = 0;
  }

  function step(dt) {
    // Target position: directly below pivot by restOffsetY
    const targetX = state.pivotX;
    const targetY = state.pivotY + state.restOffsetY;

    // Spring force: F = -k*displacement - damping*velocity
    const dx = state.massX - targetX;
    const dy = state.massY - targetY;

    const ax = (-state.k * dx - state.damping * state.vx) / state.mass;
    const ay = (-state.k * dy - state.damping * state.vy) / state.mass;

    state.vx += ax * dt;
    state.vy += ay * dt;
    state.massX += state.vx * dt;
    state.massY += state.vy * dt;
  }

  // Displacement of mass from its rest position (how far it's swinging)
  function displacement() {
    return {
      x: state.massX - state.pivotX,
      y: state.massY - (state.pivotY + state.restOffsetY),
    };
  }

  function speed() {
    return Math.hypot(state.vx, state.vy);
  }

  return { state, init, step, displacement, speed };

})();
