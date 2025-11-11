> **Reminder for all contributors:** Always review and update this status file before concluding your work. Keeping it current is required.
>
# Project Status

## Current Objective
- Host a faithful local copy of Dustloop's "BBCF/Kokonoe/Combos" page as the baseline experience.
- Preserve the downloaded Dustloop assets so we can progressively refactor the page into a richer, filterable combo resource.
- Provide an ASP.NET Core host so the site can be launched directly from Visual Studio while maintaining GitHub Pages compatibility.

## Repository Structure (key items)
- `BBCFComboFlowTree.sln` – Visual Studio solution that loads the hosting project and the static content project side-by-side.
- `src/BBCFComboSite/` – ASP.NET Core project configured to serve the static assets that live in `SiteContent/wwwroot/` via a physical file provider.
- `src/SiteContent/` – .NET SDK content project that now owns the site files under `wwwroot/` alongside the archived `reference/` artifacts.
- `src/SiteContent/wwwroot/index.html` – Static copy of the Dustloop Kokonoe combo page with asset paths rewritten to load from the local repository.
- `src/SiteContent/wwwroot/combo-sections.js` / `src/SiteContent/wwwroot/combo-sections.json` – Runtime loader and data backing the editable combo sections.
- `src/SiteContent/wwwroot/dustloop-assets/` – Local stylesheets, scripts, and media captured from the Dustloop download that power `index.html`.
- `src/SiteContent/reference/` – Supporting artifacts retained from earlier iterations of the project.
- `.gitignore` – Ignores Visual Studio artifacts, local databases, .NET build outputs, and other environment-specific files.
- `README.md` – High-level project introduction and local run instructions.

## Near-Term Notes
- High-level sections (Resources through Navigation) now load from `page-sections.json`, which points to HTML fragments in `sections/` and the combo data sources.
- `combo-sections.js` waits for the `combo-sections-root-ready` event so combo tables initialise after the dynamic layout loads.
- Update `page-sections.json` (and the referenced fragments) to add, remove, reorder, or rename major sections.
- Validate the static copy in GitHub Pages after deployment; record any assets that fail to load.
- Confirm the ASP.NET Core project launches successfully in Visual Studio. (HTTPS is disabled by default to avoid dev-certificate warnings; re-enable as needed.)
- Plan the migration path from the static dump to a React + TypeScript implementation with modular components.
- Define data models for combos (starter, route, resources used, notes, etc.) before introducing filters or dynamic tables.
