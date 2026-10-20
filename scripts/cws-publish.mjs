#!/usr/bin/env node
// Chrome Web Store API v2 publisher (service account, no OAuth refresh token).
//
//   node scripts/cws-publish.mjs            dry-run: ZIP hygiene + store status + plan (no changes)
//   node scripts/cws-publish.mjs --status   store status only
//   node scripts/cws-publish.mjs --apply    upload the ZIP and submit it for review
//
// Auth: CWS_ACCESS_TOKEN, or a short-lived token from gcloud service account impersonation
// (no key file). The token is never printed.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";

const SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const DEFAULTS = {
  publisherId: "9be8fb4d-e984-498a-b32e-cc56f2c4c352",
  extensionId: "nggfpdadfepkbpjfnpcihagbnnfpeian",
  project: "nodal-stack-486810-i3",
  serviceAccount: "cws-publisher@nodal-stack-486810-i3.iam.gserviceaccount.com",
};
const FORBIDDEN_ENTRY =
  /(^|\/)(src|tests|\.github|\.vscode|store-assets|node_modules)\/|\.map$|(^|\/)\.env/;

export function compareVersions(a, b) {
  const left = String(a).split(".").map(Number);
  const right = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/** fetchStatus の応答から、公開中・審査中のバージョンを取り出す。 */
export function summarizeStatus(status) {
  const channel = (revision) => revision?.distributionChannels?.[0];
  return {
    publishedVersion: channel(status?.publishedItemRevisionStatus)?.crxVersion,
    publishedState: status?.publishedItemRevisionStatus?.state,
    submittedVersion: channel(status?.submittedItemRevisionStatus)?.crxVersion,
    submittedState: status?.submittedItemRevisionStatus?.state,
    lastUploadState: status?.lastAsyncUploadState,
    takenDown: Boolean(status?.takenDown),
  };
}

const PENDING_STATES = new Set(["PENDING_REVIEW", "STAGED"]);

/** 二重提出・同一版の再アップロード・版数の巻き戻りを止め、次の操作を決める。 */
export function planPublish({ zipVersion, status }) {
  const summary = summarizeStatus(status);
  if (summary.takenDown)
    return { action: "blocked", reason: "The item is taken down.", summary };
  // REJECTED / CANCELLED は履歴として残るだけなので、再提出は止めない
  if (PENDING_STATES.has(summary.submittedState))
    return {
      action: "blocked",
      reason:
        summary.submittedVersion === zipVersion
          ? `Version ${zipVersion} is already submitted (${summary.submittedState}).`
          : `A review is pending for ${summary.submittedVersion ?? "another version"}; do not upload until it finishes or is cancelled.`,
      summary,
    };
  if (
    summary.publishedVersion &&
    compareVersions(zipVersion, summary.publishedVersion) === 0
  )
    return {
      action: "blocked",
      reason: `Version ${zipVersion} is already published.`,
      summary,
    };
  if (
    summary.publishedVersion &&
    compareVersions(zipVersion, summary.publishedVersion) < 0
  )
    return {
      action: "blocked",
      reason: `ZIP version ${zipVersion} is older than the published ${summary.publishedVersion}.`,
      summary,
    };
  return { action: "upload-and-publish", reason: "ready", summary };
}

/** 依存なしで ZIP の全エントリ名と manifest.json を読む。 */
export function inspectZip(buffer) {
  let eocd = -1;
  for (
    let i = buffer.length - 22;
    i >= Math.max(0, buffer.length - 65557);
    i--
  ) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0)
    throw new Error("Not a ZIP file (end of central directory not found).");
  const total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < total; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("Corrupt ZIP central directory.");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.push({ name, method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  const manifestEntry = entries.find((entry) => entry.name === "manifest.json");
  if (!manifestEntry)
    throw new Error("manifest.json is missing from the ZIP root.");
  const local = manifestEntry.localOffset;
  const dataStart =
    local +
    30 +
    buffer.readUInt16LE(local + 26) +
    buffer.readUInt16LE(local + 28);
  const raw = buffer.subarray(
    dataStart,
    dataStart + manifestEntry.compressedSize,
  );
  const manifestText = (
    manifestEntry.method === 8 ? zlib.inflateRawSync(raw) : raw
  ).toString("utf8");
  const manifest = JSON.parse(manifestText);
  return {
    names: entries.map((entry) => entry.name),
    version: manifest.version,
    permissions: manifest.permissions ?? [],
    hostPermissions: manifest.host_permissions ?? [],
  };
}

export function checkZipHygiene(info) {
  return info.names.filter((name) => FORBIDDEN_ENTRY.test(name));
}

function config(env = process.env) {
  return {
    publisherId: env.CWS_PUBLISHER_ID || DEFAULTS.publisherId,
    extensionId: env.CWS_EXTENSION_ID || DEFAULTS.extensionId,
    project: env.CWS_GCP_PROJECT || DEFAULTS.project,
    serviceAccount: env.CWS_SERVICE_ACCOUNT || DEFAULTS.serviceAccount,
    gcloud: env.GCLOUD_PATH || "gcloud",
  };
}

function getAccessToken(cfg) {
  if (process.env.CWS_ACCESS_TOKEN) return process.env.CWS_ACCESS_TOKEN.trim();
  const args = [
    "auth",
    "print-access-token",
    `--impersonate-service-account=${cfg.serviceAccount}`,
    `--scopes=${SCOPE}`,
    `--project=${cfg.project}`,
  ];
  // gcloud は Windows では .cmd のため、シェルを介さず PowerShell 経由で呼ぶ
  const result =
    process.platform === "win32"
      ? spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `& '${cfg.gcloud.replace(/'/g, "''")}' ${args.map((arg) => `'${arg.replace(/'/g, "''")}'`).join(" ")}`,
          ],
          { encoding: "utf8", windowsHide: true },
        )
      : spawnSync(cfg.gcloud, args, { encoding: "utf8" });
  const token = (result.stdout ?? "").trim().split(/\r?\n/).pop();
  if (result.status !== 0 || !token?.startsWith("ya29.")) {
    const hint = (result.stderr ?? "")
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-2)
      .join(" | ");
    throw new Error(
      `Could not get a service account token (${cfg.serviceAccount}). Check gcloud login and the Token Creator role. ${hint}`,
    );
  }
  return token;
}

