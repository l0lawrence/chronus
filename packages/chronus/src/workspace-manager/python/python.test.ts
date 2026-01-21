import { beforeEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { createTestHost, type TestHost } from "../../testing/test-host.js";
import type { WorkspaceManager } from "../types.js";
import { PythonWorkspaceManager } from "./python.js";

let host: TestHost;
let ws: WorkspaceManager;

beforeEach(async () => {
  host = createTestHost({
    "proj/setup.py": "from setuptools import setup\nsetup(name='root')",
  });

  ws = new PythonWorkspaceManager();
});

function createPyProjectToml({ name, version }: { name: string; version: string }): string {
  return stringify({
    project: {
      name,
      version,
    },
  });
}

function createSetupPy({ name, version }: { name: string; version: string }): string {
  return `from setuptools import setup
setup(
    name="${name}",
    version="${version}",
)`;
}

it("detects workspace with setup.py", async () => {
  expect(await ws.is(host.host, "proj")).toBe(true);
});

it("detects workspace with pyproject.toml", async () => {
  host.addFile("proj2/pyproject.toml", stringify({ project: { name: "test" } }));
  expect(await ws.is(host.host, "proj2")).toBe(true);
});

it("detects workspace with requirements.txt", async () => {
  host.addFile("proj3/requirements.txt", "requests==2.28.0");
  expect(await ws.is(host.host, "proj3")).toBe(true);
});

it("does not detect non-Python workspace", async () => {
  host.addFile("proj4/package.json", JSON.stringify({ name: "test" }));
  expect(await ws.is(host.host, "proj4")).toBe(false);
});

it("finds 0 packages when workspace has none", async () => {
  const workspace = await ws.load(host.host, "proj");
  expect(workspace.packages).toEqual([]);
});

it("finds all packages with pyproject.toml (PEP 621 format)", async () => {
  host.addFile("proj/sdk/package-a/pyproject.toml", createPyProjectToml({ name: "package-a", version: "1.0.0" }));
  host.addFile("proj/sdk/package-b/pyproject.toml", createPyProjectToml({ name: "package-b", version: "1.2.0" }));

  const workspace = await ws.load(host.host, "proj");
  expect(workspace.packages).toHaveLength(2);
  expect(workspace.packages[0]).toMatchObject({
    name: "package-a",
    version: "1.0.0",
    relativePath: "sdk/package-a",
  });
  expect(workspace.packages[1]).toMatchObject({
    name: "package-b",
    version: "1.2.0",
    relativePath: "sdk/package-b",
  });
});

it("finds packages with setup.py", async () => {
  host.addFile("proj/sdk/package-a/setup.py", createSetupPy({ name: "package-a", version: "1.0.0" }));
  host.addFile("proj/sdk/package-b/setup.py", createSetupPy({ name: "package-b", version: "2.5.0" }));

  const workspace = await ws.load(host.host, "proj");
  expect(workspace.packages).toHaveLength(2);
  expect(workspace.packages[0]).toMatchObject({
    name: "package-a",
    version: "1.0.0",
    relativePath: "sdk/package-a",
  });
  expect(workspace.packages[1]).toMatchObject({
    name: "package-b",
    version: "2.5.0",
    relativePath: "sdk/package-b",
  });
});

it("finds nested packages in subdirectories", async () => {
  host.addFile(
    "proj/sdk/category1/package-a/pyproject.toml",
    createPyProjectToml({ name: "package-a", version: "1.0.0" }),
  );
  host.addFile("proj/sdk/category2/package-b/setup.py", createSetupPy({ name: "package-b", version: "2.0.0" }));

  const workspace = await ws.load(host.host, "proj");
  expect(workspace.packages).toHaveLength(2);
  expect(workspace.packages[0].name).toBe("package-a");
  expect(workspace.packages[0].relativePath).toBe("sdk/category1/package-a");
  expect(workspace.packages[1].name).toBe("package-b");
  expect(workspace.packages[1].relativePath).toBe("sdk/category2/package-b");
});

it("prefers pyproject.toml over setup.py when both exist", async () => {
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

  const workspace = await ws.load(host.host, "proj");
  expect(workspace.packages).toHaveLength(1);
  expect(workspace.packages[0].name).toBe("package-from-toml");
});

describe("updateVersionsForPackage", () => {
  it("updates the package version in pyproject.toml", async () => {
    host.addFile("proj/sdk/pkg-a/pyproject.toml", createPyProjectToml({ name: "pkg-a", version: "1.0.0" }));
    const workspace = await ws.load(host.host, "proj");
    const pkg = workspace.packages[0];

    await ws.updateVersionsForPackage(host.host, workspace, pkg, {
      newVersion: "2.0.0",
      dependenciesVersions: {},
    });

    const updatedFile = await host.host.readFile("proj/sdk/pkg-a/pyproject.toml");
    expect(updatedFile.content).toContain('version: 2.0.0');
  });

  it("updates the package version in setup.py", async () => {
    host.addFile("proj/sdk/pkg-a/setup.py", createSetupPy({ name: "pkg-a", version: "1.0.0" }));
    const workspace = await ws.load(host.host, "proj");
    const pkg = workspace.packages[0];

    await ws.updateVersionsForPackage(host.host, workspace, pkg, {
      newVersion: "2.0.0",
      dependenciesVersions: {},
    });

    const updatedFile = await host.host.readFile("proj/sdk/pkg-a/setup.py");
    expect(updatedFile.content).toContain('version="2.0.0"');
  });

  it("updates Poetry-style dependencies in pyproject.toml", async () => {
    host.addFile(
      "proj/sdk/pkg-a/pyproject.toml",
      stringify({
        tool: {
          poetry: {
            name: "pkg-a",
            version: "1.0.0",
            dependencies: {
              "pkg-b": "1.0.0",
            },
          },
        },
      }),
    );
    const workspace = await ws.load(host.host, "proj");
    const pkg = workspace.packages[0];

    await ws.updateVersionsForPackage(host.host, workspace, pkg, {
      dependenciesVersions: { "pkg-b": "2.0.0" },
    });

    const updatedFile = await host.host.readFile("proj/sdk/pkg-a/pyproject.toml");
    expect(updatedFile.content).toContain('pkg-b: 2.0.0');
  });

  it("updates version and dependencies together", async () => {
    host.addFile(
      "proj/sdk/pkg-a/pyproject.toml",
      stringify({
        tool: {
          poetry: {
            name: "pkg-a",
            version: "1.0.0",
            dependencies: {
              "pkg-b": "1.0.0",
            },
          },
        },
      }),
    );
    const workspace = await ws.load(host.host, "proj");
    const pkg = workspace.packages[0];

    await ws.updateVersionsForPackage(host.host, workspace, pkg, {
      newVersion: "2.0.0",
      dependenciesVersions: { "pkg-b": "1.5.0" },
    });

    const updatedFile = await host.host.readFile("proj/sdk/pkg-a/pyproject.toml");
    expect(updatedFile.content).toContain('version: 2.0.0');
    expect(updatedFile.content).toContain('pkg-b: 1.5.0');
  });
});
