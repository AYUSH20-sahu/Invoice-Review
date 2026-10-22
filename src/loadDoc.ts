import * as pdfjs from "pdfjs-dist";
import {
  RawBBox,
  Field,
  FieldSection,
  DocLoadResult,
  Page,
  PAGE_W,
  normalizeBBox,
  sortFieldsByInvoiceOrder,
  MOCK_FIELDS_DEF,
} from "./types";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const uid = () => Math.random().toString(36).slice(2, 9);

export interface TextSpan {
  text: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  fontSize: number;
  page: number;
}

/**
 * Pixel-based line scanner: scans the canvas image data to detect text bands and regions
 */
export function scanCanvasPixelsForSpans(
  canvas: HTMLCanvasElement,
  pageNum: number,
  pageH: number
): TextSpan[] {
  const spans: TextSpan[] = [];
  const ctx = canvas.getContext("2d");
  if (!ctx) return spans;

  try {
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    const scaleX = PAGE_W / w;
    const scaleY = pageH / h;

    // Sample horizontal line brightness
    const rowDarkCounts = new Int32Array(h);
    for (let y = 0; y < h; y += 2) {
      let dark = 0;
      for (let x = 0; x < w; x += 4) {
        const idx = (y * w + x) * 4;
        const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        if (brightness < 180) dark++;
      }
      rowDarkCounts[y] = dark;
    }

    // Find horizontal text line bands
    let inBand = false;
    let bandStartY = 0;
    const minBandPixels = Math.round(w * 0.015);

    for (let y = 0; y < h; y += 2) {
      const isDark = rowDarkCounts[y] > minBandPixels;
      if (isDark && !inBand) {
        inBand = true;
        bandStartY = y;
      } else if (!isDark && inBand) {
        inBand = false;
        const bandH = y - bandStartY;
        if (bandH >= 6 && bandH <= 80) {
          // Scan for X boundaries within this band
          let minX = w;
          let maxX = 0;
          for (let by = bandStartY; by < y; by += 2) {
            for (let bx = 0; bx < w; bx += 4) {
              const idx = (by * w + bx) * 4;
              const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
              if (brightness < 180) {
                if (bx < minX) minX = bx;
                if (bx > maxX) maxX = bx;
              }
            }
          }

          if (maxX - minX > 20) {
            const x1 = Math.max(0, Math.min(PAGE_W, Math.round(minX * scaleX)));
            const y1 = Math.max(0, Math.min(pageH, Math.round(bandStartY * scaleY)));
            const x2 = Math.max(0, Math.min(PAGE_W, Math.round(maxX * scaleX)));
            const y2 = Math.max(0, Math.min(pageH, Math.round(y * scaleY)));

            spans.push({
              text: `Scanned Region (${x1}, ${y1})`,
              x1,
              y1,
              x2,
              y2,
              fontSize: Math.max(8, y2 - y1),
              page: pageNum,
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn("Pixel scanning error:", err);
  }

  return spans;
}

/**
 * Scans a rendered canvas image for text content and bounding box coordinates.
 * Uses Tesseract OCR if available, with a fast client-side pixel line scanner as fallback.
 */
export async function scanCanvasPageForSpans(
  canvas: HTMLCanvasElement,
  pageNum: number,
  pageH: number
): Promise<TextSpan[]> {
  const spans: TextSpan[] = [];

  // Method 1: Tesseract OCR (if loaded in window)
  const win = typeof window !== "undefined" ? (window as unknown as { Tesseract?: { recognize: (img: HTMLCanvasElement, lang: string) => Promise<{ data: { lines: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> } }> } }) : null;
  if (win && win.Tesseract) {
    try {
      const res = await win.Tesseract.recognize(canvas, "eng");
      const scaleX = PAGE_W / canvas.width;
      const scaleY = pageH / canvas.height;

      for (const line of res.data.lines) {
        if (!line.text || !line.text.trim()) continue;
        const x1 = Math.max(0, Math.min(PAGE_W, Math.round(line.bbox.x0 * scaleX)));
        const y1 = Math.max(0, Math.min(pageH, Math.round(line.bbox.y0 * scaleY)));
        const x2 = Math.max(0, Math.min(PAGE_W, Math.round(line.bbox.x1 * scaleX)));
        const y2 = Math.max(0, Math.min(pageH, Math.round(line.bbox.y1 * scaleY)));

        spans.push({
          text: line.text.trim(),
          x1,
          y1,
          x2,
          y2,
          fontSize: Math.max(8, y2 - y1),
          page: pageNum,
        });
      }

      if (spans.length > 0) return spans;
    } catch (err) {
      console.warn("OCR scanning error, falling back to pixel scanner:", err);
    }
  }

  // Method 2: Fallback to pixel scanner
  return scanCanvasPixelsForSpans(canvas, pageNum, pageH);
}


/**
 * Universal document loader:
 * 1st scans the document page for all text, words, and coordinates.
 * Then dynamically extracts information found on the document without any hardcoded templates.
 */
export async function loadDocument(file: File): Promise<DocLoadResult> {
  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    return loadPDFDocument(file);
  }

  const isImage =
    file.type.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name);

  if (isImage) {
    return loadImageDocument(file);
  }

  throw new Error("Unsupported file format. Please upload a PDF, PNG, JPG, or WebP document.");
}

/**
 * Loads and scans a PDF document:
 * Renders every page at 2x resolution normalized to 612 CSS pt width,
 * scans all text content and coordinates, and dynamically extracts all fields.
 */
async function loadPDFDocument(file: File): Promise<DocLoadResult> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/cmaps/",
    cMapPacked: true,
  }).promise;

  const pages: Page[] = [];
  const allSpans: TextSpan[] = [];
  let firstPageCanvas: HTMLCanvasElement | null = null;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const unscaledViewport = page.getViewport({ scale: 1 });
    const scale = PAGE_W / unscaledViewport.width;
    const baseViewport = page.getViewport({ scale });
    const pageH = Math.round((unscaledViewport.height / unscaledViewport.width) * PAGE_W);

    // Render at 2x resolution for retina sharpness
    const renderScale = scale * 2;
    const renderViewport = page.getViewport({ scale: renderScale });

    const canvas = document.createElement("canvas");
    canvas.width = renderViewport.width;
    canvas.height = renderViewport.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create rendering context for PDF page.");

    await page.render({
      canvasContext: ctx,
      viewport: renderViewport,
    }).promise;

    if (pageNum === 1) {
      firstPageCanvas = canvas;
    }

    pages.push({
      src: canvas.toDataURL("image/png"),
      width: PAGE_W,
      height: pageH,
      pageNumber: pageNum,
    });

    // Scan text content of the page directly from PDF layer
    try {
      const textContent = await page.getTextContent();
      for (const rawItem of textContent.items) {
        if (!("str" in rawItem)) continue;
        const str = rawItem.str;
        if (!str || !str.trim()) continue;

        const tx = rawItem.transform[4];
        const ty = rawItem.transform[5];
        const [vx, vy] = baseViewport.convertToViewportPoint(tx, ty);

        const fontSize = Math.max(8, Math.hypot(rawItem.transform[2], rawItem.transform[3]) * scale);
        const itemW = Math.max(6, rawItem.width * scale);
        const itemH = Math.max(fontSize, (rawItem.height || 10) * scale);

        const x1 = Math.max(0, Math.min(PAGE_W, Math.round(vx)));
        const y1 = Math.max(0, Math.min(pageH, Math.round(vy - itemH)));
        const x2 = Math.max(0, Math.min(PAGE_W, Math.round(vx + itemW)));
        const y2 = Math.max(0, Math.min(pageH, Math.round(vy + 2)));

        allSpans.push({
          text: str.trim(),
          x1,
          y1,
          x2,
          y2,
          fontSize,
          page: pageNum,
        });
      }
    } catch {
      // Scanned PDF without text stream
    }
  }

  // If the document has no embedded vector text (e.g. scanned image PDF), scan the rendered page canvas
  if (allSpans.length === 0 && firstPageCanvas) {
    const scanned = await scanCanvasPageForSpans(firstPageCanvas, 1, pages[0]?.height || 792);
    allSpans.push(...scanned);
  }

  // First scan the document, then dynamically extract all information found
  const extractedFields = analyzeDocumentSpans(allSpans, pages);

  return {
    pages,
    fields: sortFieldsByInvoiceOrder(extractedFields),
  };
}


