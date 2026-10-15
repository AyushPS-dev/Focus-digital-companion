// FOCUS Digital Companion 2.0 - Policy Engine & Local Classifier

/**
 * Deterministic local heuristic classifier based on visible YouTube metadata.
 * Evaluates whether content is educational, entertainment, mixed, or uncertain.
 * Note: Educational content from ANY subject is recognized, independently of the user's specific focus objective.
 */
function focusMockClassify(meta = {}) {
  const title = String(meta.title || "").toLowerCase();
  const channel = String(meta.channel || "").toLowerCase();
  const description = String(meta.description || "").toLowerCase();
  const url = String(meta.url || "").toLowerCase();

  // Broad educational signals across academic disciplines, skills, and learning channels
  const educationSignals = [
    /\b(lecture|lectures|tutorial|tutorials|explained|explanation|lesson|lessons|course|class\s*\d+|chapter\s*\d+|unit\s*\d+|revision|one shot|one-shot|concepts?|solved questions?|question practice|previous year questions?|pyq|notes|study|learn|learning|educational|education|how to solve|step by step|derivation|numericals?|experiment|lab practical|exam preparation|jee|neet|cbse|icse|ncert|gate|coding|programming|data structures?|algorithms?|computer science|software engineering|web dev|javascript|python|c\+\+|rust|golang|mathematics|maths?|calculus|algebra|geometry|trigonometry|physics|chemistry|biology|science|anatomy|biochemistry|genetics|astronomy|astrophysics|history|world history|geography|economics|macroeconomics|microeconomics|finance|philosophy|psychology|sociology|literature|grammar|english speaking|language learning|academic|thesis|research paper|walkthrough|crash course|guide|documentary|documentaries)\b/i,
    /\b(khan academy|crash course|freecodecamp|free code camp|mit opencourseware|stanford online|harvard|3blue1brown|veritasium|physics wallah|pw|unacademy|vedantu|byju|nptel|codewithharry|apna college|gate smashers|neso academy|organic chemistry tutor|professor leonard|numberphile|coursera|edx|ted-ed|scishow|kurzgesagt|minutephysics|stand-up maths|computerphile|fireship|techlead|traversy media|the ameu|huberman lab)\b/i
  ];

  // Strong entertainment, distraction, and recreational signals
  const entertainmentSignals = /\b(gameplay|gaming|lets play|let's play|funny moments|comedy|stand up|prank|pranks|meme|memes|reaction|reacting|roast|roasting|challenge|vlog|vlogs|daily vlog|highlights|montage|rank push|live stream|stream highlights|music video|official video|official audio|lyric video|trailer|movie scene|episode|sitcom|short film|fails|epic fail|trolling|skit|parody|tiktok compilation|bloopers)\b/i;

  const edu = educationSignals.some(rx => rx.test(title) || rx.test(channel) || rx.test(description));
  const ent = entertainmentSignals.test(title) || entertainmentSignals.test(channel);

  if (edu && ent) return "MIXED";
  if (edu) return "EDUCATIONAL";
  if (ent) return "ENTERTAINMENT";
  return "UNCERTAIN";
}

/**
 * Evaluates the policy decision for a given video/page.
 * Authority: Focus Lock state (`active`).
 * Order of evaluation when active:
 * 1. If Focus Lock is inactive -> ALLOW (normal browsing unrestricted).
 * 2. If isShort is true -> ALWAYS BLOCK (Shorts rule precedes category and allowlists).
 * 3. Channel blocklist -> BLOCK.
 * 4. Channel allowlist -> ALLOW (long-form only).
 * 5. Classification failure -> failurePolicy (block/allow).
 * 6. Content category rules (EDUCATIONAL, ENTERTAINMENT, MIXED, UNCERTAIN).
 */
function focusEvaluatePolicy({
  active = false,
  isShort = false,
  category = "UNCERTAIN",
  settings = {},
  failed = false,
  channel = "",
  allowlist = [],
  blocklist = []
}) {
  if (!active) {
    return {
      action: "ALLOW",
      reason: "Focus Lock is inactive; normal browsing and playback allowed"
    };
  }

  // MANDATORY: All YouTube Shorts are strictly blocked during active Focus Lock.
  // Neither channel allowlists nor educational titles can override this rule.
  if (isShort) {
    return {
      action: "BLOCK",
      reason: "All YouTube Shorts are blocked while Focus Lock is active, including educational Shorts"
    };
  }

  // Channel blocklist check
  const normChannel = String(channel || "").trim().toLowerCase();
  const effectiveBlocklist = Array.isArray(blocklist) ? blocklist : (settings.channelBlocklist || []);
  if (normChannel && effectiveBlocklist.some(b => String(b).trim().toLowerCase() === normChannel)) {
    return { action: "BLOCK", reason: `Channel "${channel}" is on your blocklist` };
  }

  // Channel allowlist check (applies to long-form videos only)
  const effectiveAllowlist = Array.isArray(allowlist) ? allowlist : (settings.channelAllowlist || []);
  if (normChannel && effectiveAllowlist.some(a => String(a).trim().toLowerCase() === normChannel)) {
    return { action: "ALLOW", reason: `Channel "${channel}" is on your allowlist` };
  }

  // Handle classification failure (e.g. backend offline, timeout, network failure)
  if (failed) {
    const failureAction = (settings.failurePolicy || "block").toUpperCase();
    return {
      action: failureAction,
      reason: failureAction === "BLOCK"
        ? "Classification failed or backend unavailable; blocked by fallback policy"
        : "Classification failed or backend unavailable; allowed by fallback policy"
    };
  }

  // Content category evaluation
  const mixedPref = settings.mixedPolicy || "block";
  const uncertainPref = settings.uncertainPolicy || "block";

  switch (category) {
    case "EDUCATIONAL":
      return {
        action: "ALLOW",
        reason: "Educational content is allowed during active Focus Lock"
      };
    case "ENTERTAINMENT":
      return {
        action: "BLOCK",
        reason: "Entertainment content is blocked during active Focus Lock"
      };
    case "MIXED":
      return {
        action: mixedPref.toUpperCase(),
        reason: mixedPref === "allow"
          ? "Mixed educational/entertainment content is allowed by policy"
          : "Mixed educational/entertainment content is blocked by policy"
      };
    case "UNCERTAIN":
    default:
      return {
        action: uncertainPref.toUpperCase(),
        reason: uncertainPref === "allow"
          ? "Uncertain content is allowed by policy"
          : "Uncertain content is blocked by policy"
      };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    focusMockClassify,
    focusEvaluatePolicy
  };
}