const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { focusEvaluatePolicy } = require("../policy.js");

async function classifyVideoWithBackend({ meta = {}, isShort = false, settings = {} }) {
  const backend = (settings.backendUrl || "").trim().replace(/\/+$/, "");

  if (isShort) {
    return {
      category: "SHORTS",
      decision: focusEvaluatePolicy({ active: true, isShort: true, settings })
    };
  }

  if (backend) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
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
          objective: settings.objective || ""
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const cat = String(data.category || "").toUpperCase();
      if (!["EDUCATIONAL", "ENTERTAINMENT", "MIXED", "UNCERTAIN"].includes(cat)) {
        throw new Error(`Invalid category ${cat}`);
      }

      return {
        category: cat,
        decision: focusEvaluatePolicy({
          active: true,
          isShort: false,
          category: cat,
          settings,
          failed: false
        })
      };
    } catch (err) {
      clearTimeout(timeout);
      return {
        category: "FAILURE",
        decision: focusEvaluatePolicy({
          active: true,
          isShort: false,
          settings,
          failed: true
        }),
        error: err.message
      };
    }
  }

  return {
    category: "UNCERTAIN",
    decision: focusEvaluatePolicy({
      active: true,
      isShort: false,
      category: "UNCERTAIN",
      settings,
      failed: false
    })
  };
}

test("backend: successfully queries backend and enforces returned EDUCATIONAL classification", async () => {
  // Create mock HTTP server
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/classify") {
      let body = "";
      req.on("data", chunk => (body += chunk));
      req.on("end", () => {
        const payload = JSON.parse(body);
        assert.equal(payload.title, "Advanced Quantum Computing");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ category: "EDUCATIONAL", reason: "AI verified educational lecture" }));
      });
    }
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const result = await classifyVideoWithBackend({
    meta: { title: "Advanced Quantum Computing", channel: "MIT" },
    isShort: false,
    settings: {
      backendUrl: `http://127.0.0.1:${port}`,
      failurePolicy: "block"
    }
  });

  server.close();

  assert.equal(result.category, "EDUCATIONAL");
  assert.equal(result.decision.action, "ALLOW");
});

test("backend: successfully queries backend and enforces returned ENTERTAINMENT classification", async () => {
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/classify") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ category: "ENTERTAINMENT", reason: "AI verified entertainment content" }));
    }
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const result = await classifyVideoWithBackend({
    meta: { title: "Random Stream Highlights", channel: "Streamer" },
    isShort: false,
    settings: {
      backendUrl: `http://127.0.0.1:${port}`,
      failurePolicy: "block"
    }
  });

  server.close();

  assert.equal(result.category, "ENTERTAINMENT");
  assert.equal(result.decision.action, "BLOCK");
});

test("backend: when backend is unavailable or offline, applies failurePolicy 'block'", async () => {
  // Using an unallocated local port where no server is listening
  const offlineBackend = "http://127.0.0.1:59999";

  const result = await classifyVideoWithBackend({
    meta: { title: "Some Video Title", channel: "SomeChannel" },
    isShort: false,
    settings: {
      backendUrl: offlineBackend,
      failurePolicy: "block"
    }
  });

  assert.equal(result.category, "FAILURE");
  assert.equal(result.decision.action, "BLOCK");
  assert.match(result.decision.reason, /classification failed/i);
});

test("backend: when backend is unavailable, applies failurePolicy 'allow' if configured", async () => {
  const offlineBackend = "http://127.0.0.1:59999";

  const result = await classifyVideoWithBackend({
    meta: { title: "Some Video Title", channel: "SomeChannel" },
    isShort: false,
    settings: {
      backendUrl: offlineBackend,
      failurePolicy: "allow"
    }
  });

  assert.equal(result.category, "FAILURE");
  assert.equal(result.decision.action, "ALLOW");
  assert.match(result.decision.reason, /classification failed/i);
});

test("backend: when backend returns HTTP 500 error, applies failure fallback", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const result = await classifyVideoWithBackend({
    meta: { title: "Another Video", channel: "Channel" },
    isShort: false,
    settings: {
      backendUrl: `http://127.0.0.1:${port}`,
      failurePolicy: "block"
    }
  });

  server.close();

  assert.equal(result.category, "FAILURE");
  assert.equal(result.decision.action, "BLOCK");
});
