# BBCF-Combo-FlowTree

Interactive combo flow tree visualizer for BlazBlue Central Fiction.

## Local development

### Prerequisites
- [.NET 8 SDK](https://dotnet.microsoft.com/en-us/download)

### Run the site locally
1. Open the `BBCFComboFlowTree.sln` solution in Visual Studio (2022 or newer).
2. The solution exposes two projects:
   - **BBCFComboSite** – the ASP.NET Core host used for local debugging.
   - **SiteContent** – a content-only project that surfaces `index.html`, `dustloop-assets/`, and the `reference/` material directly in Solution Explorer for editing.
3. Set **BBCFComboSite** as the startup project.
4. Press <kbd>F5</kbd> or the green **Play** button. The ASP.NET Core host serves the mirrored Dustloop content straight from the repository root, so you will land on `index.html` with all of the local assets.

You can also launch from the command line with:

```bash
dotnet run --project src/BBCFComboSite/BBCFComboSite.csproj --urls http://localhost:5216
```

If you encounter build errors in a clean environment, install the .NET SDK first. For example, on Windows grab the installer from the download link above; on macOS/Linux you can use the official `dotnet-install` script:

```bash
curl -sSL https://dot.net/v1/dotnet-install.sh | bash /dev/stdin --channel 8.0
export PATH="$HOME/.dotnet:$PATH"
```

### Run the automated tests
Run the NUnit suite to verify the path resolution logic and hosting setup:

```bash
dotnet test
```

HTTPS is disabled by default to avoid certificate trust prompts. If you prefer HTTPS during local development, restore it by editing `applicationUrl` in `src/BBCFComboSite/Properties/launchSettings.json` and trust the development certificate with `dotnet dev-certs https --trust`.

## Deployment

The `index.html` and `dustloop-assets/` directories at the repository root remain ready for GitHub Pages hosting. Any updates to those files automatically flow into the Visual Studio projects through linked items, so you only edit the files once.

## Loading combo data from a CSV file

The combo tables now read rows from the bundled `combo-spreadsheet.csv` instead of downloading them at runtime. Replace that file with an updated export from your sheet whenever you want to refresh the data.

1. Export your sheet as CSV and overwrite `combo-spreadsheet.csv` at the repo root.
2. (Optional) If you move or rename the file, update `combo-spreadsheet-source.json`:

   ```json
   {
     "csvUrl": "combo-spreadsheet.csv",
     "sectionColumn": "Situation",
     "tableType": "standard"
   }
   ```

   - `sectionColumn` tells the page which column assigns each combo to a section. If a row references a new section name, the page will create that section automatically using default formatting.
   - `tableType` controls which table definition the generated columns inherit from (see `combo-table-definitions.json`).

Any column header that matches a column defined in the chosen table definition will reuse its formatting and filtering. Headers that do not match fall back to a default text column, so you can add new columns without editing the page configuration. If you still prefer a remote CSV (e.g., Google Sheets), you can set `csvUrl` to that export URL; same-origin files are now used by default.
