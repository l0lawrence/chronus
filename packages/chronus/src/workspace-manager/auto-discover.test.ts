import { beforeEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { createTestHost, type TestHost } from "../testing/test-host.js";
import { loadWorkspace } from "./auto-discover.js";

describe("getWorkspaceManager", () => {
  let host: TestHost;
  beforeEach(async () => {
    host = createTestHost({});
  });

  function makePnpmWorkspace() {
    host.addFile(
      "proj/pnpm-workspace.yaml",
      stringify({
        packages: ["packages/*"],
      }),
    );
  }

  function makeRushWorkspace() {
    host.addFile(
      "proj/rush.json",
      JSON.stringify({
        projects: [
          {
            packageName: "pkg-a",
            projectFolder: "packages/pkg-a",
            shouldPublish: true,
          },
          {
            packageName: "pkg-b",
            projectFolder: "packages/pkg-b",
            shouldPublish: true,
          },
        ],
      }),
    );
  }
  function makeNpmWorkspace() {
    host.addFile(
      "proj/package.json",
      JSON.stringify({
        workspaces: ["packages/*"],
      }),
    );
  }

  function makePythonWorkspace() {
    host.addFile("proj/setup.py", "from setuptools import setup\nsetup(name='test')");
  }

  describe("auto", () => {
    it("finds pnpm workspace", async () => {
      makePnpmWorkspace();
      const workspace = await loadWorkspace(host.host, "proj", "auto");
      expect(workspace.type).toBe("pnpm");
    });
    it("finds rush workspace", async () => {
      makeRushWorkspace();
      const workspace = await loadWorkspace(host.host, "proj", "auto");
      expect(workspace.type).toBe("rush");
    });
    it("find npm workspace", async () => {
      makeNpmWorkspace();
      const workspace = await loadWorkspace(host.host, "proj", "auto");
      expect(workspace.type).toBe("npm");
    });
    it("finds python workspace", async () => {
      makePythonWorkspace();
      const workspace = await loadWorkspace(host.host, "proj", "auto");
      expect(workspace.type).toBe("python");
    });

    it("finds pnpm workspace over npm workspace", async () => {
      makeNpmWorkspace();
      makePnpmWorkspace();
      const workspace = await loadWorkspace(host.host, "proj", "auto");
      expect(workspace.type).toBe("pnpm");
    });

    it("finds rush workspace over npm workspace", async () => {
      makeNpmWorkspace();
      makeRushWorkspace();
      const workspace = await loadWorkspace(host.host, "proj", "auto");
      expect(workspace.type).toBe("rush");
    });

    it("finds npm workspace over python workspace", async () => {
      makePythonWorkspace();
      makeNpmWorkspace();
      const workspace = await loadWorkspace(host.host, "proj", "auto");
      expect(workspace.type).toBe("npm");
    });
  });

  describe("forced", () => {
    beforeEach(() => {
      makeNpmWorkspace();
      makeRushWorkspace();
      makePnpmWorkspace();
      makePythonWorkspace();
    });
    it("finds pnpm workspace", async () => {
      makePnpmWorkspace();
      const workspace = await loadWorkspace(host.host, "proj", "pnpm");
      expect(workspace.type).toBe("pnpm");
    });
    it("finds rush workspace", async () => {
      makeRushWorkspace();
      const workspace = await loadWorkspace(host.host, "proj", "rush");
      expect(workspace.type).toBe("rush");
    });
    it("find npm workspace", async () => {
      makeNpmWorkspace();
      const workspace = await loadWorkspace(host.host, "proj", "npm");
      expect(workspace.type).toBe("npm");
    });
    it("finds python workspace", async () => {
      makePythonWorkspace();
      const workspace = await loadWorkspace(host.host, "proj", "python");
      expect(workspace.type).toBe("python");
    });
  });
});
