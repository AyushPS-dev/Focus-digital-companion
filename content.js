// FOCUS Digital Companion - Content Script (YouTube)

(() => {
  if (window.__focusLoaded) return;
  window.__focusLoaded = true;

  let lastUrl = location.href;
  let queued = false;
  const processed = new WeakMap();
  let blockedPlayback = false;

  function stopBlockedPlayback() {
    document.querySelectorAll("video, audio").forEach(media => {
      try {
        media.pause();
        media.currentTime = 0;
      } catch {}
    });
    try { document.getElementById("movie_player")?.pauseVideo?.(); } catch {}
    try { document.getElementById("movie_player")?.stopVideo?.(); } catch {}
  }

  // Intercept play attempts while content is marked blocked
  document.addEventListener("play", event => {
    if (blockedPlayback && event.target instanceof HTMLMediaElement) {
      try {
        event.target.pause();
        event.target.currentTime = 0;
      } catch {}
    }
  }, true);

  const isShortUrl = u => {
    try {
      return new URL(u, location.origin).pathname.startsWith("/shorts/");
    } catch {
      return false;
    }
  };

  const isWatchPage = () => {
    const p = location.pathname;
    return p === "/watch" || p.startsWith("/shorts/");
  };

  const videoId = u => {
    try {
      const x = new URL(u, location.origin);
      return x.pathname.startsWith("/shorts/") ? x.pathname.split("/")[2] : x.searchParams.get("v");
    } catch {
      return null;
    }
  };

  function currentMeta() {
    const title =
      document.querySelector("ytd-watch-metadata h1 yt-formatted-string, h1 yt-formatted-string, #title h1, h1.ytd-watch-metadata")?.textContent?.trim() ||
      document.querySelector("meta[name='title']")?.content ||
      document.title.replace(/ - YouTube$/, "").trim();

    const channel =
      document.querySelector("#owner #channel-name, ytd-video-owner-renderer #channel-name, ytd-channel-name")?.textContent?.trim() ||
      document.querySelector("meta[itemprop='author']")?.content ||
      "";

    const description =
      document.querySelector("#description-inline-expander, #description, meta[name='description']")?.textContent?.trim() ||
      document.querySelector("meta[name='description']")?.content ||
      "";

    return {
      url: location.href,
      videoId: videoId(location.href),
      title,
      channel,
      description
    };
  }

  function showOverlay(reason) {
    let el = document.getElementById("focus-companion-block");
    if (!el) {
      el = document.createElement("div");
      el.id = "focus-companion-block";
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:rgba(11,18,32,0.98);color:#e7edf7;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased";
      document.documentElement.append(el);
    }

    const box = document.createElement("div");
    box.style.cssText = "max-width:480px;background:#121d30;border:1px solid #26354e;border-radius:16px;padding:32px 28px;box-shadow:0 20px 40px rgba(0,0,0,0.5)";

    const badge = document.createElement("div");
    badge.textContent = "FOCUS LOCK ACTIVE";
    badge.style.cssText = "display:inline-block;background:#7c5cff;color:#fff;font-size:11px;font-weight:700;letter-spacing:1px;padding:4px 10px;border-radius:99px;margin-bottom:16px";
    box.appendChild(badge);

    const heading = document.createElement("h2");
    heading.textContent = "Stay on your goal";
    heading.style.cssText = "font-size:22px;margin:0 0 12px;color:#fff";
    box.appendChild(heading);

    const reasonBox = document.createElement("p");
    reasonBox.textContent = reason || "Distraction blocked during focus session.";
    reasonBox.style.cssText = "font-size:14px;color:#cbd5e1;background:#0b1424;border:1px solid #33435e;border-radius:8px;padding:12px 14px;margin:16px 0;line-height:1.5";
    box.appendChild(reasonBox);

    const slogan = document.createElement("p");
    slogan.textContent = "“Block distractions, not learning.”";
    slogan.style.cssText = "font-size:12px;color:#9caec8;font-style:italic;margin:0";
    box.appendChild(slogan);

    el.replaceChildren(box);
  }

  function removeOverlay() {
    const el = document.getElementById("focus-companion-block");
    if (el) el.remove();
  }

  async function evaluatePage() {
    if (!isWatchPage()) {
      blockedPlayback = false;
      removeOverlay();
      return;
    }

    const meta = currentMeta();
    const short = isShortUrl(location.href);

    try {
      const r = await chrome.runtime.sendMessage({
        type: "CLASSIFY",
        meta,
        isShort: short
      });

      if (!r || !r.ok) return;

      blockedPlayback = r.decision.action === "BLOCK";
      if (blockedPlayback) {
        showOverlay(r.decision.reason);
        stopBlockedPlayback();
      } else {
        removeOverlay();
      }
    } catch {}
  }

  async function cardCheck(card) {
    if (!(card instanceof Element) || processed.get(card) === location.href) return;
    const a = card.querySelector('a[href*="/watch"], a[href*="/shorts/"]');
    if (!a) return;

    const titleEl = card.querySelector("#video-title, [title], h3");
    const channelEl = card.querySelector("#channel-name, ytd-channel-name, .ytd-channel-name");
    const meta = {
      url: a.href,
      videoId: videoId(a.href),
      title: titleEl?.getAttribute("title") || titleEl?.textContent?.trim() || "",
      channel: channelEl?.textContent?.trim() || "",
      description: card.querySelector("#description-text")?.textContent?.trim() || ""
    };

    if (!meta.videoId && !isShortUrl(a.href)) return;
    processed.set(card, location.href);

    try {
      const r = await chrome.runtime.sendMessage({
        type: "CLASSIFY",
        meta,
        isShort: isShortUrl(a.href)
      });

      if (r && r.ok) {
        const isBlock = r.decision.action === "BLOCK";
        card.style.outline = isBlock ? "2px solid #ef4444" : "";
        card.style.opacity = isBlock ? "0.45" : "";
        card.dataset.focusDecision = r.decision.action;
        card.title = `[FOCUS] ${r.decision.reason}`;
      }
    } catch {}
  }

  function scan() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        blockedPlayback = false;
        removeOverlay();
      }
      document.querySelectorAll(
        "ytd-video-renderer, ytd-compact-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer"
      ).forEach(cardCheck);
      evaluatePage();
    });
  }

  // Observe dynamic DOM updates
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });

  // SPA navigation events
  window.addEventListener("popstate", scan);
  window.addEventListener("yt-navigate-finish", scan);
  window.addEventListener("yt-page-data-updated", scan);

  // Background policy update broadcasts
  chrome.runtime.onMessage.addListener(msg => {
    if (msg && msg.type === "FOCUS_POLICY_CHANGED") {
      blockedPlayback = false;
      removeOverlay();
      scan();
    }
  });

  // Initial scan
  scan();
})();