/**
 * Intelligent invoice & e-way bill dynamic information extractor for vector PDFs with text layers.
 * Extracts fields dynamically based on actual document content, not hardcoded filenames.
 */
function analyzeDocumentSpans(spans: TextSpan[], pages: Page[]): Field[] {
  const fields: Field[] = [];
  const addedBBoxes: string[] = [];

  const addField = (
    fieldKey: string,
    label: string,
    val: string,
    pageNum: number,
    bbox: RawBBox,
    section: FieldSection,
    confidence = 0.98
  ) => {
    const cleanVal = val.trim();
    if (!cleanVal) return;

    const key = `${pageNum}-${bbox.join(",")}`;
    if (addedBBoxes.includes(key)) return;
    addedBBoxes.push(key);

    const pageH = pages[pageNum - 1]?.height || 792;
    fields.push({
      id: uid(),
      field: fieldKey,
      label,
      value: cleanVal,
      page: pageNum,
      bbox,
      normalizedBbox: normalizeBBox(bbox, pageH),
      status: "pending",
      confidence,
      section,
    });
  };

  const pageSpansMap = new Map<number, TextSpan[]>();
  spans.forEach((s) => {
    if (!pageSpansMap.has(s.page)) pageSpansMap.set(s.page, []);
    pageSpansMap.get(s.page)!.push(s);
  });

  pageSpansMap.forEach((pageSpans, pageNum) => {
    pageSpans.sort((a, b) => {
      const yDiff = a.y1 - b.y1;
      if (Math.abs(yDiff) > 5) return yDiff;
      return a.x1 - b.x1;
    });

    const lines: { text: string; spans: TextSpan[]; bbox: RawBBox; y: number }[] = [];
    pageSpans.forEach((span) => {
      const existingLine = lines.find(
        (l) => Math.abs(l.y - span.y1) <= 6 && (span.x1 - l.bbox[2]) >= -8 && (span.x1 - l.bbox[2]) <= 35
      );

      if (existingLine) {
        existingLine.text += (existingLine.text.endsWith(" ") ? "" : " ") + span.text;
        existingLine.spans.push(span);
        existingLine.bbox[0] = Math.min(existingLine.bbox[0], span.x1);
        existingLine.bbox[1] = Math.min(existingLine.bbox[1], span.y1);
        existingLine.bbox[2] = Math.max(existingLine.bbox[2], span.x2);
        existingLine.bbox[3] = Math.max(existingLine.bbox[3], span.y2);
      } else {
        lines.push({
          text: span.text,
          spans: [span],
          bbox: [span.x1, span.y1, span.x2, span.y2],
          y: span.y1,
        });
      }
    });

    const findValueNear = (
      labelLineIdx: number,
      labelPattern: RegExp
    ): { val: string; bbox: RawBBox } | null => {
      const line = lines[labelLineIdx];
      const inlineMatch = line.text.split(labelPattern)[1];
      if (inlineMatch && inlineMatch.replace(/[:.-]/g, "").trim().length > 0) {
        const clean = inlineMatch.replace(/^[:.-]\s*/, "").trim();
        const valSpans = line.spans.filter((s) => clean.includes(s.text) || s.text.includes(clean));
        const bbox: RawBBox = valSpans.length > 0
          ? [
              Math.min(...valSpans.map((s) => s.x1)),
              Math.min(...valSpans.map((s) => s.y1)),
              Math.max(...valSpans.map((s) => s.x2)),
              Math.max(...valSpans.map((s) => s.y2)),
            ]
          : [line.spans[line.spans.length - 1].x1, line.bbox[1], line.bbox[2], line.bbox[3]];
        return { val: clean, bbox };
      }

      // Check next few lines (vertical layout)
      for (let j = labelLineIdx + 1; j < Math.min(lines.length, labelLineIdx + 4); j++) {
        const next = lines[j];
        const yDist = next.bbox[1] - line.bbox[3];
        const xOverlap =
          Math.abs(next.bbox[0] - line.bbox[0]) < 120 ||
          (next.bbox[0] >= line.bbox[0] && next.bbox[0] <= line.bbox[2] + 40);
        if (yDist >= 0 && yDist <= 35 && xOverlap && next.text.trim()) {
          return { val: next.text.trim(), bbox: next.bbox };
        }
      }

      // Check right column (horizontal layout on same Y line)
      const sameYLines = lines.filter(
        (other, idx) => idx !== labelLineIdx && Math.abs(other.y - line.y) <= 8 && other.bbox[0] > line.bbox[2]
      );
      if (sameYLines.length > 0) {
        sameYLines.sort((a, b) => a.bbox[0] - b.bbox[0]);
        const nearest = sameYLines[0];
        if (nearest.bbox[0] - line.bbox[2] < 180 && nearest.text.trim()) {
          return { val: nearest.text.trim(), bbox: nearest.bbox };
        }
      }

      return null;
    };

    // Check if this document is an e-Way Bill
    const isEway = pageSpans.some((s) => /e-?way\s*bill/i.test(s.text));

    if (isEway) {
      // -------------------------------------------------------------
      // DYNAMIC E-WAY BILL EXTRACTION
      // -------------------------------------------------------------
      for (let i = 0; i < lines.length; i++) {
        const txt = lines[i].text;
        if (/e-?way\s*bill\s*no/i.test(txt)) {
          const found = findValueNear(i, /e-?way\s*bill\s*no\.?[\s:]*/i);
          if (found) addField("eway_bill_no", "e-Way Bill No.", found.val, pageNum, found.bbox, "header", 0.99);
        }
        if (/generated\s*date/i.test(txt)) {
          const found = findValueNear(i, /generated\s*date[\s:]*/i);
          if (found) addField("generated_date", "Generated Date", found.val, pageNum, found.bbox, "header", 0.99);
        }
        if (/generated\s*by/i.test(txt)) {
          const found = findValueNear(i, /generated\s*by[\s:]*/i);
          if (found) addField("generated_by", "Generated By", found.val, pageNum, found.bbox, "header", 0.98);
        }
        if (/valid\s*from/i.test(txt)) {
          const found = findValueNear(i, /valid\s*from[\s:]*/i);
          if (found) addField("valid_from", "Valid From", found.val, pageNum, found.bbox, "header", 0.98);
        }
        if (/valid\s*until/i.test(txt)) {
          const found = findValueNear(i, /valid\s*until[\s:]*/i);
          if (found) addField("valid_until", "Valid Until", found.val, pageNum, found.bbox, "header", 0.98);
        }
        if (/gstin\s*of\s*supplier/i.test(txt)) {
          const found = findValueNear(i, /gstin\s*of\s*supplier[\s:]*/i);
          if (found) addField("supplier_gstin", "GSTIN of Supplier", found.val, pageNum, found.bbox, "parties", 0.99);
        }
        if (/place\s*of\s*dispatch/i.test(txt)) {
          const found = findValueNear(i, /place\s*of\s*dispatch[\s:]*/i);
          if (found) addField("dispatch_place", "Place of Dispatch", found.val, pageNum, found.bbox, "parties", 0.97);
        }
        if (/gstin\s*of\s*recipient/i.test(txt)) {
          const found = findValueNear(i, /gstin\s*of\s*recipient[\s:]*/i);
          if (found) addField("recipient_gstin", "GSTIN of Recipient", found.val, pageNum, found.bbox, "parties", 0.99);
        }
        if (/place\s*of\s*delivery/i.test(txt)) {
          const found = findValueNear(i, /place\s*of\s*delivery[\s:]*/i);
          if (found) addField("delivery_place", "Place of Delivery", found.val, pageNum, found.bbox, "parties", 0.97);
        }
        if (/(?:doc(?:ument)?\.?\s*no\.?)/i.test(txt) && !/transporter/i.test(txt)) {
          const found = findValueNear(i, /(?:doc(?:ument)?\.?\s*no\.?)[\s:]*/i);
          if (found) addField("invoicenumber", "Document No. (Invoice)", found.val, pageNum, found.bbox, "header", 0.99);
        }
        if (/(?:doc(?:ument)?\.?\s*date)/i.test(txt) && !/transporter/i.test(txt)) {
          const found = findValueNear(i, /(?:doc(?:ument)?\.?\s*date)[\s:]*/i);
          if (found) addField("date", "Document Date", found.val, pageNum, found.bbox, "header", 0.98);
        }
        if (/transaction\s*type/i.test(txt)) {
          const found = findValueNear(i, /transaction\s*type[\s:]*/i);
          if (found) addField("transaction_type", "Transaction Type", found.val, pageNum, found.bbox, "header", 0.95);
        }
        if (/value\s*of\s*goods/i.test(txt)) {
          const found = findValueNear(i, /value\s*of\s*goods[\s:]*/i);
          if (found) addField("taxable_value", "Value of Goods", found.val, pageNum, found.bbox, "totals", 0.98);
        }
        if (/hsn\s*code/i.test(txt)) {
          const found = findValueNear(i, /hsn\s*code[\s:]*/i);
          if (found) addField("hsn_code", "HSN Code", found.val, pageNum, found.bbox, "line_items", 0.97);
        }
        if (/reason\s*for\s*transportation/i.test(txt)) {
          const found = findValueNear(i, /reason\s*for\s*transportation[\s:]*/i);
          if (found) addField("transport_reason", "Reason for Transportation", found.val, pageNum, found.bbox, "custom", 0.96);
        }
        if (/vehicle\s*no/i.test(txt)) {
          const found = findValueNear(i, /vehicle\s*no\.?[\s:]*/i);
          if (found) addField("vehicle_no", "Vehicle No.", found.val, pageNum, found.bbox, "custom", 0.99);
        }
        if (/total\s*invoice\s*value/i.test(txt)) {
          const found = findValueNear(i, /total\s*invoice\s*value[\s:]*/i);
          if (found) addField("totalamount", "Total Invoice Value", found.val, pageNum, found.bbox, "totals", 0.99);
        }
      }
    } else {
      // -------------------------------------------------------------
      // STANDARD INVOICE DYNAMIC EXTRACTION
      // -------------------------------------------------------------
      if (pageNum === 1) {
        const headerCandidate = lines.find(
          (l) => l.bbox[1] < 120 && l.text.length > 5 && !/(?:tax\s*invoice|original|duplicate|gst|invoice\s*no)/i.test(l.text)
        );
        if (headerCandidate) {
          addField("vendor_name", "Vendor / Supplier Name", headerCandidate.text, pageNum, headerCandidate.bbox, "parties", 0.99);
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/(?:invoice\s*no\.?|inv\s*no\.?|bill\s*no\.?|invoice\s*#)/i.test(l.text)) {
          const found = findValueNear(i, /(?:invoice\s*no\.?|inv\s*no\.?|bill\s*no\.?|invoice\s*#)[\s:]*/i);
          if (found) {
            addField("invoicenumber", "Invoice Number", found.val, pageNum, found.bbox, "header", 0.99);
          }
          break;
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/(?:dated|invoice\s*date|date[\s:]*$)/i.test(l.text)) {
          const found = findValueNear(i, /(?:dated|invoice\s*date|date)[\s:]*/i);
          if (found) {
            addField("date", "Invoice Date", found.val, pageNum, found.bbox, "header", 0.98);
          }
          break;
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/due\s*date/i.test(l.text)) {
          const found = findValueNear(i, /due\s*date[\s:]*/i);
          if (found) {
            addField("due_date", "Due Date", found.val, pageNum, found.bbox, "header", 0.96);
          }
          break;
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/consignee|ship\s*to/i.test(l.text)) {
          const found = findValueNear(i, /(?:consignee\s*(?:\([^)]*\))?|ship\s*to)[\s:]*/i);
          if (found) {
            addField("consignee_name", "Consignee (Ship to)", found.val, pageNum, found.bbox, "parties", 0.96);
          }
        }
        if (/buyer|bill\s*to/i.test(l.text)) {
          const found = findValueNear(i, /(?:buyer\s*(?:\([^)]*\))?|bill\s*to)[\s:]*/i);
          if (found) {
            addField("customer_name", "Buyer (Bill to)", found.val, pageNum, found.bbox, "parties", 0.97);
          }
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const gstMatch = l.text.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z0-9]{3}\b/);
        if (gstMatch) {
          const label = l.bbox[1] < 180 ? "Vendor GSTIN" : "Buyer GSTIN";
          const key = l.bbox[1] < 180 ? "vendor_gstin" : "buyer_gstin";
          addField(key, label, gstMatch[0], pageNum, l.bbox, "parties", 0.98);
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/state\s*name|place\s*of\s*supply/i.test(l.text)) {
          const val = l.text.replace(/^.*?(?:state\s*name|place\s*of\s*supply)[\s:]*/i, "").trim();
          if (val) {
            const key = /place\s*of\s*supply/i.test(l.text) ? "place_of_supply" : "state_name";
            addField(key, "State / Place of Supply", val, pageNum, l.bbox, "parties", 0.92);
          }
        }
      }

      let itemCount = 0;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const isItemRow =
          l.bbox[1] > 200 &&
          l.bbox[1] < 620 &&
          /^[0-9]\s+[A-Za-z]|(?:UPVC|WINDOW|DOOR|CLUSTER|SLA|SERVICE|ITEM|PANEL|GLASS)/i.test(l.text) &&
          !/(?:cgst|sgst|round\s*off|total|taxable|amount\s*chargeable)/i.test(l.text);

        if (isItemRow && itemCount < 8) {
          itemCount++;
          const rowSpans = pageSpans.filter((s) => Math.abs(s.y1 - l.bbox[1]) <= 10);
          const amountSpan = rowSpans.find((s) => s.x1 > 400 && /[0-9,]+\.[0-9]{2}/.test(s.text));

          const itemLabel = `Item ${itemCount}`;
          const itemVal = amountSpan ? `${l.text} — ₹${amountSpan.text}` : l.text;
          const bbox: RawBBox = amountSpan
            ? [Math.min(l.bbox[0], amountSpan.x1), Math.min(l.bbox[1], amountSpan.y1), Math.max(l.bbox[2], amountSpan.x2), Math.max(l.bbox[3], amountSpan.y2)]
            : l.bbox;

          addField(`item_${itemCount}`, itemLabel, itemVal, pageNum, bbox, "line_items", 0.95);
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/cgst/i.test(l.text)) {
          const amountMatch = l.text.match(/[0-9,]+\.[0-9]{2}/);
          const val = amountMatch ? amountMatch[0] : l.text;
          addField("cgst_amount", "CGST Tax", val, pageNum, l.bbox, "totals", 0.98);
        }
        if (/sgst/i.test(l.text)) {
          const amountMatch = l.text.match(/[0-9,]+\.[0-9]{2}/);
          const val = amountMatch ? amountMatch[0] : l.text;
          addField("sgst_amount", "SGST Tax", val, pageNum, l.bbox, "totals", 0.98);
        }
        if (/round\s*off/i.test(l.text)) {
          const amountMatch = l.text.match(/[0-9,]+\.[0-9]{2}/);
          const val = amountMatch ? amountMatch[0] : l.text;
          addField("round_off", "Round Off", val, pageNum, l.bbox, "totals", 0.95);
        }
      }

      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i];
        if (
          /(?:total\s*amount|grand\s*total|net\s*payable|^total\b)/i.test(l.text) &&
          !/taxable|in\s*words/i.test(l.text)
        ) {
          const amtMatch = l.text.match(/[0-9,]{3,}\.[0-9]{2}/);
          const totalVal = amtMatch ? amtMatch[0] : l.text.replace(/^total\s*/i, "");
          addField("totalamount", "Total Amount Due", totalVal || l.text, pageNum, l.bbox, "totals", 0.99);
          break;
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/(?:in\s*words|amount\s*chargeable|inr|rupees)\b.*(?:only)/i.test(l.text) || /^[A-Z\s]+only$/i.test(l.text)) {
          const val = l.text.replace(/^.*?(?:in\s*words|amount\s*chargeable\s*(?:\([^)]*\))?)[\s:]*/i, "").trim();
          addField("amount_in_words", "Amount in Words", val || l.text, pageNum, l.bbox, "totals", 0.95);
          break;
        }
      }
    }

    // -------------------------------------------------------------
    // GENERAL DYNAMIC KEY-VALUE DISCOVERY FOR ALL INVOICES/DOCS
    // -------------------------------------------------------------
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const kvMatch = line.text.match(/^([A-Za-z][A-Za-z0-9\s/()._-]{2,28})\s*[:=-]\s*(.{2,80})$/);
      if (kvMatch) {
        const rawKey = kvMatch[1].trim();
        const rawVal = kvMatch[2].trim();
        const fieldKey = rawKey.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30);
        if (!fields.some((f) => f.field === fieldKey) && !/(?:page|original|copy|part\s*[ab]|table)/i.test(rawKey)) {
          const valSpans = line.spans.filter((s) => rawVal.includes(s.text));
          const bbox: RawBBox = valSpans.length > 0
            ? [
                Math.min(...valSpans.map((s) => s.x1)),
                Math.min(...valSpans.map((s) => s.y1)),
                Math.max(...valSpans.map((s) => s.x2)),
                Math.max(...valSpans.map((s) => s.y2)),
              ]
            : line.bbox;
          addField(fieldKey, rawKey, rawVal, pageNum, bbox, "custom", 0.94);
        }
      }
    }
  });

  return fields;
}

