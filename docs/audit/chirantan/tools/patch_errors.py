p = "C:/ripple/frontend/src/lib/api.ts"
s = open(p, encoding="utf8").read()
anchor = "    INTERNAL_ERROR: 'The server hit a problem. Nothing was saved. Try again.',\n"
assert anchor in s
new = anchor + """    AMOUNT_AND_DATE_REQUIRED: 'Give an amount and a date, or pick a bill to check.',
    DAY_OUT_OF_RANGE: 'That day is outside the forecast window.',
    DRAFT_NOT_READY: 'The description still has open questions. Answer them before approving.',
    DUE_BEFORE_INVOICE: 'The due date cannot be before the invoice date.',
    EXPLICIT_APPROVAL_REQUIRED: 'Review the facts and approve them before saving.',
    FIX_OR_KIND_REQUIRED: 'Pick a fix, or choose what you want to change.',
    INTENT_DOES_NOT_FIT_PARTY: 'That kind of message does not fit this customer or supplier.',
    INVALID_STATUS: 'That status is not possible for this order.',
    INVOICE_MISMATCH: 'That bill belongs to a different party, or to the other direction. Pick the right bill.',
    NOT_EARLIER: 'Pick a date earlier than the one it has now.',
    NOT_PENDING: 'Only a pending cheque can be changed this way.',
    NO_OPEN_INVOICE: 'This party has no open bill to write about.',
    NO_OPEN_ORDER: 'This customer has no open order, so there is nothing to ask a deposit on.',
    SNAPSHOT_TOO_LARGE: 'That is too much to simulate at once. Shorten the description or the horizon.',
    STALE_DRAFT_VERSION: 'The draft changed while you were editing. Reload it and try again.',
    UNKNOWN_BUSINESS: 'That business was not found. Sign in again.',
    UNKNOWN_DRAFT: 'That draft no longer exists. Start again.',
    UNKNOWN_RULE: 'That check does not exist.',
    UNSUPPORTED_FIX: 'That kind of fix is not available.',
"""
s = s.replace(anchor, new, 1)
open(p, "w", encoding="utf8").write(s)
print("ok")
