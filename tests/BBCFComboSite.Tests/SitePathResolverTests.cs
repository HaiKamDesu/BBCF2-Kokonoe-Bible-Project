using System;
using System.IO;
using BBCFComboSite;

namespace BBCFComboSite.Tests;

[TestFixture]
public class SitePathResolverTests
{
    [Test]
    public void FindRepositoryRoot_ReturnsSolutionRootWhenPresent()
    {
        using var sandbox = new TemporaryDirectory();
        var solutionRoot = sandbox.DirectoryPath;
        File.WriteAllText(Path.Combine(solutionRoot, "BBCFComboFlowTree.sln"), string.Empty);

        var nestedPath = sandbox.CreateSubdirectory(Path.Combine("a", "b", "c"));

        var resolved = SitePathResolver.FindRepositoryRoot(nestedPath);

        Assert.That(resolved, Is.EqualTo(solutionRoot));
    }

    [Test]
    public void FindRepositoryRoot_UsesContentRootWhenMarkersMissing()
    {
        using var sandbox = new TemporaryDirectory();
        var nestedPath = sandbox.CreateSubdirectory("content");

        var resolved = SitePathResolver.FindRepositoryRoot(nestedPath);

        Assert.That(resolved, Is.EqualTo(Path.GetFullPath(nestedPath)));
    }

    [Test]
    public void FindRepositoryRoot_FallsBackToHtmlMarkers()
    {
        using var sandbox = new TemporaryDirectory();
        var markerRoot = sandbox.CreateSubdirectory("site-root");
        File.WriteAllText(Path.Combine(markerRoot, "combo-sections.json"), "{}");
        File.WriteAllText(Path.Combine(markerRoot, "index.html"), "<html></html>");

        var nestedPath = Path.Combine(markerRoot, "child");
        Directory.CreateDirectory(nestedPath);

        var resolved = SitePathResolver.FindRepositoryRoot(nestedPath);

        Assert.That(resolved, Is.EqualTo(markerRoot));
    }

    [Test]
    public void FindReferenceRoot_PrefersRepoReferenceFolder()
    {
        using var sandbox = new TemporaryDirectory();
        var repoRoot = sandbox.CreateSubdirectory("repo");
        var referencePath = Path.Combine(repoRoot, "src", "SiteContent", "reference");
        Directory.CreateDirectory(referencePath);

        var resolved = SitePathResolver.FindReferenceRoot(repoRoot, repoRoot);

        Assert.That(resolved, Is.EqualTo(referencePath));
    }

    [Test]
    public void FindReferenceRoot_FindsAncestorReferenceDirectory()
    {
        using var sandbox = new TemporaryDirectory();
        var repoRoot = sandbox.CreateSubdirectory(Path.Combine("root", "repo"));
        var ancestorReference = Path.Combine(sandbox.DirectoryPath, "reference");
        Directory.CreateDirectory(ancestorReference);

        var resolved = SitePathResolver.FindReferenceRoot(repoRoot, repoRoot);

        Assert.That(resolved, Is.EqualTo(ancestorReference));
    }

    [Test]
    public void FindReferenceRoot_UsesContentRootAncestorsWhenRepoMissing()
    {
        using var sandbox = new TemporaryDirectory();
        var contentRoot = sandbox.CreateSubdirectory(Path.Combine("content", "nested"));
        var reference = Path.Combine(sandbox.DirectoryPath, "reference");
        Directory.CreateDirectory(reference);

        var resolved = SitePathResolver.FindReferenceRoot(repoRoot: null, contentRoot);

        Assert.That(resolved, Is.EqualTo(reference));
    }

    [Test]
    public void FindReferenceRoot_ReturnsDefaultWhenNoReferenceExists()
    {
        using var sandbox = new TemporaryDirectory();
        var repoRoot = sandbox.CreateSubdirectory("repoRoot");
        var contentRoot = sandbox.CreateSubdirectory("contentRoot");

        var resolved = SitePathResolver.FindReferenceRoot(repoRoot, contentRoot);

        var expected = Path.Combine(repoRoot, "src", "SiteContent", "reference");
        Assert.That(resolved, Is.EqualTo(expected));
    }

    private sealed class TemporaryDirectory : IDisposable
    {
        public string DirectoryPath { get; }

        public TemporaryDirectory()
        {
            DirectoryPath = Path.Combine(Path.GetTempPath(), $"BBCFComboSiteTests_{Guid.NewGuid():N}");
            Directory.CreateDirectory(DirectoryPath);
        }

        public string CreateSubdirectory(string relativePath)
        {
            var fullPath = Path.Combine(DirectoryPath, relativePath);
            Directory.CreateDirectory(fullPath);
            return fullPath;
        }

        public void Dispose()
        {
            try
            {
                if (Directory.Exists(DirectoryPath))
                {
                    Directory.Delete(DirectoryPath, recursive: true);
                }
            }
            catch
            {
                // Ignore cleanup issues; the OS will reclaim the temp folder eventually.
            }
        }
    }
}