/**
 * Image loader with dynamic scanning
 */
async function loadImageDocument(file: File): Promise<DocLoadResult> {
  const url = URL.createObjectURL(file);
  const img = new Image();

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to decode image file."));
    img.src = url;
  });

  const baseW = img.naturalWidth || 612;
  const baseH = img.naturalHeight || 792;
  const heightIn612Space = Math.round((baseH / baseW) * PAGE_W);

  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W * 2;
  canvas.height = heightIn612Space * 2;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not initialize canvas context for image.");

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);

  const page: Page = {
    src: canvas.toDataURL("image/png"),
    width: PAGE_W,
    height: heightIn612Space,
    pageNumber: 1,
  };

  // Scan the image canvas for text and coordinates
  const spans = await scanCanvasPageForSpans(canvas, 1, heightIn612Space);
  const fields = analyzeDocumentSpans(spans, [page]);

  return {
    pages: [page],
    fields: sortFieldsByInvoiceOrder(fields),
  };
}

/**
 * Generates the 2-page sample enterprise invoice with matching fields
 */
export function generateSampleInvoice(): DocLoadResult {
  const p1 = createPage1Canvas();
  const p2 = createPage2Canvas();

  const pages: Page[] = [
    {
      src: p1.toDataURL("image/png"),
      width: PAGE_W,
      height: 792,
      pageNumber: 1,
    },
    {
      src: p2.toDataURL("image/png"),
      width: PAGE_W,
      height: 792,
      pageNumber: 2,
    },
  ];

  const fields: Field[] = MOCK_FIELDS_DEF.map((m) => {
    const pageH = m.page === 2 ? 792 : 792;
    return {
      id: uid(),
      field: m.field,
      label: m.label,
      value: m.value,
      page: m.page,
      bbox: m.bbox,
      normalizedBbox: normalizeBBox(m.bbox, pageH),
      status: "pending",
      confidence: 0.99,
      section: m.section,
    };
  });

  return {
    pages,
    fields: sortFieldsByInvoiceOrder(fields),
  };
}

