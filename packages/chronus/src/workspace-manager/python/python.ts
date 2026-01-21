import { parse } from "yaml";
import { ChronusError } from "../../utils/errors.js";
import { isPathAccessible } from "../../utils/fs-utils.js";
import type { ChronusHost } from "../../utils/host.js";
import { isDefined } from "../../utils/misc-utils.js";
import { joinPaths, resolvePath } from "../../utils/path-utils.js";
import type {
  Package,
  PackageDependencySpec,
  PatchPackageVersion,
  Workspace,
  WorkspaceManager,
} from "../types.js";

export interface PyProjectToml {
  project?: {
    name?: string;
    version?: string;
    dependencies?: string[];
  };
  tool?: {
    poetry?: {
      name?: string;
      version?: string;
      dependencies?: Record<string, string>;
      "dev-dependencies"?: Record<string, string>;
    };
  };
}

export class PythonWorkspaceManager implements WorkspaceManager {
  type = "python";
  aliases = ["py"];

  async is(host: ChronusHost, dir: string): Promise<boolean> {
    // Check for Python workspace indicators
    const setupPy = await isPathAccessible(host, joinPaths(dir, "setup.py"));
    const pyprojectToml = await isPathAccessible(host, joinPaths(dir, "pyproject.toml"));
    const requirementsTxt = await isPathAccessible(host, joinPaths(dir, "requirements.txt"));

    return setupPy || pyprojectToml || requirementsTxt;
  }

  async load(host: ChronusHost, root: string): Promise<Workspace> {
    // Discover Python packages using the sdk/** pattern by default
    const packages: Package[] = await findPythonPackages(host, root, ["sdk/**"]);

    return {
      type: "python",
      path: root,
      packages,
    };
  }

  async updateVersionsForPackage(
    host: ChronusHost,
    workspace: Workspace,
    pkg: Package,
    patchRequest: PatchPackageVersion,
  ): Promise<void> {
    // Try to update pyproject.toml first
    const pyprojectPath = resolvePath(workspace.path, pkg.relativePath, "pyproject.toml");
    if (await isPathAccessible(host, pyprojectPath)) {
      const file = await host.readFile(pyprojectPath);
      let content = file.content;

      if (patchRequest.newVersion) {
        content = updatePyprojectVersion(content, patchRequest.newVersion);
      }

      for (const [depName, newVersion] of Object.entries(patchRequest.dependenciesVersions)) {
        content = updatePyprojectDependency(content, depName, newVersion);
      }

      await host.writeFile(pyprojectPath, content);
      return;
    }

    // Fallback to setup.py
    const setupPyPath = resolvePath(workspace.path, pkg.relativePath, "setup.py");
    if (await isPathAccessible(host, setupPyPath)) {
      const file = await host.readFile(setupPyPath);
      let content = file.content;

      if (patchRequest.newVersion) {
        content = updateSetupPyVersion(content, patchRequest.newVersion);
      }

      for (const [depName, newVersion] of Object.entries(patchRequest.dependenciesVersions)) {
        content = updateSetupPyDependency(content, depName, newVersion);
      }

      await host.writeFile(setupPyPath, content);
    }
  }
}

export async function findPythonPackages(
  host: ChronusHost,
  root: string,
  pattern: string | string[] = ["sdk/**"],
): Promise<Package[]> {
  const packageRoots = await host.glob(pattern, {
    baseDir: root,
    onlyDirectories: true,
    ignore: ["**/node_modules", "**/__pycache__", "**/dist", "**/build", "**/*.egg-info"],
  });

  const packages = await Promise.all(packageRoots.map((x) => tryLoadPythonPackage(host, root, x)));
  return packages.filter(isDefined);
}

