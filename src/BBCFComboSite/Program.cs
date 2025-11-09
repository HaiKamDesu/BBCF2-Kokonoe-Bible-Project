using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.FileProviders.Physical;
using System.IO;

var builder = WebApplication.CreateBuilder(args);

var repoRoot = FindRepositoryRoot(builder.Environment.ContentRootPath);
var referenceRoot = Path.Combine(repoRoot, "src", "SiteContent", "reference");

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

static string FindRepositoryRoot(string contentRootPath)
{
    var directory = new DirectoryInfo(contentRootPath);

    while (directory is not null)
    {
        var candidate = Path.Combine(directory.FullName, "BBCFComboFlowTree.sln");

        if (File.Exists(candidate))
        {
            return directory.FullName;
        }

        directory = directory.Parent;
    }

    return contentRootPath;
}
