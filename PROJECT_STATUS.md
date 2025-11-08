> **Reminder for all contributors:** Always review and update this status file before concluding your work. Keeping it current is required.

# Project Status

## Current Objective
- Host a faithful local copy of Dustloop's "BBCF/Kokonoe/Combos" page as the baseline experience.
- Preserve the downloaded Dustloop assets so we can progressively refactor the page into a richer, filterable combo resource.

## Repository Structure (key items)
- `index.html` – Static copy of the Dustloop Kokonoe combo page with asset paths rewritten to load from the local repository.
- `dustloop-assets/` – Local stylesheets, scripts, and media captured from the Dustloop download that power `index.html`.
- `reference/prototype/` – The original prototype landing page that previously lived at the project root; kept for historical context.
- `.gitignore` – Ignores Visual Studio artifacts, local databases, and other environment-specific files.
- `README.md` – High-level project introduction (will be expanded once the custom experience is underway).

## Near-Term Notes
- Validate the static copy in GitHub Pages after deployment; record any assets that fail to load.
- Plan the migration path from the static dump to a React + TypeScript implementation with modular components.
- Define data models for combos (starter, route, resources used, notes, etc.) before introducing filters or dynamic tables.

