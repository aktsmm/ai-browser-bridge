import { describe, expect, it } from "vitest";
import zlib from "node:zlib";
import {
  checkZipHygiene,
  compareVersions,
  inspectZip,
  planPublish,
  summarizeStatus,
} from "./cws-publish.mjs";

function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name);
    const raw = Buffer.from(content);
    const data = zlib.deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    locals.push(local, nameBuffer, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);
    offset += 30 + nameBuffer.length + data.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

const status = (published, submitted) => ({
  publishedItemRevisionStatus: published
    ? { state: "PUBLISHED", distributionChannels: [{ crxVersion: published }] }
    : undefined,
  submittedItemRevisionStatus: submitted
    ? {
        state: "PENDING_REVIEW",
        distributionChannels: [{ crxVersion: submitted }],
      }
    : undefined,
});

describe("cws-publish", () => {
  it("compares dotted versions numerically", () => {
    expect(compareVersions("0.1.30", "0.1.29")).toBe(1);
    expect(compareVersions("0.1.9", "0.1.10")).toBe(-1);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });

  it("plans an upload only for a newer version with nothing pending", () => {
    expect(
      planPublish({ zipVersion: "0.1.30", status: status("0.1.29") }).action,
    ).toBe("upload-and-publish");
  });

  it("blocks a second submission while a review is pending", () => {
    const plan = planPublish({
      zipVersion: "0.1.31",
      status: status("0.1.29", "0.1.30"),
    });
    expect(plan.action).toBe("blocked");
    expect(plan.reason).toMatch(/pending for 0\.1\.30/);
    const same = planPublish({
      zipVersion: "0.1.30",
      status: status("0.1.29", "0.1.30"),
    });
    expect(same.reason).toMatch(/already submitted/);
  });

  it("does not let a rejected or cancelled history entry block a resubmission", () => {
    const rejected = {
      publishedItemRevisionStatus: {
        state: "PUBLISHED",
        distributionChannels: [{ crxVersion: "0.1.29" }],
      },
      submittedItemRevisionStatus: {
        state: "REJECTED",
        distributionChannels: [{ crxVersion: "0.1.30" }],
      },
    };
    expect(planPublish({ zipVersion: "0.1.31", status: rejected }).action).toBe(
      "upload-and-publish",
    );
    const staged = {
      submittedItemRevisionStatus: {
        state: "STAGED",
        distributionChannels: [{ crxVersion: "0.1.30" }],
      },
    };
    expect(planPublish({ zipVersion: "0.1.31", status: staged }).action).toBe(
      "blocked",
    );
  });

  it("blocks re-uploading the published or an older version", () => {
    expect(
      planPublish({ zipVersion: "0.1.29", status: status("0.1.29") }).reason,
    ).toMatch(/already published/);
    expect(
      planPublish({ zipVersion: "0.1.28", status: status("0.1.29") }).reason,
    ).toMatch(/older/);
  });

  it("blocks a taken-down item and tolerates a sparse response", () => {
    expect(
      planPublish({ zipVersion: "0.1.30", status: { takenDown: true } }).action,
    ).toBe("blocked");
    expect(summarizeStatus({}).publishedVersion).toBeUndefined();
    expect(planPublish({ zipVersion: "0.1.30", status: {} }).action).toBe(
      "upload-and-publish",
    );
  });

  it("reads the manifest and entry names from a ZIP without dependencies", () => {
    const zip = buildZip({
      "manifest.json": JSON.stringify({
        version: "0.1.30",
        permissions: ["storage"],
      }),
      "background.js": "x",
    });
    const info = inspectZip(zip);
    expect(info.version).toBe("0.1.30");
    expect(info.permissions).toEqual(["storage"]);
    expect(info.names).toEqual(["manifest.json", "background.js"]);
    expect(checkZipHygiene(info)).toEqual([]);
  });

  it("flags development files in a runtime ZIP", () => {
    const zip = buildZip({
      "manifest.json": JSON.stringify({ version: "1.0.0" }),
      "src/app.ts": "x",
      "chunks/app.js.map": "x",
      ".env.submit": "x",
    });
    expect(checkZipHygiene(inspectZip(zip))).toEqual([
      "src/app.ts",
      "chunks/app.js.map",
      ".env.submit",
    ]);
  });

  it("rejects a non-ZIP buffer", () => {
    expect(() =>
      inspectZip(Buffer.from("not a zip file at all, definitely")),
    ).toThrow(/ZIP/);
  });
});
