from __future__ import annotations

from datetime import date
from pathlib import Path

from app.agents.base import AgentResult, ArtifactRef, Status, TaskSpec, WorkerAgent
from app.agents.schemas import ClassificationResult
from app.domain.coa import detect_unit_scale
from app.extensions import db
from app.llm_gateway import prompts
from app.llm_gateway.prompt_utils import embed_json
from app.models.document import DOC_TYPES, Document
from app.tools.parsers.csv_tool import sniff_csv_headers
from app.utils import storage


_PREVIEW_HEAD = 20
_PREVIEW_TAIL = 10
_VALID_SCALES = {1.0, 1e3, 1e5, 1e6, 1e7, 1e9}


def _head_tail_preview(lines: list[str], head: int = _PREVIEW_HEAD, tail: int = _PREVIEW_TAIL) -> str:
    """Metadata (company name, report title, unit notes) and closing notes/footnotes can
    both carry classification signal, and a real table's structure isn't visible from a
    handful of lines at the very top alone -- so this samples the start AND the end of the
    document rather than truncating to a fixed head. Small files are sent whole."""
    lines = [ln for ln in lines if ln.strip()]
    if len(lines) <= head + tail:
        return "\n".join(lines)
    omitted = len(lines) - head - tail
    return "\n".join(lines[:head]) + f"\n... [{omitted} lines omitted] ...\n" + "\n".join(lines[-tail:])


def fast_classify_document(
    filename: str,
    headers: list[str],
    text_excerpt: str,
) -> ClassificationResult | None:
    fn = filename.lower()
    tx = text_excerpt.lower()[:3000]
    hdr_lower = [str(h).lower() for h in headers]

    doc_type = None

    has_bs = any("balance sheet" in h for h in hdr_lower) or any(w in fn for w in ("balance_sheet", "balancesheet", "bs_")) or "balance sheet" in tx or "financial position" in tx or ("equity and liabilities" in tx and "assets" in tx)
    has_pl = any(any(k in h for k in ("profit and loss", "p&l", "income statement", "pnl")) for h in hdr_lower) or any(w in fn for w in ("pnl", "p&l", "profit_and_loss", "profit_loss", "income_statement")) or "profit and loss" in tx or "revenue from operations" in tx
    has_cf = any("cash flow" in h for h in hdr_lower) or any(w in fn for w in ("cash_flow", "cashflow", "cf_")) or "cash flow" in tx

    # 1. Bank statements
    if (any(w in fn for w in ("bank", "statement", "passbook", "stmt")) and not any(w in fn for w in ("financial", "pnl", "balance_sheet", "p&l", "annual"))) or \
       any(h in ("narration", "transaction details", "chq/ref no", "withdrawal", "deposit", "balance", "txn date") for h in hdr_lower) or \
       ("opening balance" in tx and "closing balance" in tx and any(w in tx for w in ("withdrawal", "deposit", "cheque", "neft", "rtgs", "upi"))):
        doc_type = "bank_statement"

    # 2. GST Returns
    elif "gstr" in fn or "gstr_3b" in fn or "gstr-3b" in tx or "gstr 3b" in tx:
        doc_type = "gstr_3b"
    elif "gstr_2b" in fn or "gstr-2b" in tx or "gstr 2b" in tx:
        doc_type = "gstr_2b"

    # 3. Trial Balance
    elif "trial_balance" in fn or "trial balance" in fn or "trial balance" in tx[:1000]:
        doc_type = "trial_balance"

    # 4. Multi-statement financial workbook or Balance Sheet (extracts BS, PL, and CF per-sheet)
    elif has_bs:
        doc_type = "balance_sheet"

    # 5. Profit & Loss / Income Statement
    elif has_pl:
        doc_type = "pnl"

    # 6. Cash Flow Statement
    elif has_cf:
        doc_type = "cash_flow"

    # 7. Financial workbook generic
    elif any(w in fn for w in ("financial", "annual_report", "accounts", "report")):
        doc_type = "balance_sheet"

    if not doc_type:
        return None

    # Detect unit scale (e.g. Crores, Lakhs, Thousands)
    unit_scale = detect_unit_scale(text_excerpt) or 1.0

    # Detect currency
    currency = "USD" if ("$" in text_excerpt and "₹" not in text_excerpt and "inr" not in tx and "rs" not in tx) else "INR"

    # Fast detect dates / periods
    period_start = None
    period_end = None
    import re
    MONTHS = {"jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
              "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
              "aug": 8, "august": 8, "sep": 9, "september": 9, "oct": 10, "october": 10,
              "nov": 11, "november": 11, "dec": 12, "december": 12}

    m_text_date = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})\b", text_excerpt)
    if m_text_date:
        d, m_name, y = m_text_date.groups()
        m_num = MONTHS.get(m_name.lower())
        if m_num:
            try:
                period_end = f"{int(y):04d}-{int(m_num):02d}-{int(d):02d}"
                period_start = f"{int(y)-1:04d}-04-01"
            except Exception:
                pass

    if not period_end:
        # Match dates like 31-03-2024 or 31/03/2024
        m_date = re.search(r"\b(\d{1,2})[-/.](0[1-9]|1[0-2]|\d{1,2})[-/.](20\d{2})\b", text_excerpt)
        if m_date:
            d, m, y = m_date.groups()
            try:
                period_end = f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
                period_start = f"{int(y)-1:04d}-04-01"
            except Exception:
                pass

    if not period_end:
        m_fy = re.search(r"\b(?:FY\s*)?(20\d{2})[-–/](\d{2,4})\b", text_excerpt + " " + filename)
        if m_fy:
            y1, y2 = m_fy.groups()
            end_yr = int(y2) if len(y2) == 4 else int(f"20{y2}")
            period_end = f"{end_yr}-03-31"
            period_start = f"{end_yr-1}-04-01"

    if not period_end:
        m_yr = re.search(r"\b(202[0-9]|201[5-9])\b", filename)
        if m_yr:
            end_yr = int(m_yr.group(1))
            period_end = f"{end_yr}-03-31"
            period_start = f"{end_yr-1}-04-01"

    return ClassificationResult(
        doc_type=doc_type,
        confidence=0.98,
        period_start=period_start,
        period_end=period_end,
        unit_scale=unit_scale,
        currency=currency,
    )


