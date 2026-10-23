import React from "react";
import { PAGE_W } from "./types";

export interface ImportState {
  isImporting: boolean;
  fileName: string;
  fileSizeStr: string;
  stage: string;
  progress: number;
}

interface SpiralSpinnerProps {
  size?: number;
  className?: string;
}

/**
 * High-tech multi-arc spiral buffer spinner
 */
export function SpiralSpinner({ size = 20, className = "" }: SpiralSpinnerProps) {
  return (
    <svg
      className={`spiral-spinner-svg ${className}`}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="status"
      aria-label="Loading"
    >
      <defs>
        <linearGradient id="spiral-grad-1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="50%" stopColor="#06b6d4" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id="spiral-grad-2" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>

      {/* Outer spiral ring with segmented dash */}
      <circle
        cx="20"
        cy="20"
        r="17"
        stroke="url(#spiral-grad-1)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="65 40"
        className="spiral-outer-arm"
      />

      {/* Middle counter-rotating spiral arm */}
      <circle
        cx="20"
        cy="20"
        r="11"
        stroke="url(#spiral-grad-2)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeDasharray="36 24"
        className="spiral-middle-arm"
      />

      {/* Inner orbital core pulse */}
      <circle
        cx="20"
        cy="20"
        r="4.5"
        fill="#38bdf8"
        className="spiral-center-dot"
      />
    </svg>
  );
}

interface DocumentSkeletonProps {
  importState: ImportState;
}

/**
 * Pixel-accurate 612pt invoice skeleton document buffer with shimmering layout & OCR laser scanline
 */
export function DocumentSkeleton({ importState }: DocumentSkeletonProps) {
  return (
    <div className="doc-viewer-container skeleton-viewer-container">
      <div className="pages-stack view-single">
        <div className="page-wrapper skeleton-page-wrapper">
          {/* Page Meta Header Skeleton */}
          <div className="page-meta-header">
            <span className="page-badge skeleton-shimmer-box" style={{ width: 110, height: 18 }} />
            <span className="page-dim skeleton-shimmer-box" style={{ width: 80, height: 18 }} />
          </div>

          <div
            className="page-canvas-wrapper skeleton-canvas-wrapper"
            style={{ width: `${PAGE_W}px`, height: "792px", aspectRatio: `${PAGE_W} / 792` }}
          >
            {/* Animated Laser OCR Sweep Line */}
            <div className="ocr-laser-beam" />

            {/* Document Header Skeleton */}
            <div className="skel-section skel-header-row">
              <div className="skel-col">
                <div className="skeleton-bar skel-logo" />
                <div className="skeleton-bar skel-subline" style={{ width: "210px" }} />
              </div>
              <div className="skel-col skel-align-right">
                <div className="skeleton-bar skel-title" style={{ width: "170px" }} />
                <div className="skeleton-bar skel-meta-pill" style={{ width: "120px" }} />
              </div>
            </div>

            {/* Invoice Meta Grid Skeleton */}
            <div className="skel-section skel-meta-grid">
              <div className="skel-meta-cell">
                <div className="skeleton-bar skel-tiny-label" style={{ width: "70px" }} />
                <div className="skeleton-bar skel-medium-val" style={{ width: "110px" }} />
              </div>
              <div className="skel-meta-cell">
                <div className="skeleton-bar skel-tiny-label" style={{ width: "65px" }} />
                <div className="skeleton-bar skel-medium-val" style={{ width: "95px" }} />
              </div>
              <div className="skel-meta-cell">
                <div className="skeleton-bar skel-tiny-label" style={{ width: "75px" }} />
                <div className="skeleton-bar skel-medium-val" style={{ width: "100px" }} />
              </div>
            </div>

            {/* Parties: Vendor & Client Cards Skeleton */}
            <div className="skel-section skel-parties-row">
              <div className="skel-card">
                <div className="skeleton-bar skel-card-badge" style={{ width: "90px" }} />
                <div className="skeleton-bar skel-bold-name" style={{ width: "160px" }} />
                <div className="skeleton-bar skel-address-line" style={{ width: "190px" }} />
                <div className="skeleton-bar skel-address-line" style={{ width: "140px" }} />
              </div>
              <div className="skel-card">
                <div className="skeleton-bar skel-card-badge" style={{ width: "80px" }} />
                <div className="skeleton-bar skel-bold-name" style={{ width: "170px" }} />
                <div className="skeleton-bar skel-address-line" style={{ width: "180px" }} />
                <div className="skeleton-bar skel-address-line" style={{ width: "130px" }} />
              </div>
            </div>

            {/* Line Items Table Skeleton */}
            <div className="skel-section skel-table-block">
              <div className="skel-table-header">
                <div className="skeleton-bar" style={{ width: "45%" }} />
                <div className="skeleton-bar" style={{ width: "15%" }} />
                <div className="skeleton-bar" style={{ width: "15%" }} />
                <div className="skeleton-bar" style={{ width: "15%" }} />
              </div>

              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="skel-table-row">
                  <div className="skeleton-bar" style={{ width: `${50 + (i % 3) * 12}%` }} />
                  <div className="skeleton-bar" style={{ width: "35px" }} />
                  <div className="skeleton-bar" style={{ width: "55px" }} />
                  <div className="skeleton-bar" style={{ width: "65px" }} />
                </div>
              ))}
            </div>

            {/* Summary & Totals Skeleton */}
            <div className="skel-section skel-totals-row">
              <div className="skel-terms-box">
                <div className="skeleton-bar" style={{ width: "100px", height: "10px" }} />
                <div className="skeleton-bar" style={{ width: "140px", height: "14px" }} />
              </div>
              <div className="skel-totals-box">
                <div className="skel-total-line">
                  <span className="skeleton-bar" style={{ width: "60px" }} />
                  <span className="skeleton-bar" style={{ width: "80px" }} />
                </div>
                <div className="skel-total-line">
                  <span className="skeleton-bar" style={{ width: "70px" }} />
                  <span className="skeleton-bar" style={{ width: "65px" }} />
                </div>
                <div className="skel-total-line skel-grand-total">
                  <span className="skeleton-bar" style={{ width: "90px", height: "16px" }} />
                  <span className="skeleton-bar" style={{ width: "105px", height: "18px" }} />
                </div>
              </div>
            </div>

            {/* Remittance Footer Skeleton */}
            <div className="skel-section skel-footer-remittance">
              <div className="skeleton-bar" style={{ width: "220px", height: "11px" }} />
              <div className="skeleton-bar" style={{ width: "310px", height: "9px" }} />
            </div>

            {/* Floating Glassmorphic Spiral Buffer HUD */}
            <div className="spiral-buffer-hud-overlay">
              <div className="spiral-buffer-card">
                <div className="spiral-hero-icon-wrap">
                  <SpiralSpinner size={58} />
                </div>

                <div className="spiral-hud-content">
                  <div className="spiral-status-tag">
                    <span className="pulse-ping" />
                    <span>PARSING & EXTRACTING OCR FIELDS</span>
                  </div>

                  <h3 className="spiral-hud-title">Importing Document</h3>

                  <div className="spiral-file-chip">
                    <span className="file-icon">📄</span>
                    <span className="file-name" title={importState.fileName}>
                      {importState.fileName}
                    </span>
                    <span className="file-size-badge">{importState.fileSizeStr}</span>
                  </div>

                  <p className="spiral-stage-message">{importState.stage}</p>

                  {/* Dynamic Progress Bar */}
                  <div className="spiral-progress-container">
                    <div className="spiral-progress-track">
                      <div
                        className="spiral-progress-fill"
                        style={{ width: `${Math.max(10, Math.min(100, importState.progress))}%` }}
                      />
                    </div>
                    <span className="spiral-progress-pct">{importState.progress}%</span>
                  </div>

                  <div className="spiral-hud-features">
                    <span className="feature-pill">✦ 2x Retina Normalization</span>
                    <span className="feature-pill">✦ OCR Vector Scanning</span>
                    <span className="feature-pill">✦ Bounding Box Alignment</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Sidebar skeleton field cards while document is being imported
 */
