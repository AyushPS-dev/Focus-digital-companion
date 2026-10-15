const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getStartOfDay,
  getStartOfWeek,
  getActiveOverlapMs,
  computeFocusAnalytics
} = require("../analytics.js");

test("analytics: getStartOfDay returns local midnight timestamp", () => {
  const d = new Date(2026, 9, 15, 14, 30, 0); // Oct 15, 2026 14:30
  const startOfDay = getStartOfDay(d.getTime());
  const check = new Date(startOfDay);
  assert.equal(check.getHours(), 0);
  assert.equal(check.getMinutes(), 0);
  assert.equal(check.getSeconds(), 0);
  assert.equal(check.getDate(), 15);
});

test("analytics: getStartOfWeek returns Monday midnight timestamp", () => {
  // Thursday, Oct 15, 2026
  const d = new Date(2026, 9, 15, 10, 0, 0);
  const startOfWeek = getStartOfWeek(d.getTime());
  const check = new Date(startOfWeek);
  assert.equal(check.getDay(), 1); // 1 = Monday
  assert.equal(check.getHours(), 0);
  assert.equal(check.getDate(), 12); // Oct 12, 2026 was Monday
});

test("analytics: active overlap partitions session crossing midnight correctly", () => {
  // Session starts yesterday at 23:45 and ends today at 00:30 (45 mins total = 2,700,000 ms)
  const todayMidnight = new Date(2026, 9, 15, 0, 0, 0).getTime();
  const sessionStart = todayMidnight - 15 * 60 * 1000; // 23:45 yesterday
  const sessionEnd = todayMidnight + 30 * 60 * 1000;   // 00:30 today
  const activeDurationMs = 45 * 60 * 1000;

  const session = {
    startAt: sessionStart,
    endAt: sessionEnd,
    activeDurationMs,
    status: "completed"
  };

  // Today's portion [todayMidnight, todayMidnight + 12 hours]
  const todayOverlap = getActiveOverlapMs(session, todayMidnight, todayMidnight + 12 * 3600 * 1000);
  assert.equal(todayOverlap, 30 * 60 * 1000); // exactly 30 minutes

  // Yesterday's portion [todayMidnight - 24 hours, todayMidnight]
  const yesterdayOverlap = getActiveOverlapMs(session, todayMidnight - 24 * 3600 * 1000, todayMidnight);
  assert.equal(yesterdayOverlap, 15 * 60 * 1000); // exactly 15 minutes
});

test("analytics: computeFocusAnalytics calculates today, week, average, and counts correctly", () => {
  const now = new Date(2026, 9, 15, 16, 0, 0).getTime(); // Thursday Oct 15 16:00
  const todayMidnight = new Date(2026, 9, 15, 0, 0, 0).getTime();
  const mondayMidnight = new Date(2026, 9, 12, 0, 0, 0).getTime();

  const history = [
    // Completed session earlier today: 50 mins
    {
      id: "s1",
      objective: "Study React",
      startAt: todayMidnight + 9 * 3600 * 1000,
      endAt: todayMidnight + 9 * 3600 * 1000 + 50 * 60 * 1000,
      activeDurationMs: 50 * 60 * 1000,
      status: "completed"
    },
    // Completed session yesterday (Wednesday): 40 mins
    {
      id: "s2",
      objective: "Read documentation",
      startAt: todayMidnight - 14 * 3600 * 1000,
      endAt: todayMidnight - 14 * 3600 * 1000 + 40 * 60 * 1000,
      activeDurationMs: 40 * 60 * 1000,
      status: "completed"
    },
    // Cancelled session today: 10 mins (should NOT count in completed sessions average)
    {
      id: "s3",
      objective: "Quick test",
      startAt: todayMidnight + 11 * 3600 * 1000,
      endAt: todayMidnight + 11 * 3600 * 1000 + 10 * 60 * 1000,
      activeDurationMs: 10 * 60 * 1000,
      status: "cancelled"
    }
  ];

  // Currently active running session: started 20 mins ago
  const currentSession = {
    id: "s4",
    objective: "Active task",
    startAt: now - 20 * 60 * 1000,
    segmentStartedAt: now - 20 * 60 * 1000,
    elapsedBeforeRun: 0,
    status: "running"
  };

  const metrics = computeFocusAnalytics({ history, currentSession, now });

  // Today includes: s1 (50m) + s3 (10m) + current s4 (20m) = 80m
  assert.equal(metrics.todayMinutes, 80);

  // This week includes: s1 (50m) + s2 (40m) + s3 (10m) + current s4 (20m) = 120m
  assert.equal(metrics.weekMinutes, 120);

  // Completed sessions count: only s1 and s2 (2 sessions)
  assert.equal(metrics.completedCount, 2);

  // Average completed session: (50 + 40) / 2 = 45m
  assert.equal(metrics.averageCompletedMinutes, 45);

  // Chart days must have 7 buckets
  assert.equal(metrics.chartDays.length, 7);

  // The last bucket (today) should have 80m
  const todayBucket = metrics.chartDays[metrics.chartDays.length - 1];
  assert.equal(todayBucket.minutes, 80);
});

test("analytics: handles empty history and no active session safely", () => {
  const metrics = computeFocusAnalytics({ history: [], currentSession: null, now: Date.now() });
  assert.equal(metrics.todayMinutes, 0);
  assert.equal(metrics.weekMinutes, 0);
  assert.equal(metrics.completedCount, 0);
  assert.equal(metrics.averageCompletedMinutes, 0);
  assert.equal(metrics.chartDays.length, 7);
});
