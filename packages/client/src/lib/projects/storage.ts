/**
 * The device's memory of the last chosen Project. Storage is an injected adapter so a store test
 * exercises the remembering rule without a browser storage, and a browser whose storage is disabled
 * degrades to "nothing remembered" instead of failing to start.
 */

export const PROJECT_STORAGE_KEY = "pi-my-ui.project";

export interface ProjectStorage {
  /** The remembered Project path, or `null` when this device remembers none. */
  read(): string | null;
  /** Remember the chosen Project, or forget it when `null`. */
  write(project: string | null): void;
}

const NO_STORAGE: ProjectStorage = {
  read: () => null,
  write: () => undefined,
};

/** A storage that remembers nothing, for a store with no device behind it. */
export function createNoopProjectStorage(): ProjectStorage {
  return NO_STORAGE;
}

/** The browser's `localStorage`, which is per origin and survives a reload. */
export function createDeviceProjectStorage(): ProjectStorage {
  return {
    read() {
      try {
        const value = window.localStorage.getItem(PROJECT_STORAGE_KEY);
        return value === null || value === "" ? null : value;
      } catch {
        return null;
      }
    },
    write(project) {
      try {
        if (project === null) {
          window.localStorage.removeItem(PROJECT_STORAGE_KEY);
        } else {
          window.localStorage.setItem(PROJECT_STORAGE_KEY, project);
        }
      } catch {
        // A private-mode refusal is not a reason to stop the app; the choice simply is not remembered.
      }
    },
  };
}
