const test = require("node:test");
const assert = require("node:assert/strict");
const { focusMockClassify, focusEvaluatePolicy } = require("../policy.js");

test("policy: Educational video on current study objective is allowed", () => {
  const meta = {
    title: "Calculus 1 - Full College Course",
    channel: "freeCodeCamp.org",
    description: "Learn Calculus 1 in this full college course."
  };
  const category = focusMockClassify(meta);
  assert.equal(category, "EDUCATIONAL");

  const decision = focusEvaluatePolicy({
    active: true,
    isShort: false,
    category,
    settings: { mixedPolicy: "block", uncertainPolicy: "block" }
  });
  assert.equal(decision.action, "ALLOW");
  assert.match(decision.reason, /educational/i);
});

test("policy: Educational video from different subject than focus objective is allowed", () => {
  // User's focus objective is calculus, but they are watching a biology lecture
  const meta = {
    title: "Human Anatomy & Physiology: Crash Course Biology",
    channel: "CrashCourse",
    description: "Hank introduces you to the complex anatomy of the human body."
  };
  const category = focusMockClassify(meta);
  assert.equal(category, "EDUCATIONAL");

  const decision = focusEvaluatePolicy({
    active: true,
    isShort: false,
    category,
    settings: { mixedPolicy: "block", uncertainPolicy: "block" }
  });
  assert.equal(decision.action, "ALLOW");
  assert.match(decision.reason, /educational/i);
});

test("policy: Entertainment video is blocked during active focus", () => {
  const meta = {
    title: "GTA 5 Best Funny Moments Gameplay & Fails",
    channel: "GamerVids",
    description: "Watch hilarious gaming gameplay and prank moments."
  };
  const category = focusMockClassify(meta);
  assert.equal(category, "ENTERTAINMENT");

  const decision = focusEvaluatePolicy({
    active: true,
    isShort: false,
    category,
    settings: { mixedPolicy: "block", uncertainPolicy: "block" }
  });
  assert.equal(decision.action, "BLOCK");
  assert.match(decision.reason, /entertainment/i);
});

test("policy: Mixed content policy respects settings (block vs allow)", () => {
  const meta = {
    title: "Learn Python while watching funny memes and gameplay",
    channel: "CodeMeme",
    description: "Coding tutorial comedy parody"
  };
  const category = focusMockClassify(meta);
  assert.equal(category, "MIXED");

  const blockDecision = focusEvaluatePolicy({
    active: true,
    isShort: false,
    category,
    settings: { mixedPolicy: "block" }
  });
  assert.equal(blockDecision.action, "BLOCK");

  const allowDecision = focusEvaluatePolicy({
    active: true,
    isShort: false,
    category,
    settings: { mixedPolicy: "allow" }
  });
  assert.equal(allowDecision.action, "ALLOW");
});

test("policy: Uncertain content policy respects settings (block vs allow)", () => {
  const meta = {
    title: "Random Ambiguous Video Title Without Clear Signals",
    channel: "SomeUnknownChannel",
    description: ""
  };
  const category = focusMockClassify(meta);
  assert.equal(category, "UNCERTAIN");

  const blockDecision = focusEvaluatePolicy({
    active: true,
    isShort: false,
    category,
    settings: { uncertainPolicy: "block" }
  });
  assert.equal(blockDecision.action, "BLOCK");

  const allowDecision = focusEvaluatePolicy({
    active: true,
    isShort: false,
    category,
    settings: { uncertainPolicy: "allow" }
  });
  assert.equal(allowDecision.action, "ALLOW");
});

test("policy: MANDATORY - All YouTube Shorts are blocked during active focus, even educational Shorts", () => {
  const educationalShortMeta = {
    title: "Learn Calculus derivatives in 30 seconds! #shorts",
    channel: "Khan Academy",
    description: "Quick calculus revision tutorial"
  };
  const category = focusMockClassify(educationalShortMeta);
  assert.equal(category, "EDUCATIONAL");

  // Even though category is EDUCATIONAL, isShort: true MUST force BLOCK!
  const decision = focusEvaluatePolicy({
    active: true,
    isShort: true,
    category,
    settings: { mixedPolicy: "allow", uncertainPolicy: "allow" }
  });
  assert.equal(decision.action, "BLOCK");
  assert.match(decision.reason, /shorts are blocked/i);
});

test("policy: Channel allowlist does NOT override the Shorts rule", () => {
  const shortMeta = {
    title: "3Blue1Brown Linear Algebra Short",
    channel: "3Blue1Brown",
    description: "Visual math short"
  };
  const category = focusMockClassify(shortMeta);

  // 3Blue1Brown is on the allowlist
  const decision = focusEvaluatePolicy({
    active: true,
    isShort: true,
    category,
    channel: "3Blue1Brown",
    allowlist: ["3Blue1Brown"],
    settings: {}
  });
  assert.equal(decision.action, "BLOCK");
  assert.match(decision.reason, /shorts are blocked/i);
});

test("policy: Channel allowlist permits long-form videos even if uncertain", () => {
  const longFormMeta = {
    title: "Special Member Announcement",
    channel: "Khan Academy",
    description: "General channel announcement"
  };
  const category = focusMockClassify(longFormMeta);

  const decision = focusEvaluatePolicy({
    active: true,
    isShort: false,
    category,
    channel: "Khan Academy",
    allowlist: ["Khan Academy"],
    settings: { uncertainPolicy: "block" }
  });
  assert.equal(decision.action, "ALLOW");
  assert.match(decision.reason, /allowlist/i);
});

test("policy: Channel blocklist blocks long-form videos", () => {
  const meta = {
    title: "Educational Lecture on Physics",
    channel: "BannedStreamer",
    description: "Physics class"
  };
  const category = focusMockClassify(meta);

  const decision = focusEvaluatePolicy({
    active: true,
    isShort: false,
    category,
    channel: "BannedStreamer",
    blocklist: ["BannedStreamer"],
    settings: {}
  });
  assert.equal(decision.action, "BLOCK");
  assert.match(decision.reason, /blocklist/i);
});

test("policy: Classification failure respects failurePolicy setting", () => {
  const blockDecision = focusEvaluatePolicy({
    active: true,
    isShort: false,
    failed: true,
    settings: { failurePolicy: "block" }
  });
  assert.equal(blockDecision.action, "BLOCK");
  assert.match(blockDecision.reason, /classification failed/i);

  const allowDecision = focusEvaluatePolicy({
    active: true,
    isShort: false,
    failed: true,
    settings: { failurePolicy: "allow" }
  });
  assert.equal(allowDecision.action, "ALLOW");
  assert.match(allowDecision.reason, /classification failed/i);
});

test("policy: When focus is inactive, all videos and shorts are allowed", () => {
  const shortDecision = focusEvaluatePolicy({
    active: false,
    isShort: true,
    category: "ENTERTAINMENT"
  });
  assert.equal(shortDecision.action, "ALLOW");
  assert.match(shortDecision.reason, /inactive/i);

  const videoDecision = focusEvaluatePolicy({
    active: false,
    isShort: false,
    category: "ENTERTAINMENT"
  });
  assert.equal(videoDecision.action, "ALLOW");
  assert.match(videoDecision.reason, /inactive/i);
});
