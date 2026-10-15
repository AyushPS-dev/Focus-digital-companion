// FOCUS Digital Companion 2.0 - Background Service Worker
// CORE ARCHITECTURE:
// System A: STUDY STOPWATCH (Pure study tracking, does not alter blocking)
// System B: SCHEDULED FOCUS LOCK (Authority for content blocking & settings protection)
// NEVER couple their states or lifecycles.

importScripts("policy.js", "analytics.js");

const DEFAULTS = {
  objective: "",
  dailyTargetMinutes: 120,
  mixedPolicy: "block",
  uncertainPolicy: "block",
  failurePolicy: "block",
  scheduleEnabled: false,
  scheduleStart: "18:00",
  scheduleEnd: "20:00",
  scheduleDays: [1, 2, 3, 4, 5],
  backendUrl: "",
  channelAllowlist: [],
  channelBlocklist: [],
  focusSession: null,
  history: [],
  lastKnownLockState: false
};

async function readState() {
  const d = await chrome.storage.local.get(DEFAULTS);
  return d;
}

const parseTime = s => {
  const [h, m] = String(s || "0:0").split(":").map(Number);
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
};

/**
 * Pure evaluation of whether the scheduled Focus Lock is active at a given time.
 * Handles same-day windows and overnight windows crossing midnight.
 */
function scheduleIsActive(s, now = new Date()) {
  if (!s || !s.scheduleEnabled) return false;
  const days = Array.isArray(s.scheduleDays) ? s.scheduleDays : [];
  const cur = now.getHours() * 60 + now.getMinutes();
  const a = parseTime(s.scheduleStart);
  const b = parseTime(s.scheduleEnd);
  const d = now.getDay();

  if (a === b) return days.includes(d);
  if (a < b) return days.includes(d) && cur >= a && cur < b;
  // Overnight schedule spanning midnight:
  // e.g. 22:00 to 02:00 on Mon (d=1) means:
  // - Mon 22:00..23:59: d=1 is in days, cur >= 22:00
  // - Tue 00:00..01:59: (d+6)%7 = 1 is in days, cur < 02:00
  return (days.includes(d) && cur >= a) || (days.includes((d + 6) % 7) && cur < b);
}

function elapsed(s, now = Date.now()) {
  if (!s) return 0;
  return Math.max(0, (s.elapsedBeforeRun || 0) + (s.status === "running" ? Math.max(0, now - s.segmentStartedAt) : 0));
}

/**
 * Returns current state:
 * - lockActive: Authority for content blocking. True ONLY when schedule is active.
 * - session: The Study Stopwatch state. Completely independent of lockActive.
 */
async function policyState(now = new Date()) {
  const s = await readState();
  const lockActive = scheduleIsActive(s, now);
  return {
    lockActive,
    scheduledActive: lockActive,
    active: lockActive, // Compatibility alias for policy engine: blocking authority is lockActive
    session: s.focusSession,
    settings: s,
    lockReason: lockActive
      ? "Scheduled Focus Lock is active"
      : "Focus Lock is inactive"
  };
}

async function broadcastPolicyChange() {
  try {
    const tabs = await chrome.tabs.query({ url: "https://www.youtube.com/*" });
    for (const t of tabs) {
      if (t.id) {
        chrome.tabs.sendMessage(t.id, { type: "FOCUS_POLICY_CHANGED" }).catch(() => {});
      }
    }
  } catch {}
}

/**
 * State reconciliation engine for Scheduled Focus Lock.
 * Detects transitions (inactive -> active or active -> inactive) and notifies tabs.
 */
async function reconcileScheduleState(now = new Date()) {
  const s = await readState();
  const currentlyActive = scheduleIsActive(s, now);
  const lastKnown = s.lastKnownLockState ?? false;

  if (currentlyActive !== lastKnown) {
    await chrome.storage.local.set({ lastKnownLockState: currentlyActive });
    await broadcastPolicyChange();
  }
  return currentlyActive;
}

