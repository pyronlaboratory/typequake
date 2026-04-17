/// <reference lib="webworker" />

import { resolveImportSites } from "./import-resolver";

/**
 * Worker entry point for import resolution.
 * This allows us to run expensive TypeScript compiler operations in separate
 * threads, avoiding blocking the main event loop and speeding up analysis
 * of large multi-package workspaces.
 */
self.onmessage = async (event: MessageEvent) => {
  const { consumerPkgPath, changedPackageName, changedSymbols } = event.data;

  try {
    // Note: Since each worker is a separate thread, they each have their own
    // programCache. This is intended and ensures "no shared mutable state".
    const sites = await resolveImportSites(
      consumerPkgPath,
      changedPackageName,
      changedSymbols,
    );
    self.postMessage({ sites });
  } catch (error: any) {
    self.postMessage({ error: error.message || String(error) });
  }
};
