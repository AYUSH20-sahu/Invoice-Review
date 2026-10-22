import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import DocViewer from "./DocViewer";
import { loadDocument, generateSampleInvoice } from "./loadDoc";
import {
  saveSession,
  loadSession,
  clearSession,
} from "./storage";
import {
  RawBBox,
  Field,
  LogEntry,
  Page,
  PAGE_W,
  normalizeBBox,
  sortFieldsByInvoiceOrder,
} from "./types";

const uid = () => Math.random().toString(36).slice(2, 9);
const now = () => new Date().toISOString();
const formatTimestamp = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

// Friendly section labels matching how they appear in the invoice
const SECTION_TITLES: Record<string, string> = {
  header: "Page 1 • Header & References",
  parties: "Page 1 • Vendor & Customer Info",
  line_items: "Page 1 • Line Items Table",
  totals: "Page 1 • Summary & Totals",
  remittance: "Page 2 • Bank Remittance & Signer",
  custom: "Custom Added Fields",
};

export default function App() {
  const [pages, setPages] = useState<Page[]>([]);
  const [docName, setDocName] = useState<string>("");
  const [fields, setFields] = useState<Field[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<number>(1);
  const [viewMode, setViewMode] = useState<"single" | "scroll">("single");
  const [sessionHydrated, setSessionHydrated] = useState<boolean>(false);

  // Undo / Redo stacks
  const [undoStack, setUndoStack] = useState<{ fields: Field[]; log: LogEntry[] }[]>([]);
  const [redoStack, setRedoStack] = useState<{ fields: Field[]; log: LogEntry[] }[]>([]);

  // Editing state: allows editing value AND field name
  const [editing, setEditing] = useState<{
    id: string;
    fieldName: string;
    value: string;
  } | null>(null);

  // Manual box addition state (via drag or "+ Add Field" button)
  const [manualField, setManualField] = useState<{
    page: number;
    bbox: RawBBox;
    name: string;
    value: string;
  } | null>(null);

  const [error, setError] = useState<string>("");
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "edited">("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [groupBySection, setGroupBySection] = useState<boolean>(true);
  const [showDevCoords, setShowDevCoords] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return (localStorage.getItem("theme") as "dark" | "light") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  });
  const [showShortcutsModal, setShowShortcutsModal] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"fields" | "log">("fields");

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((cur) => (cur === msg ? null : cur));
    }, 3200);
  };

  // Keep refs for keyboard shortcuts
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const activePageRef = useRef(activePage);
  activePageRef.current = activePage;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  // Apply theme to root html element
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Push navigation state to browser history
  const pushNavHistory = useCallback((newPage: number, newActiveId: string | null) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("page", String(newPage));
      if (newActiveId) {
        url.searchParams.set("field", newActiveId);
      } else {
        url.searchParams.delete("field");
      }
      window.history.pushState(
        { page: newPage, activeId: newActiveId, docName },
        "",
        url.toString()
      );
    } catch {
      // Sandbox fallback
    }
  }, [docName]);

  // Load session from storage on mount (or sample invoice if no saved session)
  useEffect(() => {
    async function initSession() {
      try {
        const saved = await loadSession();
        const urlParams = new URLSearchParams(window.location.search);
        const urlPage = parseInt(urlParams.get("page") || "", 10);
        const urlField = urlParams.get("field");

        if (saved && saved.pages && saved.pages.length > 0) {
          setPages(saved.pages);
          setDocName(saved.docName);
          setFields(saved.fields);
          setLog(saved.log || []);
          setFilter(saved.filter || "all");
          setZoomLevel(saved.zoomLevel || 1);
          setViewMode(saved.viewMode || "single");

          const validPage = !isNaN(urlPage) && urlPage >= 1 && urlPage <= saved.pages.length
            ? urlPage
            : (saved.activePage && saved.activePage <= saved.pages.length ? saved.activePage : 1);
          setActivePage(validPage);

          const validId = urlField && saved.fields.some((f) => f.id === urlField)
            ? urlField
            : (saved.activeId || saved.fields[0]?.id || null);
          setActiveId(validId);
        } else {
          // No saved session found: fallback to default sample invoice
          const { pages: samplePages, fields: sampleFields } = generateSampleInvoice();
          setPages(samplePages);
          setDocName("Apex_Cloud_INV-2041.pdf");
          setFields(sampleFields);
          setLog([]);
          const initPage = !isNaN(urlPage) && urlPage >= 1 && urlPage <= samplePages.length ? urlPage : 1;
          setActivePage(initPage);
          setActiveId(sampleFields[0]?.id || null);
        }
      } catch (err) {
        console.warn("Failed to load initial session, loading sample invoice", err);
        const { pages: samplePages, fields: sampleFields } = generateSampleInvoice();
        setPages(samplePages);
        setDocName("Apex_Cloud_INV-2041.pdf");
        setFields(sampleFields);
        setActivePage(1);
        setActiveId(sampleFields[0]?.id || null);
      } finally {
        setSessionHydrated(true);
      }
    }

    initSession();
  }, []);

  // Browser Back / Forward buttons listener (popstate event)
  useEffect(() => {
    function handlePopState(e: PopStateEvent) {
      const maxP = pagesRef.current.length || 1;
      if (e.state && typeof e.state.page === "number") {
        setActivePage(Math.max(1, Math.min(e.state.page, maxP)));
        if (e.state.activeId !== undefined) {
          setActiveId(e.state.activeId);
        }
      } else {
        const urlParams = new URLSearchParams(window.location.search);
        const p = parseInt(urlParams.get("page") || "1", 10);
        if (!isNaN(p) && p >= 1) {
          setActivePage(Math.max(1, Math.min(p, maxP)));
        }
        const f = urlParams.get("field");
        if (f) setActiveId(f);
      }
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Auto-save session to IndexedDB whenever document, fields, or activePage change
  // This satisfies: "when user reload it go back to sample invoice make it to stay on the that page"
  useEffect(() => {
    if (!sessionHydrated || pages.length === 0) return;

    const timer = setTimeout(() => {
      saveSession({
        docName,
        pages,
        fields,
        log,
        activePage,
        activeId,
        filter,
        zoomLevel,
        viewMode,
        updatedAt: Date.now(),
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [
    sessionHydrated,
    docName,
    pages,
    fields,
    log,
    activePage,
    activeId,
    filter,
    zoomLevel,
    viewMode,
  ]);

  // Record undo state before modifying fields
  const pushUndo = useCallback(() => {
    setUndoStack((prev) => [...prev.slice(-30), { fields, log }]);
    setRedoStack([]);
  }, [fields, log]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setRedoStack((prev) => [...prev, { fields, log }]);
    setUndoStack((prev) => prev.slice(0, -1));
    setFields(last.fields);
    setLog(last.log);
  }, [undoStack, fields, log]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((prev) => [...prev, { fields, log }]);
    setRedoStack((prev) => prev.slice(0, -1));
    setFields(next.fields);
    setLog(next.log);
  }, [redoStack, fields, log]);

  const addLog = (
    kind: LogEntry["kind"],
    field: string,
    oldValue: string,
    newValue: string
  ) => {
    setLog((prev) => [
      { id: uid(), kind, field, oldValue, newValue, at: now() },
      ...prev,
    ]);
  };

  const patchField = (id: string, patch: Partial<Field>) => {
    pushUndo();
    setFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...patch } : f))
    );
  };

  const handleLoadSample = (clearSaved = true) => {
    try {
      setError("");
      if (clearSaved) {
        clearSession();
      }
      const { pages: samplePages, fields: sampleFields } = generateSampleInvoice();
      setPages(samplePages);
      setDocName("Apex_Cloud_INV-2041.pdf");
      setFields(sampleFields);
      setLog([]);
      setActivePage(1);
      setActiveId(sampleFields[0]?.id || null);
      setManualField(null);
      setEditing(null);
      setUndoStack([]);
      setRedoStack([]);
      pushNavHistory(1, sampleFields[0]?.id || null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load sample invoice.");
    }
  };

  async function handleFileUpload(file?: File) {
    if (!file) return;
    try {
      setError("");
      // Scan the document pages and dynamically extract real fields and real bboxes
      const { pages: loadedPages, fields: extractedFields } = await loadDocument(file);
      setPages(loadedPages);
      setDocName(file.name);
      setFields(extractedFields);
      setLog([]);
      setFilter("all");
      setSearchQuery("");
      setActivePage(1);
      setActiveId(extractedFields[0]?.id || null);
      setManualField(null);
      setEditing(null);
      setUndoStack([]);
      setRedoStack([]);
      pushNavHistory(1, extractedFields[0]?.id || null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not read that file. Please upload a PDF, PNG or JPG.");
    }
  }

  // Page switching helper
  const handleSelectPage = (pageNum: number) => {
    if (pageNum < 1 || pageNum > pages.length) return;
    setActivePage(pageNum);
    pushNavHistory(pageNum, activeId);
  };

  // Field selection helper
  const handleSelectField = (fieldId: string) => {
    setActiveId(fieldId);
    const target = fields.find((f) => f.id === fieldId);
    if (target && target.page !== activePage) {
      setActivePage(target.page);
      pushNavHistory(target.page, fieldId);
    } else {
      pushNavHistory(activePage, fieldId);
    }
  };

  // Previous & Next Field Navigation
  const handlePrevField = () => {
    const list = filteredFields;
    if (list.length === 0) return;
    const idx = list.findIndex((f) => f.id === activeId);
    const prevIdx = idx > 0 ? idx - 1 : list.length - 1;
    handleSelectField(list[prevIdx].id);
  };

  const handleNextField = () => {
    const list = filteredFields;
    if (list.length === 0) return;
    const idx = list.findIndex((f) => f.id === activeId);
    const nextIdx = idx < list.length - 1 ? idx + 1 : 0;
    handleSelectField(list[nextIdx].id);
  };

  function handleSaveEdit(field: Field) {
    if (!editing) return;
    pushUndo();
    const trimmedVal = editing.value.trim();
    const trimmedName = editing.fieldName.trim().toLowerCase().replace(/\s+/g, "_");

    // Track field rename if modified
    if (trimmedName && trimmedName !== field.field) {
      addLog("rename", field.field, field.field, trimmedName);
      patchField(field.id, { field: trimmedName, label: editing.fieldName.trim() });
    }

    // Track value change if modified
    if (trimmedVal !== field.value) {
      addLog("edit", trimmedName || field.field, field.value, trimmedVal);
      patchField(field.id, { value: trimmedVal, status: "edited" });
    }

    setEditing(null);
  }

  function handleApprove(field: Field) {
    if (field.status === "approved") return;
    pushUndo();
    addLog("approve", field.field, field.value, field.value);
    patchField(field.id, { status: "approved" });
  }

  function handleDeleteField(field: Field) {
    pushUndo();
    addLog("delete", field.field, field.value, "");
    setFields((prev) => prev.filter((f) => f.id !== field.id));
    if (activeId === field.id) {
      const remaining = fields.filter((f) => f.id !== field.id);
      setActiveId(remaining[0]?.id || null);
    }
  }

  function handleApproveAll() {
    const pendingList = fields.filter((f) => f.status === "pending" || f.status === "edited");
    if (pendingList.length === 0) return;

    pushUndo();
    setFields((prev) =>
      prev.map((f) => (f.status !== "approved" ? { ...f, status: "approved" } : f))
    );
    pendingList.forEach((f) => {
      addLog("batch_approve", f.field, f.value, f.value);
    });
  }

  function handleAddManualField() {
    if (!manualField || !manualField.name.trim()) return;
    pushUndo();
    const pageIndex = Math.min(manualField.page, pages.length) - 1;
    const pageH = pages[pageIndex]?.height || 792;
    const cleanFieldName = manualField.name.trim().toLowerCase().replace(/\s+/g, "_");

    const newField: Field = {
      id: uid(),
      field: cleanFieldName,
      label: manualField.name.trim(),
      value: manualField.value.trim(),
      page: manualField.page,
      bbox: manualField.bbox,
      normalizedBbox: normalizeBBox(manualField.bbox, pageH),
      status: "pending",
      confidence: 1.0,
      section: "custom",
    };

    const updated = sortFieldsByInvoiceOrder([...fields, newField]);
    setFields(updated);
    addLog("add", newField.field, "", newField.value);
    handleSelectField(newField.id);
    setManualField(null);
  }

  function handleExportJson() {
    const exportData = {
      document: docName,
      reviewedAt: new Date().toISOString(),
      stats: {
        totalFields: fields.length,
        approved: fields.filter((f) => f.status === "approved").length,
        edited: fields.filter((f) => f.status === "edited").length,
        pending: fields.filter((f) => f.status === "pending").length,
      },
      fields: fields.map((f) => ({
        field: f.field,
        label: f.label || f.field,
        value: f.value,
        status: f.status,
        page: f.page,
        bbox: f.bbox,
        confidence: f.confidence,
        section: f.section,
      })),
      changeLog: log,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${docName.replace(/\.[^/.]+$/, "")}_reviewed.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Keyboard navigation & shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");

      // Undo / Redo shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z)
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        if (!isInput) {
          e.preventDefault();
          if (e.shiftKey) {
            handleRedo();
          } else {
            handleUndo();
          }
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) {
        if (!isInput) {
          e.preventDefault();
          handleRedo();
          return;
        }
      }

      if (isInput) {
        if (e.key === "Escape") {
          setEditing(null);
          setManualField(null);
          (target as HTMLInputElement).blur();
        }
        return;
      }

      // Page Navigation shortcuts: [ / ] or PageUp / PageDown or Alt+ArrowUp / Alt+ArrowDown
      if (e.key === "[" || e.key === "PageUp" || (e.altKey && e.key === "ArrowUp")) {
        e.preventDefault();
        if (activePageRef.current > 1) {
          handleSelectPage(activePageRef.current - 1);
        }
        return;
      }

      if (e.key === "]" || e.key === "PageDown" || (e.altKey && e.key === "ArrowDown")) {
        e.preventDefault();
        if (activePageRef.current < pagesRef.current.length) {
          handleSelectPage(activePageRef.current + 1);
        }
        return;
      }

      if (e.key === "?") {
        e.preventDefault();
        setShowShortcutsModal((prev) => !prev);
        return;
      }

      if (e.key === "Escape") {
        setShowShortcutsModal(false);
        setManualField(null);
        return;
      }

      if (e.key === "d" || e.key === "D" || e.key === "x" || e.key === "X") {
        e.preventDefault();
        setShowDevCoords((prev) => {
          const next = !prev;
          showToast(next ? "📐 Coordinate Inspector ON — Box coordinates and crosshairs enabled" : "Coordinate Inspector turned OFF");
          return next;
        });
        return;
      }

      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        setTheme((prev) => (prev === "dark" ? "light" : "dark"));
        return;
      }

      // Navigate fields in natural invoice order
      if (e.key === "j" || e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        handleNextField();
        return;
      }

      if (e.key === "k" || e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrevField();
        return;
      }

      if (e.key === "a" || e.key === "A") {
        const current = fieldsRef.current;
        const active = current.find((f) => f.id === activeIdRef.current);
        if (active) {
          e.preventDefault();
          handleApprove(active);
        }
        return;
      }

      if (e.key === "e" || e.key === "E") {
        const current = fieldsRef.current;
        const active = current.find((f) => f.id === activeIdRef.current);
        if (active) {
          e.preventDefault();
          setEditing({ id: active.id, fieldName: active.field, value: active.value });
        }
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo, handlePrevField, handleNextField]);

  // Filtered & sorted fields
  const filteredFields = useMemo(() => {
    const list = fields.filter((f) => {
      const matchesFilter = filter === "all" || f.status === filter;
      const matchesSearch =
        !searchQuery.trim() ||
        f.field.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.value.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (f.label && f.label.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesFilter && matchesSearch;
    });

    return sortFieldsByInvoiceOrder(list);
  }, [fields, filter, searchQuery]);

  // Group fields by visual invoice section
  const groupedSections = useMemo(() => {
    if (!groupBySection) {
      return [{ key: "all", title: "As Appears on Document", fields: filteredFields }];
    }

    const sectionsMap = new Map<string, Field[]>();
    filteredFields.forEach((f) => {
      const secKey = f.section || "custom";
      if (!sectionsMap.has(secKey)) {
        sectionsMap.set(secKey, []);
      }
      sectionsMap.get(secKey)!.push(f);
    });

    const result: { key: string; title: string; fields: Field[] }[] = [];
    const orderedKeys = ["header", "parties", "line_items", "totals", "remittance", "custom"];
    orderedKeys.forEach((key) => {
      if (sectionsMap.has(key)) {
        result.push({
          key,
          title: SECTION_TITLES[key] || "Other Fields",
          fields: sectionsMap.get(key)!,
        });
      }
    });

    return result;
  }, [filteredFields, groupBySection]);

  // Statistics
  const stats = useMemo(() => {
    const total = fields.length;
    const approved = fields.filter((f) => f.status === "approved").length;
    const edited = fields.filter((f) => f.status === "edited").length;
    const pending = fields.filter((f) => f.status === "pending").length;
    const percent = total > 0 ? Math.round(((approved + edited) / total) * 100) : 0;
    return { total, approved, edited, pending, percent };
  }, [fields]);

  return (
    <div className="invoice-app-shell">
      {/* Header Bar */}
      <header className="app-header">
        <div className="header-left">
          <div className="brand-logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            <span className="brand-title">VERIFEYE</span>
            <span className="brand-badge">INVOICE REVIEW</span>
          </div>

          {/* Browser History Back / Forward Navigation Controls */}
          <div className="history-nav-controls" role="group" aria-label="History Navigation">
            <button
              className="btn-history-nav"
              onClick={() => window.history.back()}
              title="Go Back (Alt + Left Arrow)"
              aria-label="Browser Back"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
              <span>Back</span>
            </button>
            <button
              className="btn-history-nav"
              onClick={() => window.history.forward()}
              title="Go Forward (Alt + Right Arrow)"
              aria-label="Browser Forward"
            >
              <span>Forward</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>

          {pages.length > 0 && (
            <div className="doc-meta-chip" title={docName}>
              <span className="doc-dot"></span>
              <span className="doc-name-text">{docName}</span>
              <span className="doc-pages-badge">
                Page {activePage} of {pages.length}
              </span>
            </div>
          )}
        </div>

        {/* Center Progress Metrics */}
        {pages.length > 0 && (
          <div className="header-center">
            <div className="progress-info">
              <span className="progress-label">Document Review</span>
              <span className="progress-value">
                {stats.approved + stats.edited} / {stats.total} verified ({stats.percent}%)
              </span>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-valuenow={stats.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="progress-fill" style={{ width: `${stats.percent}%` }} />
            </div>
          </div>
        )}

        {/* Right Action Controls */}
        <div className="header-right">
          <button
            className="btn btn-secondary"
            onClick={() => handleLoadSample(true)}
            title="Reset to sample invoice (clears saved upload and opens demo invoice)"
          >
            ↺ Reset to Sample
          </button>

          <label className="btn btn-primary file-upload-label" title="Import PDF, PNG, JPG, JPEG, WebP, or SVG invoice document">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Import Docs</span>
            <input
              type="file"
              accept=".pdf,application/pdf,image/png,image/jpeg,image/jpg,image/webp,image/svg+xml,.svg,.png,.jpg,.jpeg,.webp"
              hidden
              onChange={(e) => handleFileUpload(e.target.files?.[0])}
            />
          </label>

          <div className="header-divider"></div>

          <button
            className={`btn-coords-toggle ${showDevCoords ? "active" : ""}`}
            onClick={() => {
              setShowDevCoords((prev) => {
                const next = !prev;
                showToast(next ? "📐 Coordinate Inspector ON — Box coordinates and crosshairs enabled" : "Coordinate Inspector turned OFF");
                return next;
              });
            }}
            title="Toggle Dev Coordinate Inspector (D or X)"
            aria-label="Toggle Dev Coordinate Inspector"
          >
            <span className="btn-icon-text">XY</span>
            <span className="btn-coords-badge">{showDevCoords ? "ON" : "OFF"}</span>
          </button>

          <button
            className="btn-icon"
            onClick={() => setShowShortcutsModal(true)}
            title="Keyboard Shortcuts (?)"
            aria-label="Keyboard Shortcuts"
          >
            ?
          </button>

          <button
            className="btn-icon"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            title="Toggle Light / Dark Theme (T)"
            aria-label="Toggle Theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </header>

      {/* Toast Notification */}
      {toastMsg && (
        <div className="toast-notification" role="status" aria-live="polite">
          <span className="toast-icon">ℹ️</span>
          <span className="toast-text">{toastMsg}</span>
          <button className="toast-dismiss" onClick={() => setToastMsg(null)}>✕</button>
        </div>
      )}

      {/* Global Error Banner */}
      {error && (
        <div className="alert-banner" role="alert">
          <span className="alert-icon">⚠️</span>
          <span className="alert-text">{error}</span>
          <button className="alert-dismiss" onClick={() => setError("")}>✕</button>
        </div>
      )}

      {/* Main Workspace Layout */}
      {!pages.length ? (
        <div className="empty-state-hero">
          <div className="empty-card">
            <div className="empty-icon-ring">📄</div>
            <h2>No Invoice Loaded</h2>
            <p>Import a PDF, image, or SVG invoice to review extracted fields in the exact order they appear on the document.</p>
            <div className="empty-actions">
              <label className="btn btn-primary btn-large file-upload-label">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                <span>Import Docs</span>
                <input
                  type="file"
                  accept=".pdf,application/pdf,image/png,image/jpeg,image/jpg,image/webp,image/svg+xml,.svg,.png,.jpg,.jpeg,.webp"
                  hidden
                  onChange={(e) => handleFileUpload(e.target.files?.[0])}
                />
              </label>
              <button className="btn btn-secondary btn-large" onClick={() => handleLoadSample(true)}>
                Explore With Sample Invoice
              </button>
            </div>
            <p className="empty-formats">Supports PDF, PNG, JPG, JPEG, WebP, and SVG. Pages are scanned dynamically and normalised to 612 CSS pt at 2x resolution.</p>
          </div>
        </div>
      ) : (
        <main className="app-workspace">
          {/* Document Viewport */}
          <section className="document-viewport" aria-label="Invoice Document">
            <div className="viewport-toolbar">
              {/* Left: Page Navigation Back & Forward Controls */}
              <div className="toolbar-left">
                <div className="page-nav-stepper" role="group" aria-label="Document Page Navigation">
                  <button
                    className="btn-page-nav"
                    disabled={activePage <= 1}
                    onClick={() => handleSelectPage(activePage - 1)}
                    title="Previous Page ( [ or PageUp )"
                    aria-label="Previous Page"
                  >
                    ◀ Prev Page
                  </button>
                  <span className="page-stepper-counter">
                    Page <strong>{Math.min(activePage, pages.length || 1)}</strong> of {pages.length}
                  </span>
                  <button
                    className="btn-page-nav"
                    disabled={activePage >= pages.length || pages.length <= 1}
                    onClick={() => handleSelectPage(activePage + 1)}
                    title="Next Page ( ] or PageDown )"
                    aria-label="Next Page"
                  >
                    Next Page ▶
                  </button>
                </div>

                {pages.length > 1 && (
                  <div className="page-pills-list">
                    {pages.map((_, idx) => {
                      const pNum = idx + 1;
                      return (
                        <button
                          key={pNum}
                          className={`pill-page-btn ${activePage === pNum ? "active" : ""}`}
                          onClick={() => handleSelectPage(pNum)}
                          title={`Jump to Page ${pNum}`}
                        >
                          P{pNum}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Center: Zoom and View Mode Controls */}
              <div className="toolbar-center">
                {/* View Mode Toggle: Single Page vs Continuous Scroll */}
                <div className="view-mode-pill-group">
                  <button
                    className={`pill-mode-btn ${viewMode === "single" ? "active" : ""}`}
                    onClick={() => setViewMode("single")}
                    title="Focus on single active page"
                  >
                    Page View
                  </button>
                  <button
                    className={`pill-mode-btn ${viewMode === "scroll" ? "active" : ""}`}
                    onClick={() => setViewMode("scroll")}
                    title="Continuous vertical scroll through all pages"
                  >
                    Continuous
                  </button>
                </div>

                <div className="toolbar-divider-v"></div>

                <button
                  className="btn-tool"
                  onClick={() => setZoomLevel((z) => Math.max(0.6, Number((z - 0.1).toFixed(1))))}
                  title="Zoom Out"
                >
                  −
                </button>
                <span className="zoom-indicator">{Math.round(zoomLevel * 100)}%</span>
                <button
                  className="btn-tool"
                  onClick={() => setZoomLevel((z) => Math.min(1.8, Number((z + 0.1).toFixed(1))))}
                  title="Zoom In"
                >
                  +
                </button>
                <button
                  className="btn-tool text-btn"
                  onClick={() => setZoomLevel(1)}
                  title="Reset Zoom to 100%"
                >
                  Fit 100%
                </button>
              </div>

              {/* Right: Hint Badge */}
              <div className="toolbar-right">
                <span className="drag-hint-badge">
                  <span className="mouse-icon">🖱️</span> Drag on document to add/label any field
                </span>
              </div>
            </div>

            <div className="viewer-scroll-area">
              <DocViewer
                pages={pages}
                fields={fields}
                activeId={activeId}
                activePage={activePage}
                viewMode={viewMode}
                onSelectField={handleSelectField}
                onPageChange={(p) => handleSelectPage(p)}
                onDraw={(page, bbox) =>
                  setManualField({ page, bbox, name: "", value: "" })
                }
                showDevCoords={showDevCoords}
                zoomLevel={zoomLevel}
              />
            </div>
          </section>

          {/* Right Review Sidebar */}
          <aside className="review-sidebar" aria-label="Extracted Fields Review Panel">
            <div className="sidebar-tabs">
              <button
                className={`tab-btn ${activeTab === "fields" ? "active" : ""}`}
                onClick={() => setActiveTab("fields")}
              >
                Invoice Fields ({fields.length})
              </button>
              <button
                className={`tab-btn ${activeTab === "log" ? "active" : ""}`}
                onClick={() => setActiveTab("log")}
              >
                Audit Log ({log.length})
              </button>
            </div>

            {activeTab === "fields" ? (
              <div className="sidebar-tab-content">
                {/* Field Navigation Bar: Prev/Next Field & Undo/Redo */}
                <div className="field-stepper-bar">
                  <div className="field-stepper-left">
                    <button
                      className="btn-field-step"
                      onClick={handlePrevField}
                      title="Previous Field (K or ↑)"
                    >
                      ◀ Prev Field
                    </button>
                    <button
                      className="btn-field-step"
                      onClick={handleNextField}
                      title="Next Field (J or ↓)"
                    >
                      Next Field ▶
                    </button>
                  </div>

                  <div className="undo-redo-controls">
                    <button
                      className="btn-undo-redo"
                      disabled={undoStack.length === 0}
                      onClick={handleUndo}
                      title="Undo (Ctrl+Z)"
                    >
                      ↶ Undo
                    </button>
                    <button
                      className="btn-undo-redo"
                      disabled={redoStack.length === 0}
                      onClick={handleRedo}
                      title="Redo (Ctrl+Y)"
                    >
                      ↷ Redo
                    </button>
                  </div>
                </div>

                {/* Filter and View Mode Toolbar */}
                <div className="filter-bar">
                  <div className="filter-chips">
                    <button
                      className={`chip ${filter === "all" ? "active" : ""}`}
                      onClick={() => setFilter("all")}
                    >
                      All ({stats.total})
                    </button>
                    <button
                      className={`chip pending ${filter === "pending" ? "active" : ""}`}
                      onClick={() => setFilter("pending")}
                    >
                      Pending ({stats.pending})
                    </button>
                    <button
                      className={`chip approved ${filter === "approved" ? "active" : ""}`}
                      onClick={() => setFilter("approved")}
                    >
                      Approved ({stats.approved})
                    </button>
                    <button
                      className={`chip edited ${filter === "edited" ? "active" : ""}`}
                      onClick={() => setFilter("edited")}
                    >
                      Edited ({stats.edited})
                    </button>
                  </div>

                  <div className="view-mode-row">
                    <div className="search-box">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                      </svg>
                      <input
                        type="text"
                        placeholder="Search any field or value..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                      {searchQuery && (
                        <button className="search-clear" onClick={() => setSearchQuery("")}>✕</button>
                      )}
                    </div>

                    <button
                      className={`btn-view-toggle ${groupBySection ? "active" : ""}`}
                      onClick={() => setGroupBySection((v) => !v)}
                      title={groupBySection ? "Switch to Flat List" : "Switch to Section Groups"}
                    >
                      {groupBySection ? "Section View" : "Sequential"}
                    </button>
                  </div>
                </div>

                {/* Batch Action Bar & Add Field Button */}
                <div className="batch-action-bar">
                  <div className="action-bar-left">
                    <button
                      className="btn btn-sm btn-secondary"
                      disabled={stats.pending === 0}
                      onClick={handleApproveAll}
                      title="Approve all pending fields"
                    >
                      ✓ Approve All ({stats.pending})
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() =>
                        setManualField({
                          page: activePage,
                          bbox: [100, 200, 300, 230],
                          name: "",
                          value: "",
                        })
                      }
                      title="Add any custom field present in this invoice"
                    >
                      + Add Field
                    </button>
                  </div>

                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={handleExportJson}
                    title="Export verified invoice data as JSON"
                  >
                    Export JSON
                  </button>
                </div>

                {/* Manual Box / Custom Field Creator */}
                {manualField && (
                  <div className="manual-field-card" role="region" aria-label="Add Field">
                    <div className="manual-card-header">
                      <span className="manual-title">Add Any Invoice Field</span>
                      <span className="manual-bbox-tag">
                        P{manualField.page} • [{manualField.bbox.join(", ")}]
                      </span>
                    </div>

                    <p className="manual-hint">
                      Invoices contain various fields. Type any field name or choose a common one:
                    </p>

                    <div className="suggested-pills">
                      {[
                        "shipping_fee",
                        "discount_amount",
                        "vat_number",
                        "iban",
                        "swift_code",
                        "payment_reference",
                        "tax_rate",
                        "notes",
                      ].map((sug) => (
                        <button
                          key={sug}
                          className="sug-pill"
                          onClick={() => setManualField({ ...manualField, name: sug })}
                        >
                          +{sug}
                        </button>
                      ))}
                    </div>

                    <div className="manual-inputs">
                      <input
                        autoFocus
                        placeholder="Field Name (e.g. shipping_fee)"
                        value={manualField.name}
                        onChange={(e) => setManualField({ ...manualField, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddManualField();
                          if (e.key === "Escape") setManualField(null);
                        }}
                      />
                      <input
                        placeholder="Field Value (e.g. $45.00)"
                        value={manualField.value}
                        onChange={(e) => setManualField({ ...manualField, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddManualField();
                          if (e.key === "Escape") setManualField(null);
                        }}
                      />
                    </div>

                    <div className="manual-actions">
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={!manualField.name.trim()}
                        onClick={handleAddManualField}
                      >
                        Add Field
                      </button>
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => setManualField(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Fields List (Rendered as they appear in the invoice) */}
                <div className="fields-scroll-container">
                  {groupedSections.every((s) => s.fields.length === 0) ? (
                    <div className="no-fields-state">
                      <p>No fields match the current filter or search.</p>
                      {filter !== "all" && (
                        <button className="btn btn-sm btn-ghost" onClick={() => setFilter("all")}>
                          Show All Fields
                        </button>
                      )}
                    </div>
                  ) : (
                    groupedSections.map((sec) => {
                      if (sec.fields.length === 0) return null;

                      return (
                        <div key={sec.key} className="section-group">
                          {groupBySection && (
                            <div className="section-header">
                              <span className="section-title">{sec.title}</span>
                              <span className="section-count">{sec.fields.length}</span>
                            </div>
                          )}

                          <ul className="fields-card-list" role="list">
                            {sec.fields.map((f) => {
                              const isActive = f.id === activeId;
                              const isEditingThis = editing?.id === f.id;

                              return (
                                <li
                                  key={f.id}
                                  className={`field-card ${isActive ? "active" : ""} status-${f.status}`}
                                  onClick={() => handleSelectField(f.id)}
                                >
                                  {/* Field Card Header */}
                                  <div className="field-card-top">
                                    <div className="field-name-wrapper">
                                      <span className="field-name-title">
                                        {f.label || f.field.replace(/_/g, " ")}
                                      </span>
                                      <span className="field-key-badge" title="Underlying field key">
                                        {f.field}
                                      </span>
                                    </div>

                                    <div className="field-badges">
                                      <span className="page-indicator" title={`Positioned on Page ${f.page}`}>
                                        P{f.page}
                                      </span>
                                      {f.confidence && (
                                        <span className="conf-badge" title={`Confidence: ${Math.round(f.confidence * 100)}%`}>
                                          {Math.round(f.confidence * 100)}%
                                        </span>
                                      )}
                                      <span className={`status-pill pill-${f.status}`}>
                                        <span className="status-dot"></span>
                                        {f.status}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Inline Edit Form */}
                                  {isEditingThis ? (
                                    <div className="inline-editor" onClick={(e) => e.stopPropagation()}>
                                      <div className="editor-inputs-row">
                                        <div className="input-group">
                                          <label className="input-lbl">Field Name</label>
                                          <input
                                            value={editing.fieldName}
                                            aria-label="Edit field name"
                                            placeholder="Field name"
                                            onChange={(e) =>
                                              setEditing({ ...editing, fieldName: e.target.value })
                                            }
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") handleSaveEdit(f);
                                              if (e.key === "Escape") setEditing(null);
                                            }}
                                          />
                                        </div>

                                        <div className="input-group">
                                          <label className="input-lbl">Extracted Value</label>
                                          <input
                                            autoFocus
                                            value={editing.value}
                                            aria-label="Edit extracted value"
                                            placeholder="Value"
                                            onChange={(e) =>
                                              setEditing({ ...editing, value: e.target.value })
                                            }
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") handleSaveEdit(f);
                                              if (e.key === "Escape") setEditing(null);
                                            }}
                                          />
                                        </div>
                                      </div>

                                      <div className="editor-actions">
                                        <button
                                          className="btn btn-sm btn-primary"
                                          onClick={() => handleSaveEdit(f)}
                                        >
                                          Save (↵)
                                        </button>
                                        <button
                                          className="btn btn-sm btn-secondary"
                                          onClick={() => setEditing(null)}
                                        >
                                          Cancel (Esc)
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    /* Normal Value & Actions Row */
                                    <div className="field-value-row">
                                      <div className="value-display">
                                        {f.value ? (
                                          <span className="val-text">{f.value}</span>
                                        ) : (
                                          <span className="val-empty">(empty)</span>
                                        )}
                                      </div>

                                      <div className="field-action-buttons">
                                        <button
                                          className="btn-action edit"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleSelectField(f.id);
                                            setEditing({
                                              id: f.id,
                                              fieldName: f.field,
                                              value: f.value,
                                            });
                                          }}
                                          title="Edit field name or value (E)"
                                        >
                                          Edit
                                        </button>
                                        <button
                                          className="btn-action approve"
                                          disabled={f.status === "approved"}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleApprove(f);
                                          }}
                                          title="Approve field (A)"
                                        >
                                          {f.status === "approved" ? "✓ Done" : "Approve"}
                                        </button>
                                        <button
                                          className="btn-action delete"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteField(f);
                                          }}
                                          title="Remove field"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              /* Audit Log Tab */
              <div className="sidebar-tab-content log-tab-content">
                <div className="log-header-row">
                  <span className="log-count">{log.length} Entries Logged</span>
                  {log.length > 0 && (
                    <button className="btn btn-sm btn-ghost" onClick={() => setLog([])}>
                      Clear Log
                    </button>
                  )}
                </div>

                {log.length === 0 ? (
                  <div className="log-empty-state">
                    <p>No modifications yet.</p>
                    <span className="hint-sub">Edits, approvals, renames, and deletions will appear here in chronological order.</span>
                  </div>
                ) : (
                  <ol className="audit-log-list">
                    {log.map((entry) => (
                      <li key={entry.id} className={`log-item kind-${entry.kind}`}>
                        <div className="log-item-top">
                          <span className={`log-kind-tag tag-${entry.kind}`}>
                            {entry.kind === "edit" && "EDITED"}
                            {entry.kind === "approve" && "APPROVED"}
                            {entry.kind === "add" && "ADDED"}
                            {entry.kind === "delete" && "DELETED"}
                            {entry.kind === "rename" && "RENAMED"}
                            {entry.kind === "batch_approve" && "BATCH APPROVED"}
                          </span>
                          <time className="log-timestamp">{formatTimestamp(entry.at)}</time>
                        </div>

                        <div className="log-field-name">{entry.field}</div>

                        <div className="log-diff-display">
                          {entry.kind === "edit" && (
                            <div className="diff-row">
                              <span className="diff-old">{entry.oldValue || "(empty)"}</span>
                              <span className="diff-arrow">→</span>
                              <span className="diff-new">{entry.newValue || "(empty)"}</span>
                            </div>
                          )}
                          {entry.kind === "rename" && (
                            <div className="diff-row">
                              <span className="diff-old">{entry.oldValue}</span>
                              <span className="diff-arrow">→</span>
                              <span className="diff-new">{entry.newValue}</span>
                            </div>
                          )}
                          {entry.kind === "approve" && (
                            <div className="diff-row">
                              <span className="diff-approved-val">{entry.newValue}</span>
                            </div>
                          )}
                          {entry.kind === "add" && (
                            <div className="diff-row">
                              <span className="diff-new">{entry.newValue || "(empty)"}</span>
                            </div>
                          )}
                          {entry.kind === "delete" && (
                            <div className="diff-row">
                              <span className="diff-old">{entry.oldValue} (removed)</span>
                            </div>
                          )}
                          {entry.kind === "batch_approve" && (
                            <div className="diff-row">
                              <span className="diff-approved-val">{entry.newValue}</span>
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </aside>
        </main>
      )}

      {/* Keyboard Shortcuts Modal */}
      {showShortcutsModal && (
        <div className="modal-backdrop" onClick={() => setShowShortcutsModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Keyboard Shortcuts</h3>
              <button className="modal-close" onClick={() => setShowShortcutsModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <table className="shortcuts-table">
                <tbody>
                  <tr>
                    <td><kbd>[</kbd> / <kbd>]</kbd> or <kbd>PgUp</kbd> / <kbd>PgDn</kbd></td>
                    <td>Previous / Next Page in document</td>
                  </tr>
                  <tr>
                    <td><kbd>Alt</kbd> + <kbd>←</kbd> / <kbd>→</kbd></td>
                    <td>Browser History Back / Forward</td>
                  </tr>
                  <tr>
                    <td><kbd>Ctrl</kbd> + <kbd>Z</kbd> / <kbd>Ctrl</kbd> + <kbd>Y</kbd></td>
                    <td>Undo / Redo field changes</td>
                  </tr>
                  <tr>
                    <td><kbd>↓</kbd> or <kbd>J</kbd> or <kbd>→</kbd></td>
                    <td>Next field (following invoice reading order)</td>
                  </tr>
                  <tr>
                    <td><kbd>↑</kbd> or <kbd>K</kbd> or <kbd>←</kbd></td>
                    <td>Previous field (following invoice reading order)</td>
                  </tr>
                  <tr>
                    <td><kbd>A</kbd></td>
                    <td>Approve selected field</td>
                  </tr>
                  <tr>
                    <td><kbd>E</kbd></td>
                    <td>Inline edit field name & value</td>
                  </tr>
                  <tr>
                    <td><kbd>Enter</kbd></td>
                    <td>Save inline edit / confirm new field</td>
                  </tr>
                  <tr>
                    <td><kbd>Esc</kbd></td>
                    <td>Cancel edit / dismiss dialog</td>
                  </tr>
                  <tr>
                    <td><kbd>D</kbd></td>
                    <td>Toggle Dev Coordinate Inspector</td>
                  </tr>
                  <tr>
                    <td><kbd>T</kbd></td>
                    <td>Toggle Dark / Light Theme</td>
                  </tr>
                  <tr>
                    <td><kbd>?</kbd></td>
                    <td>Open shortcuts reference</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
