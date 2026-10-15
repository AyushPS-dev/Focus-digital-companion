// FOCUS Digital Companion - Analytics & Time Calculation Utilities

function getStartOfDay(timestamp) {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getStartOfWeek(timestamp) {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  // Monday as start of week (ISO standard): Sunday is 0 -> 6, Mon is 1 -> 0
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.getTime();
}

/**
 * Calculates how much active duration of a session falls within a given [windowStart, windowEnd] interval.
 * Correctly accounts for sessions crossing midnight or week boundaries.
 */
function getActiveOverlapMs(session, windowStart, windowEnd) {
  if (!session) return 0;
  const start = session.startAt;
  const end = session.endAt || Date.now();
  const activeDuration = session.activeDurationMs != null ? session.activeDurationMs : (session.elapsedBeforeRun || 0);

  if (start >= windowEnd || end <= windowStart) return 0;

  const overlapStart = Math.max(start, windowStart);
  const overlapEnd = Math.min(end, windowEnd);
  const overlapSpan = Math.max(0, overlapEnd - overlapStart);
  const totalSpan = Math.max(1, end - start);

  // If activeDuration is greater than or equal to total span (e.g. continuous run),
  // active time in window equals overlap span.
  if (activeDuration >= totalSpan) {
    return Math.min(overlapSpan, activeDuration);
  }

  // Otherwise, proportionally allocate active duration over the total duration window
  const activeRatio = Math.max(0, Math.min(1, activeDuration / totalSpan));
  return Math.round(overlapSpan * activeRatio);
}

/**
 * Computes all analytics metrics from history and optional active session.
 */
function computeFocusAnalytics({ history = [], currentSession = null, now = Date.now() }) {
  const todayStart = getStartOfDay(now);
  const weekStart = getStartOfWeek(now);

  // If there is an active session, construct a transient record with current elapsed time
  let activeRecord = null;
  if (currentSession && (currentSession.status === "running" || currentSession.status === "paused")) {
    const elapsed = (currentSession.elapsedBeforeRun || 0) +
      (currentSession.status === "running" ? Math.max(0, now - currentSession.segmentStartedAt) : 0);
    activeRecord = {
      id: currentSession.id,
      objective: currentSession.objective || "In Progress",
      startAt: currentSession.startAt,
      endAt: now,
      activeDurationMs: elapsed,
      status: currentSession.status
    };
  }

  const allRecords = activeRecord ? [activeRecord, ...history] : [...history];

  // Calculate Today's active focus time
  let todayMs = 0;
  for (const s of allRecords) {
    todayMs += getActiveOverlapMs(s, todayStart, now);
  }

  // Calculate This Week's active focus time
  let weekMs = 0;
  for (const s of allRecords) {
    weekMs += getActiveOverlapMs(s, weekStart, now);
  }

  // Completed sessions only from finalized history
  const completedSessions = history.filter(s => s.status === "completed");
  const completedCount = completedSessions.length;
  const completedDurationMs = completedSessions.reduce((sum, s) => sum + (s.activeDurationMs || 0), 0);
  const averageCompletedMs = completedCount > 0 ? Math.round(completedDurationMs / completedCount) : 0;

  // Build 7-day activity chart (today and previous 6 days)
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const chartDays = [];
  const midnightToday = new Date(todayStart);

  for (let i = 6; i >= 0; i--) {
    const dayDate = new Date(midnightToday);
    dayDate.setDate(dayDate.getDate() - i);
    const dayStart = dayDate.getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;

    let dayActiveMs = 0;
    for (const s of allRecords) {
      dayActiveMs += getActiveOverlapMs(s, dayStart, Math.min(now, dayEnd));
    }

    const dayMinutes = Math.round(dayActiveMs / 60000);
    const dayKey = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, "0")}-${String(dayDate.getDate()).padStart(2, "0")}`;

    chartDays.push({
      dateKey: dayKey,
      dayName: dayNames[dayDate.getDay()],
      minutes: dayMinutes,
      activeMs: dayActiveMs
    });
  }

  return {
    todayMinutes: Math.round(todayMs / 60000),
    todayMs,
    weekMinutes: Math.round(weekMs / 60000),
    weekMs,
    completedCount,
    averageCompletedMinutes: Math.round(averageCompletedMs / 60000),
    averageCompletedMs,
    chartDays
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getStartOfDay,
    getStartOfWeek,
    getActiveOverlapMs,
    computeFocusAnalytics
  };
}
