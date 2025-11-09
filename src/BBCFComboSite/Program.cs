using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.FileProviders.Physical;
using Microsoft.Extensions.Hosting;
using System;
using System.IO;

var initialContentRoot = Directory.GetCurrentDirectory();
var repoRoot = FindRepositoryRoot(initialContentRoot);

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = repoRoot,
    WebRootPath = repoRoot
});

var referenceRoot = FindReferenceRoot(repoRoot, initialContentRoot);

var webRoot = builder.Environment.WebRootPath;

var app = builder.Build();

app.Logger.LogInformation("Serving static files from {WebRoot}", webRoot);
if (!string.Equals(webRoot, initialContentRoot, StringComparison.Ordinal))
{
    app.Logger.LogDebug(
        "Initial content root was {InitialContentRoot}; static web root adjusted to {WebRoot}",
        initialContentRoot,
        webRoot);
}

var webRootProvider = new PhysicalFileProvider(webRoot, ExclusionFilters.Hidden | ExclusionFilters.System | ExclusionFilters.Sensitive);
var defaultFiles = new DefaultFilesOptions
{
    FileProvider = webRootProvider,
    RequestPath = string.Empty
};
defaultFiles.DefaultFileNames.Clear();
defaultFiles.DefaultFileNames.Add("index.html");
app.UseDefaultFiles(defaultFiles);

var staticFileLogger = app.Logger;

app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = webRootProvider,
    RequestPath = string.Empty,
    OnPrepareResponse = ctx =>
    {
        var physicalPath = ctx.File?.PhysicalPath ?? "(unknown)";
        staticFileLogger.LogDebug(
            "Static file request for {RequestPath} resolved to {PhysicalPath}",
            ctx.Context.Request.Path,
            physicalPath);

        if (!string.IsNullOrEmpty(physicalPath) &&
            ".json".Equals(Path.GetExtension(physicalPath), StringComparison.OrdinalIgnoreCase))
        {
            var headers = ctx.Context.Response.Headers;
            headers.CacheControl = "no-store, no-cache, must-revalidate";
            headers.Pragma = "no-cache";
            headers.Expires = "0";
        }
    }
});

if (Directory.Exists(referenceRoot))
{
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(referenceRoot),
        RequestPath = "/reference"
    });
}
else
{
    app.Logger.LogWarning("Reference assets directory not found at {ReferenceRoot}", referenceRoot);
}

app.Run();

static string FindRepositoryRoot(string contentRootPath)
{
    var directory = new DirectoryInfo(contentRootPath);

    while (directory is not null)
    {
        if (File.Exists(Path.Combine(directory.FullName, "BBCFComboFlowTree.sln")))
        {
            return directory.FullName;
        }

        if (File.Exists(Path.Combine(directory.FullName, "combo-sections.json")) &&
            File.Exists(Path.Combine(directory.FullName, "index.html")))
        {
            return directory.FullName;
        }

        directory = directory.Parent;
    }

    return contentRootPath;
}

static string FindReferenceRoot(string? repoRoot, string contentRootPath)
{
    if (!string.IsNullOrEmpty(repoRoot))
    {
        var directReferencePath = Path.Combine(repoRoot, "src", "SiteContent", "reference");
        if (Directory.Exists(directReferencePath))
        {
            return directReferencePath;
        }

        var directory = new DirectoryInfo(repoRoot);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "reference");
            if (Directory.Exists(candidate))
            {
                return candidate;
            }

            directory = directory.Parent;
        }
    }

    var fallbackDirectory = new DirectoryInfo(contentRootPath);
    while (fallbackDirectory is not null)
    {
        var candidate = Path.Combine(fallbackDirectory.FullName, "reference");
        if (Directory.Exists(candidate))
        {
            return candidate;
        }

        fallbackDirectory = fallbackDirectory.Parent;
    }

    return Path.Combine(repoRoot ?? contentRootPath, "src", "SiteContent", "reference");
}