async function api(token, method, url, { body, contentType } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body,
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `${method} ${url.split("?")[0]} -> HTTP ${response.status}: ${text.slice(0, 500)}`,
    );
  return text ? JSON.parse(text) : {};
}

const itemUrl = (cfg) =>
  `https://chromewebstore.googleapis.com/v2/publishers/${cfg.publisherId}/items/${cfg.extensionId}`;
const uploadUrl = (cfg) =>
  `https://chromewebstore.googleapis.com/upload/v2/publishers/${cfg.publisherId}/items/${cfg.extensionId}`;

function defaultZipPath() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { version } = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  return path.join(
    root,
    ".output",
    `copilot-browser-bridge-chrome-${version}-chrome.zip`,
  );
}

function parseArgs(argv) {
  const options = { apply: false, statusOnly: false, zip: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") options.apply = true;
    else if (argv[i] === "--status") options.statusOnly = true;
    else if (argv[i] === "--zip") options.zip = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cfg = config();
  const token = getAccessToken(cfg);
  const status = await api(token, "GET", `${itemUrl(cfg)}:fetchStatus`);
  console.log("store status:", JSON.stringify(summarizeStatus(status)));
  if (options.statusOnly) return 0;

  const zipPath = path.resolve(options.zip ?? defaultZipPath());
  const buffer = fs.readFileSync(zipPath);
  const info = inspectZip(buffer);
  const leaked = checkZipHygiene(info);
  const sha256 = createHash("sha256")
    .update(buffer)
    .digest("hex")
    .toUpperCase();
  console.log(
    `zip: ${path.basename(zipPath)} ${buffer.length} B sha256=${sha256} version=${info.version} entries=${info.names.length}`,
  );
  console.log(
    `permissions: ${info.permissions.join(",")} | host: ${info.hostPermissions.join(",")}`,
  );
  if (leaked.length) {
    console.error(
      `BLOCKED: runtime ZIP contains development files: ${leaked.join(", ")}`,
    );
    return 2;
  }
  const plan = planPublish({ zipVersion: info.version, status });
  console.log(`plan: ${plan.action} (${plan.reason})`);
  if (plan.action !== "upload-and-publish") return 2;
  if (!options.apply) {
    console.log(
      "dry-run: nothing was uploaded. Re-run with --apply to upload and submit for review.",
    );
    return 0;
  }

  let upload = await api(token, "POST", `${uploadUrl(cfg)}:upload`, {
    body: buffer,
    contentType: "application/zip",
  });
  console.log(
    "upload:",
    JSON.stringify({
      uploadState: upload.uploadState,
      crxVersion: upload.crxVersion,
    }),
  );
  for (let i = 0; i < 12 && upload.uploadState === "IN_PROGRESS"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const current = await api(token, "GET", `${itemUrl(cfg)}:fetchStatus`);
    upload = {
      uploadState: current.lastAsyncUploadState,
      crxVersion: upload.crxVersion,
    };
  }
  if (upload.uploadState !== "SUCCEEDED" && upload.uploadState !== "SUCCESS") {
    console.error(
      `BLOCKED: upload did not succeed (${upload.uploadState}). Not publishing; do not retry blindly.`,
    );
    return 2;
  }
  const published = await api(token, "POST", `${itemUrl(cfg)}:publish`, {
    body: "{}",
    contentType: "application/json",
  });
  console.log(
    "publish:",
    JSON.stringify({ state: published.state, itemId: published.itemId }),
  );
  const after = await api(token, "GET", `${itemUrl(cfg)}:fetchStatus`);
  console.log("store status after:", JSON.stringify(summarizeStatus(after)));
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`ERROR: ${error.message}`);
      process.exit(1);
    });
}
