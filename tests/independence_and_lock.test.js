const test = require("node:test");
const assert = require("node:assert/strict");
const { focusMockClassify, focusEvaluatePolicy } = require("../policy.js");

// Mock storage helper
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

const parseTime = s => {
  const [h, m] = String(s || "0:0").split(":").map(Number);
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
};

function scheduleIsActive(s, now = new Date()) {
  if (!s || !s.scheduleEnabled) return false;
  const days = Array.isArray(s.scheduleDays) ? s.scheduleDays : [];
  const cur = now.getHours() * 60 + now.getMinutes();
  const a = parseTime(s.scheduleStart);
  const b = parseTime(s.scheduleEnd);
  const d = now.getDay();

  if (a === b) return days.includes(d);
  if (a < b) return days.includes(d) && cur >= a && cur < b;
  return (days.includes(d) && cur >= a) || (days.includes((d + 6) % 7) && cur < b);
}

function elapsed(s, now = Date.now()) {
  if (!s) return 0;
  return Math.max(0, (s.elapsedBeforeRun || 0) + (s.status === "running" ? Math.max(0, now - s.segmentStartedAt) : 0));
}

// Integrated test harness for testing Core Architecture:
// System A: Study Stopwatch
// System B: Scheduled Focus Lock
class IntegratedSystemHarness {
  constructor(initialSettings = {}) {
    this.storage = new MockStorage({
      settings: {
        objective: "",
        scheduleEnabled: false,
        scheduleStart: "18:00",
        scheduleEnd: "20:00",
        scheduleDays: [1, 2, 3, 4, 5],
        mixedPolicy: "block",
        uncertainPolicy: "block",
        failurePolicy: "block",
        channelAllowlist: [],
        channelBlocklist: [],
        ...initialSettings
      },
      focusSession: null,
      history: [],
      lastKnownLockState: false
    });
    this.broadcastCount = 0;
  }

  async readState() {
    return this.storage.data;
  }

  async broadcastPolicyChange() {
    this.broadcastCount++;
  }

  async reconcileScheduleState(now = new Date()) {
    const s = await this.readState();
    const currentlyActive = scheduleIsActive(s.settings, now);
    const lastKnown = s.lastKnownLockState ?? false;
    if (currentlyActive !== lastKnown) {
      await this.storage.set({ lastKnownLockState: currentlyActive });
      await this.broadcastPolicyChange();
    }
    return currentlyActive;
  }

  async getPolicyState(now = new Date()) {
    const s = await this.readState();
    const lockActive = scheduleIsActive(s.settings, now);
    return {
      lockActive,
      session: s.focusSession,
      settings: s.settings
    };
  }

  // Study Stopwatch Action (System A)
  async stopwatchAction(action, objective, now = Date.now()) {
    const s = await this.readState();
    let x = s.focusSession;

    if (action === "start") {
      if (x && ["running", "paused"].includes(x.status)) {
        throw new Error("A study session is already active.");
      }
      const sessionObjective = typeof objective === "string" ? objective.trim().slice(0, 160) : "";
      x = {
        id: "sess-" + Math.random().toString(36).slice(2, 8),
        objective: sessionObjective,
        startAt: now,
        segmentStartedAt: now,
        elapsedBeforeRun: 0,
        status: "running",
        updatedAt: now
      };
    } else if (action === "pause") {
      if (!x || x.status !== "running") throw new Error("No running session");
      x.elapsedBeforeRun = elapsed(x, now);
      x.status = "paused";
      x.updatedAt = now;
    } else if (action === "resume") {
      if (!x || x.status !== "paused") throw new Error("No paused session");
      x.segmentStartedAt = now;
      x.status = "running";
      x.updatedAt = now;
    } else if (action === "finish") {
      if (!x || !["running", "paused"].includes(x.status)) throw new Error("No active session");
      const dur = elapsed(x, now);
      const record = {
        id: x.id,
        objective: x.objective || "Untitled session",
        startAt: x.startAt,
        endAt: now,
        activeDurationMs: dur,
        status: "completed",
        updatedAt: now
      };
      const h = s.history || [];
      h.unshift(record);
      await this.storage.set({ history: h });
      x = null;
    }

    await this.storage.set({ focusSession: x });
    // Stopwatch does NOT broadcast policy changes because it does not affect Focus Lock!
    return this.getPolicyState(new Date(now));
  }

