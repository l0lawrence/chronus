import { isPathAccessible } from "../utils/fs-utils.js";
import type { ChronusHost } from "../utils/host.js";
import { isDefined, resolvePath } from "../utils/index.js";
import type { Package, PackageDependencySpec } from "./types.js";

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
    
    // Map dependencies to the new format
    const dependencies = new Map<string, PackageDependencySpec>();
    
    if (pkgJson.dependencies) {
      for (const [name, version] of Object.entries(pkgJson.dependencies)) {
        dependencies.set(name, { name, version: version as string, kind: "prod" });
      }
    }
    
    if (pkgJson.devDependencies) {
      for (const [name, version] of Object.entries(pkgJson.devDependencies)) {
        dependencies.set(name, { name, version: version as string, kind: "dev" });
      }
    }
    
    return {
      name: pkgJson.name,
      version: pkgJson.version,
      relativePath: relativePath,
      dependencies,
      manifest: pkgJson, // Keep for backward compatibility
    };
  } else {
    return undefined;
  }
}
