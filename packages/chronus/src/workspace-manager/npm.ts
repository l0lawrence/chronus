import { parse } from "yaml";
import { ChronusError, joinPaths, type ChronusHost } from "../utils/index.js";
import type { Package, PackageJson, PatchPackageVersion, Workspace, WorkspaceManager } from "./types.js";
import { findPackagesFromPattern } from "./utils.js";

const workspaceFileName = "package.json";

export function createNpmWorkspaceManager(): WorkspaceManager {
  return {
    type: "npm",
    async is(host: ChronusHost, dir: string): Promise<boolean> {
      try {
        const workspaceFilePath = joinPaths(dir, workspaceFileName);
        const file = await host.readFile(workspaceFilePath);
        const pkgJson: PackageJson = parse(file.content) as any;
        return pkgJson.workspaces !== undefined && Array.isArray(pkgJson.workspaces);
      } catch {
        return false;
      }
    },
    async load(host: ChronusHost, root: string): Promise<Workspace> {
      const workspaceFilePath = joinPaths(root, workspaceFileName);

      const file = await host.readFile(workspaceFilePath);
      const pkgJson: PackageJson = parse(file.content) as any;

      if (pkgJson.workspaces === undefined) {
        throw new ChronusError(`workspaces entry missing in ${workspaceFileName}`);
      }
      if (Array.isArray(pkgJson.workspaces) === false) {
        throw new ChronusError(`workspaces is not an array in ${workspaceFileName}`);
      }
      const packages: Package[] = (
        await Promise.all(pkgJson.workspaces.map((pattern) => findPackagesFromPattern(host, root, pattern)))
      ).flat();
      return {
        type: "npm",
        path: root,
        packages,
      };
    },
    async updateVersionsForPackage(
      host: ChronusHost,
      workspace: Workspace,
      pkg: Package,
      patchRequest: PatchPackageVersion,
    ): Promise<void> {
      // TODO: Implement version update for npm packages
      throw new ChronusError("updateVersionsForPackage not yet implemented for npm");
    },
  };
}
