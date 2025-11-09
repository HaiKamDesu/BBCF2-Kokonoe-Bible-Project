using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.FileProviders.Physical;
using System.IO;

var builder = WebApplication.CreateBuilder(args);

var repoRoot = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", ".."));
var referenceRoot = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "SiteContent", "reference"));

var webRoot = repoRoot;

builder.Environment.WebRootPath = webRoot;

var app = builder.Build();

var webRootProvider = new PhysicalFileProvider(webRoot, ExclusionFilters.Hidden | ExclusionFilters.System | ExclusionFilters.Sensitive);
var defaultFiles = new DefaultFilesOptions
{
    FileProvider = webRootProvider,
    RequestPath = string.Empty
};
defaultFiles.DefaultFileNames.Clear();
defaultFiles.DefaultFileNames.Add("index.html");
app.UseDefaultFiles(defaultFiles);

app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = webRootProvider,
    RequestPath = string.Empty
});

if (Directory.Exists(referenceRoot))
{
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(referenceRoot),
        RequestPath = "/reference"
    });
}

app.Run();
