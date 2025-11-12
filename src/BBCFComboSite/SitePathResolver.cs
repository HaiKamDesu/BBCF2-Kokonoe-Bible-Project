using System;
using System.IO;

namespace BBCFComboSite;

internal static class SitePathResolver
{
    public static string FindRepositoryRoot(string contentRootPath)
    {
        if (string.IsNullOrEmpty(contentRootPath))
        {
            throw new ArgumentException("Content root path must be provided.", nameof(contentRootPath));
        }

        var directory = new DirectoryInfo(contentRootPath);

        while (directory is not null)
        {
            var currentPath = directory.FullName;
            if (File.Exists(Path.Combine(currentPath, "BBCFComboFlowTree.sln")))
            {
                return currentPath;
            }

            if (File.Exists(Path.Combine(currentPath, "combo-sections.json")) &&
                File.Exists(Path.Combine(currentPath, "index.html")))
            {
                return currentPath;
            }

            directory = directory.Parent;
        }

        return Path.GetFullPath(contentRootPath);
    }

    public static string FindReferenceRoot(string? repoRoot, string contentRootPath)
    {
        if (string.IsNullOrEmpty(contentRootPath))
        {
            throw new ArgumentException("Content root path must be provided.", nameof(contentRootPath));
        }

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

        return Path.Combine(repoRoot ?? Path.GetFullPath(contentRootPath), "src", "SiteContent", "reference");
    }
}
