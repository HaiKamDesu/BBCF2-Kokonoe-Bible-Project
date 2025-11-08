using Microsoft.Extensions.FileProviders;
using System.IO;

var builder = WebApplication.CreateBuilder(args);

var siteContentRoot = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "SiteContent"));
var webRoot = Path.Combine(siteContentRoot, "wwwroot");
var referenceRoot = Path.Combine(siteContentRoot, "reference");

builder.Environment.WebRootPath = webRoot;

var app = builder.Build();

var webRootProvider = new PhysicalFileProvider(webRoot);
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
