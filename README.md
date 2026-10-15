# FOCUS Digital Companion 2.0

**“Block distractions, not learning.”**

FOCUS Digital Companion 2.0 is built on a clear, decoupled architecture consisting of **two completely independent systems**:

1. **System A: Study Stopwatch** — Pure study-tracking stopwatch and analytics.
2. **System B: Scheduled Focus Lock** — The sole authority for selective YouTube content blocking and settings protection.

---

## Core Architecture

```
+-----------------------------------------------------------------------------------+
|                           FOCUS Digital Companion 2.0                             |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  [SYSTEM A: STUDY STOPWATCH]                      [SYSTEM B: SCHEDULED FOCUS LOCK]|
|  - Start, pause, resume, finish                   - Authority for content blocking|
|  - Track time towards study objective             - Recurring weekday schedule    |
|  - Persist timer & session history                - Protects settings when active |
|  - Analytics (Today, Week, Average, Chart)        - Same-day & overnight windows  |
|                                                                                   |
|  * Does NOT activate or deactivate Focus Lock!     * Runs on schedule whether      |
|  * Purely tracks study sessions.                    stopwatch is running, paused, |
|                                                     or stopped!                   |
+-----------------------------------------------------------------------------------+
                                          |
                                          | (When Focus Lock is active)
                                          v
+-----------------------------------------------------------------------------------+
|                         SELECTIVE YOUTUBE BLOCKING                                |
|                                                                                   |
|  - All YouTube Shorts: STRICTLY BLOCKED (including educational Shorts)            |
|  - Educational long-form: ALLOWED (all academic subjects, even if not objective)  |
|  - Entertainment: BLOCKED according to policy                                     |
|  - Mixed / Uncertain: Follows user's configured policy (Block vs Allow)           |
|  - Channel Allowlist / Blocklist: Allowlist cannot override Shorts                |
|  - When Focus Lock is INACTIVE: Normal browsing resumes unrestricted              |
+-----------------------------------------------------------------------------------+
```

---

## 1. Study Stopwatch (System A)

- **Stopwatch Controls**: Start, Pause, Resume, and Finish buttons.
- **Persistent Elapsed Time**: Displays `HH:MM:SS`. Remains accurate across popup closures and browser restarts.
- **Restart Recovery**: Reconciles active stopwatch segments upon browser startup, pausing gracefully so elapsed time does not run away when the browser was closed.
- **Analytics & History**: Calculates today's study minutes, weekly study minutes, completed count, average duration, and 7-day activity bar chart with boundary-safe midnight and week calculations ([analytics.js](file:///c:/Users/Lenovo/Downloads/FOCUS%202.0/analytics.js)).
- **Complete Decoupling**: Starting, pausing, resuming, or finishing the stopwatch **never** activates or deactivates Focus Lock or content blocking.

---

## 2. Scheduled Focus Lock (System B)

- **Schedule Authority**: Focus Lock is governed exclusively by the configured recurring schedule:
  - Enable recurring schedule toggle.
  - Start time (e.g., `18:00`).
  - End time (e.g., `20:00`).
  - Active weekdays (e.g., Monday through Friday).
- **Exact Boundaries**:
  - Before 18:00: Focus Lock is inactive. Normal browsing allowed.
  - 18:00 to 20:00: Focus Lock is active. Blocking policies enforced.
  - 20:00: Focus Lock becomes inactive. Normal playback resumes.
- **Overnight Windows**: Handles schedules spanning midnight (e.g., `22:00` to `02:00`).
- **State Reconciliation**: Evaluates current time dynamically on every navigation, request, alarm, and browser restart. Detects state transitions and immediately broadcasts `FOCUS_POLICY_CHANGED` to all open YouTube tabs.
- **Settings Protection**: While Focus Lock is active, settings cannot be changed or weakened. Normal access is restored when the lock window ends.

---

## 3. YouTube Content Blocking Rules (While Focus Lock is Active)