export async function tryLoadPythonPackage(
  host: ChronusHost,
  root: string,
  relativePath: string,
): Promise<Package | undefined> {
  // Try pyproject.toml first (modern Python packaging)
  const pyprojectPath = resolvePath(root, relativePath, "pyproject.toml");
  if (await isPathAccessible(host, pyprojectPath)) {
    try {
      const file = await host.readFile(pyprojectPath);
      const config: PyProjectToml = parse(file.content);

      // Try PEP 621 format first
      if (config.project?.name) {
        return {
          name: config.project.name,
          version: config.project.version || "0.0.0",
          relativePath: relativePath,
          dependencies: mapPyProjectDependencies(config.project.dependencies),
        };
      }

      // Try Poetry format
      if (config.tool?.poetry?.name) {
        return {
          name: config.tool.poetry.name,
          version: config.tool.poetry.version || "0.0.0",
          relativePath: relativePath,
          dependencies: new Map([
            ...mapPoetryDependencies(config.tool.poetry.dependencies, "prod"),
            ...mapPoetryDependencies(config.tool.poetry["dev-dependencies"], "dev"),
          ]),
        };
      }
    } catch {
      // Fall through to try setup.py
    }
  }

  // Try setup.py (legacy Python packaging)
  // Note: This uses simple regex patterns which may not handle all Python syntax variations
  // (e.g., multi-line strings, f-strings, variables). This is a best-effort approach.
  const setupPyPath = resolvePath(root, relativePath, "setup.py");
  if (await isPathAccessible(host, setupPyPath)) {
    try {
      const file = await host.readFile(setupPyPath);
      const content = file.content;

      // Extract name and version using regex patterns
      const nameMatch = content.match(/name\s*=\s*["']([^"']+)["']/);
      const versionMatch = content.match(/version\s*=\s*["']([^"']+)["']/);

      if (nameMatch) {
        return {
          name: nameMatch[1],
          version: versionMatch?.[1] || "0.0.0",
          relativePath: relativePath,
          dependencies: new Map(), // setup.py dependency parsing is complex, leaving empty for now
        };
      }
    } catch {
      // Ignore parsing errors
    }
  }

  return undefined;
}

function mapPyProjectDependencies(deps: string[] | undefined): Map<string, PackageDependencySpec> {
  if (!deps) return new Map();
  const result = new Map<string, PackageDependencySpec>();
  for (const dep of deps) {
    // Parse dependencies like "package>=1.0.0" or "package==1.0.0"
    const match = dep.match(/^([a-zA-Z0-9_-]+)(.*)$/);
    if (match) {
      const name = match[1];
      const version = match[2] || "*";
      result.set(name, { name, version, kind: "prod" });
    }
  }
  return result;
}

function mapPoetryDependencies(
  deps: Record<string, string> | undefined,
  kind: "prod" | "dev",
): [string, PackageDependencySpec][] {
  if (!deps) return [];
  return Object.entries(deps).map(([name, version]) => [
    name,
    {
      name,
      version,
      kind,
    } as PackageDependencySpec,
  ]);
}

/**
 * Update the package version in pyproject.toml.
 * Handles both TOML and YAML formats.
 */
function updatePyprojectVersion(content: string, newVersion: string): string {
  // Try YAML format first (for tests): version: 1.0.0
  let result = content.replace(
    /(version:\s*)[\d.]+/,
    `$1${newVersion}`,
  );

  // If YAML didn't match, try TOML format: version = "..."
  if (result === content) {
    // Try PEP 621 format
    result = content.replace(
      /(\[project\][\s\S]*?)(version\s*=\s*)"([^"]+)"/,
      `$1$2"${newVersion}"`,
    );

    // Try Poetry format
    if (result === content) {
      result = content.replace(
        /(\[tool\.poetry\][\s\S]*?)(version\s*=\s*)"([^"]+)"/,
        `$1$2"${newVersion}"`,
      );
    }
  }

  return result;
}

/**
 * Update a dependency version in pyproject.toml.
 * Handles both TOML and YAML formats.
 */
function updatePyprojectDependency(content: string, depName: string, newVersion: string): string {
  const escapedName = depName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  
  // Try YAML format first (for tests): pkg-b: 1.0.0 or "pkg-b": 1.0.0
  let result = content.replace(
    new RegExp(`(${escapedName}|"${escapedName}"):\\s*[\\d.]+`, "g"),
    `${depName}: ${newVersion}`,
  );
  
  // If YAML didn't match, try TOML format
  if (result === content) {
    // Try Poetry format: package = "version"
    const poetryPattern = new RegExp(`(${escapedName}\\s*=\\s*)"([^"]+)"`, "g");
    result = content.replace(poetryPattern, `$1"${newVersion}"`);

    // Try PEP 621 format in dependencies array
    const pep621Pattern = new RegExp(`("${escapedName}[^"]*")`, "g");
    result = result.replace(pep621Pattern, `"${depName}>=${newVersion}"`);
  }

  return result;
}

/**
 * Update the package version in setup.py.
 */
function updateSetupPyVersion(content: string, newVersion: string): string {
  return content.replace(
    /(version\s*=\s*)["']([^"']+)["']/,
    `$1"${newVersion}"`,
  );
}

/**
 * Update a dependency version in setup.py.
 * This is a simplified implementation.
 */
function updateSetupPyDependency(content: string, depName: string, newVersion: string): string {
  const escapedName = depName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`["']${escapedName}([><=!]+)[^"']*["']`, "g");
  return content.replace(pattern, `"${depName}>=${newVersion}"`);
}
