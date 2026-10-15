const test = require("node:test");
const assert = require("node:assert/strict");

function elapsed(s, now = Date.now()) {
  if (!s) return 0;
  return Math.max(0, (s.elapsedBeforeRun || 0) + (s.status === "running" ? Math.max(0, now - s.segmentStartedAt) : 0));
}

class MockStorage {
  constructor(initial = {}) {
    this.data = { ...initial };
  }
  async get(defaults) {
    const res = {};
    for (const k in defaults) {
      res[k] = this.data[k] !== undefined ? this.data[k] : defaults[k];
    }
    return res;
  }
  async set(items) {
    Object.assign(this.data, items);
  }
}

class SessionManager {
  constructor(storage) {
    this.storage = storage;
  }

  async getState() {
    return this.storage.get({ focusSession: null, history: [] });
  }

  async action(actionType, objective, now = Date.now()) {
    const s = await this.getState();
    let x = s.focusSession;

    if (actionType === "start") {
      if (x && ["running", "paused"].includes(x.status)) {
        throw new Error("A focus session is already active.");
      }
      x = {
        id: "sess-" + Math.random().toString(36).slice(2, 9),
        objective: String(objective || "").slice(0, 160),
        startAt: now,
        segmentStartedAt: now,
        elapsedBeforeRun: 0,
        status: "running",
        updatedAt: now
      };
    } else if (actionType === "pause") {
      if (!x || x.status !== "running") {
        throw new Error("No running session to pause.");
      }
      x.elapsedBeforeRun = elapsed(x, now);
      x.status = "paused";
      x.updatedAt = now;
    } else if (actionType === "resume") {
      if (!x || x.status !== "paused") {
        throw new Error("No paused session to resume.");
      }
      x.segmentStartedAt = now;
      x.status = "running";
      x.updatedAt = now;
    } else if (actionType === "finish" || actionType === "cancel") {
      if (!x || !["running", "paused"].includes(x.status)) {
        throw new Error("No active session to finish.");
      }
      const dur = elapsed(x, now);
      const record = {
        id: x.id,
        objective: x.objective || "Untitled session",
        startAt: x.startAt,
        endAt: now,
        activeDurationMs: dur,
        pausedDurationMs: Math.max(0, now - x.startAt - dur),
        status: actionType === "finish" ? "completed" : "cancelled",
        updatedAt: now
      };
      const h = s.history || [];
      h.unshift(record);
      s.history = h.slice(0, 1000);
      x = null;
    } else {
      throw new Error(`Unknown session action: ${actionType}`);
    }

    await this.storage.set({ focusSession: x, history: s.history || [] });
    return { session: x, history: s.history || [] };
  }

  // Handles browser restart reconciliation
  async onBrowserStartup(now = Date.now()) {
    const s = await this.getState();
    if (s.focusSession && s.focusSession.status === "running") {
      const x = s.focusSession;
      const lastHeartbeat = x.updatedAt || x.segmentStartedAt || x.startAt;
      const additionalTime = Math.min(Math.max(0, lastHeartbeat - x.segmentStartedAt), 60000);
      x.elapsedBeforeRun = (x.elapsedBeforeRun || 0) + additionalTime;
      x.status = "paused";
      x.updatedAt = now;
      await this.storage.set({ focusSession: x });
    }
  }
}

test("sessions: start, pause, resume, and finish lifecycle with accurate elapsed time", async () => {
  const storage = new MockStorage();
  const manager = new SessionManager(storage);

  let t = 1000000; // t0
  // 1. Start session
  const { session: s1 } = await manager.action("start", "Solve LeetCode problems", t);
  assert.equal(s1.status, "running");
  assert.equal(s1.objective, "Solve LeetCode problems");
  assert.equal(s1.startAt, t);

  // Attempting to start another session while running should fail
  await assert.rejects(
    async () => manager.action("start", "Another session", t + 5000),
    /already active/
  );

  // 2. Advance time 20 seconds, pause
  t += 20000;
  const { session: s2 } = await manager.action("pause", null, t);
  assert.equal(s2.status, "paused");
  assert.equal(s2.elapsedBeforeRun, 20000);
  assert.equal(elapsed(s2, t), 20000);

  // Time passes while paused (30 seconds)
  t += 30000;
  assert.equal(elapsed(s2, t), 20000); // Elapsed does NOT advance while paused!

  // 3. Resume session
  const { session: s3 } = await manager.action("resume", null, t);
  assert.equal(s3.status, "running");
  assert.equal(s3.segmentStartedAt, t);

  // Advance time 25 seconds while running
  t += 25000;
  assert.equal(elapsed(s3, t), 45000); // 20s + 25s = 45s

  // 4. Finish session
  const { session: sFinal, history } = await manager.action("finish", null, t);
  assert.equal(sFinal, null); // active session cleared
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "completed");
  assert.equal(history[0].activeDurationMs, 45000);
  assert.equal(history[0].pausedDurationMs, 30000);
  assert.equal(history[0].objective, "Solve LeetCode problems");
});

test("sessions: timer persistence across popup close and reopen", async () => {
  const storage = new MockStorage();
  const manager = new SessionManager(storage);

  const t0 = 2000000;
  await manager.action("start", "Review math notes", t0);

  // Simulated popup closed. 15 seconds elapse in browser.
  const t1 = t0 + 15000;

  // Simulated popup reopen: popup queries storage
  const state = await manager.getState();
  const activeSess = state.focusSession;
  assert.equal(activeSess.status, "running");

  // Popup computes elapsed
  const currentElapsed = elapsed(activeSess, t1);
  assert.equal(currentElapsed, 15000);
});

test("sessions: browser restart reconciliation pauses runaway timer", async () => {
  const storage = new MockStorage();
  const manager = new SessionManager(storage);

  const t0 = 3000000;
  await manager.action("start", "Prepare presentation", t0);

  // Heartbeat updated at t0 + 10,000 ms
  const s = (await manager.getState()).focusSession;
  s.updatedAt = t0 + 10000;
  await storage.set({ focusSession: s });

  // Browser was closed and reopened 5 hours (18,000,000 ms) later!
  const restartTime = t0 + 18000000;
  await manager.onBrowserStartup(restartTime);

  const reconciled = (await manager.getState()).focusSession;
  assert.equal(reconciled.status, "paused");
  // Elapsed time must be capped around the last heartbeat (10,000 ms), NOT 5 hours!
  assert.ok(reconciled.elapsedBeforeRun <= 70000);
  assert.ok(reconciled.elapsedBeforeRun >= 10000);
});

test("sessions: starting with empty objective saves as Untitled session upon finish", async () => {
  const storage = new MockStorage();
  const manager = new SessionManager(storage);

  const t0 = 4000000;
  const { session } = await manager.action("start", "", t0);
  assert.equal(session.status, "running");
  assert.equal(session.objective, "");

  const { history } = await manager.action("finish", null, t0 + 30000);
  assert.equal(history.length, 1);
  assert.equal(history[0].objective, "Untitled session");
  assert.equal(history[0].status, "completed");
});