// ==================================================
// SYSTEM A: STUDY STOPWATCH
// Independent study-tracking feature.
// Does NOT activate, deactivate, or alter Focus Lock.
// ==================================================
async function sessionAction(action, objective) {
  const s = await readState();
  let x = s.focusSession;
  const now = Date.now();

  if (action === "start") {
    if (x && ["running", "paused"].includes(x.status)) {
      throw new Error("A study session is already active.");
    }
    const sessionObjective = typeof objective === "string" ? objective.trim().slice(0, 160) : "";
    x = {
      id: crypto.randomUUID(),
      objective: sessionObjective,
      startAt: now,
      segmentStartedAt: now,
      elapsedBeforeRun: 0,
      status: "running",
      updatedAt: now
    };
  } else if (action === "pause") {
    if (!x || x.status !== "running") {
      throw new Error("No running study session to pause.");
    }
    x.elapsedBeforeRun = elapsed(x, now);
    x.status = "paused";
    x.updatedAt = now;
  } else if (action === "resume") {
    if (!x || x.status !== "paused") {
      throw new Error("No paused study session to resume.");
    }
    x.segmentStartedAt = now;
    x.status = "running";
    x.updatedAt = now;
  } else if (action === "finish" || action === "cancel") {
    if (!x || !["running", "paused"].includes(x.status)) {
      throw new Error("No active study session to finish.");
    }
    const dur = elapsed(x, now);
    const record = {
      id: x.id,
      objective: x.objective || "Untitled session",
      startAt: x.startAt,
      endAt: now,
      activeDurationMs: dur,
      pausedDurationMs: Math.max(0, now - x.startAt - dur),
      status: action === "finish" ? "completed" : "cancelled",
      updatedAt: now
    };
    const h = s.history || [];
    if (!h.some(r => r.id === record.id)) {
      h.unshift(record);
    }
    s.history = h.slice(0, 1000);
    x = null;
  } else {
    throw new Error(`Unknown session action: ${action}`);
  }

  await chrome.storage.local.set({ focusSession: x, history: s.history || [] });
  // Notice: Stopwatch actions DO NOT broadcast policy changes because they do not affect Focus Lock!
  return policyState();
}

