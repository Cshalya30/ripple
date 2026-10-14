# Simulation Fixtures

The mandatory fixture set is
[`fixtures/simulation/mandatory-fixtures.json`](../fixtures/simulation/mandatory-fixtures.json).
It is intentionally small enough to inspect and is the source of truth for the
example inputs and outputs. It is not representative of a live integration and
must not be treated as a database seed or production data feed.

The checked-in examples under
[`fixtures/simulation/examples/`](../fixtures/simulation/examples/) are
generated request/response demonstrations. Real integrations should build the
same contract-shaped request from external systems; they should not edit these
files at runtime.

## Scenarios

- **Fixture A / baseline**: old-customer receipt funds the supplier payment,
  production, delivery, and final customer collection.
- **Fixture B / delayed receipt**: delaying the old receipt demonstrates
  dependency-relative schedule movement and delivery lateness.
- **Fixture C / deposit**: a customer deposit preserves the original collection
  total and restores the delayed schedule.
- **Fixture D / credit bridge**: a bounded bridge facility restores delivery and
  repays with explicit daily interest.
- **Fixture E / repayment stress**: delayed collections leave the facility
  outstanding beyond the planning horizon and expose accrued financing cost.

The fixture tests also assert cash, inventory, and debt conservation. Scenario
transformations deep-copy the snapshot, so a scenario cannot mutate the
baseline input.

Regenerate checked-in examples after changing the fixture contract:

```powershell
C:\Users\amanw\AppData\Local\Python\pythoncore-3.14-64\python.exe `
  fixtures\simulation\generate_examples.py
```