function createPage1Canvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = PAGE_W * 2;
  c.height = 792 * 2;
  const ctx = c.getContext("2d")!;
  ctx.scale(2, 2);

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_W, 792);

  // Header band
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(40, 40, PAGE_W - 80, 4);

  // Company Logo / Title
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 20px Inter, -apple-system, sans-serif";
  ctx.fillText("APEX CLOUD SOLUTIONS", 40, 70);

  ctx.fillStyle = "#64748b";
  ctx.font = "10px Inter, sans-serif";
  ctx.fillText("Enterprise Infrastructure & Managed Cloud SLA", 40, 84);

  // Commercial Tax Invoice Header
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 11px Inter, sans-serif";
  ctx.fillText("COMMERCIAL TAX INVOICE", 380, 70);

  // Metadata Box (Invoice No & Date)
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.strokeRect(120, 100, 140, 24);
  ctx.strokeRect(380, 100, 140, 24);
  ctx.strokeRect(120, 132, 140, 24);

  ctx.fillStyle = "#64748b";
  ctx.font = "9px Inter, sans-serif";
  ctx.fillText("INVOICE NUMBER", 120, 96);
  ctx.fillText("INVOICE DATE", 380, 96);
  ctx.fillText("PURCHASE ORDER", 120, 128);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 11px Inter, monospace";
  ctx.fillText("INV-2041", 128, 116);
  ctx.fillText("2026-09-14", 388, 116);
  ctx.fillText("PO-99124", 128, 148);

  // Vendor & Client Cards
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(40, 175, 240, 85);
  ctx.fillRect(332, 175, 240, 85);
  ctx.strokeStyle = "#e2e8f0";
  ctx.strokeRect(40, 175, 240, 85);
  ctx.strokeRect(332, 175, 240, 85);

  ctx.fillStyle = "#2563eb";
  ctx.font = "bold 9px Inter, sans-serif";
  ctx.fillText("ISSUED BY / VENDOR", 50, 190);
  ctx.fillText("BILL TO / RECIPIENT", 342, 190);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 11px Inter, sans-serif";
  ctx.fillText("Apex Cloud Solutions Inc.", 50, 206);
  ctx.fillText("Global Tech Innovations Ltd", 342, 206);

  ctx.fillStyle = "#475569";
  ctx.font = "10px Inter, sans-serif";
  ctx.fillText("500 Montgomery St, Suite 400", 50, 222);
  ctx.fillText("San Francisco, CA 94111", 50, 236);
  ctx.fillText("Tax ID: US-EIN-94-2849102", 50, 250);

  ctx.fillText("100 Innovation Way, Suite 800", 342, 222);
  ctx.fillText("Austin, TX 78701", 342, 236);
  ctx.fillText("Tax ID: US-EIN-74-9102938", 342, 250);

  // Line items table header
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(40, 280, PAGE_W - 80, 26);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 9px Inter, sans-serif";
  ctx.fillText("ITEM DESCRIPTION", 50, 296);
  ctx.fillText("QTY", 320, 296);
  ctx.fillText("UNIT PRICE", 390, 296);
  ctx.fillText("AMOUNT (USD)", 480, 296);

  // Items
  const items = [
    { desc: "Dedicated High-Availability Cloud Cluster (Tier 4)", qty: "1 SLA", rate: "28,500.00", amt: "28,500.00", y: 322 },
    { desc: "Kubernetes Enterprise Managed Controller SLA", qty: "4 nodes", rate: "2,200.00", amt: "8,800.00", y: 346 },
    { desc: "Zero-Trust Security & Compliance Suite Tier-1", qty: "1 yr license", rate: "4,600.00", amt: "4,600.00", y: 370 },
    { desc: "Custom 24/7 SRE Dedicated Support Retainer", qty: "1 mo", rate: "2,850.00", amt: "2,850.00", y: 394 },
  ];

  ctx.font = "10px Inter, sans-serif";
  items.forEach((it, idx) => {
    ctx.fillStyle = idx % 2 === 0 ? "#ffffff" : "#f8fafc";
    ctx.fillRect(40, it.y - 14, PAGE_W - 80, 22);

    ctx.fillStyle = "#0f172a";
    ctx.fillText(it.desc, 50, it.y);
    ctx.fillText(it.qty, 320, it.y);
    ctx.fillText(it.rate, 390, it.y);
    ctx.font = "bold 10px Inter, monospace";
    ctx.fillText(it.amt, 480, it.y);
    ctx.font = "10px Inter, sans-serif";

    ctx.strokeStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.moveTo(40, it.y + 8);
    ctx.lineTo(PAGE_W - 40, it.y + 8);
    ctx.stroke();
  });

  // Summary Table
  const totals = [
    { label: "SUBTOTAL", val: "44,750.00", y: 440 },
    { label: "STATE TAX (8.25%)", val: "3,691.88", y: 460 },
    { label: "ENTERPRISE DISCOUNT", val: "-191.88", y: 480 },
    { label: "TOTAL BALANCE DUE", val: "48,250.00", y: 505, bold: true },
  ];

  totals.forEach((t) => {
    ctx.fillStyle = t.bold ? "#0f172a" : "#64748b";
    ctx.font = t.bold ? "bold 11px Inter, sans-serif" : "9px Inter, sans-serif";
    ctx.fillText(t.label, 360, t.y);

    ctx.fillStyle = t.bold ? "#2563eb" : "#0f172a";
    ctx.font = t.bold ? "bold 13px Inter, monospace" : "10px Inter, monospace";
    ctx.fillText(t.val, 480, t.y);
  });

  // Footer notes
  ctx.strokeStyle = "#e2e8f0";
  ctx.strokeRect(40, 540, PAGE_W - 80, 50);
  ctx.fillStyle = "#64748b";
  ctx.font = "9px Inter, sans-serif";
  ctx.fillText("TERMS & CONDITIONS", 50, 555);
  ctx.fillStyle = "#0f172a";
  ctx.fillText("Payment is due within 30 days of invoice issuance. Interest applies to past-due accounts.", 50, 570);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "9px Inter, sans-serif";
  ctx.fillText("Page 1 of 2 • Apex Cloud Solutions • System Generated Invoice", 40, 770);

  return c;
}

