import { beforeEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { createTestHost, type TestHost } from "../testing/test-host.js";
import { createNpmWorkspaceManager } from "./npm.js";
import type { WorkspaceManager } from "./types.js";

describe("npm", () => {
  let host: TestHost;
  let npm: WorkspaceManager;
  beforeEach(async () => {
    host = createTestHost({
      "proj/package.json": stringify({
        workspaces: ["packages/*"],
      }),
    });

    npm = createNpmWorkspaceManager();
  });

  it("finds 0 packages when workspace has none", async () => {
    const workspace = await npm.load(host.host, "proj");
    expect(workspace.packages).toEqual([]);
  });

  it("finds all packages", async () => {
    host.addFile("proj/packages/pkg-a/package.json", JSON.stringify({ name: "pkg-a", version: "1.0.0" }));
    host.addFile("proj/packages/pkg-b/package.json", JSON.stringify({ name: "pkg-b", version: "1.2.0" }));
    const workspace = await npm.load(host.host, "proj");
    expect(workspace.packages).toHaveLength(2);
    expect(workspace.packages[0]).toMatchObject({
      name: "pkg-a",
      version: "1.0.0",
      relativePath: "packages/pkg-a",
    });
    expect(workspace.packages[1]).toMatchObject({
      name: "pkg-b",
      version: "1.2.0",
      relativePath: "packages/pkg-b",
    });
  });
});
