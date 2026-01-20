import { beforeEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { createTestHost, type TestHost } from "../testing/test-host.js";
import { createPythonWorkspaceManager } from "./python.js";
import type { WorkspaceManager } from "./types.js";

describe("python", () => {
  let host: TestHost;
  let python: WorkspaceManager;

  beforeEach(async () => {
    host = createTestHost({});
    python = createPythonWorkspaceManager(host.host);
  });

  describe("workspace detection", () => {
    it("detects workspace with setup.py", async () => {
      host.addFile("proj/setup.py", "from setuptools import setup\nsetup(name='test')");
      expect(await python.is("proj")).toBe(true);
    });

    it("detects workspace with pyproject.toml", async () => {
      host.addFile("proj/pyproject.toml", stringify({ project: { name: "test" } }));
      expect(await python.is("proj")).toBe(true);
    });

    it("detects workspace with requirements.txt", async () => {
      host.addFile("proj/requirements.txt", "requests==2.28.0");
      expect(await python.is("proj")).toBe(true);
    });

    it("does not detect non-Python workspace", async () => {
      host.addFile("proj/package.json", JSON.stringify({ name: "test" }));
      expect(await python.is("proj")).toBe(false);
    });
  });

  describe("package discovery", () => {
    it("finds 0 packages when workspace has none", async () => {
      host.addFile("proj/setup.py", "from setuptools import setup\nsetup(name='root')");
      const workspace = await python.load("proj");
      expect(workspace.packages).toEqual([]);
    });

    it("finds packages with pyproject.toml (PEP 621 format)", async () => {
      host.addFile("proj/pyproject.toml", "");
      host.addFile(
        "proj/sdk/package-a/pyproject.toml",
        stringify({
          project: {
            name: "package-a",
            version: "1.0.0",
          },
        }),
      );
      host.addFile(
        "proj/sdk/package-b/pyproject.toml",
        stringify({
          project: {
            name: "package-b",
            version: "2.0.0",
          },
        }),
      );

      const workspace = await python.load("proj");
      expect(workspace.packages).toHaveLength(2);
      expect(workspace.packages[0]).toEqual({
        name: "package-a",
        version: "1.0.0",
        relativePath: "sdk/package-a",
        manifest: {},
      });
      expect(workspace.packages[1]).toEqual({
        name: "package-b",
        version: "2.0.0",
        relativePath: "sdk/package-b",
        manifest: {},
      });
    });

    it("finds packages with pyproject.toml (Poetry format)", async () => {
      host.addFile("proj/pyproject.toml", "");
      host.addFile(
        "proj/sdk/package-a/pyproject.toml",
        stringify({
          tool: {
            poetry: {
              name: "package-a",
              version: "1.5.0",
            },
          },
        }),
      );

      const workspace = await python.load("proj");
      expect(workspace.packages).toHaveLength(1);
      expect(workspace.packages[0]).toEqual({
        name: "package-a",
        version: "1.5.0",
        relativePath: "sdk/package-a",
        manifest: {},
      });
    });

    it("finds packages with setup.py", async () => {
      host.addFile("proj/setup.py", "");
      host.addFile(
        "proj/sdk/package-a/setup.py",
        `from setuptools import setup
setup(
    name="package-a",
    version="1.0.0",
)`,
      );
      host.addFile(
        "proj/sdk/package-b/setup.py",
        `from setuptools import setup
setup(name='package-b', version='2.5.0')`,
      );

      const workspace = await python.load("proj");
      expect(workspace.packages).toHaveLength(2);
      expect(workspace.packages[0]).toEqual({
        name: "package-a",
        version: "1.0.0",
        relativePath: "sdk/package-a",
        manifest: {},
      });
      expect(workspace.packages[1]).toEqual({
        name: "package-b",
        version: "2.5.0",
        relativePath: "sdk/package-b",
        manifest: {},
      });
    });

    it("finds nested packages in subdirectories", async () => {
      host.addFile("proj/setup.py", "");
      host.addFile(
        "proj/sdk/category1/package-a/pyproject.toml",
        stringify({
          project: {
            name: "package-a",
            version: "1.0.0",
          },
        }),
      );
      host.addFile(
        "proj/sdk/category2/package-b/setup.py",
        `setup(name="package-b", version="2.0.0")`,
      );

      const workspace = await python.load("proj");
      expect(workspace.packages).toHaveLength(2);
      expect(workspace.packages[0].name).toBe("package-a");
      expect(workspace.packages[0].relativePath).toBe("sdk/category1/package-a");
      expect(workspace.packages[1].name).toBe("package-b");
      expect(workspace.packages[1].relativePath).toBe("sdk/category2/package-b");
    });

    it("handles packages with missing version", async () => {
      host.addFile("proj/pyproject.toml", "");
      host.addFile(
        "proj/sdk/package-a/pyproject.toml",
        stringify({
          project: {
            name: "package-a",
          },
        }),
      );

      const workspace = await python.load("proj");
      expect(workspace.packages).toHaveLength(1);
      expect(workspace.packages[0].version).toBe("0.0.0");
    });

    it("handles malformed pyproject.toml gracefully", async () => {
      host.addFile("proj/pyproject.toml", "");
      host.addFile("proj/sdk/package-a/pyproject.toml", "invalid: yaml: content:");

      const workspace = await python.load("proj");
      expect(workspace.packages).toEqual([]);
    });

    it("handles setup.py without name", async () => {
      host.addFile("proj/setup.py", "");
      host.addFile("proj/sdk/package-a/setup.py", `from setuptools import setup\nsetup(version="1.0.0")`);

      const workspace = await python.load("proj");
      expect(workspace.packages).toEqual([]);
    });

    it("prefers pyproject.toml over setup.py when both exist", async () => {
      host.addFile("proj/setup.py", "");
      host.addFile(
        "proj/sdk/package-a/pyproject.toml",
        stringify({
          project: {
            name: "package-from-toml",
            version: "1.0.0",
          },
        }),
      );
      host.addFile("proj/sdk/package-a/setup.py", `setup(name="package-from-setup", version="2.0.0")`);

      const workspace = await python.load("proj");
      expect(workspace.packages).toHaveLength(1);
      expect(workspace.packages[0].name).toBe("package-from-toml");
    });
  });

  describe("workspace properties", () => {
    it("sets correct workspace type", async () => {
      host.addFile("proj/setup.py", "");
      const workspace = await python.load("proj");
      expect(workspace.type).toBe("python");
    });

    it("sets correct workspace path", async () => {
      host.addFile("proj/setup.py", "");
      const workspace = await python.load("proj");
      expect(workspace.path).toBe("proj");
    });
  });
});
