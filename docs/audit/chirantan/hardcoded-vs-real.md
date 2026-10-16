# What is hardcoded and what is real (notebook Q1 to Q3)

Method: code review of every value the owner-facing screens display, classed as one of
**U** user input, **R** stored record, **E** engine-calculated (from records by the deterministic engine or the risk engine), **K** hardcoded constant, **S** static text.
Machine counts were not possible for "how much is vibe-coded": authorship is not recorded and cannot be measured, so the honest measure used here is the
share of displayed values that is K or S. The shares below are estimates from reading the code, not instrument readings; the counts of constants in section 2 are exact (from `grep`).

## 1. By screen (Q1)

| Screen | What is shown | U | R | E | K | S | Verdict |
|---|---|---|---|---|---|---|---|
| Today | headline sentence, cash, receivable, payable, runway, ranked actions, this week, Risk and Finance line | none | cash, parties, invoices | headline, runway, actions, week, verdict, safe-to-spend | action wording | labels | about 90% real. Only wording is static |
| Engine, Network | parties by exposure, share of risk, delays | filter text | parties, exposure | share of risk | none | labels | real |
| Engine, Flow / Decisions / Timeline | every event, day, waits, cash pools, the engine's own log | what-if inputs | orders, invoices, stock | all event dates, waits, balances, diffs | the three suggested terms in "ways to fix" (see 2.1) | legend text | real except the fix terms |
| Engine, what-if | impact figures, moved events | kind, date, days, amount | none | all figures | none | help text | real |
| Book, Position | net today, runway chart, risk at a glance, why the dip, ways to fix | window | all totals | chart, chances, causes, fix effects | fix terms (2% discount, 90% advance, 1.5% fee, 10 days) | labels | real except fix terms |
| Book, Risk & Finance | futures chart, safe-to-spend, payment check, flags, books check, offers, back-test | payment check inputs, "assumed return" | transactions, invoices, stock | chances, ladder, option results, back-test | thresholds (section 2.3), default yield 6.5% | rule descriptions, statute notes | real inputs and calculations; thresholds are judgement calls |
| Book, Ledger | every transaction with running balance | filters | all rows | balance, totals | none | labels | real |
| Munim | answers | the question | none | every figure comes from a tool; AI mode must pass a number check | template wording (en, ta, hi), help text | none | real; wording is template |

Findings: **no screen shows a made-up number typed into the code**. Every money amount, date and percentage on Today, Engine and Book comes from the records or the engines
(this is also what the independent recomputation in `tests/test_trackA_recompute.py` checks for 8 scenarios). What is hardcoded is the demo business itself and a small set of
assumptions and thresholds, listed next.

## 2. The hardcoded values (Q2)

### 2.1 Invented commercial terms (the largest honesty issue)

`backend/app/services/fixes.py`: `DISCOUNT_BP = 200` (2% early-payment discount a customer is assumed to accept), `FINANCE_ADVANCE_BP = 9000` (90% advance on an invoice),
`FINANCE_FEE_BP_PER_30D = 150` (1.5% fee per 30 days), `EXTENSION_DAYS = 10` (a supplier is assumed to grant 10 more days), a 30% deposit rounded up to the next ₹1,000, and
draw-down timing for a credit line. They decide the cost and effect shown for each "way to fix". They are labelled as costs on screen, but not as assumptions.
**Proposal:** business settings with these as defaults, and the words "assumed terms" beside each fix. (Medium effort.)

### 2.2 Model constants

`position.py`: `SHRINKAGE_K = 5` (how fast a customer's own history outweighs the average), `MIN_POOL = 20` (payments needed before any risk figure is shown).
`risk.py`: `WINDOWS = (30, 60, 90)`, 200 samples (`RISK_SAMPLES`), 36 drawn futures. These are model choices, documented in the "How far to trust it" panel and the README.
**Proposal:** keep as constants; show them in that panel. (Small.)

### 2.3 Risk and Finance thresholds (`services/guard.py`)

Concentration warning at 40% and 60% of receivables; overdue warning at 20% and 40%; a customer "paying later" when the last three payments average 5 days worse than before;
the 45-day MSME limit; cash rules at ₹2,00,000 (receipts, s.269ST) and ₹10,000 (payments, s.40A(3)); an amount flagged as unusual above 3 times the party's usual (loosening to 5 times
after repeated "Looks fine" verdicts); duplicates within 3 days; offers only above ₹25,000; the safe-to-spend windows 7/14/30/45/60 days; a payment judged on the next 30 days;
default assumed yearly return 6.5%.
**Proposal:** the statutory ones stay constants with their citation (they are, and are labelled "check with your CA"). The business ones (40/60%, 20/40%, 3x, 25,000, the windows)
become settings. The yield is already an editable assumption on screen. (Medium.)

### 2.4 Demo data

`records/seed.py`: the business "Mahalakshmi Fabrics", 8 customers, 6 suppliers, materials, products, sales orders, receivables, payables, purchase orders, `TARGET_CASH = 230_000`, and a
generated payment history. It is synthetic by design and labelled "demo copy" in the header. Three shared accounts and a documented password exist (`auth_routes.DEMO_ACCOUNTS`).
**Proposal:** keep, but make sure the production password is set from the environment and the README does not publish a live one on a public deployment.

### 2.5 Static text

Screen text lives in `frontend/src/lib/i18n.ts` (English, Tamil, Hindi) and message templates in `services/messages.py`. Voice works in 10 languages; the screens do not.
Glossary and statute notes are in `munim.py` (`GLOSSARY`) and in the guard rules.

### 2.6 Limits and configuration constants (exact)

`MAX_BODY_BYTES = 256 KiB`, `SESSION_DAYS = 7`, `SANDBOX_TTL_HOURS = 24`, `MAX_SANDBOXES = 400`, `MAX_TOOL_CALLS = 5` (Munim), rate limits (login 10/min per address and 30 per 15 min per account; demo 6/min and 120/h;
AI 20/min per user and 60/h per address; what-if 20/min; simulation 30/min; invites 10/h; reseed 6/h), `MAX_EVENT_DAYS = 60_000`, GST state codes 01 to 38 plus 97 and 99.

## 3. What can be made real, practical and meaningful (Q3)

| Change | Effort | Value |
|---|---|---|
| Make the fix terms (2.1) business settings, show "assumed terms" beside each fix | Medium | High: removes the one place where invented numbers drive advice |
| Show every model constant (2.2) and threshold (2.3) in the "How far to trust it" panel | Small | High: the engine explains itself |
| Import the owner's real data: a bank statement or Tally export as CSV into transactions; parties and invoices as CSV | Large | Highest: replaces synthetic history, which is what the risk model learns from |
| Let the owner turn each Risk and Finance threshold on or off and change it | Medium | Medium |
| Send reminders through an approved WhatsApp provider instead of a share link | Large | Medium (needs account and consent) |
| Real GSTIN and Udyam verification against the government service | Large | Low for the demo; the checksum warning exists |
| Back-test with the model's own shrinkage (today the panel tests the per-customer range only, and says so) | Small | Medium |
| Translate the Munim help and fallback texts for Tamil and Hindi (they are English today) | Small | Medium |

Do now (small, safe): the "assumed terms" wording, the constants in the trust panel, the Tamil and Hindi help text. They are not done in this round because they change screen copy that
Track B owns; they are listed so the three of us can agree before editing.
