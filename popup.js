// FOCUS Digital Companion 2.0 - Popup Script
// Controls Study Stopwatch & displays Scheduled Focus Lock status

const $ = id => document.getElementById(id);
let st = null;
let hist = [];
let objectiveInitialized = false;

function elapsed(s) {
  if (!s) return 0;
  return Math.max(0, (s.elapsedBeforeRun || 0) + (s.status === "running" ? Date.now() - s.segmentStartedAt : 0));
}

function fmt(ms) {
  const n = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  return [h, m, sec].map(x => String(x).padStart(2, "0")).join(":");
}

function syncObjectiveField() {
  const s = st?.session;
  if (s) {
    // Session is active: lock input to current session objective
    $("objective").value = s.objective || "";
    $("objective").disabled = true;
    objectiveInitialized = false; // Reset so next idle session can re-sync
  } else {
    // Session is idle: enable input for user entry
    $("objective").disabled = false;
    if (!objectiveInitialized) {
      // Restore explicitly saved default objective if present; otherwise keep empty
      $("objective").value = st?.settings?.objective || "";
      objectiveInitialized = true;
    }
  }
}

function render() {
  const s = st?.session;
  $("timer").textContent = fmt(elapsed(s));

  // Focus Lock authority badge
  if (st?.lockActive) {
    $("badge").textContent = "Focus Lock Active";
    $("badge").classList.add("active");
  } else {
    $("badge").textContent = "Lock Inactive";
    $("badge").classList.remove("active");
  }

  // Study Stopwatch state message
  if (s) {
    $("state").textContent = s.status === "paused" ? "Stopwatch paused" : "Study stopwatch in progress";
  } else if (st?.lockActive) {
    $("state").textContent = "Scheduled Focus Lock is active. Ready to track study time.";
  } else {
    $("state").textContent = "Ready when you are.";
  }

  // Stopwatch action buttons
  $("start").hidden = !!s;
  $("pause").hidden = !s || s.status !== "running";
  $("resume").hidden = !s || s.status !== "paused";
  $("finish").hidden = !s;

  // Study analytics
  const metrics = computeFocusAnalytics({
    history: hist,
    currentSession: s,
    now: Date.now()
  });

  $("today").textContent = `${metrics.todayMinutes}m`;
  $("completed").textContent = String(metrics.completedCount);
}

async function refresh() {
  const r = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (!r.ok) throw new Error(r.error || "Failed to load state");
  st = r;
  hist = r.history || [];
  syncObjectiveField();
  render();
}

async function action(a) {
  try {
    const objective = $("objective").value.trim();
    const r = await chrome.runtime.sendMessage({
      type: "SESSION_ACTION",
      action: a,
      objective
    });
    if (!r.ok) throw new Error(r.error || "Action failed");
    await refresh();
    $("notice").textContent = "";
  } catch (e) {
    $("notice").textContent = e.message || String(e);
  }
}

$("start").onclick = () => action("start");
$("pause").onclick = () => action("pause");
$("resume").onclick = () => action("resume");
$("finish").onclick = () => action("finish");

refresh().catch(e => {
  $("notice").textContent = e.message;
});

// Periodic timer update (only updates elapsed timer and stats; does not touch objective input)
setInterval(() => {
  if (st) render();
}, 500);