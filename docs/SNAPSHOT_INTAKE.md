# Garment snapshot intake

The intake layer extracts documented facts for a small garment/knitwear
manufacturer and then builds the existing `simulation.contract.v1`
`BusinessSnapshot`. It does not generate engine events or simulation results.

## Flow

`POST /snapshot/draft` accepts `business_id`, `start_date`, `horizon_days`, and
`source_text`. When `reviewed_facts` is omitted, the configured extractor is
called:

```text
source_text -> Groq -> BusinessFacts -> review -> BusinessSnapshot -> simulation
```

Groq is selected through `SNAPSHOT_EXTRACTOR` and uses `GROQ_API_KEY` and
`GROQ_MODEL`. Secrets must be supplied through the environment or a local
`.env`; `.env` is ignored by Git. The response keeps extracted facts, exact
evidence excerpts, unresolved questions, validation issues, and a snapshot when
one is runnable.

For demos or environments without a provider, the same request accepts
`reviewed_facts`. This is an explicit manual path, not an automatic fallback:
the supplied facts still go through the same builder and domain validation.

Owners submit corrected reviewed facts with `PATCH /snapshot/draft/{draft_id}`.
This retains the original source text, increments the version, marks corrected
facts as user-provided input, and invalidates approval. The owner then submits
the exact draft version and `approval: "APPROVE"` to `POST /snapshot/approve`.
The approved snapshot can be sent unchanged to `/simulation/run`.

## Endpoints

### `POST /snapshot/draft`

AI-backed request:

```json
{
  "business_id": "meera-knitwear",
  "start_date": "2026-01-01",
  "horizon_days": 90,
  "source_text": "Meera Knitwear has INR 50,000 cash. ..."
}
```

Manual/reviewed request:

```json
{
  "business_id": "meera-knitwear",
  "start_date": "2026-01-01",
  "horizon_days": 90,
  "source_text": "Cash in hand is INR 50,000",
  "reviewed_facts": {
    "business_name": "Meera Knitwear",
    "opening_cash": {
      "amount": "50000",
      "currency": "INR",
      "unit": "rupees"
    },
    "opening_inventory": [],
    "inventory_status": "CONFIRMED_COMPLETE",
    "supplier_purchases": [],
    "supplier_purchases_status": "CONFIRMED_COMPLETE",
    "customer_orders": [],
    "customer_orders_status": "CONFIRMED_COMPLETE",
    "existing_receivables": [],
    "existing_receivables_status": "CONFIRMED_COMPLETE",
    "expenses": [],
    "approved_facilities": [],
    "facilities_status": "CONFIRMED_COMPLETE",
    "evidence": [
      {
        "fact_reference": "cash-1",
        "field_path": "opening_cash",
        "source_excerpt": "Cash in hand is INR 50,000",
        "status": "USER_CONFIRMED"
      }
    ],
    "unresolved_questions": []
  }
}
```

`reviewed_facts` is not an engine snapshot. It is the human-confirmed
intermediate model used by the deterministic builder.

### `PATCH /snapshot/draft/{draft_id}`

Submit the complete corrected `facts` object:

```json
{
  "facts": {
    "...": "BusinessFacts fields"
  }
}
```

The version increments and any previous approval becomes invalid.

### `POST /snapshot/approve`

```json
{
  "draft_id": "returned-draft-id",
  "draft_version": 1,
  "approval": "APPROVE"
}
```

Approval checks the stored draft, exact version, unresolved questions, evidence
validation, and snapshot validation. The returned `snapshot` is compatible with
`POST /simulation/run`.

## Validation and money rules

- `BusinessFacts` and all nested intake models reject unknown fields.
- Opening cash is not inferred from sales, profit, invoice value, or credit.
- Unknown collections are not treated as confirmed empty collections.
- Evidence excerpts must occur in the original source text.
- INR values use decimal strings and become integer paise through `Decimal`.
- Paise inputs are not multiplied again.
- Unsupported currencies, sub-paise precision, inconsistent units, duplicate
  source references, missing essential facts, and invalid engine dependencies
  are rejected.
- Request `business_id`, `start_date`, and `horizon_days` remain authoritative.

The builder calls the existing `validate_snapshot()` validator. It does not
replace or weaken simulation-domain validation.

## Provider behavior

The Groq adapter uses a schema generated from the intake Pydantic models and
best-effort structured JSON mode, followed by local Pydantic validation.
Provider failures are surfaced as safe categories such as:

- `MISSING_PROVIDER_CONFIGURATION`
- `AUTHENTICATION_FAILED`
- `RATE_LIMITED`
- `PROVIDER_CONFIGURATION_ERROR`
- `PROVIDER_UNAVAILABLE`
- `EMPTY_PROVIDER_RESPONSE`
- `INVALID_PROVIDER_OUTPUT`

Groq token-per-minute limits can return `429`. The manual `reviewed_facts` path
is the reliable demo path during provider outages or quota exhaustion; it is
explicit and never used as a silent fallback after an AI failure.

Draft storage is intentionally in-memory for this demonstration. Drafts are
single-process and are lost on restart; production use needs authenticated,
durable, business-scoped persistence. Evidence excerpt matching proves only
that the excerpt occurs in the source text, not that the association is
semantically correct. Extraction quality still requires labelled evaluation
and user review.

## Testing

Run the complete suite from the repository root:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

The suite covers the original simulation fixtures plus intake building,
currency conversion, evidence and missing-fact behavior, manual draft
creation, approval, and the intake-to-simulation path. Live Groq calls are not
required for normal tests.
