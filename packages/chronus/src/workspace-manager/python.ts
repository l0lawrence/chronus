import { isPathAccessible, joinPaths, type ChronusHost } from "../utils/index.js";
import type { Package, Workspace, WorkspaceManager } from "./types.js";
import { findPythonPackages } from "./utils.js";

export function createPythonWorkspaceManager(host: ChronusHost): WorkspaceManager {
  return {
    type: "python",
    async is(dir: string): Promise<boolean> {
      // Check for Python workspace indicators
      const setupPy = await isPathAccessible(host, joinPaths(dir, "setup.py"));
      const pyprojectToml = await isPathAccessible(host, joinPaths(dir, "pyproject.toml"));
      const requirementsTxt = await isPathAccessible(host, joinPaths(dir, "requirements.txt"));
      
      return setupPy || pyprojectToml || requirementsTxt;
    },
    async load(root: string): Promise<Workspace> {
      // Discover Python packages using the sdk/** pattern by default
      const packages: Package[] = await findPythonPackages(host, root);
      
      return {
        type: "python",
        path: root,
        packages,
      };
    },
  };
}
