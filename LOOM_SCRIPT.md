# 2-Minute Loom Walkthrough Script

**Target Duration:** 2 minutes (120 seconds)  
**Style:** Conversational, engineering-focused, no filler words.

---

### [00:00 - 00:15] — Introduction (15 seconds)
> "Hey everyone! Today I’m walking through **VerifEye**, a fast, keyboard-first invoice review application built with React, TypeScript, and Vite. It lets operators review OCR-extracted fields from multi-page PDFs and images, verify values against visual bounding boxes, make inline edits, and keep a clean, tamper-evident audit log."

---

### [00:15 - 01:30] — Key Files & Coordinate Normalization (75 seconds)
> "Let's dive straight into the code. The entire architecture centers around three core modules:
>
> 1. **`loadDoc.ts`**: This handles file ingestion for PDFs and images. For PDFs, we pin `pdfjs-dist` and normalize every page to 612 CSS points—the standard PDF point width—rendering at 2x resolution on an HTML5 canvas for crisp text on retina screens. It also includes an embedded generator for our sample two-page invoice.
>
> 2. **`types.ts` & The Coordinate Normalization Decision**: Incoming OCR models often return boxes either in pixels or PDF points. If you apply pixel coordinates directly to the DOM, they break as soon as the user zooms in or opens the app on a tablet. So we normalize all coordinates into 0-to-1 ratios relative to the page's actual width and height on load. 
>
> 3. **`DocViewer.tsx`**: By using normalized coordinates, `DocViewer` renders highlights entirely with CSS percentages: `left`, `top`, `width`, and `height`. When the container scales down, the boxes stay pinned to the exact text. We also implemented pointer events with `setPointerCapture` and clamped coordinates, so you can drag anywhere on the page to manually label a missing field without worrying about out-of-bounds errors. We even have a dev inspector toggle—press `D`—which projects real-time crosshairs and 612-point coordinates under your cursor."

---

### [01:30 - 02:00] — Improvement with More Time (30 seconds)
> "If I had more time to take this further, the first feature I'd add is **interactive drag-to-resize bounding boxes** with eight-point anchor handles. Right now, drawing a box is a single drag-and-drop gesture; adding resize and drag-to-reposition handles with collision detection would give operators fine-grained control when an OCR box slightly misses an invoice line item, without needing to re-draw the whole box from scratch."

---

### [02:00 - 02:10] — Wrap-up (10 seconds)
> "That’s VerifEye—clean component design, zero UI libraries, full keyboard shortcuts, and deployable to Vercel with zero config. Thanks for watching!"
