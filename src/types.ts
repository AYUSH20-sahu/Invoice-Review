export type RawBBox = [number, number, number, number]; // [x1, y1, x2, y2] in 612px-wide page space
export type NormalizedBBox = [number, number, number, number]; // [x1, y1, x2, y2] normalized 0-1 per page

export type FieldStatus = "pending" | "approved" | "edited";

export type FieldSection = "header" | "parties" | "line_items" | "totals" | "remittance" | "custom";

export interface Field {
  id: string;
  field: string;
  label?: string;
  value: string;
  page: number; // 1-indexed
  bbox: RawBBox; // in 612px page space
  normalizedBbox: NormalizedBBox; // normalized 0-1
  status: FieldStatus;
  confidence?: number; // 0 - 1 OCR confidence score
  section?: FieldSection;
}

export interface LogEntry {
  id: string;
  kind: "edit" | "approve" | "add" | "delete" | "rename" | "batch_approve";
  field: string;
  oldValue: string;
  newValue: string;
  at: string; // ISO string
}

export interface Page {
  src: string;
  width: number; // 612 CSS px
  height: number; // in 612-base space (e.g. 792 for standard letter)
  pageNumber: number;
}

export interface DocLoadResult {
  pages: Page[];
  fields: Field[];
}

export const PAGE_W = 612; // Standard PDF point width

/**
 * Normalizes a raw 612px bbox to 0-1 coordinate space
 */
export function normalizeBBox(bbox: RawBBox, pageHeight: number): NormalizedBBox {
  const [x1, y1, x2, y2] = bbox;
  return [
    Math.max(0, Math.min(1, x1 / PAGE_W)),
    Math.max(0, Math.min(1, y1 / pageHeight)),
    Math.max(0, Math.min(1, x2 / PAGE_W)),
    Math.max(0, Math.min(1, y2 / pageHeight)),
  ];
}

/**
 * Converts a normalized 0-1 bbox back to 612px-wide page space
 */
export function denormalizeBBox(norm: NormalizedBBox, pageHeight: number): RawBBox {
  const [nx1, ny1, nx2, ny2] = norm;
  return [
    Math.round(nx1 * PAGE_W),
    Math.round(ny1 * pageHeight),
    Math.round(nx2 * PAGE_W),
    Math.round(ny2 * pageHeight),
  ];
}

/**
 * Sorts fields by natural document reading order (as they physically appear on the invoice):
 * Page ascending -> Y1 (top to bottom) -> X1 (left to right)
 */
export function sortFieldsByInvoiceOrder(fields: Field[]): Field[] {
  return [...fields].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    // Allow small 12px vertical alignment threshold so side-by-side fields stay together
    const yDiff = a.bbox[1] - b.bbox[1];
    if (Math.abs(yDiff) > 12) {
      return yDiff;
    }
    return a.bbox[0] - b.bbox[0];
  });
}

/**
 * Realistic fields sequenced in natural invoice reading order (top-to-bottom as they appear on the document).
 * Standard US Letter is 612 x 792 points.
 */
