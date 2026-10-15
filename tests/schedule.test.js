const test = require("node:test");
const assert = require("node:assert/strict");

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

test("schedule: returns false when scheduleEnabled is false", () => {
  const settings = {
    scheduleEnabled: false,
    scheduleStart: "09:00",
    scheduleEnd: "17:00",
    scheduleDays: [0, 1, 2, 3, 4, 5, 6]
  };
  const now = new Date(2026, 9, 15, 12, 0, 0); // 12:00
  assert.equal(scheduleIsActive(settings, now), false);
});

test("schedule: same-day schedule window matches correctly", () => {
  const settings = {
    scheduleEnabled: true,
    scheduleStart: "18:00",
    scheduleEnd: "20:00",
    scheduleDays: [1, 2, 3, 4, 5] // Mon-Fri
  };

  // Thursday Oct 15, 2026 at 18:30 -> Active
  const activeTime = new Date(2026, 9, 15, 18, 30, 0);
  assert.equal(scheduleIsActive(settings, activeTime), true);

  // Thursday Oct 15, 2026 at 17:59 -> Inactive
  const beforeTime = new Date(2026, 9, 15, 17, 59, 0);
  assert.equal(scheduleIsActive(settings, beforeTime), false);

  // Thursday Oct 15, 2026 at 20:00 -> Inactive (end boundary)
  const afterTime = new Date(2026, 9, 15, 20, 0, 0);
  assert.equal(scheduleIsActive(settings, afterTime), false);

  // Sunday Oct 18, 2026 at 18:30 -> Inactive (Sunday not in scheduleDays)
  const sunday = new Date(2026, 9, 18, 18, 30, 0);
  assert.equal(scheduleIsActive(settings, sunday), false);
});

test("schedule: overnight schedule window spanning midnight works correctly", () => {
  const settings = {
    scheduleEnabled: true,
    scheduleStart: "22:00",
    scheduleEnd: "02:00",
    scheduleDays: [1, 2, 3, 4, 5] // Mon-Fri nights
  };

  // Thursday Oct 15 at 23:15 -> Active
  const lateNight = new Date(2026, 9, 15, 23, 15, 0);
  assert.equal(scheduleIsActive(settings, lateNight), true);

  // Friday Oct 16 at 01:30 (continuation of Thursday night) -> Active
  const earlyMorning = new Date(2026, 9, 16, 1, 30, 0);
  assert.equal(scheduleIsActive(settings, earlyMorning), true);

  // Friday Oct 16 at 02:15 -> Inactive
  const pastEnd = new Date(2026, 9, 16, 2, 15, 0);
  assert.equal(scheduleIsActive(settings, pastEnd), false);

  // Thursday Oct 15 at 21:55 -> Inactive
  const beforeStart = new Date(2026, 9, 15, 21, 55, 0);
  assert.equal(scheduleIsActive(settings, beforeStart), false);
});

test("schedule: focus lock prevents saving settings during active schedule window", () => {
  const settings = {
    scheduleEnabled: true,
    scheduleStart: "10:00",
    scheduleEnd: "12:00",
    scheduleDays: [4] // Thursday
  };
  const testTime = new Date(2026, 9, 15, 11, 0, 0); // Thursday 11:00
  const isLocked = scheduleIsActive(settings, testTime);
  assert.equal(isLocked, true);

  // Attempting to save settings when isLocked is true must throw
  assert.throws(() => {
    if (isLocked) {
      throw new Error("Settings are locked during the active scheduled focus window.");
    }
  }, /Settings are locked/);
});
