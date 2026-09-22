import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "playwright-module": { type: "string" },
    "output-dir": { type: "string" },
    "extension-dir": { type: "string" },
  },
});
const { chromium } = await import(
  values["playwright-module"]
    ? pathToFileURL(path.resolve(values["playwright-module"])).href
    : "playwright"
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extension = path.resolve(
  values["extension-dir"] || path.join(root, ".output/chrome-mv3"),
);
const output = path.resolve(
  values["output-dir"] ||
    path.join(root, ".output/installed-extension-evidence"),
);
const manifest = JSON.parse(
  await fs.readFile(path.join(extension, "manifest.json"), "utf8"),
);
assert.equal(manifest.manifest_version, 3);
const ownedDirectory = await fs.mkdtemp(
  path.join(os.tmpdir(), "browser-bridge-installed-"),
);
const downloads = path.join(ownedDirectory, "downloads");
await fs.mkdir(downloads);
await fs.mkdir(output, { recursive: true });
const requests = [];
let releaseCapabilities;
const capabilitiesReady = new Promise((resolve) => {
  releaseCapabilities = resolve;
});
const fixture = `<!doctype html><html><head><title>Installed Extension Fixture</title></head><body><main><h1>Installed extension fixture</h1><p>Verified local article for extraction.</p><form><label>Full name <input name="fullName" id="name"></label><button type="submit">Submit</button></form><div id="shadow"></div><iframe src="/frame" title="Fixture frame"></iframe></main><script>window.submissions=0;document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();window.submissions++});document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<p>Shadow fixture content</p>';</script></body></html>`;
const fixtureServer = http.createServer((request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(
    request.url === "/frame"
      ? '<label>Frame field<input id="frame-field"></label><p>Nested fixture content</p>'
      : fixture,
  );
});
const bridgeServer = http.createServer(async (request, response) => {
  const endpoint = new URL(request.url, "http://127.0.0.1").pathname;
  response.setHeader("Content-Type", "application/json");
  if (endpoint === "/health") {
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (request.headers["x-copilot-bridge-client"] !== "chrome-extension") {
    response.writeHead(401);
    response.end("{}");
    return;
  }
  if (endpoint === "/models") {
    response.end(
      JSON.stringify([{ provider: "copilot", id: "fixture", name: "Fixture" }]),
    );
    return;
  }
  if (endpoint === "/capabilities") {
    await capabilitiesReady;
    if (response.destroyed) return;
    response.end(
      JSON.stringify({
        version: "fixture",
        bridge: "vscode",
        contextVersion: 1,
        browserBackend: "extension-dom",
        providers: [
          {
            id: "vscode-lm",
            name: "Fixture",
            status: "available",
            supportsVision: false,
          },
        ],
        recommended: { chat: "vscode-lm", agent: "vscode-lm" },
      }),
    );
    return;
  }
  if (endpoint === "/chat") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push(payload);
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(
      payload.messages.at(-1)?.content === "Fill the fixture name"
        ? "[ACTION: type, #name, Installed Test]"
        : "Installed extension response.",
    );
    return;
  }
  response.writeHead(404);
  response.end("{}");
});
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
let context;
try {
  const fixturePort = await listen(fixtureServer);
  const bridgePort = await listen(bridgeServer);
  const fixtureUrl = `http://127.0.0.1:${fixturePort}/fixture`;
  context = await chromium.launchPersistentContext(
    path.join(ownedDirectory, "profile"),
    {
      headless: false,
      viewport: { width: 480, height: 900 },
      acceptDownloads: true,
      downloadsPath: downloads,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        "--disable-sync",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--no-proxy-server",
        "--host-resolver-rules=MAP permission.fixture.test 127.0.0.1",
      ],
    },
  );
  context.setDefaultTimeout(15000);
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker", { timeout: 15000 }));
  const extensionId = new URL(worker.url()).hostname;
  assert.match(extensionId, /^[a-p]{32}$/);
  await worker.evaluate(async (port) => {
    await chrome.storage.local.set({
      serverPort: port,
      language: "en",
      llmSettings: {
        provider: "auto",
        copilot: { model: "fixture" },
        lmStudio: { endpoint: "http://localhost:1234", model: "" },
      },
      assistantSettingsV1: {
        version: 1,
        globalInstructions: "Fixture global instruction",
        profiles: [{ id: "default", name: "Fixture", instructions: "" }],
        selectedProfileId: "default",
        mode: "read-only",
        post: {
          name: "Fixture Post",
          instructions: "Fixture post instruction",
        },
      },
    });
  }, bridgePort);
  const source = await context.newPage();
  await source.goto(fixtureUrl);
  const sourceTabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({ url }))[0]?.id,
    fixtureUrl,
  );
  assert.equal(typeof sourceTabId, "number");
  await worker.evaluate(
    async (tabId) =>
      chrome.storage.local.set({ pendingAction: { type: "post", tabId } }),
    sourceTabId,
  );
  const panel = await context.newPage();
  const pageErrors = [];
  panel.on("pageerror", (error) => pageErrors.push(error.message));
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const devtools = await context.newCDPSession(panel);
  await devtools.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloads,
    eventsEnabled: true,
  });
  await panel
    .getByRole("button", { name: "Fixture Post", exact: true })
    .waitFor();
  await panel
    .getByText(
      "Action queued: waiting for bridge readiness or the current task.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    (await worker.evaluate(() => chrome.storage.local.get("pendingAction")))
      .pendingAction.type,
    "post",
  );
  assert.equal(requests.length, 0);
  releaseCapabilities();
  await panel
    .getByText("Installed extension response.", { exact: true })
    .waitFor();
  assert.equal(requests.length, 1);
  assert(requests[0].pageContent.includes("Verified local article"));
  assert(requests[0].pageContent.includes("Shadow fixture content"));
  assert(requests[0].pageContent.includes("Nested fixture content"));
  assert.equal(
    requests[0].context.taskInstructions,
    "Fixture post instruction",
  );
  assert.deepEqual(requests[0].context.allowedActions, []);
  const frameDocuments = await worker.evaluate(async (tabId) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => document.title,
    });
    return results.map(({ frameId, documentId }) => ({ frameId, documentId }));
  }, sourceTabId);
  assert(frameDocuments.length >= 2);
  assert(frameDocuments.every((frame) => typeof frame.documentId === "string"));
  await panel
    .getByRole("button", { name: "Save this answer", exact: true })
    .click();
  await panel.getByText("Saved", { exact: true }).waitFor();
  const downloaded = await panel.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          chrome.downloads.onChanged.removeListener(check);
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("Download did not complete"));
        }, 10000);
        const check = () => {
          void chrome.downloads
            .search({})
            .then((items) => {
              const complete = items.find((item) => item.state === "complete");
              if (complete) {
                cleanup();
                resolve(complete);
              } else if (items.some((item) => item.state === "interrupted")) {
                cleanup();
                reject(new Error("Download interrupted"));
              }
            })
            .catch((error) => {
              cleanup();
              reject(error);
            });
        };
        chrome.downloads.onChanged.addListener(check);
        check();
      }),
  );
  assert.equal(typeof downloaded.filename, "string");
  assert(path.resolve(downloaded.filename).startsWith(downloads + path.sep));
  const exported = await fs.readFile(downloaded.filename, "utf8");
  assert(exported.includes("Installed extension response."));
  assert(exported.includes(fixtureUrl));
  await panel.screenshot({
    path: path.join(output, "installed-download.png"),
    animations: "disabled",
  });
  await panel
    .getByLabel("Browser operation", { exact: true })
    .selectOption("input");
  await panel.evaluate(
    (tabId) => chrome.tabs.update(tabId, { active: true }),
    sourceTabId,
  );
  const input = panel.locator("form textarea").last();
  await input.fill("Fill the fixture name");
  await input.press("Enter");
  await panel.getByText(/Field value verified; not submitted/).waitFor();
  assert.equal(await source.locator("#name").inputValue(), "Installed Test");
  assert.equal(await source.evaluate(() => window.submissions), 0);
  await panel
    .getByText("Installed extension response.", { exact: true })
    .waitFor();
  const denied = await context.newPage();
  const deniedUrl = `http://permission.fixture.test:${fixturePort}/fixture`;
  await denied.goto(deniedUrl);
  const deniedTabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({ url }))[0]?.id,
    deniedUrl,
  );
  assert.equal(typeof deniedTabId, "number");
  assert.equal(
    await panel.evaluate(() =>
      chrome.permissions.contains({
        origins: ["http://permission.fixture.test/*"],
      }),
    ),
    false,
  );
  const requestCount = requests.length;
  await worker.evaluate(
    async (tabId) =>
      chrome.storage.local.set({ pendingAction: { type: "post", tabId } }),
    deniedTabId,
  );
  await panel.getByText("Site permission required", { exact: true }).waitFor();
  await panel
    .getByRole("button", { name: "Allow this site", exact: true })
    .waitFor();
  assert.equal(requests.length, requestCount);
  assert.deepEqual(pageErrors, []);
  await panel.screenshot({
    path: path.join(output, "installed-extension.png"),
    animations: "disabled",
  });
  console.log(
    JSON.stringify({
      result: "PASS",
      checks: [
        "actual MV3 service worker",
        "real extension storage",
        "queued action survives delayed capabilities",
        "real tab-bound extraction",
        "Shadow DOM and iframe extraction",
        "documentId capture",
        "real background download",
        "document-bound input and read-back",
        "no form submission",
        "denied host stops before model request",
        "site permission recovery control",
      ],
      llm: "local fixture",
      surface: "extension sidepanel document in an owned tab",
      screenshot: path.relative(
        root,
        path.join(output, "installed-extension.png"),
      ),
    }),
  );
} finally {
  releaseCapabilities();
  try {
    await context?.close();
  } finally {
    try {
      await Promise.all([close(bridgeServer), close(fixtureServer)]);
    } finally {
      await fs.rm(ownedDirectory, { recursive: true, force: true });
    }
  }
}
