import { useRef, useState, useEffect, useCallback } from "react";
import { RawBBox, Field, Page, PAGE_W } from "./types";

interface Props {
  pages: Page[];
  fields: Field[];
  activeId: string | null;
  activePage?: number;
  viewMode?: "single" | "scroll";
  onSelectField: (id: string) => void;
  onPageChange?: (page: number) => void;
  onDraw: (page: number, bbox: RawBBox) => void;
  showDevCoords: boolean;
  zoomLevel: number;
}

export default function DocViewer({
  pages,
  fields,
  activeId,
  activePage = 1,
  viewMode = "single",
  onSelectField,
  onPageChange = () => {},
  onDraw,
  showDevCoords,
  zoomLevel,
}: Props) {
  const [drag, setDrag] = useState<{
    page: number;
    a: [number, number]; // [x, y] in 612px page space
    b: [number, number];
  } | null>(null);

  const [hoverCoords, setHoverCoords] = useState<{
    page: number;
    x: number;
    y: number;
    normX: number;
    normY: number;
    clientX: number;
    clientY: number;
  } | null>(null);

  const [hoveredFieldId, setHoveredFieldId] = useState<string | null>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Scroll active field's page into view when selected
  useEffect(() => {
    if (!activeId) return;
    const field = fields.find((f) => f.id === activeId);
    if (!field) return;

    if (field.page !== activePage) {
      onPageChange(field.page);
    }

    if (viewMode === "scroll") {
      const pageIndex = field.page - 1;
      const el = pageRefs.current[pageIndex];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [activeId, fields, activePage, viewMode, onPageChange]);

  // When activePage changes in scroll view, scroll it smoothly into view
  useEffect(() => {
    if (viewMode === "scroll") {
      const pageIndex = activePage - 1;
      const el = pageRefs.current[pageIndex];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [activePage, viewMode]);

  // Compute point in 612-wide page space, clamped to page boundaries
  const getPagePoint = useCallback(
    (e: React.PointerEvent, pageNum: number): [number, number] => {
      const pageIndex = pageNum - 1;
      const el = pageRefs.current[pageIndex];
      if (!el) return [0, 0];
      const rect = el.getBoundingClientRect();
      const pageHeight = pages[pageIndex]?.height || 792;
      const scale = PAGE_W / rect.width;

      // Relative offset inside the page element
      const rawX = (e.clientX - rect.left) * scale;
      const rawY = (e.clientY - rect.top) * scale;

      // Clamped to page boundaries
      const clampedX = Math.max(0, Math.min(PAGE_W, Math.round(rawX)));
      const clampedY = Math.max(0, Math.min(pageHeight, Math.round(rawY)));

      return [clampedX, clampedY];
    },
    [pages]
  );

  const computeRect = (a: [number, number], b: [number, number]): RawBBox => {
    return [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
    ];
  };

  const handlePointerDown = (e: React.PointerEvent, pageNum: number) => {
    if (e.button !== 0) return;
    const p = getPagePoint(e, pageNum);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ page: pageNum, a: p, b: p });
  };

  const handlePointerMove = (e: React.PointerEvent, pageNum: number) => {
    const p = getPagePoint(e, pageNum);
    const pg = pages[pageNum - 1];
    const pageH = pg?.height || 792;

    if (showDevCoords) {
      setHoverCoords({
        page: pageNum,
        x: p[0],
        y: p[1],
        normX: Number((p[0] / PAGE_W).toFixed(4)),
        normY: Number((p[1] / pageH).toFixed(4)),
        clientX: e.clientX,
        clientY: e.clientY,
      });
    }

    if (drag && drag.page === pageNum) {
      setDrag((prev) => (prev ? { ...prev, b: p } : null));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (drag) {
      const r = computeRect(drag.a, drag.b);
      // Ignore tiny unintentional accidental clicks (< 8px width & height)
      if (r[2] - r[0] > 8 && r[3] - r[1] > 8) {
        onDraw(drag.page, r);
      }
      setDrag(null);
    }
  };

  const handlePointerLeave = () => {
    if (!drag) {
      setHoverCoords(null);
    }
  };

  // Determine pages to display based on viewMode (safely clamped to existing pages)
  const safeActivePage = Math.max(1, Math.min(activePage, pages.length || 1));
  const visiblePages = viewMode === "single"
    ? pages.filter((_, i) => i + 1 === safeActivePage)
    : pages;
  const renderedPages = visiblePages.length > 0 ? visiblePages : (pages.length > 0 ? [pages[0]] : []);

  return (
    <div
      className="doc-viewer-container"
      style={{ transform: `scale(${zoomLevel})`, transformOrigin: "top center" }}
    >
      <div className={`pages-stack view-${viewMode}`}>
        {renderedPages.map((pg) => {
          const pageNum = pg.pageNumber || pages.indexOf(pg) + 1;
          const pageFields = fields.filter((f) => f.page === pageNum);

          return (
            <div key={pageNum} className="page-wrapper">
              <div className="page-meta-header">
                <span className="page-badge">
                  Page {pageNum} of {pages.length}
                </span>
                <span className="page-dim">
                  {PAGE_W} × {pg.height} pt
                </span>
              </div>

              <div
                className="page-canvas-wrapper"
                ref={(el) => (pageRefs.current[pageNum - 1] = el)}
                style={{ aspectRatio: `${PAGE_W} / ${pg.height}` }}
                onPointerDown={(e) => handlePointerDown(e, pageNum)}
                onPointerMove={(e) => handlePointerMove(e, pageNum)}
                onPointerUp={handlePointerUp}
                onPointerCancel={() => setDrag(null)}
                onPointerLeave={handlePointerLeave}
              >
                <img
                  src={pg.src}
                  alt={`Invoice Page ${pageNum}`}
                  draggable={false}
                  className="page-image"
                />

                {/* Dev Mode Cursor Guides */}
                {showDevCoords && hoverCoords && hoverCoords.page === pageNum && (
                  <>
                    <div
                      className="dev-crosshair dev-crosshair-x"
                      style={{ top: `${(hoverCoords.y / pg.height) * 100}%` }}
                    />
                    <div
                      className="dev-crosshair dev-crosshair-y"
                      style={{ left: `${(hoverCoords.x / PAGE_W) * 100}%` }}
                    />
                  </>
                )}

                {/* Render All Extracted Bounding Boxes */}
                {pageFields.map((f) => {
                  const isActive = f.id === activeId;
                  const isHovered = f.id === hoveredFieldId;
                  // Normalized coordinates (0 - 1 per page) convert directly to percentage styles
                  const [nx1, ny1, nx2, ny2] = f.normalizedBbox;
                  const left = `${nx1 * 100}%`;
                  const top = `${ny1 * 100}%`;
                  const width = `${(nx2 - nx1) * 100}%`;
                  const height = `${(ny2 - ny1) * 100}%`;

                  return (
                    <div
                      key={f.id}
                      className={`bbox-highlight ${isActive ? "active" : ""} ${
                        isHovered ? "hovered" : ""
                      } ${f.status}`}
                      style={{ left, top, width, height }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectField(f.id);
                      }}
                      onPointerEnter={() => setHoveredFieldId(f.id)}
                      onPointerLeave={() => setHoveredFieldId(null)}
                      title={`${f.field}: ${f.value} (${f.status})`}
                      role="button"
                      tabIndex={0}
                      aria-label={`Highlight for ${f.field}`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectField(f.id);
                        }
                      }}
                    >
                      {/* Label badge for active or hovered field */}
                      {(isActive || isHovered) && (
                        <div className="bbox-label-badge">
                          <span className="badge-field">{f.label || f.field}</span>
                          <span className={`badge-status status-${f.status}`}>
                            {f.status}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Drawing Draft Box */}
                {drag && drag.page === pageNum && (
                  (() => {
                    const r = computeRect(drag.a, drag.b);
                    const left = `${(r[0] / PAGE_W) * 100}%`;
                    const top = `${(r[1] / pg.height) * 100}%`;
                    const width = `${((r[2] - r[0]) / PAGE_W) * 100}%`;
                    const height = `${((r[3] - r[1]) / pg.height) * 100}%`;
                    return (
                      <div
                        className="bbox-highlight draft-box"
                        style={{ left, top, width, height }}
                      >
                        <span className="draft-dimension-tag">
                          {r[2] - r[0]} × {r[3] - r[1]}
                        </span>
                      </div>
                    );
                  })()
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Dev Coordinates Floating HUD */}
      {showDevCoords && hoverCoords && (
        <div className="dev-coords-hud" role="status" aria-live="polite">
          <div className="hud-header">
            DEV COORDINATE INSPECTOR (Page {hoverCoords.page})
          </div>
          <div className="hud-row">
            <span>612px Point Space:</span>
            <strong>
              X: {hoverCoords.x}px, Y: {hoverCoords.y}px
            </strong>
          </div>
          <div className="hud-row">
            <span>Normalized (0-1):</span>
            <strong>[{hoverCoords.normX}, {hoverCoords.normY}]</strong>
          </div>
          <div className="hud-tip">Click & drag to measure bounding box</div>
        </div>
      )}
    </div>
  );
}
