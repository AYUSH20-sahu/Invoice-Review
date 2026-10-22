import { Page, Field, LogEntry } from "./types";

export interface SavedSession {
  docName: string;
  pages: Page[];
  fields: Field[];
  log: LogEntry[];
  activePage: number;
  activeId: string | null;
  filter: "all" | "pending" | "approved" | "edited";
  zoomLevel: number;
  viewMode: "single" | "scroll";
  updatedAt: number;
}

const DB_NAME = "VerifeyeInvoiceDB";
const STORE_NAME = "sessions";
const SESSION_KEY = "current_session";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not supported in this environment"));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Saves the current document session to IndexedDB so it survives page reloads.
 */
export async function saveSession(session: SavedSession): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(session, SESSION_KEY);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("Failed to persist session to IndexedDB, attempting localStorage fallback", err);
    try {
      // Store minimal metadata in localStorage if IndexedDB fails
      const fallback = {
        docName: session.docName,
        activePage: session.activePage,
        activeId: session.activeId,
        filter: session.filter,
        zoomLevel: session.zoomLevel,
        viewMode: session.viewMode,
        updatedAt: session.updatedAt,
      };
      localStorage.setItem("verifeye_meta_session", JSON.stringify(fallback));
    } catch {
      // Ignore quota errors in localStorage
    }
  }
}

/**
 * Loads the saved session from IndexedDB if one exists.
 */
export async function loadSession(): Promise<SavedSession | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(SESSION_KEY);

      req.onsuccess = () => {
        const val = req.result as SavedSession | undefined;
        resolve(val || null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("Failed to read session from IndexedDB", err);
    return null;
  }
}

/**
 * Clears the saved session from IndexedDB (e.g. when resetting to sample invoice).
 */
export async function clearSession(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(SESSION_KEY);

      req.onsuccess = () => {
        try {
          localStorage.removeItem("verifeye_meta_session");
        } catch {
          // ignore
        }
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("Failed to clear session from IndexedDB", err);
  }
}