export const MOCK_FIELDS_DEF = [
  // ==========================================
  // PAGE 1: HEADER & DOCUMENT REFERENCE
  // ==========================================
  {
    field: "invoicenumber",
    label: "Invoice Number",
    value: "INV-2041",
    page: 1,
    bbox: [120, 80, 260, 104] as RawBBox,
    section: "header" as FieldSection,
    confidence: 0.99,
  },
  {
    field: "date",
    label: "Invoice Date",
    value: "2026-09-14",
    page: 1,
    bbox: [400, 80, 520, 104] as RawBBox,
    section: "header" as FieldSection,
    confidence: 0.98,
  },
  {
    field: "purchase_order",
    label: "Purchase Order",
    value: "PO-98124",
    page: 1,
    bbox: [120, 110, 240, 132] as RawBBox,
    section: "header" as FieldSection,
    confidence: 0.95,
  },
  {
    field: "due_date",
    label: "Due Date",
    value: "2026-10-14",
    page: 1,
    bbox: [400, 110, 520, 132] as RawBBox,
    section: "header" as FieldSection,
    confidence: 0.97,
  },

  // ==========================================
  // PAGE 1: PARTIES (VENDOR & CUSTOMER)
  // ==========================================
  {
    field: "vendor_name",
    label: "Vendor Name",
    value: "Apex Cloud Solutions Inc.",
    page: 1,
    bbox: [48, 140, 270, 164] as RawBBox,
    section: "parties" as FieldSection,
    confidence: 0.99,
  },
  {
    field: "customer_name",
    label: "Customer / Bill To",
    value: "Global Tech Innovations Ltd.",
    page: 1,
    bbox: [320, 140, 550, 164] as RawBBox,
    section: "parties" as FieldSection,
    confidence: 0.98,
  },
  {
    field: "vendor_tax_id",
    label: "Vendor Tax ID / EIN",
    value: "US-94-3829104",
    page: 1,
    bbox: [48, 170, 190, 190] as RawBBox,
    section: "parties" as FieldSection,
    confidence: 0.94,
  },
  {
    field: "customer_address",
    label: "Billing Address",
    value: "742 Evergreen Terrace, Suite 12, Springfield, OR 97477",
    page: 1,
    bbox: [320, 170, 560, 210] as RawBBox,
    section: "parties" as FieldSection,
    confidence: 0.93,
  },
  {
    field: "vendor_address",
    label: "Vendor Address",
    value: "100 Montgomery St, Suite 400, San Francisco, CA 94104",
    page: 1,
    bbox: [48, 195, 290, 230] as RawBBox,
    section: "parties" as FieldSection,
    confidence: 0.94,
  },

  // ==========================================
  // PAGE 1: LINE ITEMS TABLE
  // ==========================================
  {
    field: "item_1_description",
    label: "Item 1 Description",
    value: "Dedicated High-Availability Cloud Cluster (Tier-4)",
    page: 1,
    bbox: [48, 276, 310, 308] as RawBBox,
    section: "line_items" as FieldSection,
    confidence: 0.97,
  },
  {
    field: "item_1_amount",
    label: "Item 1 Total",
    value: "28,500.00",
    page: 1,
    bbox: [470, 276, 560, 308] as RawBBox,
    section: "line_items" as FieldSection,
    confidence: 0.98,
  },
  {
    field: "item_2_description",
    label: "Item 2 Description",
    value: "Managed Kubernetes Enterprise Cluster SLA",
    page: 1,
    bbox: [48, 308, 310, 340] as RawBBox,
    section: "line_items" as FieldSection,
    confidence: 0.96,
  },
  {
    field: "item_2_amount",
    label: "Item 2 Total",
    value: "9,600.00",
    page: 1,
    bbox: [470, 308, 560, 340] as RawBBox,
    section: "line_items" as FieldSection,
    confidence: 0.98,
  },
  {
    field: "item_3_description",
    label: "Item 3 Description",
    value: "Zero-Trust Security & Compliance Audit Log Suite",
    page: 1,
    bbox: [48, 340, 310, 372] as RawBBox,
    section: "line_items" as FieldSection,
    confidence: 0.95,
  },
  {
    field: "item_3_amount",
    label: "Item 3 Total",
    value: "4,166.05",
    page: 1,
    bbox: [470, 340, 560, 372] as RawBBox,
    section: "line_items" as FieldSection,
    confidence: 0.97,
  },
  {
    field: "item_4_description",
    label: "Item 4 Description",
    value: "Custom REST/gRPC API Microservice Gateway",
    page: 1,
    bbox: [48, 372, 310, 404] as RawBBox,
    section: "line_items" as FieldSection,
    confidence: 0.96,
  },
  {
    field: "item_4_amount",
    label: "Item 4 Total",
    value: "2,000.00",
    page: 1,
    bbox: [470, 372, 560, 404] as RawBBox,
    section: "line_items" as FieldSection,
    confidence: 0.98,
  },

  // ==========================================
  // PAGE 1: TOTALS & PAYMENT TERMS
  // ==========================================
  {
    field: "subtotal",
    label: "Subtotal",
    value: "44,266.05",
    page: 1,
    bbox: [400, 565, 520, 588] as RawBBox,
    section: "totals" as FieldSection,
    confidence: 0.99,
  },
  {
    field: "tax_amount",
    label: "Sales Tax (9.0%)",
    value: "3,983.95",
    page: 1,
    bbox: [400, 592, 520, 615] as RawBBox,
    section: "totals" as FieldSection,
    confidence: 0.98,
  },
  {
    field: "currency",
    label: "Currency",
    value: "USD",
    page: 1,
    bbox: [360, 620, 395, 645] as RawBBox,
    section: "totals" as FieldSection,
    confidence: 0.99,
  },
  {
    field: "totalamount",
    label: "Total Amount Due",
    value: "48,250.00",
    page: 1,
    bbox: [400, 620, 520, 645] as RawBBox,
    section: "totals" as FieldSection,
    confidence: 0.99,
  },
  {
    field: "payment_terms",
    label: "Payment Terms",
    value: "Net 30 Days",
    page: 1,
    bbox: [150, 670, 240, 692] as RawBBox,
    section: "totals" as FieldSection,
    confidence: 0.95,
  },

  // ==========================================
  // PAGE 2: REMITTANCE & BANK INSTRUCTIONS
  // ==========================================
  {
    field: "remittance_account",
    label: "Remittance Account",
    value: "ACH / Wire: 8840-2910-3841",
    page: 2,
    bbox: [64, 120, 310, 148] as RawBBox,
    section: "remittance" as FieldSection,
    confidence: 0.97,
  },
  {
    field: "beneficiary_bank",
    label: "Beneficiary Bank",
    value: "Silicon Valley Commercial Depository",
    page: 2,
    bbox: [64, 150, 340, 168] as RawBBox,
    section: "remittance" as FieldSection,
    confidence: 0.95,
  },
  {
    field: "routing_aba",
    label: "Routing / ABA",
    value: "121000358",
    page: 2,
    bbox: [140, 165, 230, 180] as RawBBox,
    section: "remittance" as FieldSection,
    confidence: 0.96,
  },
  {
    field: "swift_bic",
    label: "SWIFT / BIC",
    value: "SVCDUS6S",
    page: 2,
    bbox: [330, 165, 410, 180] as RawBBox,
    section: "remittance" as FieldSection,
    confidence: 0.98,
  },
  {
    field: "authorized_signer",
    label: "Authorized Signer",
    value: "Marcus Vance, VP Finance",
    page: 2,
    bbox: [365, 245, 550, 275] as RawBBox,
    section: "remittance" as FieldSection,
    confidence: 0.96,
  },
];

// Preserving original MOCK export for backwards compatibility
export const MOCK = [
  { field: "invoicenumber", value: "INV-2041", page: 1, bbox: [120, 80, 260, 100] as RawBBox },
  { field: "date", value: "2026-09-14", page: 1, bbox: [400, 80, 520, 100] as RawBBox },
  { field: "totalamount", value: "48,250.00", page: 1, bbox: [400, 620, 520, 645] as RawBBox },
] as const;
