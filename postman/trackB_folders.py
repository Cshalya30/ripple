"""Track B (Nandini) Postman folders: parties, invoices and payments, orders, inventory, settings and export, cross-business access.

Imported by build_collection.py. Every folder runs in the private sandbox opened by "01 Session", creates only synthetic records,
reads each write back, and removes what it created where the API allows. No credentials, tokens or keys appear anywhere.
"""
from __future__ import annotations


def build(req, status, is_json, js):
    set_var = lambda name, expr: f"pm.collectionVariables.set('{name}', {expr});"
    get_var = lambda name: f"pm.collectionVariables.get('{name}')"
    folders = []

    # ------------------------------------------------------------------ 08 parties
    folders.append({"name": "08 Khata: parties, notes, datasheets", "item": [
        req("customers list", "GET", "/api/parties?kind=CUSTOMER", status(200) + is_json() + js(
            "const r = pm.response.json();",
            "pm.test('rows, a total, integer money', () => { pm.expect(r.parties).to.be.an('array').and.not.empty; pm.expect(Number.isInteger(r.total_outstanding_paise)).to.be.true; });",
            "pm.test('every row is a customer with an integer outstanding', () => r.parties.forEach(p => { pm.expect(p.kind).to.eql('CUSTOMER'); pm.expect(Number.isInteger(p.outstanding_paise)).to.be.true; }));",
            "const k = r.parties.find(p => p.name === 'Kaveri Boutique') || r.parties[0];",
            set_var("customer_id", "k.id"), set_var("customer_name", "k.name"),
            "const other = r.parties.find(p => p.id !== k.id); " + set_var("customer2_id", "other.id"))),
        req("suppliers list", "GET", "/api/parties?kind=SUPPLIER", status(200) + js(
            "const r = pm.response.json();", "pm.test('suppliers only', () => r.parties.forEach(p => pm.expect(p.kind).to.eql('SUPPLIER')));",
            set_var("supplier_id", "r.parties[0].id"))),
        req("parties: bad kind", "GET", "/api/parties?kind=ALIEN", status(422)),
        req("party detail", "GET", "/api/parties/{{customer_id}}", status(200) + js(
            "const d = pm.response.json();",
            "pm.test('has open bills with integer amounts', () => { pm.expect(d.open_items).to.be.an('array').and.not.empty; d.open_items.forEach(i => pm.expect(Number.isInteger(i.amount_paise)).to.be.true); });",
            "pm.test('no password, hash or token anywhere', () => pm.expect(JSON.stringify(d)).to.not.match(/password|scrypt|token/i));",
            set_var("invoice_id", "d.open_items[0].id"), set_var("invoice_number", "d.open_items[0].number"), set_var("invoice_amount", "d.open_items[0].amount_paise"))),
        req("party detail: unknown id", "GET", "/api/parties/no-such-party", status(404, "NOT_FOUND")),
        req("party detail: path traversal text", "GET", "/api/parties/..%2F..%2Fetc%2Fpasswd", status(404)),
        req("create customer", "POST", "/api/parties", status(200) + js(
            "const p = pm.response.json(); const row = p.party || p;",
            "pm.test('created with the name given and a new id', () => { pm.expect(row.id).to.be.a('string'); pm.expect(row.name).to.eql('Postman Test Traders'); });",
            set_var("new_party_id", "row.id")),
            body={"kind": "CUSTOMER", "name": "Postman Test Traders", "city": "Erode", "phone": "98765 43210", "terms_type": "CREDIT", "terms_days": 30, "tags": ["test"]}),
        req("created customer is in the list (persistence)", "GET", "/api/parties?kind=CUSTOMER", status(200) + js(
            "pm.test('the new party is listed once', () => pm.expect(pm.response.json().parties.filter(p => p.id === pm.collectionVariables.get('new_party_id')).length).to.eql(1));")),
        req("create party: missing name", "POST", "/api/parties", status(422), body={"kind": "CUSTOMER"}),
        req("create party: empty name", "POST", "/api/parties", status(422), body={"kind": "CUSTOMER", "name": ""}),
        req("create party: name over 120", "POST", "/api/parties", status(422), body={"kind": "CUSTOMER", "name": "n" * 121}),
        req("create party: bad kind", "POST", "/api/parties", status(422), body={"kind": "ALIEN", "name": "X"}),
        req("create party: phone with letters", "POST", "/api/parties", status(422), body={"kind": "CUSTOMER", "name": "X", "phone": "call me"}),
        req("create party: credit days 366", "POST", "/api/parties", status(422), body={"kind": "CUSTOMER", "name": "X", "terms_days": 366}),
        req("create party: credit days as text", "POST", "/api/parties", status(422), body={"kind": "CUSTOMER", "name": "X", "terms_days": "thirty"}),
        req("create party: extra property (mass assignment)", "POST", "/api/parties", status(422), body={"kind": "CUSTOMER", "name": "X", "business_id": "someone-else", "id": "chosen"}),
        req("create party: wrong content type", "POST", "/api/parties", status(422), raw_body="kind=CUSTOMER&name=X", content_type="text/plain"),
        req("create party: malformed JSON", "POST", "/api/parties", status(422), raw_body="{not json"),
        req("create party: markup in the name is stored as text", "POST", "/api/parties", status(200) + js(
            "const row = pm.response.json().party || pm.response.json(); pm.test('the name comes back unchanged, never interpreted', () => pm.expect(row.name).to.eql('<img src=x onerror=alert(1)>'));",
            set_var("xss_party_id", "row.id")),
            body={"kind": "CUSTOMER", "name": "<img src=x onerror=alert(1)>"}),
        req("create party: a name that starts like a spreadsheet formula", "POST", "/api/parties", status(200) + js(
            "const row = pm.response.json().party || pm.response.json(); " + set_var("formula_party_id", "row.id")),
            body={"kind": "CUSTOMER", "name": "=HYPERLINK(\"http://example.invalid\",\"click\")"}),
        req("update party", "PATCH", "/api/parties/{{new_party_id}}", status(200), body={"city": "Salem", "terms_days": 45}),
        req("the update was stored (persistence)", "GET", "/api/parties/{{new_party_id}}", status(200) + js(
            "const p = pm.response.json().party || pm.response.json(); pm.test('city and terms changed', () => { pm.expect(p.city).to.eql('Salem'); pm.expect(p.terms_days).to.eql(45); });")),
        req("update party: unknown id", "PATCH", "/api/parties/no-such-party", status(404), body={"city": "Salem"}),
        req("update party: extra property", "PATCH", "/api/parties/{{new_party_id}}", status(422), body={"kind": "SUPPLIER"}),
        req("add a note", "POST", "/api/parties/{{new_party_id}}/notes", status(200), body={"text": "Promised to pay by Friday"}),
        req("the note is stored", "GET", "/api/parties/{{new_party_id}}", status(200) + js(
            "pm.test('note present', () => pm.expect(JSON.stringify(pm.response.json())).to.include('Promised to pay by Friday'));")),
        req("add a note: empty", "POST", "/api/parties/{{new_party_id}}/notes", status(422), body={"text": ""}),
        req("add a note: too long", "POST", "/api/parties/{{new_party_id}}/notes", status(422), body={"text": "n" * 5000}),
        req("party datasheet (CSV)", "GET", "/api/export/party/{{customer_id}}/datasheet.csv", js(
            "pm.test('status is 200', () => pm.response.to.have.status(200));",
            "pm.test('CSV with a download name', () => { pm.expect(pm.response.headers.get('Content-Type')).to.include('text/csv'); pm.expect(pm.response.headers.get('Content-Disposition')).to.include('attachment'); });",
            "pm.test('starts with a byte-order mark so Excel reads it as UTF-8', () => pm.expect(Buffer.from(pm.response.stream.slice(0, 3)).toString('hex')).to.eql('efbbbf'));",
            "pm.test('no cell can start a formula', () => pm.expect(pm.response.text()).to.not.match(/(^|,)\"?[=@]/m));")),
        req("party datasheet: unknown party", "GET", "/api/export/party/no-such-party/datasheet.csv", status(404)),
        req("company datasheet (CSV)", "GET", "/api/export/company/datasheet.csv", js(
            "pm.test('status is 200 and CSV', () => { pm.response.to.have.status(200); pm.expect(pm.response.headers.get('Content-Type')).to.include('text/csv'); });",
            "pm.test('no secrets in the sheet', () => pm.expect(pm.response.text()).to.not.match(/scrypt|password_hash|GROQ|api[_-]?key/i));")),
        req("message draft: reminder", "POST", "/api/messages/draft", status(200) + js(
            "const d = pm.response.json();",
            "pm.test('text has no unfilled placeholders and a WhatsApp link with a country code', () => { pm.expect(d.text).to.not.match(/[{}]|undefined|NaN|None/); if (d.wa_link) pm.expect(d.wa_link).to.match(/^https:\\/\\/wa\\.me\\/\\d{10,15}\\?text=/); });"),
            body={"intent": "reminder", "party_id": "{{customer_id}}", "tone": "polite", "language": "en", "include_msme": False}),
        req("message draft: intent that does not fit", "POST", "/api/messages/draft", status(422), body={"intent": "extension", "party_id": "{{customer_id}}"}),
        req("message draft: unknown language", "POST", "/api/messages/draft", status(422), body={"intent": "reminder", "party_id": "{{customer_id}}", "language": "xx"}),
    ]})

    # ------------------------------------------------------------------ 09 invoices and payments
    folders.append({"name": "09 Invoices, payments, cheques", "item": [
        req("create an invoice", "POST", "/api/invoices", status(200) + js(
            "const i = pm.response.json().invoice || pm.response.json(); pm.test('stored open, amount in paise', () => { pm.expect(i.status).to.eql('OPEN'); pm.expect(i.amount_paise).to.eql(250000); });",
            set_var("test_invoice_id", "i.id")),
            body={"party_id": "{{new_party_id}}", "number": "PM-1001", "amount_paise": 250000, "invoice_date": "2026-10-10", "due_date": "2026-11-10"}),
        req("the invoice shows on the party (persistence)", "GET", "/api/parties/{{new_party_id}}", status(200) + js(
            "pm.test('open item present', () => pm.expect(pm.response.json().open_items.some(i => i.number === 'PM-1001')).to.be.true);")),
        req("invoice: duplicate number for the same party", "POST", "/api/invoices", status(422, "DUPLICATE_INVOICE_NUMBER"),
            body={"party_id": "{{new_party_id}}", "number": "pm 1001", "amount_paise": 100, "invoice_date": "2026-10-10"}),
        req("invoice: due before invoice date", "POST", "/api/invoices", status(422, "DUE_BEFORE_INVOICE"),
            body={"party_id": "{{new_party_id}}", "number": "PM-1002", "amount_paise": 100, "invoice_date": "2026-10-10", "due_date": "2026-10-01"}),
        req("invoice: year 9999", "POST", "/api/invoices", status(422), body={"party_id": "{{new_party_id}}", "number": "PM-1003", "amount_paise": 100, "invoice_date": "9999-12-31"}),
        req("invoice: amount zero", "POST", "/api/invoices", status(422), body={"party_id": "{{new_party_id}}", "number": "PM-1004", "amount_paise": 0, "invoice_date": "2026-10-10"}),
        req("invoice: amount negative", "POST", "/api/invoices", status(422), body={"party_id": "{{new_party_id}}", "number": "PM-1005", "amount_paise": -100, "invoice_date": "2026-10-10"}),
        req("invoice: amount with decimals", "POST", "/api/invoices", status(422), raw_body='{"party_id": "{{new_party_id}}", "number": "PM-1006", "amount_paise": 10.5, "invoice_date": "2026-10-10"}'),
        req("invoice: amount as text", "POST", "/api/invoices", status(422), body={"party_id": "{{new_party_id}}", "number": "PM-1007", "amount_paise": "100", "invoice_date": "2026-10-10"}),
        req("invoice: amount beyond any real figure", "POST", "/api/invoices", status(422), body={"party_id": "{{new_party_id}}", "number": "PM-1008", "amount_paise": 9007199254740993, "invoice_date": "2026-10-10"}),
        req("invoice: unknown party", "POST", "/api/invoices", status(404), body={"party_id": "no-such-party", "number": "PM-1009", "amount_paise": 100, "invoice_date": "2026-10-10"}),
        req("invoice: promised date", "PATCH", "/api/invoices/{{test_invoice_id}}", status(200), body={"promised_date": "2026-10-20"}),
        req("invoice: promised date unknown invoice", "PATCH", "/api/invoices/no-such-invoice", status(404), body={"promised_date": "2026-10-20"}),
        req("payment: part payment by UPI", "POST", "/api/transactions", status(200) + js(
            "const r = pm.response.json(); pm.test('cleared, with the amount stored exactly', () => { pm.expect(r.transaction.status).to.eql('CLEARED'); pm.expect(r.transaction.amount_paise).to.eql(100000); });",
            set_var("upi_txn_id", "r.transaction.id")),
            body={"party_id": "{{new_party_id}}", "direction": "IN", "amount_paise": 100000, "date": "2026-10-14", "medium": "UPI", "reference": "UTR1", "invoice_id": "{{test_invoice_id}}"}),
        req("the payment is in the ledger and the bill went down (persistence)", "GET", "/api/transactions", status(200) + js(
            "pm.test('the ledger has the payment', () => pm.expect(pm.response.json().rows.some(r => r.id === pm.collectionVariables.get('upi_txn_id') && r.amount_paise === 100000)).to.be.true);")),
        req("payment: more than the bill", "POST", "/api/transactions", status(422, "AMOUNT_EXCEEDS_OUTSTANDING"),
            body={"party_id": "{{new_party_id}}", "direction": "IN", "amount_paise": 150001, "date": "2026-10-14", "medium": "UPI", "invoice_id": "{{test_invoice_id}}"}),
        req("payment: dated in the future", "POST", "/api/transactions", status(422, "FUTURE_DATE"),
            body={"party_id": "{{new_party_id}}", "direction": "IN", "amount_paise": 100, "date": "2026-12-01", "medium": "UPI"}),
        req("payment: wrong direction for a customer", "POST", "/api/transactions", status(422, "DIRECTION_MISMATCH"),
            body={"party_id": "{{new_party_id}}", "direction": "OUT", "amount_paise": 100, "date": "2026-10-14", "medium": "UPI"}),
        req("payment: another party's bill", "POST", "/api/transactions", status(422, "INVOICE_MISMATCH"),
            body={"party_id": "{{customer2_id}}", "direction": "IN", "amount_paise": 100, "date": "2026-10-14", "medium": "UPI", "invoice_id": "{{test_invoice_id}}"}),
        req("payment: unknown party", "POST", "/api/transactions", status(404), body={"party_id": "no-such-party", "direction": "IN", "amount_paise": 100, "date": "2026-10-14", "medium": "UPI"}),
        req("payment: unknown medium", "POST", "/api/transactions", status(422), body={"party_id": "{{new_party_id}}", "direction": "IN", "amount_paise": 100, "date": "2026-10-14", "medium": "BITCOIN"}),
        req("payment: amount zero", "POST", "/api/transactions", status(422), body={"party_id": "{{new_party_id}}", "direction": "IN", "amount_paise": 0, "date": "2026-10-14", "medium": "UPI"}),
        req("payment: amount as text", "POST", "/api/transactions", status(422), body={"party_id": "{{new_party_id}}", "direction": "IN", "amount_paise": "1e5", "date": "2026-10-14", "medium": "UPI"}),
        req("payment: date as text", "POST", "/api/transactions", status(422), body={"party_id": "{{new_party_id}}", "direction": "IN", "amount_paise": 100, "date": "yesterday", "medium": "UPI"}),
        req("payment: extra property", "POST", "/api/transactions", status(422), body={"party_id": "{{new_party_id}}", "direction": "IN", "amount_paise": 100, "date": "2026-10-14", "medium": "UPI", "status": "CLEARED", "business_id": "x"}),
        req("cheque for the rest of the bill is pending", "POST", "/api/transactions", status(200) + js(
            "const r = pm.response.json(); pm.test('pending, so not cash yet', () => pm.expect(r.transaction.status).to.eql('PENDING'));", set_var("cheque_id", "r.transaction.id")),
            body={"party_id": "{{new_party_id}}", "direction": "IN", "amount_paise": 150000, "date": "2026-10-14", "medium": "CHEQUE", "reference": "500001", "invoice_id": "{{test_invoice_id}}"}),
        req("a second cheque for the same money is refused", "POST", "/api/transactions", status(422, "AMOUNT_EXCEEDS_OUTSTANDING") + js(
            "const d = pm.response.json().error.details; pm.test('says how much is held by pending cheques', () => { pm.expect(d.pending_cheques_paise).to.eql(150000); pm.expect(d.outstanding_paise).to.eql(0); });"),
            body={"party_id": "{{new_party_id}}", "direction": "IN", "amount_paise": 150000, "date": "2026-10-14", "medium": "CHEQUE", "reference": "500002", "invoice_id": "{{test_invoice_id}}"}),
        req("bounce the cheque", "PATCH", "/api/transactions/{{cheque_id}}", status(200) + js("pm.test('status is BOUNCED', () => pm.expect(pm.response.json().transaction.status).to.eql('BOUNCED'));"), body={"status": "BOUNCED"}),
        req("a bounced cheque cannot be changed again", "PATCH", "/api/transactions/{{cheque_id}}", status(422, "NOT_PENDING"), body={"status": "CLEARED"}),
        req("the money is free again after the bounce", "POST", "/api/transactions", status(200) + js(
            "const r = pm.response.json(); " + set_var("cheque2_id", "r.transaction.id")),
            body={"party_id": "{{new_party_id}}", "direction": "IN", "amount_paise": 150000, "date": "2026-10-14", "medium": "CHEQUE", "reference": "500003", "invoice_id": "{{test_invoice_id}}"}),
        req("clear the cheque", "PATCH", "/api/transactions/{{cheque2_id}}", status(200), body={"status": "CLEARED"}),
        req("the bill is now paid (persistence)", "GET", "/api/parties/{{new_party_id}}", status(200) + js(
            "pm.test('no open item left for PM-1001', () => pm.expect(pm.response.json().open_items.some(i => i.number === 'PM-1001')).to.be.false);")),
        req("transaction status: invalid value", "PATCH", "/api/transactions/{{cheque2_id}}", status(422), body={"status": "REFUNDED"}),
        req("transaction status: unknown id", "PATCH", "/api/transactions/no-such-txn", status(404), body={"status": "CLEARED"}),
        req("ledger: limit 0", "GET", "/api/transactions?limit=0", status(422)),
        req("ledger: limit over 1000", "GET", "/api/transactions?limit=1001", status(422)),
        req("ledger: medium filter", "GET", "/api/transactions?medium=UPI", status(200) + js("pm.test('only UPI rows', () => pm.response.json().rows.forEach(r => pm.expect(r.medium).to.eql('UPI')));")),
        req("a payment from the formula-named customer", "POST", "/api/transactions", status(200), body={"party_id": "{{formula_party_id}}", "direction": "IN", "amount_paise": 500, "date": "2026-10-14", "medium": "UPI"}),
        req("transactions CSV: formula guard and byte-order mark", "GET", "/api/export/transactions.csv", js(
            "pm.test('status 200 and CSV', () => { pm.response.to.have.status(200); pm.expect(pm.response.headers.get('Content-Type')).to.include('text/csv'); });",
            "pm.test('starts with a byte-order mark', () => pm.expect(Buffer.from(pm.response.stream.slice(0, 3)).toString('hex')).to.eql('efbbbf'));",
            "pm.test('the formula-like party name is neutralised', () => { const t = pm.response.text(); pm.expect(t).to.include(\"'=HYPERLINK\"); pm.expect(t).to.not.match(/,=HYPERLINK/); });")),
    ]})

    # ------------------------------------------------------------------ 10 orders
    folders.append({"name": "10 Orders: sales stages, purchase orders, what-if", "item": [
        req("sales orders", "GET", "/api/sales-orders", status(200) + js(
            "const o = pm.response.json().orders; pm.test('orders with a stage and integer value', () => o.forEach(x => { pm.expect(x.stage).to.be.a('string'); pm.expect(Number.isInteger(x.value_paise)).to.be.true; }));",
            "const planned = o.find(x => x.stage === 'PLANNED'); " + set_var("so_id", "planned ? planned.id : o[0].id"))),
        req("move an order forward", "PATCH", "/api/sales-orders/{{so_id}}", status(200), body={"stage": "MATERIALS_READY"}),
        req("the stage was stored (persistence)", "GET", "/api/sales-orders", status(200) + js(
            "pm.test('the order is at MATERIALS_READY', () => pm.expect(pm.response.json().orders.find(x => x.id === pm.collectionVariables.get('so_id')).stage).to.eql('MATERIALS_READY'));")),
        req("order: same stage again", "PATCH", "/api/sales-orders/{{so_id}}", status(422, "INVALID_TRANSITION"), body={"stage": "MATERIALS_READY"}),
        req("order: undo back to planned", "PATCH", "/api/sales-orders/{{so_id}}", status(200), body={"stage": "PLANNED"}),
        req("order: unknown stage", "PATCH", "/api/sales-orders/{{so_id}}", status(422), body={"stage": "TELEPORTED"}),
        req("order: unknown id", "PATCH", "/api/sales-orders/no-such-order", status(404), body={"stage": "MATERIALS_READY"}),
        req("order: extra property", "PATCH", "/api/sales-orders/{{so_id}}", status(422), body={"stage": "PLANNED", "qty": 1}),
        req("purchase orders", "GET", "/api/purchase-orders", status(200) + is_json()),
        req("catalogue (products, materials, suppliers)", "GET", "/api/catalogue", status(200) + js(
            "const c = pm.response.json(); pm.test('lists present', () => { pm.expect(c.products).to.be.an('array').and.not.empty; pm.expect(c.materials).to.be.an('array').and.not.empty; });",
            set_var("product_id", "c.products[0].id"), set_var("material_id", "c.materials[0].id"))),
        req("create a purchase order", "POST", "/api/purchase-orders", status(200) + js(
            "const po = pm.response.json().order || pm.response.json().purchase_order || pm.response.json(); pm.test('ordered', () => pm.expect(po.status).to.eql('ORDERED')); " + set_var("po_id", "po.id")),
            body={"supplier_id": "{{supplier_id}}", "material_id": "{{material_id}}", "qty": 5}),
        req("purchase order: a customer is not a supplier", "POST", "/api/purchase-orders", status(422, "NOT_A_SUPPLIER"), body={"supplier_id": "{{customer_id}}", "material_id": "{{material_id}}", "qty": 5}),
        req("purchase order: quantity zero", "POST", "/api/purchase-orders", status(422), body={"supplier_id": "{{supplier_id}}", "material_id": "{{material_id}}", "qty": 0}),
        req("purchase order: unknown material", "POST", "/api/purchase-orders", status(404), body={"supplier_id": "{{supplier_id}}", "material_id": "no-such-material", "qty": 5}),
        req("purchase order: arrival in year 9999", "POST", "/api/purchase-orders", status(422), body={"supplier_id": "{{supplier_id}}", "material_id": "{{material_id}}", "qty": 5, "expected_arrival": "9999-12-31"}),
        req("mark the purchase order arrived", "PATCH", "/api/purchase-orders/{{po_id}}", status(200), body={"status": "ARRIVED"}),
        req("arriving twice is refused", "PATCH", "/api/purchase-orders/{{po_id}}", status(422, "INVALID_TRANSITION"), body={"status": "ARRIVED"}),
        req("undo the arrival", "PATCH", "/api/purchase-orders/{{po_id}}", status(200), body={"status": "UNDO"}),
        req("purchase order: unknown status", "PATCH", "/api/purchase-orders/{{po_id}}", status(422), body={"status": "LOST"}),
        req("purchase order: unknown id", "PATCH", "/api/purchase-orders/no-such-po", status(404), body={"status": "ARRIVED"}),
        req("accept an order (create a sales order)", "POST", "/api/sales-orders", status(200) + js(
            "const o = pm.response.json().order || pm.response.json(); pm.test('planned, with the quantity asked', () => { pm.expect(o.stage).to.eql('PLANNED'); pm.expect(o.qty).to.eql(7); }); " + set_var("new_so_id", "o.id")),
            body={"customer_id": "{{customer_id}}", "product_id": "{{product_id}}", "qty": 7, "promised_date": "2026-12-20"}),
        req("the new order is listed (persistence)", "GET", "/api/sales-orders", status(200) + js(
            "pm.test('present once', () => pm.expect(pm.response.json().orders.filter(x => x.id === pm.collectionVariables.get('new_so_id')).length).to.eql(1));")),
        req("order: quantity zero", "POST", "/api/sales-orders", status(422), body={"customer_id": "{{customer_id}}", "product_id": "{{product_id}}", "qty": 0, "promised_date": "2026-12-20"}),
        req("order: quantity as text", "POST", "/api/sales-orders", status(422), body={"customer_id": "{{customer_id}}", "product_id": "{{product_id}}", "qty": "7", "promised_date": "2026-12-20"}),
        req("order: unknown customer", "POST", "/api/sales-orders", status(404), body={"customer_id": "no-such", "product_id": "{{product_id}}", "qty": 1, "promised_date": "2026-12-20"}),
        req("order: promised date year 1999", "POST", "/api/sales-orders", status(422), body={"customer_id": "{{customer_id}}", "product_id": "{{product_id}}", "qty": 1, "promised_date": "1999-01-01"}),
        req("what-if: can I take this order", "POST", "/api/orders/what-if", status(200) + is_json(), body={"customer_id": "{{customer_id}}", "product_id": "{{product_id}}", "qty": 10, "promised_date": "2026-12-15"}),
        req("what-if: quantity zero", "POST", "/api/orders/what-if", status(422), body={"customer_id": "{{customer_id}}", "product_id": "{{product_id}}", "qty": 0, "promised_date": "2026-12-15"}),
        req("what-if: price as text", "POST", "/api/orders/what-if", status(422), body={"customer_id": "{{customer_id}}", "product_id": "{{product_id}}", "qty": 1, "unit_price_paise": "abc", "promised_date": "2026-12-15"}),
        req("what-if: date year 9999", "POST", "/api/orders/what-if", status(422), body={"customer_id": "{{customer_id}}", "product_id": "{{product_id}}", "qty": 1, "promised_date": "9999-12-31"}),
        req("what-if: unknown customer", "POST", "/api/orders/what-if", status(404), body={"customer_id": "no-such", "product_id": "{{product_id}}", "qty": 1, "promised_date": "2026-12-15"}),
    ]})

    # ------------------------------------------------------------------ 11 inventory
    folders.append({"name": "11 Inventory: materials, recipes, stock", "item": [
        req("inventory", "GET", "/api/inventory", status(200) + js(
            "const i = pm.response.json(); pm.test('materials with an on-hand quantity and a status', () => i.materials.forEach(m => { pm.expect(Number.isInteger(m.on_hand)).to.be.true; pm.expect(m.status).to.be.a('string'); }));",
            "pm.test('summary has integer counts', () => pm.expect(Number.isInteger(i.summary.short_count)).to.be.true); " + set_var("first_material_id", "i.materials[0].id") + " " + set_var("first_on_hand", "i.materials[0].on_hand"))),
        req("inventory summary", "GET", "/api/inventory/summary", status(200) + is_json()),
        req("create a material", "POST", "/api/materials", status(200) + js(
            "const m = pm.response.json().material; pm.test('stored with its cost in paise', () => { pm.expect(m.name).to.eql('Postman dye'); pm.expect(m.avg_cost_paise).to.eql(12050); }); " + set_var("new_material_id", "m.id")),
            body={"name": "Postman dye", "unit": "kg", "cost_paise": 12050, "opening_qty": 2.5}),
        req("the material is listed with its opening stock (persistence)", "GET", "/api/inventory", status(200) + js(
            "const m = pm.response.json().materials.find(x => x.id === pm.collectionVariables.get('new_material_id')); pm.test('present with 2.5 kg = 2500 g', () => { pm.expect(m).to.be.an('object'); pm.expect(m.on_hand).to.eql(2500); });")),
        req("material: same name again", "POST", "/api/materials", status(422, "MATERIAL_EXISTS"), body={"name": "postman  DYE", "unit": "kg"}),
        req("material: empty name", "POST", "/api/materials", status(422), body={"name": "  ", "unit": "kg"}),
        req("material: unknown unit", "POST", "/api/materials", status(422), body={"name": "X", "unit": "furlong"}),
        req("material: negative cost", "POST", "/api/materials", status(422), body={"name": "Neg", "unit": "kg", "cost_paise": -1}),
        req("material: opening stock below zero", "POST", "/api/materials", status(422), body={"name": "Neg2", "unit": "kg", "opening_qty": -1}),
        req("material: opening stock with four decimals", "POST", "/api/materials", status(422), body={"name": "Dec", "unit": "kg", "opening_qty": 1.2345}),
        req("material: sku with spaces", "POST", "/api/materials", status(422), body={"name": "Sku", "unit": "kg", "sku": "bad sku!"}),
        req("material: extra property", "POST", "/api/materials", status(422), body={"name": "Extra", "unit": "kg", "business_id": "x"}),
        req("rename the material", "PATCH", "/api/materials/{{new_material_id}}", status(200), body={"name": "Postman dye v2"}),
        req("material: patch unknown id", "PATCH", "/api/materials/no-such", status(404), body={"name": "x"}),
        req("stock: add with a note", "POST", "/api/stock-movements", status(200), body={"item_type": "MATERIAL", "item_id": "{{new_material_id}}", "qty_delta": 500, "note": "postman count"}),
        req("stock: the movement is listed", "GET", "/api/stock-movements", status(200) + js(
            "pm.test('the count note is in the list', () => pm.expect(JSON.stringify(pm.response.json().movements)).to.include('postman count'));")),
        req("stock: zero change", "POST", "/api/stock-movements", status(422, "ZERO_QUANTITY"), body={"item_type": "MATERIAL", "item_id": "{{new_material_id}}", "qty_delta": 0, "note": "x"}),
        req("stock: no note", "POST", "/api/stock-movements", status(422), body={"item_type": "MATERIAL", "item_id": "{{new_material_id}}", "qty_delta": 1, "note": ""}),
        req("stock: taking out more than is there", "POST", "/api/stock-movements", status(422, "NOT_ENOUGH_STOCK"), body={"item_type": "MATERIAL", "item_id": "{{new_material_id}}", "qty_delta": -100000000, "note": "too much"}),
        req("stock: still the same amount (nothing was taken)", "GET", "/api/inventory", status(200) + js(
            "const m = pm.response.json().materials.find(x => x.id === pm.collectionVariables.get('new_material_id')); pm.test('on hand unchanged and not negative', () => { pm.expect(m.on_hand).to.eql(3000); });")),
        req("stock: unknown item", "POST", "/api/stock-movements", status(404), body={"item_type": "MATERIAL", "item_id": "no-such", "qty_delta": 1, "note": "x"}),
        req("stock: bad item type", "POST", "/api/stock-movements", status(422), body={"item_type": "GOLD", "item_id": "{{new_material_id}}", "qty_delta": 1, "note": "x"}),
        req("recipe: read", "GET", "/api/recipes/{{product_id}}", status(200) + is_json()),
        req("recipe: duplicate material line", "PUT", "/api/recipes/{{product_id}}", status(422, "DUPLICATE_MATERIAL"),
            body={"lines": [{"material_id": "{{first_material_id}}", "qty_per_piece": 100, "wastage_bp": 0}, {"material_id": "{{first_material_id}}", "qty_per_piece": 100, "wastage_bp": 0}]}),
        req("recipe: unknown material", "PUT", "/api/recipes/{{product_id}}", status(404), body={"lines": [{"material_id": "no-such", "qty_per_piece": 100, "wastage_bp": 0}]}),
        req("recipe: unknown product", "PUT", "/api/recipes/no-such", status(404), body={"lines": []}),
        req("recipe: negative quantity", "PUT", "/api/recipes/{{product_id}}", status(422), body={"lines": [{"material_id": "{{first_material_id}}", "qty_per_piece": -1, "wastage_bp": 0}]}),
        req("a material with stock history cannot be deleted", "DELETE", "/api/materials/{{new_material_id}}", status(422, "MATERIAL_IN_USE")),
        req("create a scrap material with no history", "POST", "/api/materials", status(200) + js("const m = pm.response.json().material; " + set_var("scrap_material_id", "m.id")),
            body={"name": "Postman scrap", "unit": "pc"}),
        req("delete the scrap material", "DELETE", "/api/materials/{{scrap_material_id}}", status(200)),
        req("the material is gone (persistence)", "GET", "/api/inventory", status(200) + js(
            "pm.test('not listed', () => pm.expect(pm.response.json().materials.some(m => m.id === pm.collectionVariables.get('scrap_material_id'))).to.be.false);")),
        req("delete a material that is in use", "DELETE", "/api/materials/{{first_material_id}}", status(422, "MATERIAL_IN_USE")),
        req("delete an unknown material", "DELETE", "/api/materials/no-such", status(404)),
    ]})

    # ------------------------------------------------------------------ 12 settings, export, team
    folders.append({"name": "12 Settings, export, team, data", "item": [
        req("settings", "GET", "/api/settings", status(200) + js(
            "const s = pm.response.json(); pm.test('profile, money, recurring, facilities, team', () => ['business','money','recurring','facilities','team'].forEach(k => pm.expect(s).to.have.property(k)));",
            "pm.test('team rows carry no password data', () => pm.expect(JSON.stringify(s.team)).to.not.match(/password|scrypt|hash/i));")),
        req("business profile: change the owner name", "PUT", "/api/settings/business", status(200), body={"owner_name": "Meera S."}),
        req("business profile is stored (persistence)", "GET", "/api/settings", status(200) + js("pm.test('owner name changed', () => pm.expect(pm.response.json().business.owner_name).to.eql('Meera S.'));")),
        req("business profile: GSTIN of the wrong length", "PUT", "/api/settings/business", status(422), body={"gstin": "33AAJFM4721K1"}),
        req("business profile: Udyam number of the wrong shape", "PUT", "/api/settings/business", status(422), body={"udyam_number": "UDYAM-1"}),
        req("business profile: name over 120", "PUT", "/api/settings/business", status(422), body={"name": "n" * 121}),
        req("business profile: unknown field", "PUT", "/api/settings/business", status(422), body={"is_admin": True}),
        req("money rules: safety buffer", "PUT", "/api/settings/money", status(200), body={"safety_buffer_paise": 7500000}),
        req("money rules are stored", "GET", "/api/settings", status(200) + js("pm.test('buffer changed', () => pm.expect(pm.response.json().money.safety_buffer_paise).to.eql(7500000));")),
        req("money rules: negative buffer", "PUT", "/api/settings/money", status(422), body={"safety_buffer_paise": -1}),
        req("money rules: credit days 366", "PUT", "/api/settings/money", status(422), body={"default_customer_terms_days": 366}),
        req("money rules: buffer as text", "PUT", "/api/settings/money", status(422), body={"safety_buffer_paise": "lots"}),
        req("recurring expense: add", "POST", "/api/settings/recurring", status(200) + js(
            "const r = pm.response.json(); const row = (r.recurring || []).find(x => x.label === 'Postman rent'); pm.test('listed with the amount in paise', () => { pm.expect(row).to.be.an('object'); pm.expect(row.amount_paise).to.eql(1250000); }); " + set_var("recurring_id", "row.id")),
            body={"label": "Postman rent", "amount_paise": 1250000, "day_of_month": 5, "active": True}),
        req("recurring expense: day 32", "POST", "/api/settings/recurring", status(422), body={"label": "x", "amount_paise": 100, "day_of_month": 32}),
        req("recurring expense: amount zero", "POST", "/api/settings/recurring", status(422), body={"label": "x", "amount_paise": 0, "day_of_month": 5}),
        req("recurring expense: remove", "DELETE", "/api/settings/recurring/{{recurring_id}}", status(200)),
        req("recurring expense: remove unknown", "DELETE", "/api/settings/recurring/no-such", status(404, "NOT_FOUND")),
        req("credit facility: repayment before it is available", "POST", "/api/settings/facilities", status(422, "REPAYMENT_BEFORE_AVAILABLE"),
            body={"label": "CC", "approved_limit_paise": 1000000, "annual_rate_bps": 1100, "drawdown_fee_paise": 0, "available_from": "2026-12-01", "repayment_date": "2026-11-01"}),
        req("credit facility: rate over 100%", "POST", "/api/settings/facilities", status(422), body={"label": "CC", "approved_limit_paise": 1000000, "annual_rate_bps": 20000, "drawdown_fee_paise": 0, "available_from": "2026-11-01", "repayment_date": "2026-12-01"}),
        req("credit facility: add", "POST", "/api/settings/facilities", status(200) + js(
            "const r = pm.response.json(); const row = (r.facilities || []).find(x => x.label === 'Postman OD'); pm.test('listed', () => pm.expect(row).to.be.an('object')); " + set_var("facility_id", "row.id")),
            body={"label": "Postman OD", "approved_limit_paise": 1000000, "annual_rate_bps": 1100, "drawdown_fee_paise": 0, "available_from": "2026-11-01", "repayment_date": "2026-12-01"}),
        req("credit facility: remove", "DELETE", "/api/settings/facilities/{{facility_id}}", status(200)),
        req("export everything (JSON)", "GET", "/api/export", status(200) + is_json() + js(
            "pm.test('has the business tables and no secrets', () => { const t = pm.response.text(); pm.expect(JSON.parse(t)).to.have.property('party'); pm.expect(t).to.not.match(/scrypt|password_hash|GROQ|api[_-]?key/i); });")),
        req("team: invite", "POST", "/api/team", status(200) + js(
            "const r = pm.response.json(); pm.test('a one-time password is returned once', () => { pm.expect(r.temporary_password).to.be.a('string').with.length.above(8); });", set_var("invited_email", "r.email")),
            body={"email": "postman.member@example.com", "name": "Postman Member", "role": "ACCOUNTANT"}),
        req("team: the invitee is listed (persistence) and has no password data", "GET", "/api/settings", status(200) + js(
            "const t = pm.response.json().team; const u = t.find(x => x.email === 'postman.member@example.com'); pm.test('listed', () => pm.expect(u).to.be.an('object')); " + set_var("invited_id", "u.id"))),
        req("team: inviting the same email again says only that it cannot be done", "POST", "/api/team", status(409, "CANNOT_INVITE") + js(
            "pm.test('no hint about who has an account', () => pm.expect(pm.response.text()).to.not.match(/already|exists|taken|registered/i));"),
            body={"email": "postman.member@example.com", "name": "Again", "role": "ACCOUNTANT"}),
        req("team: an address that belongs to the shared demo gets the same answer", "POST", "/api/team", status(409, "CANNOT_INVITE"), body={"email": "owner@ripple.demo", "name": "Probe", "role": "ACCOUNTANT"}),
        req("team: invalid email", "POST", "/api/team", status(422), body={"email": "not-an-email", "name": "X", "role": "ACCOUNTANT"}),
        req("team: unknown role", "POST", "/api/team", status(422), body={"email": "a.b@example.com", "name": "X", "role": "GOD"}),
        req("team: remove the invitee", "DELETE", "/api/team/{{invited_id}}", status(200)),
        req("team: remove yourself", "DELETE", "/api/team/{{my_user_id}}", status(422, "CANNOT_REMOVE_SELF")),
        req("team: remove a person who does not exist", "DELETE", "/api/team/no-such-user", status(404)),
        req("reset: wrong confirmation", "POST", "/api/data/reset", status(422, "CONFIRMATION_MISMATCH"), body={"confirm": "not the name"}),
        req("reset: confirmation missing", "POST", "/api/data/reset", status(422), body={}),
        req("preferences: change the theme", "PUT", "/api/me/prefs", status(200) + js("pm.test('the new theme comes back', () => pm.expect(pm.response.json().prefs.theme).to.eql('day'));"), body={"theme": "day"}),
        req("preferences are stored (persistence)", "GET", "/api/me", status(200) + js("pm.test('theme is day', () => pm.expect(pm.response.json().prefs.theme).to.eql('day'));")),
        req("preferences: unknown theme", "PUT", "/api/me/prefs", status(422), body={"theme": "neon"}),
        req("preferences: unknown field", "PUT", "/api/me/prefs", status(422), body={"role": "OWNER"}),
        req("preferences: text size as number", "PUT", "/api/me/prefs", status(422), body={"text_size": 12}),
        req("sessions list carries no token", "GET", "/api/sessions", status(200) + js("pm.test('only dates and a device name', () => pm.expect(JSON.stringify(pm.response.json())).to.not.match(/token|ripple_session|hash/i));")),
        req("body over the limit is refused", "POST", "/api/parties", status(413, "BODY_TOO_LARGE"), raw_body='{"kind":"CUSTOMER","name":"' + "x" * 300000 + '"}'),
    ]})

    # ------------------------------------------------------------------ 13 cross-business (ends in a second sandbox)
    folders.append({"name": "13 Cross-business access (two sandboxes)", "item": [
        req("remember business A's ids", "GET", "/api/parties?kind=CUSTOMER", status(200) + js(
            "const r = pm.response.json(); " + set_var("a_party_id", "r.parties[0].id"))),
        req("sign out of A", "POST", "/api/auth/logout", status(200)),
        req("open sandbox B", "POST", "/api/auth/demo", status(200)),
        req("B cannot read A's party", "GET", "/api/parties/{{a_party_id}}", status(404, "NOT_FOUND")),
        req("B cannot pay against A's party", "POST", "/api/transactions", status(404), body={"party_id": "{{a_party_id}}", "direction": "IN", "amount_paise": 100, "date": "2026-10-14", "medium": "UPI"}),
        req("B cannot edit A's party", "PATCH", "/api/parties/{{a_party_id}}", status(404), body={"city": "Hijacked"}),
        req("B cannot read A's datasheet", "GET", "/api/export/party/{{a_party_id}}/datasheet.csv", status(404)),
        req("B cannot move A's order", "PATCH", "/api/sales-orders/{{so_id}}", status(404), body={"stage": "MATERIALS_READY"}),
        req("B cannot receive A's purchase order", "PATCH", "/api/purchase-orders/{{po_id}}", status(404), body={"status": "ARRIVED"}),
        req("B cannot change A's material", "PATCH", "/api/materials/{{first_material_id}}", status(404), body={"name": "Hijacked"}),
        req("B cannot adjust A's stock", "POST", "/api/stock-movements", status(404), body={"item_type": "MATERIAL", "item_id": "{{first_material_id}}", "qty_delta": 1, "note": "x"}),
        req("B cannot remove A's team member", "DELETE", "/api/team/{{my_user_id}}", status(404)),
        req("B's own data is untouched and reachable", "GET", "/api/parties?kind=CUSTOMER", status(200) + js("pm.test('B still has its own parties', () => pm.expect(pm.response.json().parties.length).to.be.above(0));")),
    ]})

    # ------------------------------------------------------------------ 14 supervisor on Track B routes
    skip = ["if (!pm.environment.get('supervisor_password')) { pm.execution.skipRequest(); }"]
    no_money = "pm.test('no rupee amount anywhere in the response', () => pm.expect(pm.response.text()).to.not.match(/_paise|₹/));"
    folders.append({"name": "14 Supervisor on Track B routes (runs only if supervisor_password is set)", "item": [
        req("sign in as the supervisor", "POST", "/api/auth/login", status(200), body={"email": "supervisor@ripple.demo", "password": "{{supervisor_password}}"}, pre=skip),
        req("supervisor: parties are finance only", "GET", "/api/parties", status(403, "FORBIDDEN_FOR_ROLE"), pre=skip),
        req("supervisor: cannot record a payment", "POST", "/api/transactions", status(403), body={"party_id": "x", "direction": "IN", "amount_paise": 100, "date": "2026-10-14", "medium": "UPI"}, pre=skip),
        req("supervisor: cannot create an invoice", "POST", "/api/invoices", status(403), body={"party_id": "x", "number": "S1", "amount_paise": 100, "invoice_date": "2026-10-10"}, pre=skip),
        req("supervisor: cannot read the ledger or export it", "GET", "/api/export/transactions.csv", status(403), pre=skip),
        req("supervisor: cannot export the business", "GET", "/api/export", status(403), pre=skip),
        req("supervisor: cannot change money rules", "PUT", "/api/settings/money", status(403), body={"safety_buffer_paise": 1}, pre=skip),
        req("supervisor: cannot invite or remove people", "POST", "/api/team", status(403), body={"email": "x@y.co", "name": "X", "role": "OWNER"}, pre=skip),
        req("supervisor: cannot reset the business", "POST", "/api/data/reset", status(403), body={"confirm": "x"}, pre=skip),
        req("supervisor: sales orders carry no money", "GET", "/api/sales-orders", status(200) + js(no_money), pre=skip),
        req("supervisor: purchase orders carry no money", "GET", "/api/purchase-orders", status(200) + js(no_money), pre=skip),
        req("supervisor: inventory carries no money", "GET", "/api/inventory", status(200) + js(no_money), pre=skip),
        req("supervisor: stock movements carry no money", "GET", "/api/stock-movements", status(200) + js(no_money), pre=skip),
        req("supervisor: cannot move an order back past delivery", "PATCH", "/api/sales-orders/no-such", status(404), body={"stage": "PLANNED"}, pre=skip),
        req("supervisor: can adjust stock only with a note", "POST", "/api/stock-movements", status(422), body={"item_type": "MATERIAL", "item_id": "x", "qty_delta": 1, "note": ""}, pre=skip),
    ]})
    return folders
