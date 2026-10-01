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
    "browser-executable": { type: "string" },
    "output-dir": { type: "string" },
    "extension-dir": { type: "string" },
    "display-only": { type: "boolean", default: false },
    "live-display": { type: "boolean", default: false },
    "native-panel": { type: "boolean", default: false },
  },
});
if (
  (values["live-display"] || values["native-panel"]) &&
  !values["display-only"]
)
  throw new Error("Live/native verification requires --display-only");
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
const verificationStartedAt = new Date().toISOString();
let liveActive = false;
let liveBridge;
let liveBridgeUrl = "";
let liveRequests = 0;
let beforeDisplayReplacement = async () => {};
let releaseCapabilities;
const capabilitiesReady = new Promise((resolve) => {
  releaseCapabilities = resolve;
});
const fixture = `<!doctype html><html><head><title>Installed Extension Fixture</title></head><body><main><h1>Installed extension fixture</h1><p>Verified local article for extraction.</p><form><h2 id="display-heading">Do you need a break?</h2><label>Full name <input name="fullName" id="name"></label><button type="submit">Submit</button></form><button type="button" id="receipt-one">Receipt one</button><button type="button" id="receipt-two">Receipt two</button><a href="/receipt.pdf" download="receipt.pdf">Download receipt</a><div id="shadow"></div><iframe src="/frame" title="Fixture frame"></iframe>${values["display-only"] ? Array.from({ length: 130 }, (_, index) => `<button type="button">Extra ${index}</button>`).join("") : ""}</main><script>window.submissions=0;window.receipts=[];document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();window.submissions++});document.querySelectorAll('[id^=receipt-]').forEach(button=>button.addEventListener('click',()=>window.receipts.push(button.id)));document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<p>Shadow fixture content</p>';</script></body></html>`;
const receiptContent = "BT /F1 18 Tf 72 720 Td (Fixture receipt) Tj ET";
const pdfObjects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${Buffer.byteLength(receiptContent)} >>\nstream\n${receiptContent}\nendstream`,
];
let receiptPdf = "%PDF-1.4\n";
const pdfOffsets = pdfObjects.map((object, index) => {
  const offset = Buffer.byteLength(receiptPdf);
  receiptPdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  return offset;
});
const xrefOffset = Buffer.byteLength(receiptPdf);
receiptPdf += `xref\n0 ${pdfOffsets.length + 1}\n0000000000 65535 f \n${pdfOffsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${pdfOffsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
const fixtureServer = http.createServer((request, response) => {
  if (request.url === "/receipt.pdf") {
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="receipt.pdf"',
    );
    response.end(receiptPdf);
    return;
  }
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
        ...(values["display-only"] ? { displayTextLookupVersion: 1 } : {}),
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
    if (liveActive) {
      liveRequests++;
      const upstreamAbort = new AbortController();
      response.once("close", () => {
        if (!response.writableEnded) upstreamAbort.abort();
      });
      try {
        const upstream = await fetch(`${liveBridgeUrl}/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Copilot-Bridge-Client": "chrome-extension",
          },
          body: JSON.stringify({
            ...payload,
            settings: {
              ...payload.settings,
              provider: "copilot-sdk",
              copilot: { model: "" },
            },
          }),
          signal: AbortSignal.any([
            upstreamAbort.signal,
            AbortSignal.timeout(90000),
          ]),
        });
        if (!upstream.ok) throw new Error("Live bridge request failed");
        response.end(await upstream.text());
      } catch {
        response.end("エラー: Live provider request could not be verified.");
      }
      return;
    }
    if (
      values["display-only"] &&
      payload.context.displayTextLookupVersion === 1
    ) {
      const originalRequest = payload.messages.findLast(
        (message) =>
          message.role === "user" &&
          [
            "Change the heading",
            "Change again",
            "Correct malformed heading edit",
          ].includes(message.content),
      )?.content;
      if (payload.context.allowedActions.length === 0) {
        response.end(
          "Verified local display edit. [ACTION: click, #receipt-one]",
        );
        return;
      }
      if (
        payload.context.allowedActions.length === 2 &&
        payload.context.allowedActions.includes("replaceText") &&
        payload.context.allowedActions.includes("findDisplayText")
      ) {
        await beforeDisplayReplacement();
        const reference = payload.messages
          .at(-1)
          .content.match(/ref:f\d+:d[a-f0-9]{32}/)?.[0];
        assert(reference, "Dedicated lookup handle missing from continuation");
        response.end(
          `[ACTION: replaceText, ${JSON.stringify({ selector: reference, text: originalRequest === "Change again" ? "Enjoy Every Day" : "Enjoy Work" })}]`,
        );
        return;
      }
      if (payload.messages.at(-1)?.content === "Change the heading") {
        response.end(
          '[ACTION: findDisplayText, {"text":"Do you need a break?"}]',
        );
        return;
      }
      if (payload.messages.at(-1)?.content === "Find duplicate text") {
        response.end('[ACTION: findDisplayText, {"text":"Duplicate heading"}]');
        return;
      }
      if (payload.messages.at(-1)?.content === "Change again") {
        response.end('[ACTION: findDisplayText, {"text":"Enjoy Work"}]');
        return;
      }
      if (
        payload.messages.at(-1)?.content === "Correct malformed heading edit"
      ) {
        response.end(
          '[ACTION: replaceText, {"selector":"text=Do you need a break?","text":"Enjoy Work"}]',
        );
        return;
      }
      if (
        payload.context.allowedActions.length === 1 &&
        payload.context.allowedActions[0] === "findDisplayText"
      ) {
        response.end(
          '[ACTION: findDisplayText, {"text":"Do you need a break?"}]',
        );
        return;
      }
    }
    if (payload.messages.at(-1)?.content === "Download fixture receipt") {
      const receiptRef = payload.pageContent.match(
        /\[(f0:e\d+)\] link "Download receipt"/,
      )?.[1];
      assert(receiptRef, "Receipt download ref missing from snapshot");
      response.end(`[ACTION: click, ref:${receiptRef}]`);
      return;
    }
    if (
      payload.messages.at(-1)?.content === "Open fixture receipt one" ||
      payload.messages.at(-1)?.content === "Open fixture receipt two"
    ) {
      const number = payload.messages.at(-1).content.endsWith("one")
        ? "one"
        : "two";
      const receiptRef = payload.pageContent.match(
        new RegExp(`\\[(f0:e\\d+)\\] button "Receipt ${number}"`),
      )?.[1];
      assert(receiptRef, "Receipt button ref missing from snapshot");
      response.end(`[ACTION: click, ref:${receiptRef}]`);
      return;
    }
    if (payload.messages.at(-1)?.content === "Edit both fixture labels") {
      const headingRef = payload.pageContent.match(
        /\[(f0:e\d+)\] heading "Installed extension fixture"/,
      )?.[1];
      const articleRef = payload.pageContent.match(
        /\[(f0:e\d+)\] p "Verified local article/,
      )?.[1];
      assert(
        headingRef && articleRef,
        "Display-edit refs missing from snapshot",
      );
      response.end(
        `[ACTION: replaceText, ${JSON.stringify({
          edits: [
            { selector: `ref:${headingRef}`, text: "Demo heading" },
            { selector: `ref:${articleRef}`, text: "Demo article" },
          ],
        })}]`,
      );
      return;
    }
    response.end(
      payload.messages.at(-1)?.content === "Fill the fixture name"
        ? "[ACTION: type, #name, Installed Test]"
        : payload.context?.target?.url?.includes("permission.fixture.test")
          ? "Second site response."
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
      executablePath: values["browser-executable"],
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
  assert.equal(typeof manifest.background?.service_worker, "string");
  const expectedWorkerPath = `/${manifest.background.service_worker}`;
  const matchesWorker = (item) => {
    const url = new URL(item.url());
    return (
      url.protocol === "chrome-extension:" &&
      url.pathname === expectedWorkerPath
    );
  };
  const worker =
    context.serviceWorkers().find(matchesWorker) ||
    (await context
      .waitForEvent("serviceworker", {
        predicate: matchesWorker,
        timeout: 15000,
      })
      .catch(() => {
        throw new Error(
          `Expected extension worker not registered: ${JSON.stringify({
            expectedName: manifest.name,
            expectedWorkerPath,
            observedWorkers: context.serviceWorkers().map((item) => item.url()),
            browserVersion: context.browser()?.version(),
            browserExecutable: path.basename(
              values["browser-executable"] || "bundled Chromium",
            ),
          })}`,
        );
      }));
  const extensionId = new URL(worker.url()).hostname;
  assert.match(extensionId, /^[a-p]{32}$/);
  const workerIdentity = await worker.evaluate(() => ({
    chromeAvailable: typeof chrome !== "undefined",
    id: typeof chrome === "undefined" ? null : chrome.runtime?.id,
    name:
      typeof chrome === "undefined"
        ? null
        : chrome.runtime?.getManifest?.().name,
    storageAvailable:
      typeof chrome !== "undefined" && Boolean(chrome.storage?.local),
  }));
  if (
    workerIdentity.id !== extensionId ||
    workerIdentity.name !== manifest.name ||
    !workerIdentity.storageAvailable
  )
    throw new Error(
      `Extension worker environment mismatch: ${JSON.stringify({
        expectedName: manifest.name,
        expectedWorkerPath,
        workerUrl: worker.url(),
        workerIdentity,
        observedWorkers: context.serviceWorkers().map((item) => item.url()),
        browserVersion: context.browser()?.version(),
        browserExecutable: path.basename(
          values["browser-executable"] || "bundled Chromium",
        ),
      })}`,
    );
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
  if (values["display-only"]) {
    await panel
      .getByLabel("Browser operation", { exact: true })
      .selectOption("input");
    await panel.evaluate(
      (tabId) => chrome.tabs.update(tabId, { active: true }),
      sourceTabId,
    );
    await source.locator("#name").fill("Keep this unsaved value");
    await source.evaluate(() => {
      document.querySelector("main").setAttribute("tabindex", "-1");
      document.querySelector("#display-heading").innerHTML =
        "<span>Do you need a break?</span>";
    });
    const permission = panel.getByLabel("Display editing permission", {
      exact: true,
    });
    await permission.selectOption("site");
    await panel
      .waitForFunction(() => {
        const select = document.querySelector(
          'select[aria-label="Display editing permission"]',
        );
        return select?.value === "site" && !select.disabled;
      })
      .catch(async (error) => {
        const diagnostic = await panel.evaluate(
          async (origin) => ({
            select: document.querySelector(
              'select[aria-label="Display editing permission"]',
            )?.value,
            alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(
              (element) => element.textContent,
            ),
            result: await chrome.runtime.sendMessage({
              type: "display-edit",
              operation: "permission",
              origin,
              enabled: true,
            }),
          }),
          new URL(fixtureUrl).origin,
        );
        throw new Error(
          `Display permission setup failed: ${JSON.stringify(diagnostic)}`,
          { cause: error },
        );
      });
    assert.deepEqual(
      (
        await panel.evaluate(() =>
          chrome.storage.local.get("displayEditOriginsV1"),
        )
      ).displayEditOriginsV1,
      [new URL(fixtureUrl).origin],
    );
    const send = async (text) => {
      const input = panel.locator("form textarea").last();
      await input.fill(text);
      await input.press("Enter");
    };
    await send("Change the heading");
    await source.waitForFunction(
      () =>
        document.querySelector("#display-heading").textContent === "Enjoy Work",
    );
    await panel.getByRole("button", { name: "Send", exact: true }).waitFor();
    assert.equal(
      await source.locator("#name").inputValue(),
      "Keep this unsaved value",
    );
    assert.equal(await source.evaluate(() => window.submissions), 0);
    assert.deepEqual(await source.evaluate(() => window.receipts), []);
    await panel
      .getByText("Action result verified. No submit action was requested.", {
        exact: true,
      })
      .waitFor();
    await panel
      .getByText("Additional actions in the final report were not executed.", {
        exact: true,
      })
      .waitFor();
    await panel
      .getByText("Verified local display edit.", { exact: true })
      .waitFor();
    const hiddenCommand = panel
      .locator("details pre")
      .filter({ hasText: "Not executed: [ACTION: click, #receipt-one]" });
    await hiddenCommand.waitFor({ state: "attached" });
    assert.equal(await hiddenCommand.isVisible(), false);
    assert.equal(await permission.inputValue(), "site");
    const taskRequests = requests.slice(1);
    assert.equal(taskRequests.length, 3);
    assert(taskRequests[0].context.allowedActions.includes("findDisplayText"));
    assert.equal(taskRequests[1].context.fileOperationsEnabled, false);
    assert.deepEqual(taskRequests[1].context.allowedActions, [
      "findDisplayText",
      "replaceText",
    ]);
    assert.deepEqual(taskRequests[2].context.allowedActions, []);
    assert.equal(await source.locator("[data-copilot-ref]").count(), 120);
    assert.equal(
      await source.locator("#display-heading").getAttribute("data-copilot-ref"),
      null,
    );
    await send("Change again");
    await source.waitForFunction(
      () =>
        document.querySelector("#display-heading").textContent ===
        "Enjoy Every Day",
    );
    await panel.getByRole("button", { name: "Send", exact: true }).waitFor();
    await panel.reload();
    await panel.evaluate(
      (tabId) => chrome.tabs.update(tabId, { active: true }),
      sourceTabId,
    );
    await panel.getByRole("button", { name: /Undo|元に戻す/ }).click();
    await source.waitForFunction(
      () =>
        document.querySelector("#display-heading").textContent === "Enjoy Work",
    );
    await panel.getByRole("button", { name: /Undo|元に戻す/ }).click();
    await source.waitForFunction(
      () =>
        document.querySelector("#display-heading").textContent ===
        "Do you need a break?",
    );
    await send("Change the heading");
    await source.waitForFunction(
      () =>
        document.querySelector("#display-heading").textContent === "Enjoy Work",
    );
    await panel.getByRole("button", { name: "Send", exact: true }).waitFor();
    const secondEdited = await context.newPage();
    await secondEdited.goto(`http://127.0.0.1:${fixturePort}/second-edit`);
    const secondEditedId = await worker.evaluate(
      async (url) => (await chrome.tabs.query({ url }))[0]?.id,
      secondEdited.url(),
    );
    assert.equal(typeof secondEditedId, "number");
    await panel.evaluate(
      (tabId) => chrome.tabs.update(tabId, { active: true }),
      secondEditedId,
    );
    await send("Change the heading");
    await secondEdited.waitForFunction(
      () =>
        document.querySelector("#display-heading").textContent === "Enjoy Work",
    );
    await panel.getByRole("button", { name: "Send", exact: true }).waitFor();
    assert.equal(
      await source.locator("#display-heading").textContent(),
      "Enjoy Work",
    );
    await panel.reload();
    await panel.evaluate(
      (tabId) => chrome.tabs.update(tabId, { active: true }),
      secondEditedId,
    );
    await panel.getByRole("button", { name: /Undo|元に戻す/ }).click();
    await secondEdited.waitForFunction(
      () =>
        document.querySelector("#display-heading").textContent ===
        "Do you need a break?",
    );
    assert.equal(
      await source.locator("#display-heading").textContent(),
      "Enjoy Work",
    );
    await panel.evaluate(
      (tabId) => chrome.tabs.update(tabId, { active: true }),
      sourceTabId,
    );
    await panel.getByRole("button", { name: /Undo|元に戻す/ }).click();
    await source.waitForFunction(
      () =>
        document.querySelector("#display-heading").textContent ===
        "Do you need a break?",
    );
    assert.equal(
      await secondEdited.locator("#display-heading").textContent(),
      "Do you need a break?",
    );
    await secondEdited.close();
    await panel.reload();
    await permission.waitFor();
    assert.equal(await permission.inputValue(), "site");
    await panel.evaluate(
      (tabId) => chrome.tabs.update(tabId, { active: true }),
      sourceTabId,
    );
    await source.evaluate(() => {
      const form = document.querySelector("form");
      form.insertAdjacentHTML(
        "beforeend",
        "<h2>Duplicate heading</h2><h2>Duplicate heading</h2>",
      );
    });
    await panel
      .getByLabel("Browser operation", { exact: true })
      .selectOption("automation");
    const beforeSummary = requests.length;
    await send("Summarize entire page");
    await panel.getByRole("button", { name: "Send", exact: true }).waitFor();
    assert.equal(requests.length, beforeSummary + 1);
    assert(
      requests.at(-1).pageContent.includes("Extra 129"),
      "Persistent edit permission must not reduce full-page summary context",
    );
    assert.equal(requests.at(-1).context.fileOperationsEnabled, true);
    await panel
      .getByLabel("Browser operation", { exact: true })
      .selectOption("input");
    const beforeDuplicate = requests.length;
    await send("Find duplicate text");
    await panel.getByRole("button", { name: "Send", exact: true }).waitFor();
    assert.equal(requests.length, beforeDuplicate + 1);
    await panel
      .getByRole("alert")
      .filter({
        hasText: "Multiple matching targets. Identify a unique target.",
      })
      .waitFor();
    assert.equal(
      await source
        .locator("h2")
        .filter({ hasText: "Duplicate heading" })
        .count(),
      2,
    );
    beforeDisplayReplacement = async () => {
      await source.evaluate(() => {
        const old = document.querySelector("#display-heading");
        const replacement = old.cloneNode(true);
        old.replaceWith(replacement);
      });
    };
    await send("Change the heading");
    await panel.getByRole("button", { name: "Send", exact: true }).waitFor();
    assert.equal(
      await source.locator("#display-heading").textContent(),
      "Do you need a break?",
    );
    beforeDisplayReplacement = async () => {};
    await permission.selectOption("off");
    await panel.waitForFunction(() => {
      const select = document.querySelector(
        'select[aria-label="Display editing permission"]',
      );
      return select?.value === "off" && !select.disabled;
    });
    assert.deepEqual(
      (
        await panel.evaluate(() =>
          chrome.storage.local.get("displayEditOriginsV1"),
        )
      ).displayEditOriginsV1,
      [],
    );
    await permission.selectOption("once");
    await panel.waitForFunction(() => {
      const select = document.querySelector(
        'select[aria-label="Display editing permission"]',
      );
      return select?.value === "once" && !select.disabled;
    });
    await panel.evaluate(async (url) => {
      const tab = await chrome.tabs.create({ url, active: false });
      await chrome.tabs.update(tab.id, { url: `${url}?updated` });
    }, fixtureUrl);
    assert.equal(await permission.inputValue(), "once");
    await send("Correct malformed heading edit");
    await source.waitForFunction(
      () =>
        document.querySelector("#display-heading").textContent === "Enjoy Work",
    );
    await panel.getByRole("button", { name: "Send", exact: true }).waitFor();
    assert.equal(await permission.inputValue(), "off");
    await source.evaluate(() => {
      const host = document.createElement("div");
      host.id = "large-dom-fixture";
      host.hidden = true;
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < 51000; index++)
        fragment.append(
          document.createElementNS("http://www.w3.org/2000/svg", "svg"),
        );
      host.append(fragment);
      document.body.append(host);
    });
    const largeScan = await panel.evaluate(async (tabId) => {
      const tab = await chrome.tabs.get(tabId);
      const started = await chrome.runtime.sendMessage({
        type: "display-edit",
        operation: "start",
        tabId,
        url: tab.url,
        once: true,
      });
      if (!started?.ok) throw new Error("Large DOM task could not start");
      try {
        const snapshots = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => self.origin,
        });
        const frames = snapshots.map((snapshot) => ({
          frameId: snapshot.frameId,
          documentId: snapshot.documentId,
          origin: snapshot.result,
        }));
        const start = performance.now();
        const result = await chrome.runtime.sendMessage({
          type: "display-edit",
          operation: "find",
          taskId: started.taskId,
          frames,
          text: "Enjoy Work",
        });
        return {
          ok: result?.ok,
          result: result?.result,
          elapsedMs: Math.round(performance.now() - start),
        };
      } finally {
        await chrome.runtime.sendMessage({
          type: "display-edit",
          operation: "end",
          taskId: started.taskId,
        });
      }
    }, sourceTabId);
    assert.equal(largeScan.ok, false);
    assert.match(largeScan.result, /search was incomplete/);
    assert.equal(
      await source.locator("#display-heading").textContent(),
      "Enjoy Work",
    );
    assert.equal(
      await source.locator("#name").inputValue(),
      "Keep this unsaved value",
    );
    assert.equal(await source.evaluate(() => window.submissions), 0);
    await source
      .locator("#large-dom-fixture")
      .evaluate((element) => element.remove());
    if (values["live-display"]) {
      const { StandaloneBridgeServer } = await import(
        pathToFileURL(path.join(root, "standalone-bridge/out/src/index.js"))
          .href
      );
      const reservation = http.createServer();
      const livePort = await listen(reservation);
      await close(reservation);
      liveBridge = new StandaloneBridgeServer(
        livePort,
        "live-test",
        ownedDirectory,
        [],
      );
      await liveBridge.start();
      liveBridgeUrl = `http://127.0.0.1:${livePort}`;
      await worker.evaluate(() =>
        chrome.storage.local.set({
          llmSettings: {
            provider: "copilot-sdk",
            copilot: { model: "" },
            lmStudio: { endpoint: "http://localhost:1234", model: "" },
          },
        }),
      );
      await panel.reload();
      panel.setDefaultTimeout(120000);
      await permission.waitFor();
      await panel.evaluate(
        (tabId) => chrome.tabs.update(tabId, { active: true }),
        sourceTabId,
      );
      await permission.selectOption("site");
      await panel.waitForFunction(() => {
        const select = document.querySelector(
          'select[aria-label="Display editing permission"]',
        );
        return select?.value === "site" && !select.disabled;
      });
      liveActive = true;
      await send(
        "On this synthetic local page, temporarily change the exact visible heading Enjoy Work to Live verified heading. First use findDisplayText with that exact text, then use the returned display ref in replaceText. Emit only one permitted ACTION per response and wait for execution results. Do not create files, navigate, click, submit, or use any other tools.",
      );
      await panel.getByRole("button", { name: "Send", exact: true }).waitFor();
      const actual = await source.locator("#display-heading").textContent();
      await fs.writeFile(
        path.join(output, "live-display-summary.json"),
        JSON.stringify(
          {
            passed: actual === "Live verified heading",
            provider: "copilot-sdk",
            model: "SDK default",
            clientProvider: requests.at(-1)?.settings?.provider,
            requests: liveRequests,
            syntheticPage: true,
            inputUnchanged:
              (await source.locator("#name").inputValue()) ===
              "Keep this unsaved value",
            submissions: await source.evaluate(() => window.submissions),
          },
          null,
          2,
        ),
      );
      assert.equal(
        actual,
        "Live verified heading",
        "Live SDK task did not complete the synthetic display change; inspect the dedicated verification result before retrying",
      );
      assert.equal(await source.evaluate(() => window.submissions), 0);
      await panel.getByRole("button", { name: /Undo|元に戻す/ }).click();
      await source.waitForFunction(
        () =>
          document.querySelector("#display-heading").textContent ===
          "Enjoy Work",
      );
      liveActive = false;
      console.log(
        "Live SDK synthetic display workflow PASS; no authenticated user page was accessed",
      );
    }
    if (values["live-display"] || values["native-panel"]) {
      await fs.writeFile(
        path.join(output, "native-sidepanel-summary.json"),
        JSON.stringify(
          {
            status: "running",
            verificationStartedAt,
            interactiveWorkflowVerified: false,
          },
          null,
          2,
        ),
      );
      liveActive = values["live-display"];
      await permission.selectOption("site");
      await panel.waitForFunction(() => {
        const select = document.querySelector(
          'select[aria-label="Display editing permission"]',
        );
        return select?.value === "site" && !select.disabled;
      });
      await panel.evaluate(async (tabId) => {
        const tab = await chrome.tabs.get(tabId);
        const button = document.createElement("button");
        button.textContent = "Open native verification sidepanel";
        button.onclick = async () => {
          try {
            await chrome.sidePanel.open({ windowId: tab.windowId });
            window.__nativeVerificationOpen = true;
          } catch {
            window.__nativeVerificationOpen = false;
          }
        };
        document.body.append(button);
      }, sourceTabId);
      await panel
        .getByRole("button", {
          name: "Open native verification sidepanel",
          exact: true,
        })
        .click();
      await panel.waitForFunction(
        () => window.__nativeVerificationOpen === true,
      );
      const nativeContexts = await panel.evaluate(() =>
        chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] }),
      );
      assert(
        nativeContexts.some(
          (item) =>
            item.documentUrl ===
            `chrome-extension://${extensionId}/sidepanel.html`,
        ),
        "Native sidepanel context missing",
      );
      await source.locator("#display-heading").evaluate((element) => {
        element.textContent = "Do you need a break?";
      });
      await panel.evaluate(
        (tabId) => chrome.tabs.update(tabId, { active: true }),
        sourceTabId,
      );
      const originalTarget = (await devtools.send("Target.getTargetInfo"))
        .targetInfo.targetId;
      const targetInfos = (await devtools.send("Target.getTargets"))
        .targetInfos;
      const nativeTarget = targetInfos.find(
        (target) =>
          target.url === `chrome-extension://${extensionId}/sidepanel.html` &&
          target.targetId !== originalTarget,
      );
      assert(nativeTarget, "Native sidepanel renderer target missing");
      const nativeSession = await devtools.send("Target.attachToTarget", {
        targetId: nativeTarget.targetId,
        flatten: false,
      });
      let nativeSequence = 0;
      const nativePending = new Map();
      const receiveNative = (event) => {
        if (event.sessionId !== nativeSession.sessionId) return;
        const message = JSON.parse(event.message);
        const pending = nativePending.get(message.id);
        if (!pending) return;
        nativePending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error)
          pending.reject(new Error("Native renderer command failed"));
        else pending.resolve(message.result);
      };
      devtools.on("Target.receivedMessageFromTarget", receiveNative);
      const sendNative = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const id = ++nativeSequence;
          const timer = setTimeout(
            () => {
              nativePending.delete(id);
              reject(new Error("Native renderer deadline reached"));
            },
            values["live-display"] ? 120000 : 30000,
          );
          nativePending.set(id, { resolve, reject, timer });
          void devtools
            .send("Target.sendMessageToTarget", {
              sessionId: nativeSession.sessionId,
              message: JSON.stringify({ id, method, params }),
            })
            .catch(reject);
        });
      try {
        const ready = await sendNative("Runtime.evaluate", {
          awaitPromise: true,
          returnByValue: true,
          expression: `new Promise(resolve => {
          const ready = () => Boolean(document.querySelector('form textarea') && document.querySelector('select[aria-label="Display editing permission"]')?.value === 'site');
          if (ready()) return resolve(true);
          const observer = new MutationObserver(() => { if (ready()) { clearTimeout(timer); observer.disconnect(); resolve(true); } });
          const timer = setTimeout(() => { observer.disconnect(); resolve(false); }, 10000);
          observer.observe(document.documentElement, {subtree:true,childList:true,attributes:true});
        })`,
        });
        assert.equal(
          ready.result?.value,
          true,
          "Native sidepanel controls were not ready",
        );
        const nativePrompt = values["live-display"]
          ? "On this synthetic local page, temporarily change the exact heading Do you need a break? to Enjoy Work. First use findDisplayText, then replaceText with the returned ref. Emit one permitted ACTION per response, wait for results, and do not click, navigate, create files or submit."
          : "Change the heading";
        await sendNative("Runtime.evaluate", {
          awaitPromise: true,
          returnByValue: true,
          expression: `new Promise(resolve => {
          const input = document.querySelector('form textarea');
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(nativePrompt)});
          input.dispatchEvent(new Event('input',{bubbles:true}));
          requestAnimationFrame(() => { document.querySelector('button[aria-label="Send"]').click(); resolve(true); });
        })`,
        });
        await source.waitForFunction(
          () =>
            document.querySelector("#display-heading").textContent ===
            "Enjoy Work",
          undefined,
          { timeout: values["live-display"] ? 120000 : 15000 },
        );
        const rendered = await sendNative("Runtime.evaluate", {
          awaitPromise: true,
          returnByValue: true,
          expression: `new Promise(resolve => {
          const settled = () => document.body.innerText.includes('Action result verified.') && Boolean(document.querySelector('button[aria-label="Send"]'));
          const snapshot = () => ({verified:settled(),noOverflow:document.documentElement.scrollWidth <= window.innerWidth,hasInput:Boolean(document.querySelector('form textarea'))});
          if (settled()) return resolve(snapshot());
          const observer = new MutationObserver(() => { if (settled()) { clearTimeout(timer); observer.disconnect(); resolve(snapshot()); } });
          const timer = setTimeout(() => { observer.disconnect(); resolve(snapshot()); }, ${values["live-display"] ? 90000 : 10000});
          observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
        })`,
        });
        assert.equal(
          rendered.result?.value?.verified,
          true,
          "Native result reporting did not finish",
        );
        assert.equal(rendered.result?.value?.hasInput, true);
        assert.equal(rendered.result?.value?.noOverflow, true);
        const capture = await sendNative("Page.captureScreenshot", {
          format: "png",
        });
        await fs.writeFile(
          path.join(output, "native-sidepanel.png"),
          Buffer.from(capture.data, "base64"),
        );
      } finally {
        devtools.off("Target.receivedMessageFromTarget", receiveNative);
        await devtools
          .send("Target.detachFromTarget", {
            sessionId: nativeSession.sessionId,
          })
          .catch(() => undefined);
      }
      assert.equal(
        await source.locator("#name").inputValue(),
        "Keep this unsaved value",
      );
      assert.equal(await source.evaluate(() => window.submissions), 0);
      await fs.writeFile(
        path.join(output, "native-sidepanel-summary.json"),
        JSON.stringify(
          {
            opened: true,
            status: "passed",
            verificationStartedAt,
            contextType: "SIDE_PANEL",
            loadedExtension: extensionId,
            syntheticPage: true,
            interactiveWorkflowVerified: true,
            resultReportingFinished: true,
            responseProvider: values["live-display"]
              ? "copilot-sdk"
              : "deterministic fixture",
            sdkRequestsTotal: liveRequests,
            inputUnchanged: true,
            submissions: 0,
          },
          null,
          2,
        ),
      );
      console.log(
        "Native docked sidepanel workflow PASS with verified result and idle send control",
      );
      liveActive = false;
    }
    for (const width of [320, 480]) {
      await panel.setViewportSize({ width, height: 900 });
      assert(
        await panel.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        "Display permission UI overflows",
      );
      await panel.screenshot({
        path: path.join(output, `display-edit-${width}.png`),
        animations: "disabled",
      });
    }
    assert.deepEqual(pageErrors, []);
    await fs.writeFile(
      path.join(output, "display-edit-summary.json"),
      JSON.stringify(
        {
          passed: true,
          ordinaryRefs: 120,
          formHeadingChanged: true,
          undo: true,
          persistentPermission: true,
          twoEditedTabsIndependentUndo: true,
          duplicateDenied: true,
          staleElementDenied: true,
          reportActionDenied: true,
          reedit: true,
          nestedHeading: true,
          negativeTabindex: true,
          fullSummary: true,
          oneTaskPermission: true,
          parseCorrection: true,
          largeDomIncomplete: true,
          largeDomElements: 51000,
          largeDomElapsedMs: largeScan.elapsedMs,
          unchangedInput: true,
          submissions: 0,
          viewports: [320, 480],
        },
        null,
        2,
      ),
    );
    console.log(
      "Display editing fixture PASS: form heading, 120 refs, persistent permission, undo, duplicates, stale DOM, report-only and responsive UI",
    );
  } else {
    const pageStatus = panel.getByRole("region", { name: "Page context" });
    const [statusBounds, originBounds] = await Promise.all([
      pageStatus.getByRole("status").boundingBox(),
      pageStatus.locator("[title]").first().boundingBox(),
    ]);
    assert(statusBounds && originBounds);
    assert(
      Math.abs(statusBounds.y - originBounds.y) < 3,
      "Page status spans multiple rows",
    );
    const pageCount = context.pages().length;
    await panel.getByRole("button", { name: "Report an issue" }).click();
    const issueDialog = panel.getByRole("dialog", { name: "Report an issue" });
    await issueDialog.waitFor();
    assert.equal(
      await issueDialog
        .getByRole("button", { name: "Review on GitHub" })
        .isDisabled(),
      true,
    );
    await issueDialog.getByLabel("Title").fill("Fixture page read failure");
    await issueDialog
      .getByLabel("Steps to reproduce")
      .fill("Read the fixture page");
    await issueDialog.getByLabel("Actual").fill("No page content");
    await issueDialog.getByText("Preview issue text").click();
    assert(
      !(await issueDialog.locator("pre").innerText()).includes(
        new URL(fixtureUrl).origin,
      ),
    );
    await issueDialog.getByLabel(/Include site origin/).check();
    assert(
      (await issueDialog.locator("pre").innerText()).includes(
        new URL(fixtureUrl).origin,
      ),
    );
    await panel.setViewportSize({ width: 320, height: 740 });
    assert(
      await panel.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "Issue dialog overflows a narrow sidepanel",
    );
    await panel.screenshot({
      path: path.join(output, "installed-issue-mobile.png"),
      animations: "disabled",
    });
    await panel.setViewportSize({ width: 480, height: 900 });
    await panel.keyboard.press("Escape");
    await issueDialog.waitFor({ state: "hidden" });
    assert.equal(context.pages().length, pageCount);
    const frameDocuments = await worker.evaluate(async (tabId) => {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => document.title,
      });
      return results.map(({ frameId, documentId }) => ({
        frameId,
        documentId,
      }));
    }, sourceTabId);
    assert(frameDocuments.length >= 2);
    assert(
      frameDocuments.every((frame) => typeof frame.documentId === "string"),
    );
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
                const complete = items.find(
                  (item) => item.state === "complete",
                );
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
    await panel.getByText("Action details", { exact: true }).last().click();
    await panel.getByText(/Field value verified; not submitted/).waitFor();
    assert.equal(await source.locator("#name").inputValue(), "Installed Test");
    assert.equal(await source.evaluate(() => window.submissions), 0);
    await input.fill("Unsent draft");
    await input.press("Home");
    await input.press("ArrowUp");
    assert.equal(await input.inputValue(), "Fill the fixture name");
    await input.press("ArrowDown");
    assert.equal(await input.inputValue(), "Unsent draft");
    await input.fill("");
    await panel
      .getByLabel("Browser operation", { exact: true })
      .selectOption("automation");
    await input.fill("Open fixture receipt one");
    await input.press("Enter");
    await panel
      .getByRole("dialog", { name: "Approve browser action" })
      .waitFor();
    assert.equal(
      await panel
        .getByRole("button", { name: "Cancel", exact: true })
        .evaluate((button) => document.activeElement === button),
      true,
    );
    assert.equal(await source.evaluate(() => window.receipts.length), 0);
    await panel.getByRole("button", { name: "Always allow this site" }).click();
    await source.waitForFunction(() => window.receipts.includes("receipt-one"));
    await panel
      .getByText(/outcome unverified/)
      .last()
      .waitFor({ state: "attached" });
    await panel.getByRole("button", { name: "Send", exact: true }).waitFor();
    assert.equal(await source.evaluate(() => window.submissions), 0);
    await panel.reload();
    await panel
      .getByLabel("Browser operation", { exact: true })
      .selectOption("automation");
    const nextInput = panel.locator("form textarea").last();
    await nextInput.fill("Open fixture receipt two");
    await nextInput.press("Enter");
    await source.waitForFunction(() => window.receipts.includes("receipt-two"));
    await panel.getByRole("button", { name: "Send", exact: true }).waitFor();
    assert.equal(
      await panel
        .getByRole("dialog", { name: "Approve browser action" })
        .count(),
      0,
    );
    assert.equal(await source.evaluate(() => window.submissions), 0);
    await panel.getByText("Approved button sites", { exact: true }).click();
    const revokeButton = panel.getByRole("button", {
      name: `${new URL(fixtureUrl).origin} revoke permission`,
    });
    await revokeButton.click();
    await revokeButton.waitFor({ state: "detached" });
    const receiptsBeforeRejection = await source.evaluate(
      () => window.receipts.length,
    );
    await nextInput.fill("Open fixture receipt one");
    await nextInput.press("Enter");
    await panel
      .getByRole("dialog", { name: "Approve browser action" })
      .waitFor();
    await panel.keyboard.press("Shift+Tab");
    assert.equal(
      await panel
        .getByRole("button", { name: "Always allow this site" })
        .evaluate((button) => document.activeElement === button),
      true,
    );
    await panel.keyboard.press("Tab");
    assert.equal(
      await panel
        .getByRole("button", { name: "Cancel", exact: true })
        .evaluate((button) => document.activeElement === button),
      true,
    );
    await panel.keyboard.press("Escape");
    await panel
      .getByRole("dialog", { name: "Approve browser action" })
      .waitFor({ state: "hidden" });
    assert.equal(
      await nextInput.evaluate(
        (textarea) => document.activeElement === textarea,
      ),
      true,
    );
    assert.equal(
      await source.evaluate(() => window.receipts.length),
      receiptsBeforeRejection,
    );
    assert.equal(await source.evaluate(() => window.submissions), 0);
    const siteDownloadPromise = source.waitForEvent("download");
    await nextInput.fill("Download fixture receipt");
    await nextInput.press("Enter");
    await panel
      .getByRole("dialog", { name: "Approve browser action" })
      .waitFor();
    await panel.getByText("/receipt.pdf", { exact: true }).waitFor();
    await panel.getByRole("button", { name: "Once", exact: true }).click();
    const siteDownload = await siteDownloadPromise;
    assert.equal(siteDownload.suggestedFilename(), "receipt.pdf");
    const receiptDownload = await panel.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            chrome.downloads.onChanged.removeListener(check);
          };
          const timer = setTimeout(() => {
            cleanup();
            reject(new Error("Receipt download did not complete"));
          }, 10000);
          const check = () => {
            void chrome.downloads
              .search({})
              .then((items) => {
                const receipt = items.find((item) =>
                  item.filename.endsWith("receipt.pdf"),
                );
                if (receipt?.state === "complete") {
                  cleanup();
                  resolve({ filename: receipt.filename, state: receipt.state });
                } else if (receipt?.state === "interrupted") {
                  cleanup();
                  reject(
                    new Error(`Receipt download interrupted: ${receipt.error}`),
                  );
                }
              })
              .catch(reject);
          };
          chrome.downloads.onChanged.addListener(check);
          check();
        }),
    );
    assert.equal(receiptDownload.state, "complete");
    assert(
      path.resolve(receiptDownload.filename).startsWith(downloads + path.sep),
    );
    const savedPdf = await fs.readFile(receiptDownload.filename, "utf8");
    assert(savedPdf.startsWith("%PDF-1.4"));
    assert(savedPdf.includes("(Fixture receipt)"));
    assert(savedPdf.endsWith(`startxref\n${xrefOffset}\n%%EOF\n`));
    assert.equal(await source.evaluate(() => window.submissions), 0);
    await panel
      .getByText("Installed extension response.", { exact: true })
      .waitFor();
    await panel
      .getByLabel("Display editing permission", { exact: true })
      .selectOption("once");
    await input.fill("Edit both fixture labels");
    await input.press("Enter");
    await source.getByText("Demo heading", { exact: true }).waitFor();
    assert.equal(
      await source.locator("main > p").textContent(),
      "Demo article",
    );
    const editRequest = requests.find(
      (item) => item.messages.at(-1)?.content === "Edit both fixture labels",
    );
    assert(editRequest.pageContent.includes("Verified local article"));
    const undoEdit = panel.getByRole("button", { name: "Undo display edit" });
    await undoEdit.waitFor();
    const secondSite = await context.newPage();
    const secondUrl = `http://permission.fixture.test:${fixturePort}/fixture`;
    await secondSite.goto(secondUrl);
    const secondTabId = await worker.evaluate(
      async (url) => (await chrome.tabs.query({ url }))[0]?.id,
      secondUrl,
    );
    assert.equal(typeof secondTabId, "number");
    await panel.evaluate(
      (tabId) => chrome.tabs.update(tabId, { active: true }),
      secondTabId,
    );
    await undoEdit.waitFor({ state: "hidden", timeout: 3000 });
    assert.equal(await source.locator("h1").textContent(), "Demo heading");
    await panel.evaluate(
      (tabId) => chrome.tabs.update(tabId, { active: true }),
      sourceTabId,
    );
    await undoEdit.waitFor({ state: "visible", timeout: 3000 });
    await undoEdit.click();
    await source
      .getByText("Installed extension fixture", { exact: true })
      .waitFor();
    assert.equal(
      await source.locator("main > p").textContent(),
      "Verified local article for extraction.",
    );
    assert.equal(
      await panel
        .getByLabel("Display editing permission", { exact: true })
        .inputValue(),
      "off",
    );
    await panel.evaluate(
      (tabId) => chrome.tabs.update(tabId, { active: true }),
      secondTabId,
    );
    assert.equal(
      await panel.evaluate(() =>
        chrome.permissions.contains({
          origins: ["http://permission.fixture.test/*"],
        }),
      ),
      true,
    );
    const requestCount = requests.length;
    await worker.evaluate(
      async (tabId) =>
        chrome.storage.local.set({ pendingAction: { type: "post", tabId } }),
      secondTabId,
    );
    await panel.getByText("Second site response.", { exact: true }).waitFor();
    assert.equal(requests.length, requestCount + 1);
    assert(requests.at(-1).pageContent.includes("Verified local article"));
    assert.equal(
      await panel.getByRole("button", { name: "Allow this site" }).count(),
      0,
    );
    assert.deepEqual(pageErrors, []);
    await panel.screenshot({
      path: path.join(output, "installed-extension.png"),
      animations: "disabled",
    });
    console.log(
      JSON.stringify({
        result: "PASS",
        fixtureAnswerBytes: Buffer.byteLength(exported),
        fixturePdfBytes: Buffer.byteLength(savedPdf),
        fixtureDownloadSuggestedName: siteDownload.suggestedFilename(),
        downloadFilesManagedByPlaywright: true,
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
          "compact one-line page status and prompt history draft restoration",
          "issue preview keeps site origin opt-in and never opens GitHub before confirmation",
          "button approval keyboard focus, Escape, persistent grant and revocation without submitting",
          "approved same-origin download link yields a real fixture PDF without form submission",
          "two display edits in one action, undone together",
          "undo follows the edited tab and stays hidden on other tabs",
          "original page text sent to the selected model before display editing",
          "second HTTP site readable without a site-grant action",
          "page task still required before sending content to the model",
        ],
        llm: "local fixture",
        surface: "extension sidepanel document in an owned tab",
        screenshot: path.relative(
          root,
          path.join(output, "installed-extension.png"),
        ),
      }),
    );
  }
} finally {
  releaseCapabilities();
  liveBridge?.stop();
  try {
    await context?.close();
  } finally {
    try {
      await Promise.all([close(bridgeServer), close(fixtureServer)]);
    } finally {
      await fs.rm(ownedDirectory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  }
}