  // Settings modification
  async saveSettings(newSettings, now = new Date()) {
    await this.reconcileScheduleState(now);
    const p = await this.getPolicyState(now);
    if (p.lockActive) {
      throw new Error("Settings are protected and cannot be changed while scheduled Focus Lock is active.");
    }
    const current = (await this.readState()).settings;
    const updated = { ...current, ...newSettings };
    await this.storage.set({ settings: updated });
    await this.reconcileScheduleState(now);
    return updated;
  }

  // Video evaluation: governed exclusively by Focus Lock
  async evaluateVideo(meta, isShort, now = new Date()) {
    const p = await this.getPolicyState(now);
    if (!p.lockActive) {
      return {
        action: "ALLOW",
        reason: "Focus Lock is inactive; normal browsing and playback allowed"
      };
    }
    const cat = focusMockClassify(meta);
    return focusEvaluatePolicy({
      active: p.lockActive,
      isShort,
      category: cat,
      settings: p.settings
    });
  }

  // Simulated browser restart
  async onBrowserStartup(now = Date.now()) {
    await this.reconcileScheduleState(new Date(now));
    const s = await this.readState();
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

// =========================================================================
// THE 14 REQUIRED ARCHITECTURAL TESTS
// =========================================================================

// 1. Lock activates at the configured start time
test("1. Lock activates at the configured start time", () => {
  const settings = {
    scheduleEnabled: true,
    scheduleStart: "18:00",
    scheduleEnd: "20:00",
    scheduleDays: [4] // Thursday
  };
  const exactStartTime = new Date(2026, 9, 15, 18, 0, 0); // Thu 18:00:00
  assert.equal(scheduleIsActive(settings, exactStartTime), true);

  const oneMinuteBefore = new Date(2026, 9, 15, 17, 59, 59); // Thu 17:59:59
  assert.equal(scheduleIsActive(settings, oneMinuteBefore), false);
});

// 2. Lock deactivates at the configured end time
test("2. Lock deactivates at the configured end time", () => {
  const settings = {
    scheduleEnabled: true,
    scheduleStart: "18:00",
    scheduleEnd: "20:00",
    scheduleDays: [4] // Thursday
  };
  const rightBeforeEnd = new Date(2026, 9, 15, 19, 59, 59); // Thu 19:59:59
  assert.equal(scheduleIsActive(settings, rightBeforeEnd), true);

  const exactEndTime = new Date(2026, 9, 15, 20, 0, 0); // Thu 20:00:00
  assert.equal(scheduleIsActive(settings, exactEndTime), false);
});

// 3. Only selected weekdays activate the lock
test("3. Only selected weekdays activate the lock", () => {
  const settings = {
    scheduleEnabled: true,
    scheduleStart: "18:00",
    scheduleEnd: "20:00",
    scheduleDays: [1, 3, 5] // Mon, Wed, Fri
  };
  const mondayTime = new Date(2026, 9, 12, 19, 0, 0); // Monday -> Active
  const tuesdayTime = new Date(2026, 9, 13, 19, 0, 0); // Tuesday -> Inactive
  const wednesdayTime = new Date(2026, 9, 14, 19, 0, 0); // Wednesday -> Active
  const thursdayTime = new Date(2026, 9, 15, 19, 0, 0); // Thursday -> Inactive
  const fridayTime = new Date(2026, 9, 16, 19, 0, 0); // Friday -> Active

  assert.equal(scheduleIsActive(settings, mondayTime), true);
  assert.equal(scheduleIsActive(settings, tuesdayTime), false);
  assert.equal(scheduleIsActive(settings, wednesdayTime), true);
  assert.equal(scheduleIsActive(settings, thursdayTime), false);
  assert.equal(scheduleIsActive(settings, fridayTime), true);
});

// 4. Overnight schedules work correctly
test("4. Overnight schedules work correctly across midnight", () => {
  const settings = {
    scheduleEnabled: true,
    scheduleStart: "22:00",
    scheduleEnd: "02:00",
    scheduleDays: [4] // Thursday night into Friday morning
  };
  const thursdayLate = new Date(2026, 9, 15, 23, 30, 0); // Thu 23:30
  const fridayEarly = new Date(2026, 9, 16, 1, 30, 0);   // Fri 01:30
  const fridayPastEnd = new Date(2026, 9, 16, 2, 0, 0);   // Fri 02:00

  assert.equal(scheduleIsActive(settings, thursdayLate), true);
  assert.equal(scheduleIsActive(settings, fridayEarly), true);
  assert.equal(scheduleIsActive(settings, fridayPastEnd), false);
});

// 5. Lock state is independent of stopwatch state
test("5. Lock state is independent of stopwatch state", async () => {
  const harness = new IntegratedSystemHarness({
    scheduleEnabled: true,
    scheduleStart: "18:00",
    scheduleEnd: "20:00",
    scheduleDays: [4]
  });

  const timeDuringLock = new Date(2026, 9, 15, 19, 0, 0); // In lock window
  const timeOutsideLock = new Date(2026, 9, 15, 14, 0, 0); // Outside lock window

  // When stopwatch is stopped: lock state reflects schedule
  assert.equal((await harness.getPolicyState(timeDuringLock)).lockActive, true);
  assert.equal((await harness.getPolicyState(timeOutsideLock)).lockActive, false);

  // Start stopwatch
  await harness.stopwatchAction("start", "Calculus revision", timeOutsideLock.getTime());

  // Stopwatch running outside lock window does NOT activate lock
  assert.equal((await harness.getPolicyState(timeOutsideLock)).lockActive, false);

  // Stopwatch running inside lock window does not affect lock
  assert.equal((await harness.getPolicyState(timeDuringLock)).lockActive, true);
});

// 6. Starting the stopwatch does not activate the lock
test("6. Starting the stopwatch does not activate the lock", async () => {
  const harness = new IntegratedSystemHarness({
    scheduleEnabled: false // Schedule disabled
  });

  const now = new Date(2026, 9, 15, 15, 0, 0);
  assert.equal((await harness.getPolicyState(now)).lockActive, false);

  // Start the study stopwatch
  await harness.stopwatchAction("start", "Reading history", now.getTime());

  // Lock must remain INACTIVE
  const state = await harness.getPolicyState(now);
  assert.equal(state.lockActive, false);
  assert.equal(state.session.status, "running");

  // YouTube browsing must NOT be blocked
  const videoDecision = await harness.evaluateVideo(
    { title: "GTA 5 Funny Moments", channel: "Gamer" },
    false,
    now
  );
  assert.equal(videoDecision.action, "ALLOW");
  assert.match(videoDecision.reason, /inactive/i);
});

// 7. Finishing the stopwatch does not deactivate the lock
test("7. Finishing the stopwatch does not deactivate the lock", async () => {
  const harness = new IntegratedSystemHarness({
    scheduleEnabled: true,
    scheduleStart: "18:00",
    scheduleEnd: "20:00",
    scheduleDays: [4]
  });

  const t1 = new Date(2026, 9, 15, 18, 30, 0);
  await harness.stopwatchAction("start", "Coding data structures", t1.getTime());

  // Finish the stopwatch 20 mins later
  const t2 = new Date(2026, 9, 15, 18, 50, 0);
  await harness.stopwatchAction("finish", null, t2.getTime());

  // Lock must STILL be active because 18:50 is inside the scheduled window!
  const state = await harness.getPolicyState(t2);
  assert.equal(state.lockActive, true);
  assert.equal(state.session, null);
});

// 8. Lock remains effective when the stopwatch is stopped
test("8. Lock remains effective when the stopwatch is stopped", async () => {
  const harness = new IntegratedSystemHarness({
    scheduleEnabled: true,
    scheduleStart: "18:00",
    scheduleEnd: "20:00",
    scheduleDays: [4]
  });

  const lockTime = new Date(2026, 9, 15, 19, 15, 0);
  const state = await harness.getPolicyState(lockTime);
  assert.equal(state.session, null); // Stopwatch is not running
  assert.equal(state.lockActive, true); // Lock is active

  // Entertainment must be blocked
  const decision = await harness.evaluateVideo(
    { title: "Gameplay Walkthrough", channel: "Gamer" },
    false,
    lockTime
  );
  assert.equal(decision.action, "BLOCK");
});

// 9. Shorts are blocked while the lock is active
test("9. Shorts are blocked while the lock is active, even educational Shorts", async () => {
  const harness = new IntegratedSystemHarness({
    scheduleEnabled: true,
    scheduleStart: "18:00",
    scheduleEnd: "20:00",
    scheduleDays: [4]
  });
  const lockTime = new Date(2026, 9, 15, 19, 0, 0);

  const shortDecision = await harness.evaluateVideo(
    { title: "Calculus in 60s #shorts", channel: "Khan Academy" },
    true, // isShort = true
    lockTime
  );
  assert.equal(shortDecision.action, "BLOCK");
  assert.match(shortDecision.reason, /shorts are blocked/i);
});

// 10. Educational long-form videos are allowed
test("10. Educational long-form videos are allowed while lock is active", async () => {
  const harness = new IntegratedSystemHarness({
    scheduleEnabled: true,
    scheduleStart: "18:00",
    scheduleEnd: "20:00",
    scheduleDays: [4]
  });
  const lockTime = new Date(2026, 9, 15, 19, 0, 0);

  const eduDecision = await harness.evaluateVideo(
    { title: "MIT Physics 8.01 Classical Mechanics Lecture 1", channel: "MIT OpenCourseWare" },
    false,
    lockTime
  );
  assert.equal(eduDecision.action, "ALLOW");
  assert.match(eduDecision.reason, /educational/i);
});

// 11. Entertainment is blocked according to policy
test("11. Entertainment is blocked according to policy while lock is active", async () => {
  const harness = new IntegratedSystemHarness({
    scheduleEnabled: true,
    scheduleStart: "18:00",
    scheduleEnd: "20:00",
    scheduleDays: [4]
  });
  const lockTime = new Date(2026, 9, 15, 19, 0, 0);

  const entDecision = await harness.evaluateVideo(
    { title: "Hilarious Pranks Compilation & Memes", channel: "Prankster" },
    false,
    lockTime
  );
  assert.equal(entDecision.action, "BLOCK");
  assert.match(entDecision.reason, /entertainment/i);
});

// 12. Normal browsing resumes when the lock becomes inactive
test("12. Normal browsing resumes when the lock becomes inactive", async () => {
  const harness = new IntegratedSystemHarness({
    scheduleEnabled: true,
    scheduleStart: "18:00",
    scheduleEnd: "20:00",
    scheduleDays: [4]
  });

  const afterEndTime = new Date(2026, 9, 15, 20, 0, 1); // 20:00:01
  const state = await harness.getPolicyState(afterEndTime);
  assert.equal(state.lockActive, false);

  // Both entertainment videos and Shorts are allowed when lock is inactive
  const entertainmentDecision = await harness.evaluateVideo(
    { title: "Funny gaming video", channel: "Gamer" },
    false,
    afterEndTime
  );
  assert.equal(entertainmentDecision.action, "ALLOW");
  assert.match(entertainmentDecision.reason, /inactive/i);

  const shortDecision = await harness.evaluateVideo(
    { title: "Funny Short #shorts", channel: "ShortsCreator" },
    true,
    afterEndTime
  );
  assert.equal(shortDecision.action, "ALLOW");
  assert.match(shortDecision.reason, /inactive/i);
});

// 13. Browser and service worker restart recovery works
test("13. Browser and service worker restart recovery works correctly", async () => {
  const harness = new IntegratedSystemHarness({
    scheduleEnabled: true,
    scheduleStart: "18:00",
    scheduleEnd: "20:00",
    scheduleDays: [4]
  });

  // User starts stopwatch at 17:30
  const t0 = new Date(2026, 9, 15, 17, 30, 0).getTime();
  await harness.stopwatchAction("start", "Biology exam prep", t0);

  // Heartbeat updated at 17:35
  const s = (await harness.readState()).focusSession;
  s.updatedAt = t0 + 5 * 60 * 1000;
  await harness.storage.set({ focusSession: s });

  // Browser shuts down and restarts at 18:30 (inside Focus Lock window)
  const restartTime = new Date(2026, 9, 15, 18, 30, 0).getTime();
  await harness.onBrowserStartup(restartTime);

  // 1. Lock must be detected as ACTIVE immediately upon restart
  const state = await harness.getPolicyState(new Date(restartTime));
  assert.equal(state.lockActive, true);

  // 2. Stopwatch must be safely paused (not inflated by 1 hour of shutdown time)
  assert.equal(state.session.status, "paused");
  assert.ok(state.session.elapsedBeforeRun <= 6 * 60 * 1000); // capped around 5 mins
});

// 14. Settings protection follows the scheduled lock state
test("14. Settings protection follows the scheduled lock state", async () => {
  const harness = new IntegratedSystemHarness({
    scheduleEnabled: true,
    scheduleStart: "18:00",
    scheduleEnd: "20:00",
    scheduleDays: [4]
  });

  const duringLockTime = new Date(2026, 9, 15, 19, 0, 0);

  // While lock is active: attempting to change settings MUST be rejected
  await assert.rejects(
    async () => harness.saveSettings({ scheduleEnabled: false }, duringLockTime),
    /Settings are protected/
  );

  const afterLockTime = new Date(2026, 9, 15, 20, 5, 0);

  // When lock window ends: settings can be saved normally
  const updated = await harness.saveSettings({ dailyTargetMinutes: 180 }, afterLockTime);
  assert.equal(updated.dailyTargetMinutes, 180);
});

// 15. A fresh installation shows an empty default objective
test("15. A fresh installation shows an empty default objective", async () => {
  const harness = new IntegratedSystemHarness();
  const state = await harness.readState();
  assert.equal(state.settings.objective, "");
  assert.equal(state.focusSession, null);
});

// 16. An explicitly saved objective in settings is restored correctly
test("16. An explicitly saved objective in settings is restored correctly", async () => {
  const harness = new IntegratedSystemHarness();
  const savedObjective = "Study linear algebra";
  await harness.saveSettings({ objective: savedObjective });

  const state = await harness.readState();
  assert.equal(state.settings.objective, savedObjective);
});

// 17. An empty objective allows the stopwatch to start and records as Untitled session
test("17. An empty objective allows the stopwatch to start and records as Untitled session", async () => {
  const harness = new IntegratedSystemHarness();
  const t0 = Date.now();

  // Start with empty objective string
  const { session } = await harness.stopwatchAction("start", "", t0);
  assert.equal(session.status, "running");
  assert.equal(session.objective, "");

  // Finish session
  await harness.stopwatchAction("finish", null, t0 + 15000);

  const history = (await harness.readState()).history;
  assert.equal(history.length, 1);
  assert.equal(history[0].objective, "Untitled session");
});

// 18. User-entered session objective overrides empty default and persists in history
test("18. User-entered session objective overrides empty default and persists in history", async () => {
  const harness = new IntegratedSystemHarness();
  const t0 = Date.now();

  const userObjective = "Prepare chemistry lab report";
  const { session } = await harness.stopwatchAction("start", userObjective, t0);
  assert.equal(session.status, "running");
  assert.equal(session.objective, userObjective);

  await harness.stopwatchAction("finish", null, t0 + 25000);

  const history = (await harness.readState()).history;
  assert.equal(history.length, 1);
  assert.equal(history[0].objective, userObjective);
});
