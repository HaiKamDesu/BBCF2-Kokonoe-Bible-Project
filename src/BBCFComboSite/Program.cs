using Microsoft.Extensions.FileProviders;
using System.IO;

var builder = WebApplication.CreateBuilder(args);

var repoRoot = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", ".."));
var fileProvider = new PhysicalFileProvider(repoRoot);

builder.Environment.WebRootPath = repoRoot;

var app = builder.Build();

var defaultFiles = new DefaultFilesOptions
{
    FileProvider = fileProvider,
    RequestPath = string.Empty
};
defaultFiles.DefaultFileNames.Clear();
defaultFiles.DefaultFileNames.Add("index.html");
app.UseDefaultFiles(defaultFiles);

app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = fileProvider,
    RequestPath = string.Empty
});

app.Run();
