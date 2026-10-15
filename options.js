// FOCUS Digital Companion 2.0 - Options & Settings Script

const $ = id => document.getElementById(id);
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Initialize day checkboxes
const daysContainer = $("days");
daysContainer.innerHTML = "";
dayNames.forEach((n, i) => {
  const l = document.createElement("label");
  l.className = "day";
  l.innerHTML = `<input type="checkbox" value="${i}" ${i > 0 && i < 6 ? "checked" : ""}><span>${n}</span>`;
  daysContainer.appendChild(l);
});

let saved = {};
let isLockActive = false;

const esc = s =>
  String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function renderAnalytics(history = [], currentSession = null) {
  const metrics = computeFocusAnalytics({
    history,
    currentSession,
    now: Date.now()
  });

  $("today").textContent = `${metrics.todayMinutes}m`;
  $("week").textContent = `${metrics.weekMinutes}m`;
  $("average").textContent = `${metrics.averageCompletedMinutes}m`;
  $("completed").textContent = String(metrics.completedCount);

  // Render 7-day activity chart
  const maxMinutes = Math.max(30, ...metrics.chartDays.map(d => d.minutes));
  $("chart").innerHTML = metrics.chartDays
    .map(
      b => `<div class="bar-wrap">
        <small>${b.minutes}m</small>
        <div class="bar" style="height:${Math.max(4, Math.round((b.minutes / maxMinutes) * 100))}%"></div>
        <small>${b.dayName}</small>
      </div>`
    )
    .join("");

  // Render recent sessions list
  const recent = history.slice(0, 12);
  if (recent.length === 0) {
    $("history").innerHTML = '<p class="muted">No study sessions recorded yet. Real session history will appear here.</p>';
  } else {
    $("history").innerHTML = recent
      .map(x => {
        const dateStr = x.startAt ? new Date(x.startAt).toLocaleString() : "Unknown date";
        const durMins = Math.round((x.activeDurationMs || 0) / 60000);
        const statusBadge = x.status === "completed" ? "completed" : x.status || "ended";
        return `<div class="history-item">
          <div>
            <b>${esc(x.objective || "Untitled session")}</b>
            <small>${dateStr}</small>
          </div>
          <span>${durMins}m · ${statusBadge}</span>
        </div>`;
      })
      .join("");
  }
}

function updateLockStateUI(locked) {
  isLockActive = !!locked;
  const lockProtectedInputs = [
    $("mixed"),
    $("uncertain"),
    $("failure"),
    $("enabled"),
    $("startTime"),
    $("endTime"),
    $("backend"),
    ...document.querySelectorAll("#days input")
  ];

  lockProtectedInputs.forEach(el => {
    el.disabled = isLockActive;
  });

  $("save").disabled = isLockActive;

  if (isLockActive) {
    $("notice").style.color = "#fbbf24";
    $("notice").textContent =
      "Scheduled Focus Lock is currently active. Policy and schedule settings are protected and cannot be changed until the scheduled window ends.";
  } else {
    if ($("notice").textContent.includes("Scheduled Focus Lock is currently active")) {
      $("notice").textContent = "";
    }
  }
}

async function load() {
  const r = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (!r.ok) throw new Error(r.error || "Failed to load state");

  saved = r.settings || {};
  $("objective").value = saved.objective || "";
  $("target").value = saved.dailyTargetMinutes || 120;
  $("mixed").value = saved.mixedPolicy || "block";
  $("uncertain").value = saved.uncertainPolicy || "block";
  $("failure").value = saved.failurePolicy || "block";
  $("enabled").checked = !!saved.scheduleEnabled;
  $("startTime").value = saved.scheduleStart || "18:00";
  $("endTime").value = saved.scheduleEnd || "20:00";
  $("backend").value = saved.backendUrl || "";

  const activeDays = Array.isArray(saved.scheduleDays) ? saved.scheduleDays : [1, 2, 3, 4, 5];
  document.querySelectorAll("#days input").forEach(x => {
    x.checked = activeDays.includes(Number(x.value));
  });

  updateLockStateUI(r.lockActive);
  renderAnalytics(r.history || [], r.session || null);
}

$("save").onclick = async () => {
  if (isLockActive) {
    $("notice").style.color = "#ef4444";
    $("notice").textContent = "Settings are protected while Scheduled Focus Lock is active.";
    return;
  }

  const v = {
    ...saved,
    objective: $("objective").value.trim(),
    dailyTargetMinutes: Number($("target").value) || 120,
    mixedPolicy: $("mixed").value,
    uncertainPolicy: $("uncertain").value,
    failurePolicy: $("failure").value,
    scheduleEnabled: $("enabled").checked,
    scheduleStart: $("startTime").value,
    scheduleEnd: $("endTime").value,
    scheduleDays: [...document.querySelectorAll("#days input:checked")].map(x => Number(x.value)),
    backendUrl: $("backend").value.trim()
  };

  try {
    const r = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: v });
    if (!r.ok) throw new Error(r.error || "Failed to save settings");
    saved = v;
    $("notice").style.color = "#10b981";
    $("notice").textContent = "Settings saved successfully.";
    updateLockStateUI(r.lockActive);
    setTimeout(() => {
      if (!isLockActive) $("notice").textContent = "";
    }, 3000);
  } catch (e) {
    $("notice").style.color = "#ef4444";
    $("notice").textContent = e.message || String(e);
  }
};

$("reload").onclick = () => {
  load()
    .then(() => {
      $("notice").style.color = "#10b981";
      $("notice").textContent = "Settings reloaded.";
      setTimeout(() => {
        if (!isLockActive) $("notice").textContent = "";
      }, 2000);
    })
    .catch(e => {
      $("notice").style.color = "#ef4444";
      $("notice").textContent = e.message || String(e);
    });
};

load().catch(e => {
  $("notice").textContent = e.message;
});