class IntakeAgent(WorkerAgent):
    name = "intake_classifier"
    allowed_tools = ["pdf.extract_text", "layout.fingerprint", "ocr.extract_text"]

    def execute(self, spec: TaskSpec) -> AgentResult:
        document_id = spec.params["document_id"]
        doc = Document.query.get(document_id)
        if doc is None:
            return AgentResult(task_id=spec.task_id, status=Status.FAILED, summary=f"Document {document_id} not found")

        ext = doc.original_filename.lower().rsplit(".", 1)[-1]
        abs_path = str(storage.resolve(doc.file_uri))
        text_excerpt = ""
        headers: list[str] = []

        try:
            if ext == "pdf":
                full_text = self.call_tool("pdf.extract_text", file_path=abs_path, max_pages=10)
                if len(full_text.strip()) < 20:
                    try:
                        full_text = self.call_tool("ocr.extract_text", file_path=abs_path, max_pages=3)
                    except Exception:
                        pass
                text_excerpt = _head_tail_preview(full_text.splitlines())
            elif ext in ("png", "jpg", "jpeg", "webp", "tiff", "tif", "bmp"):
                full_text = self.call_tool("ocr.extract_text", file_path=abs_path)
                text_excerpt = _head_tail_preview(full_text.splitlines())
            elif ext == "csv":
                headers = sniff_csv_headers(abs_path)
                # Header alone is often just column labels ("Line Item", period dates) with
                # no signal about statement type -- sampling real rows (start and end) gives
                # the classifier something to actually match against.
                lines = Path(abs_path).read_text(encoding="utf-8-sig", errors="replace").splitlines()
                text_excerpt = _head_tail_preview(lines)
            elif ext in ("xlsx", "xls"):
                import openpyxl

                wb = openpyxl.load_workbook(abs_path, read_only=True, data_only=True)
                headers = wb.sheetnames
                sheet_previews = []
                for ws in wb.worksheets:
                    sheet_lines = [
                        ", ".join(str(c) for c in row if c not in (None, ""))
                        for row in ws.iter_rows(max_row=15, values_only=True)
                    ]
                    sheet_previews.append(f"[Sheet: {ws.title}]\n" + _head_tail_preview(sheet_lines, head=15, tail=5))
                text_excerpt = "\n\n".join(sheet_previews)
                wb.close()
        except Exception as exc:  # parser failure -> classify as "other", let extraction fail loudly later
            text_excerpt = f"(could not read file for preview: {exc})"

        # Fast deterministic classification (<1ms) — avoids 20+ second LLM call for standard financial statements
        fast_result = fast_classify_document(doc.original_filename, headers, text_excerpt)
        if fast_result is not None:
            result = fast_result
        else:
            prompt = [
                {"role": "system", "content": prompts.INTAKE_CLASSIFIER},
                {"role": "user", "content": embed_json("ALLOWED_DOC_TYPES_JSON", list(DOC_TYPES)) + "\n"
                                             + f"Filename: {doc.original_filename}\nExcerpt:\n{text_excerpt[:8000]}"},
            ]
            # mask_pii=True: this prompt carries a raw excerpt of the uploaded document, unlike
            # most other agents' calls which only send our own structured JSON (see base.py).
            result: ClassificationResult = self.call_llm(prompt, schema=ClassificationResult, mask_pii=True)

        # A real LLM not shown the allowed values will happily invent a human-readable
        # string ("Profit and Loss Statement") instead of the enum code ("pnl") -- caught
        # against a live model. "other" still gets mapped (see _NEEDS_MAPPING), so this is
        # a safe fallback rather than silently accepting a value nothing else recognizes.
        doc.doc_type = result.doc_type if result.doc_type in DOC_TYPES else "other"
        # A unit stated in the document ('(₹ crore)', 'Rs. in lakhs', "INR '000") always wins:
        # models disagreed on the same workbook (one returned 1, another 10^7), so figures
        # differed by 10 million-fold between runs. The model's guess is used only when the
        # document states no unit, and only if it's a real scale.
        stated = detect_unit_scale(text_excerpt)
        llm_scale = float(result.unit_scale or 1)
        doc.unit_scale = stated if stated is not None else (llm_scale if llm_scale in _VALID_SCALES else 1.0)
        doc.currency = result.currency
        for attr, value in (("period_start", result.period_start), ("period_end", result.period_end)):
            if value:
                try:
                    setattr(doc, attr, date.fromisoformat(value))
                except ValueError:
                    pass
        if headers:
            doc.layout_id = self.call_tool("layout.fingerprint", labels=headers)
        doc.status = "classified"
        db.session.commit()

        return AgentResult(
            task_id=spec.task_id, status=Status.DONE,
            outputs=[ArtifactRef(id=doc.id, kind="raw_file", uri=doc.file_uri)],
            summary=f"Classified '{doc.original_filename}' as {result.doc_type} (confidence {result.confidence:.2f})",
            confidence=result.confidence,
        )