1. **Shorts Rule (Mandatory)**: All YouTube Shorts (`/shorts/*`) are blocked, including educational Shorts. Channel allowlists cannot override this rule.
2. **Educational Content**: Ordinary long-form educational videos (calculus, programming, biology, physics, history, etc.) are allowed, even if the subject differs from the current study objective.
3. **Entertainment**: Blocked during active Focus Lock.
4. **Mixed & Uncertain Content**: Follows user's configured choice ("block" by default or "allow").
5. **Channel Allowlist & Blocklist**: Channel-level rules apply to long-form videos only.
6. **Playback Enforcement**: Media elements are paused and reset to `currentTime = 0`. An overlay displays the exact reason for the block.
7. **When Inactive**: Normal YouTube playback and website browsing work without restriction.

---

## Automated Test Suite

A comprehensive test suite verifies both systems and their complete independence:

```bash
npm test
```

### Test Results (42 tests pass, 0 failures):
- **Independence & Lock (14 tests)**:
  1. Lock activates at configured start time.
  2. Lock deactivates at configured end time.
  3. Only selected weekdays activate the lock.
  4. Overnight schedules work correctly across midnight.
  5. Lock state is independent of stopwatch state.
  6. Starting the stopwatch does not activate the lock.
  7. Finishing the stopwatch does not deactivate the lock.
  8. Lock remains effective when the stopwatch is stopped.
  9. Shorts are blocked while the lock is active.
  10. Educational long-form videos are allowed while lock is active.
  11. Entertainment is blocked according to policy while lock is active.
  12. Normal browsing resumes when the lock becomes inactive.
  13. Browser and service worker restart recovery works correctly.
  14. Settings protection follows the scheduled lock state.
- **Policy Engine (11 tests)**: Keyword classification, mixed/uncertain policies, Shorts precedence, channel allowlists/blocklists, failure fallback.
- **Analytics Engine (5 tests)**: Midnight partition calculations, start of week, average durations, 7-day chart buckets.
- **Schedule Engine (4 tests)**: Same-day, overnight, inactive days, and schedule enabled toggle.
- **Session Lifecycle (3 tests)**: Stopwatch start/pause/resume/finish, persistence across popup close, browser restart reconciliation.
- **Backend AI (5 tests)**: Live mock HTTP server integration, educational/entertainment verification, offline failure fallback, 500 error handling.

---

## Microsoft Edge Manual Verification Steps

1. In Microsoft Edge, navigate to `edge://extensions`.
2. Toggle on **Developer mode** in the left sidebar.
3. Click **Load unpacked** and select `c:\Users\Lenovo\Downloads\FOCUS 2.0`.
4. Click the extensions icon and pin **FOCUS Digital Companion**.

### Verification Checklist:
- **Test 1: Stopwatch Independence Outside Schedule**:
  - When schedule is not active (or disabled), open popup and click **Start session**.
  - Notice the header badge says **Lock Inactive**.
  - Open YouTube and play any video or Short: verify playback works normally and is **not** blocked.
  - Finish the session: verify the session is saved in Completed stats.
- **Test 2: Scheduled Focus Lock Activation**:
  - Open **Settings & analytics ↗**. Enable recurring schedule, select today's weekday, and set a time window that includes the current local time. Click **Save settings**.
  - Notice the popup badge now displays **Focus Lock Active**.
  - Open a YouTube Short (`/shorts/...`): verify it is blocked with the overlay.
  - Open an educational long-form video: verify it is allowed to play.
  - Open an entertainment video: verify it is blocked.
- **Test 3: Stopwatch Independence During Focus Lock**:
  - While Focus Lock is active, start the stopwatch in the popup.
  - Pause or finish the stopwatch.
  - Verify that finishing the stopwatch does **not** deactivate Focus Lock; YouTube Shorts remain blocked.
- **Test 4: Settings Protection**:
  - While Focus Lock is active, visit `options.html`.
  - Verify that policy and schedule inputs are disabled and saving is rejected.

---

## Known Platform Limitations

1. **Native Browser Controls**: Manifest V3 extensions cannot prevent a user from disabling or uninstalling the extension via `edge://extensions`.
2. **Local Metadata Classifier**: The local classifier analyzes textual metadata (title, channel, description). True audio/video frame analysis requires an external backend AI inference server configured via the `Classification API base URL` field.