function createPage2Canvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = PAGE_W * 2;
  c.height = 792 * 2;
  const ctx = c.getContext("2d")!;
  ctx.scale(2, 2);

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_W, 792);

  // Top header banner
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(40, 40, PAGE_W - 80, 4);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 16px Inter, sans-serif";
  ctx.fillText("APEX CLOUD SOLUTIONS — REMITTANCE & BANK DETAILS", 40, 70);

  ctx.fillStyle = "#64748b";
  ctx.font = "10px Inter, sans-serif";
  ctx.fillText("Invoice Reference: INV-2041 • Customer Account: ACC-81029", 40, 86);

  // Wire Transfer Remittance Card
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(40, 110, PAGE_W - 80, 130);
  ctx.strokeStyle = "#cbd5e1";
  ctx.strokeRect(40, 110, PAGE_W - 80, 130);

  ctx.fillStyle = "#2563eb";
  ctx.font = "bold 10px Inter, sans-serif";
  ctx.fillText("ELECTRONIC FUNDS TRANSFER (ACH / WIRE)", 55, 130);

  const bankRows = [
    { label: "Beneficiary Name:", val: "Apex Cloud Solutions Inc.", y: 150 },
    { label: "Bank Name:", val: "Silicon Valley Federal Bank, N.A.", y: 168 },
    { label: "Account Number:", val: "9481029384", y: 186 },
    { label: "Routing (ABA):", val: "121000358", y: 204 },
    { label: "SWIFT / BIC Code:", val: "SVFBUS6S", y: 222 },
  ];

  bankRows.forEach((r) => {
    ctx.fillStyle = "#64748b";
    ctx.font = "10px Inter, sans-serif";
    ctx.fillText(r.label, 55, r.y);

    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 10px Inter, monospace";
    ctx.fillText(r.val, 220, r.y);
  });

  // International IBAN Remittance
  ctx.fillStyle = "#ffffff";
  ctx.strokeRect(40, 260, PAGE_W - 80, 75);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 10px Inter, sans-serif";
  ctx.fillText("INTERNATIONAL REMITTANCE (EUR / GBP)", 55, 280);

  ctx.fillStyle = "#64748b";
  ctx.font = "10px Inter, sans-serif";
  ctx.fillText("IBAN Code:", 55, 300);
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 10px Inter, monospace";
  ctx.fillText("US33SVFB1210003589481029384", 220, 300);

  ctx.fillStyle = "#64748b";
  ctx.font = "10px Inter, sans-serif";
  ctx.fillText("Payment Reference:", 55, 320);
  ctx.fillStyle = "#2563eb";
  ctx.font = "bold 10px Inter, monospace";
  ctx.fillText("INV-2041-APEX", 220, 320);

  // Authorized signature section
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(40, 360, PAGE_W - 80, 110);
  ctx.strokeStyle = "#e2e8f0";
  ctx.strokeRect(40, 360, PAGE_W - 80, 110);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 10px Inter, sans-serif";
  ctx.fillText("AUTHORIZED AUDIT APPROVAL", 55, 380);

  ctx.fillStyle = "#64748b";
  ctx.font = "10px Inter, sans-serif";
  ctx.fillText("Signed by:", 55, 405);
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 10px Inter, sans-serif";
  ctx.fillText("Marcus Vance, VP Finance & Global Controller", 180, 405);

  ctx.fillStyle = "#64748b";
  ctx.fillText("Approval Date:", 55, 425);
  ctx.fillStyle = "#0f172a";
  ctx.font = "10px Inter, monospace";
  ctx.fillText("2026-09-14", 180, 425);

  ctx.fillStyle = "#64748b";
  ctx.fillText("Verification Hash:", 55, 445);
  ctx.fillStyle = "#059669";
  ctx.font = "9px Inter, monospace";
  ctx.fillText("SHA256: 7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069", 180, 445);

  // Footer note
  ctx.fillStyle = "#94a3b8";
  ctx.font = "9px Inter, sans-serif";
  ctx.fillText("Page 2 of 2 • Remittance Advice • Please retain for your company tax records", 40, 770);

  return c;
}
