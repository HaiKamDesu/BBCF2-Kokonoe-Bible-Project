# BBCF-Combo-FlowTree

Interactive combo flow tree visualizer for BlazBlue Central Fiction.

## Local development

### Prerequisites
- [.NET 8 SDK](https://dotnet.microsoft.com/en-us/download)

### Run the site locally
1. Open the `BBCFComboFlowTree.sln` solution in Visual Studio (2022 or newer).
2. Set **BBCFComboSite** as the startup project.
3. Press <kbd>F5</kbd> or the green **Play** button. The ASP.NET Core host serves the mirrored Dustloop content from the repository root, so you will land on `index.html` with all of the local assets.

You can also launch from the command line with:

```bash
dotnet run --project src/BBCFComboSite/BBCFComboSite.csproj
```

The application listens on the HTTPS and HTTP URLs defined in `Properties/launchSettings.json` (defaults are `https://localhost:7216` and `http://localhost:5216`).

## Deployment

The `index.html` and `dustloop-assets/` directories at the repository root remain ready for GitHub Pages hosting. Any updates to those files are automatically included when you build or run the ASP.NET Core project.
