# VerifEye — Enterprise Invoice Review & Verification

A production-grade invoice data review web application built with **React**, **TypeScript**, and **Vite**. Designed to review, verify, and edit OCR-extracted fields from multi-page PDFs and images with pixel-precise responsive bounding boxes, an immutable audit log, and high-velocity keyboard shortcuts.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm

### Local Development
```bash
# Install dependencies
npm install

# Start local dev server
npm run dev
```

Navigate to `http://localhost:5173`. The application automatically boots with a realistic high-DPI sample invoice and mock extraction data ready for immediate testing.

### Production Build
```bash
npm run build
npm run preview
```

---

## 🌟 Key Features

1. **Document Ingestion (PDF & Images)**:
   - High-fidelity PDF rendering via pinned `pdfjs-dist@4.4.168`.
   - Normalises every document page to **612 CSS pt** (standard PDF point width) and renders at **2x resolution** on canvas for retina sharpness.
   - Supports multi-page PDFs, PNG, JPG, and WebP with graceful error handling.
   - Built-in "Try Sample Invoice" button generates an ultra-crisp 2-page invoice canvas matching mock bounding boxes.

2. **Robust Normalized Coordinate System**:
   - Extracted coordinates are normalized to `[0, 1]` relative to each page's width and height.
   - Rendered using percentage-based CSS (`left: ${x1 * 100}%`, `top: ${y1 * 100}%`, `width: ${(x2 - x1) * 100}%`, `height: ${(y2 - y1) * 100}%`).
   - Ensures bounding boxes remain perfectly aligned across window resizing, responsive mobile views, and document zoom levels.

3. **Interactive Side Panel & Bounding Boxes**:
   - Bidirectional selection: clicking a field in the sidebar jumps and scrolls to its highlighted box on the document; clicking a box on the document selects the field in the sidebar.
   - Active field glow, badge tooltips, and status tags (`Pending`, `Approved`, `Edited`).

4. **Fast Inline Review**:
   - Single-key approval (`A`), inline editing (`E`) with `Enter` to commit and `Escape` to cancel.
   - "Approve All" batch verification.

5. **Immutable Audit Change Log**:
   - Real-time visible log showing newest changes first.
   - Records edits (`OLD value → NEW value`), approvals, batch approvals, and manual field additions with ISO timestamps.

6. **Interactive Manual Box Drawing**:
   - Drag anywhere on the document canvas using pointer events (`setPointerCapture` with touch support).
   - Clamped to page boundaries `[0, PAGE_W]` and `[0, pageHeight]` to prevent invalid coordinates.
   - Side drawer allows naming the field (with one-click suggestion pills) and saving it immediately to fields and the audit log.

7. **Dev-Only Coordinate Inspector (Press `D` or click `XY`)**:
   - Live crosshair guides that track cursor movement across the 612pt page space.
   - Displays real-time 612px point coordinates `(X, Y)` and normalized `[normX, normY]` for quick mock data calibration.

8. **Keyboard-Driven Workflow**:
   - `↓` / `J`: Next field
   - `↑` / `K`: Previous field
   - `A`: Approve selected field
   - `E`: Inline edit selected field
   - `Enter`: Save edit / confirm new field
   - `Esc`: Cancel edit / dismiss modal
   - `D`: Toggle dev coordinate inspector
   - `T`: Toggle Dark / Light theme
   - `?`: Open keyboard shortcuts cheat sheet

9. **Data Export**:
   - One-click export of verified invoice data and change logs as structured JSON.

---

## ☁️ Vercel Deployment Guide

This repository is configured for zero-config deployment on **Vercel**.

### Step-by-Step Deployment:
1. Push your repository to GitHub.
2. In the [Vercel Dashboard](https://vercel.com/dashboard), click **Add New Project** and select your GitHub repository.
3. Configure project settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `./` (or `./invoice-review` if using the nested folder)
   - **Build Command**: `tsc && vite build` (or `npm run build`)
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`
4. Click **Deploy**.

### Verifying the PDF Worker in Production:
PDF rendering relies on `pdfjs-dist/build/pdf.worker.min.mjs`. 
In this project, Vite resolves the worker asset via:
```typescript
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
```
To verify in production:
1. Open your deployed Vercel URL in Chrome.
2. Open **DevTools** (`F12`) → **Network** tab.
3. Filter by `mjs` or `worker`.
4. Upload any PDF file. You should see `pdf.worker-....mjs` return **HTTP 200 OK** from the `/assets/` directory (or the fallback unpkg CDN if offline).

---

## 📐 Coordinate Normalization Architecture

In invoice review software, incoming documents vary wildly in DPI (72 DPI scans, 300 DPI receipts, 600 DPI vector PDFs).

- **Standard Base**: We normalize every page to `612 CSS pt` wide (the standard width of a US Letter/A4 PDF point space).
- **Extracted BBox Format**: `[x1, y1, x2, y2]` in the 612px page space.
- **Normalized Per-Page Form**: On ingestion, we compute:
  $$\text{normX} = \frac{x}{\text{PAGE\_W}}, \quad \text{normY} = \frac{y}{\text{pageHeight}}$$
- **Render Engine**: Every bounding box uses percentages for `left`, `top`, `width`, and `height`:
  ```css
  left: calc(normX1 * 100%);
  top: calc(normY1 * 100%);
  width: calc((normX2 - normX1) * 100%);
  height: calc((normY2 - normY1) * 100%);
  ```
This makes highlights impervious to layout zoom, responsive container shrink, and mobile viewport shifts.

---

## 🛡️ Edge Cases Handled

- **Multi-Page PDFs**: Seamless page stacking, page metadata tags (`Page 1 of 2`), and automatic scroll-to-page when selecting a field located on page 2 or beyond.
- **Landscape & Tall Documents**: Aspect-ratio preserving container dynamically computes height from `img.naturalHeight / img.naturalWidth * 612`.
- **Mid-Session Document Replacement**: Automatically revokes previous blob URLs (`URL.revokeObjectURL`) to prevent memory leaks, re-extracts mock fields, and resets state cleanly.
- **Empty Field Values**: Displays clear italicized `(empty)` placeholder without breaking layout; logs transitions from/to empty values accurately.
- **Dragging Outside Document Bounds**: Clamps drag coordinates strictly within `[0, PAGE_W]` and `[0, pageHeight]`, filtering out clicks smaller than 8px.

---

## 🎬 2-Minute Loom Video Script

See [LOOM_SCRIPT.md](./LOOM_SCRIPT.md) for the exact word-for-word walkthrough script formatted with 15s intro, 75s file walkthrough, 30s architectural improvements, and 10s wrap-up.