export function SidebarSkeleton() {
  return (
    <div className="sidebar-tab-content skeleton-sidebar-content">
      {/* Skeleton Top Nav Bar */}
      <div className="field-stepper-bar">
        <div className="skeleton-bar" style={{ width: "160px", height: "28px", borderRadius: "6px" }} />
        <div className="skeleton-bar" style={{ width: "90px", height: "28px", borderRadius: "6px" }} />
      </div>

      {/* Skeleton Filter Chips */}
      <div className="filter-bar">
        <div className="filter-chips">
          {[1, 2, 3, 4].map((n) => (
            <span
              key={n}
              className="chip skeleton-shimmer-box"
              style={{ width: n === 1 ? 50 : 75, height: 24, borderRadius: "12px" }}
            />
          ))}
        </div>
        <div className="skeleton-bar" style={{ width: "100%", height: "32px", borderRadius: "6px", marginTop: "8px" }} />
      </div>

      <div className="skeleton-importing-notice">
        <span className="spinner-icon">⏳</span>
        <span>Extracting invoice fields & bounding coordinates...</span>
      </div>

      {/* 5 Shimmering Field Cards */}
      <div className="fields-list">
        {[1, 2, 3, 4, 5].map((idx) => (
          <div key={idx} className="field-card skeleton-field-card">
            <div className="card-top-row">
              <div className="skeleton-bar" style={{ width: `${40 + (idx % 3) * 15}%`, height: "13px" }} />
              <div className="skeleton-bar" style={{ width: "55px", height: "16px", borderRadius: "10px" }} />
            </div>
            <div className="skeleton-bar" style={{ width: `${60 + (idx % 4) * 10}%`, height: "18px", marginTop: "8px" }} />
            <div className="card-bottom-row" style={{ marginTop: "10px" }}>
              <div className="skeleton-bar" style={{ width: "50px", height: "11px" }} />
              <div className="skeleton-bar" style={{ width: "70px", height: "20px", borderRadius: "4px" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