// ==================================================
// SYSTEM B: SCHEDULED FOCUS LOCK - CONTENT CLASSIFICATION
// Content blocking is enforced ONLY when Focus Lock is active.
// When Focus Lock is inactive, all normal browsing & playback is allowed.
// ==================================================
async function classifyVideo(meta = {}, isShort = false) {
  // Reconcile schedule state on demand
  await reconcileScheduleState();
  const p = await policyState();
  const channel = meta.channel || "";

  // 1. If Focus Lock is inactive: NORMAL BROWSING RESUMES UNRESTRICTED.
  if (!p.lockActive) {
    return {
      category: "INACTIVE",
      decision: { action: "ALLOW", reason: "Focus Lock is inactive; normal playback allowed" },
      source: "policy"
    };
  }

  // Focus Lock is ACTIVE: Enforce configured blocking policies.

  // 2. Shorts rule precedes everything else during active lock
  if (isShort) {
    return {
      category: "SHORTS",
      decision: {
        action: "BLOCK",
        reason: "All YouTube Shorts are blocked while Focus Lock is active, including educational Shorts"
      },
      source: "policy"
    };
  }

  // 3. Channel blocklist
  const blocklist = p.settings.channelBlocklist || [];
  if (channel && blocklist.some(c => String(c).trim().toLowerCase() === channel.trim().toLowerCase())) {
    return {
      category: "BLOCKLISTED",
      decision: { action: "BLOCK", reason: `Channel "${channel}" is on your blocklist` },
      source: "channel_blocklist"
    };
  }

  // 4. Channel allowlist (long-form only, cannot override Shorts)
  const allowlist = p.settings.channelAllowlist || [];
  if (channel && allowlist.some(c => String(c).trim().toLowerCase() === channel.trim().toLowerCase())) {
    return {
      category: "ALLOWLISTED",
      decision: { action: "ALLOW", reason: `Channel "${channel}" is on your allowlist` },
      source: "channel_allowlist"
    };
  }

  // 5. Backend AI / classification endpoint if configured
  const backend = (p.settings.backendUrl || "").trim().replace(/\/+$/, "");
  if (backend) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    try {
      const resp = await fetch(`${backend}/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: meta.url || "",
          videoId: meta.videoId || "",
          title: meta.title || "",
          channel: meta.channel || "",
          description: meta.description || "",
          isShort: !!isShort,
          objective: p.session?.objective || p.settings.objective || ""
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        throw new Error(`Backend returned HTTP status ${resp.status}`);
      }

      const json = await resp.json();
      const cat = String(json.category || "").toUpperCase();
      if (!["EDUCATIONAL", "ENTERTAINMENT", "MIXED", "UNCERTAIN"].includes(cat)) {
        throw new Error(`Unexpected category: "${cat}"`);
      }

      const decision = focusEvaluatePolicy({
        active: p.lockActive,
        isShort: !!isShort,
        category: cat,
        settings: p.settings,
        failed: false,
        channel
      });
      if (json.reason) decision.reason = json.reason;

      return { category: cat, decision, source: "backend_ai" };
    } catch (err) {
      clearTimeout(timeout);
      const decision = focusEvaluatePolicy({
        active: p.lockActive,
        isShort: !!isShort,
        settings: p.settings,
        failed: true,
        channel
      });
      return {
        category: "FAILURE",
        decision,
        source: "backend_failure_fallback",
        error: err.message
      };
    }
  }

  // 6. Local heuristic classifier (no backend configured)
  const cat = focusMockClassify(meta);
  const decision = focusEvaluatePolicy({
    active: p.lockActive,
    isShort: !!isShort,
    category: cat,
    settings: p.settings,
    failed: false,
    channel
  });
  return { category: cat, decision, source: "local_mock" };
}

// Lifecycle listeners
chrome.runtime.onInstalled.addListener(async () => {
  const s = await chrome.storage.local.get(null);
  if (!("scheduleEnabled" in s)) {
    await chrome.storage.local.set(DEFAULTS);
  }
  chrome.alarms.create("focus-schedule", { periodInMinutes: 1 });
  await reconcileScheduleState();
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create("focus-schedule", { periodInMinutes: 1 });

  // Reconcile schedule state immediately on browser startup
  await reconcileScheduleState();

  // Handle browser restart for Study Stopwatch: reconcile running session
  // so elapsed time does not accumulate while browser was closed.
  const s = await readState();
  if (s.focusSession && s.focusSession.status === "running") {
    const x = s.focusSession;
    const now = Date.now();
    const lastHeartbeat = x.updatedAt || x.segmentStartedAt || x.startAt;
    const additionalTime = Math.min(Math.max(0, lastHeartbeat - x.segmentStartedAt), 60000);
    x.elapsedBeforeRun = (x.elapsedBeforeRun || 0) + additionalTime;
    x.status = "paused";
    x.updatedAt = now;
    await chrome.storage.local.set({ focusSession: x });
  }
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === "focus-schedule") {
    // 1. Reconcile schedule active state and broadcast if transitioned
    await reconcileScheduleState();

    // 2. Update stopwatch session heartbeat if active
    const s = await readState();
    if (s.focusSession && s.focusSession.status === "running") {
      s.focusSession.updatedAt = Date.now();
      await chrome.storage.local.set({ focusSession: s.focusSession });
    }
  }
});

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    if (!m || typeof m.type !== "string") throw new Error("Invalid message format");

    if (m.type === "GET_STATE") {
      await reconcileScheduleState();
      const p = await policyState();
      const s = await readState();
      const analytics = computeFocusAnalytics({
        history: s.history || [],
        currentSession: s.focusSession,
        now: Date.now()
      });
      return {
        ok: true,
        ...p,
        history: s.history || [],
        analytics
      };
    }

    if (m.type === "SESSION_ACTION") {
      const p = await sessionAction(m.action, m.objective);
      return { ok: true, ...p };
    }

    if (m.type === "CLASSIFY") {
      const res = await classifyVideo(m.meta || {}, !!m.isShort);
      return { ok: true, ...res };
    }

    if (m.type === "SAVE_SETTINGS") {
      await reconcileScheduleState();
      const p = await policyState();

      // ==================================================
      // SETTINGS PROTECTION:
      // While Focus Lock is active, settings cannot be changed.
      // ==================================================
      if (p.lockActive) {
        throw new Error("Settings are protected and cannot be changed while scheduled Focus Lock is active.");
      }

      const old = await readState();
      const v = m.settings || {};
      const next = {
        ...old,
        ...v,
        dailyTargetMinutes: Math.max(5, Math.min(1440, Number(v.dailyTargetMinutes) || 120)),
        scheduleDays: Array.isArray(v.scheduleDays)
          ? v.scheduleDays.map(Number).filter(n => n >= 0 && n <= 6)
          : [1, 2, 3, 4, 5],
        backendUrl: String(v.backendUrl || "").trim()
      };
      await chrome.storage.local.set(next);

      // Reconcile against newly saved schedule
      await reconcileScheduleState();
      const updated = await policyState();
      return { ok: true, ...updated };
    }

    throw new Error(`Unknown message type: ${m.type}`);
  })()
    .then(reply)
    .catch(e => reply({ ok: false, error: e.message || "Unexpected error" }));

  return true;
});