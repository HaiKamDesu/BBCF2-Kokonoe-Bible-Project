using BBCFComboSite;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.FileProviders.Physical;
using Microsoft.Extensions.Hosting;
using System;
using System.IO;

var initialContentRoot = Directory.GetCurrentDirectory();
var repoRoot = SitePathResolver.FindRepositoryRoot(initialContentRoot);

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = repoRoot,
    WebRootPath = repoRoot
});

var referenceRoot = SitePathResolver.FindReferenceRoot(repoRoot, initialContentRoot);

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
