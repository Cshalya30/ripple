# Repository Guidelines

Please follow these guidelines throughout the Bug Bounty event.

### 1. Branch Rules
- Each team must maintain a single repository with three branches: `main`, `bugbounty`, and `fixing`.
- `main` is for ongoing development, `bugbounty` is for deployment and peer testing, and `fixing` is for bug fixes.
- Keep `main` and `bugbounty` in sync until the Attack Phase begins.
- **Never delete the `bugbounty` or `fixing` branches.**

### 2. Attack Phase (12:00 AM – 2:00 AM)
- The `bugbounty` branch will be frozen at the start of the Attack Phase. No changes or commits are allowed to this branch after the phase begins.
- Only the code on the `bugbounty` branch will be deployed for peer testing.
- Development may continue on `main`.
- Test only assigned projects and follow the event's testing guidelines.

### 3. Fixing Phase (2:00 AM – 3:30 AM)
- **Create the `fixing` branch directly from `bugbounty`** at the start of the Fixing Phase. Do not create it from `main` or any other branch.
- Commit all bug fixes to the `fixing` branch only.
- Keep `bugbounty` frozen throughout the Fixing Phase and subsequent evaluation.
- All fixing work must stop when the Fixing Phase ends at 3:30 AM.
- **Do not make any commits to the `fixing` branch after the Fixing Phase ends.** Post-deadline commits may result in disqualification from the Bug Bounty round.
- Merge validated fixes into `main` only after the Fixing Phase ends.
- Update `bugbounty` only after the organizers explicitly announce that evaluation is complete and development may resume.

### 4. Bug Reporting Rules
- Each team may report a maximum of **10 bugs overall**, with a maximum of **4 bugs per target team**.
- Bug reports must be clear and reproducible.
- Report critical vulnerabilities or exposed data privately to the organizers.

### 5. Important
- **Do not modify the `bugbounty` branch after the Attack Phase begins.** Unauthorized changes may result in disqualification from the Bug Bounty round.
- **Do not commit to the `fixing` branch after the Fixing Phase ends at 3:30 AM.** Violations may result in disqualification from the Bug Bounty round.
- Do not modify another team's branches or attempt to bypass repository restrictions.
- Test only assigned projects and authorized accounts. Destructive testing, denial-of-service attacks, phishing, malware deployment, and attempts to access unrelated systems are prohibited.

All teams are expected to follow these rules strictly throughout the event.

## Repository layout

This directory is the repository root. The application code, fixtures, tests,
and documentation live directly under it; there is no additional project
subdirectory to enter before running commands.

```text
backend/   FastAPI application and simulation engine
fixtures/  Mandatory simulation fixtures and examples
tests/     Unit and API tests
docs/      Simulation contract and integration notes
```

## Simulation engine

The `simulation-engine` branch includes a typed, deterministic business
simulation module and FastAPI endpoints for running and comparing scenarios.
See the [simulation contract](docs/SIMULATION_CONTRACT.md), [fixtures](docs/SIMULATION_FIXTURES.md),
[examples](docs/SIMULATION_EXAMPLES.md), and [handoff](docs/SIMULATION_HANDOFF.md).

Garment-specific onboarding is documented in the
[snapshot intake guide](docs/SNAPSHOT_INTAKE.md). It extracts reviewed business
facts, builds the existing `BusinessSnapshot`, and leaves simulation execution
to the deterministic engine.

From this repository root, run the tests with:

```text
python -m unittest discover -s tests -v
```

Start the API with:

```text
uvicorn backend.app.main:app --reload
```

To load local Groq settings from `.env` without exposing them in the repository:

```powershell
.\.venv\Scripts\dotenv.exe run -- `
  .\.venv\Scripts\python.exe -m uvicorn backend.app.main:app `
  --host 127.0.0.1 --port 8000
```

Swagger UI is then available at `http://127.0.0.1:8000/docs`.