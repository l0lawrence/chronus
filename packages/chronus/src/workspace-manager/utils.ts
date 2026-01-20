import { parse } from "yaml";
import { isPathAccessible } from "../utils/fs-utils.js";
import type { ChronusHost } from "../utils/host.js";
import { isDefined, resolvePath } from "../utils/index.js";
import type { Package } from "./types.js";

export async function findPackagesFromPattern(
  host: ChronusHost,
  root: string,
  pattern: string | string[],
): Promise<Package[]> {
  const packageRoots = await host.glob(pattern, {
    baseDir: root,
    onlyDirectories: true,
    ignore: ["**/node_modules"],
  });

  const packages = await Promise.all(packageRoots.map((x) => tryLoadNodePackage(host, root, x)));
  return packages.filter(isDefined);
}

export async function tryLoadNodePackage(
  host: ChronusHost,
  root: string,
  relativePath: string,
): Promise<Package | undefined> {
  const pkgJsonPath = resolvePath(root, relativePath, "package.json");
  if (await isPathAccessible(host, pkgJsonPath)) {
    const file = await host.readFile(pkgJsonPath);
    const pkgJson = JSON.parse(file.content);
    return {
      name: pkgJson.name,
      version: pkgJson.version,
      relativePath: relativePath,
      manifest: pkgJson,
    };
  } else {
    return undefined;
  }
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
      interface PyProjectConfig {
        project?: {
          name?: string;
          version?: string;
        };
        tool?: {
          poetry?: {
            name?: string;
            version?: string;
          };
        };
      }
      const config: PyProjectConfig = parse(file.content);
      
      // Try PEP 621 format first
      if (config.project?.name) {
        return {
          name: config.project.name,
          version: config.project.version || "0.0.0",
          relativePath: relativePath,
          manifest: {} as any, // Python packages don't use package.json structure
        };
      }
      
      // Try Poetry format
      if (config.tool?.poetry?.name) {
        return {
          name: config.tool.poetry.name,
          version: config.tool.poetry.version || "0.0.0",
          relativePath: relativePath,
          manifest: {} as any,
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
          manifest: {} as any,
        };
      }
    } catch {
      // Ignore parsing errors
    }
  }

  return undefined;
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
