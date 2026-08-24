# migrate-layout.ps1
# Migrates all Company Admin pages from manual Layout/Sidebar/Content wrapping
# to the new AppShell component.
#
# For each .jsx file in src/pages/company/admin/:
#   1. Add import for AppShell and PageHeader
#   2. Replace <Layout style={{ minHeight: '100vh' ... }}>\n<CompanySidebar />\n<Layout...>\n<Content...>
#      with <AppShell sidebar={<CompanySidebar />}>
#   3. Replace closing </Content></Layout></Layout> with </AppShell>

$adminDir = "D:\send 4\frontend\src\pages\company\admin"

# Skip dashboard.jsx (already migrated)
$files = Get-ChildItem -Path $adminDir -Filter "*.jsx" -Recurse | Where-Object { $_.Name -ne "dashboard.jsx" }

foreach ($file in $files) {
    $content = Get-Content -Path $file.FullName -Raw

    # Skip if already migrated
    if ($content -match "AppShell") {
        Write-Host "SKIP (already migrated): $($file.FullName)"
        continue
    }

    # Skip if doesn't have the pattern
    if ($content -notmatch "minHeight: '100vh'") {
        Write-Host "SKIP (no layout pattern): $($file.FullName)"
        continue
    }

    $original = $content

    # Calculate relative path depth to determine import path prefix
    $relativePath = $file.FullName.Replace($adminDir, "").TrimStart("\").Replace("\", "/")
    $depth = ($relativePath.Split("/").Length - 1)  # depth of subdirectory within admin
    
    if ($depth -eq 0) {
        # file is directly in admin/ e.g., eBRC_Bulk_Download.jsx
        $appShellImport = "import AppShell from '../../../components/layout/AppShell.jsx'"
        $pageHeaderImport = "import PageHeader from '../../../components/common/PageHeader.jsx'"
    } else {
        # file is in a subdirectory e.g., admin/process/startprocess.jsx
        $appShellImport = "import AppShell from '../../../../components/layout/AppShell.jsx'"
        $pageHeaderImport = "import PageHeader from '../../../../components/common/PageHeader.jsx'"
    }

    # Add AppShell import after CompanySidebar import if not already present
    if ($content -notmatch "AppShell") {
        $content = $content -replace "(import CompanySidebar from [^\n]+)", "`$1`n$appShellImport`n$pageHeaderImport"
    }

    # Remove 'const { Content } = Layout' line (no longer needed in most cases)
    # But keep it if Content is used elsewhere (some files use Content directly)
    # For safety, we'll leave it

    # Pattern 1: <Layout style={{ minHeight: '100vh', background: '#fff' }}>
    # followed by <CompanySidebar /> then <Layout style={{ ... }}>  then <Content style={{ ... }}>
    # This is a multi-line replacement - use regex

    # Replace opening: <Layout style={{ minHeight: '100vh', background: '#fff' }}>  <CompanySidebar />  <Layout ...>  <Content ...>
    # With: <AppShell sidebar={<CompanySidebar />}>

    # Match the opening pattern (varies slightly across files)
    $openPattern = '<Layout style=\{\{ minHeight: .100vh.[^}]*\}\}>\s*\r?\n\s*<CompanySidebar\s*/>\s*\r?\n\s*<Layout[^>]*>\s*\r?\n\s*<Content[^>]*>'
    $content = [regex]::Replace($content, $openPattern, '<AppShell sidebar={<CompanySidebar />}>')

    # Replace closing: </Content>  </Layout>  </Layout>  (possibly with modal between last two)
    # This is trickier because some files have modals between </Layout> tags
    
    # Simple case: </Content>\n</Layout>\n</Layout>  at end of return
    # We need to replace the last 3 closing tags pattern
    
    # Replace </Content> with nothing (AppShell already wraps content)
    # Replace the double </Layout> at the end with </AppShell>
    
    # Find </Content> followed eventually by </Layout> </Layout>
    # Simple approach: replace </Content>\s*</Layout>\s*</Layout> with </AppShell>
    $content = [regex]::Replace($content, '</Content>\s*\r?\n\s*</Layout>\s*\r?\n\s*</Layout>', '</AppShell>')

    # Some files also have </Content></Layout> then modal then </Layout>
    # Pattern: </Content>\n</Layout>\n\n<Modal...>...</Modal>\n</Layout>
    # In those cases, the first replacement didn't match. Let's handle:
    # Replace </Content>\n</Layout> with just a blank (content flows into AppShell area)
    # Then the final </Layout> becomes </AppShell>
    
    # Check if there's still an unclosed pattern
    if ($content -match '</Content>\s*\r?\n\s*</Layout>') {
        $content = [regex]::Replace($content, '</Content>\s*\r?\n\s*</Layout>', '')
        # Now replace the last standalone </Layout> in the return statement with </AppShell>
        # Find the last </Layout> and replace with </AppShell>
        $lastIdx = $content.LastIndexOf('</Layout>')
        if ($lastIdx -gt 0) {
            $content = $content.Substring(0, $lastIdx) + '</AppShell>' + $content.Substring($lastIdx + '</Layout>'.Length)
        }
    }

    if ($content -ne $original) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        Write-Host "MIGRATED: $($file.FullName)"
    } else {
        Write-Host "NO CHANGE: $($file.FullName)"
    }
}

Write-Host "`nDone! Migration complete."
