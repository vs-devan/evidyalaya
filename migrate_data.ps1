# eVidyalaya Database Migration Script
# This script copies your entire local PostgreSQL database schema and data to your remote deployment database.

$ErrorActionPreference = "Continue"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "   eVidyalaya Database Migrator (Local -> Prod)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Locate PostgreSQL tools
$pgBinPath = "C:\Program Files\PostgreSQL\18\bin"
$pgDump = Join-Path $pgBinPath "pg_dump.exe"
$psql = Join-Path $pgBinPath "psql.exe"

if (-not (Test-Path $pgDump) -or -not (Test-Path $psql)) {
    # Try searching the system path
    $pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    $psql = Get-Command psql -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    
    if (-not $pgDump -or -not $psql) {
        Write-Host "Error: Could not find pg_dump.exe or psql.exe." -ForegroundColor Red
        Write-Host "Please ensure PostgreSQL is installed and added to your system PATH." -ForegroundColor Yellow
        Write-Host "Expected path: C:\Program Files\PostgreSQL\18\bin" -ForegroundColor Yellow
        exit 1
    }
}

# 2. Read local database connection string from .env.local
$envFile = Join-Path $PSScriptRoot ".env.local"
if (-not (Test-Path $envFile)) {
    Write-Host "Error: .env.local file not found at: $envFile" -ForegroundColor Red
    exit 1
}

$localDbUrl = $null
$content = Get-Content $envFile
foreach ($line in $content) {
    if ($line.Trim() -like "DATABASE_URL=*") {
        $localDbUrl = $line.Substring($line.IndexOf("=") + 1).Trim().Trim('"').Trim("'")
    }
}

if (-not $localDbUrl) {
    Write-Host "Error: DATABASE_URL not found in .env.local" -ForegroundColor Red
    exit 1
}

# Clean local connection string of Prisma-specific query parameters
$cleanLocalDbUrl = $localDbUrl -replace '([\?&])schema=[^&]*', '$1' -replace '([\?&])connection_limit=[^&]*', '$1'
$cleanLocalDbUrl = $cleanLocalDbUrl -replace '\?$', '' -replace '&$', '' -replace '\?&', '?'

$maskedLocal = $cleanLocalDbUrl -replace ':[^/:]+@', ':******@'
Write-Host "✓ Detected Local Database: $maskedLocal" -ForegroundColor Green

# 3. Prompt user for Remote Database URL
Write-Host ""
Write-Host "Enter your REMOTE Database Connection String (e.g. from Neon, Supabase, Vercel Postgres):" -ForegroundColor Yellow
$remoteDbUrl = Read-Host "Remote DATABASE_URL"

if (-not $remoteDbUrl) {
    Write-Host "Operation cancelled. Remote URL cannot be empty." -ForegroundColor Red
    exit 1
}

# Clean remote connection string of Prisma-specific query parameters
$cleanRemoteDbUrl = $remoteDbUrl -replace '([\?&])schema=[^&]*', '$1' -replace '([\?&])connection_limit=[^&]*', '$1'
$cleanRemoteDbUrl = $cleanRemoteDbUrl -replace '\?$', '' -replace '&$', '' -replace '\?&', '?'

Write-Host ""
Write-Host "Preparing migration..." -ForegroundColor Cyan
$tempDumpFile = Join-Path $PSScriptRoot "temp_local_dump.sql"

# 4. Dump local database
Write-Host "1. Dumping local database..." -ForegroundColor Yellow
$dumpError = $null
try {
    & $pgDump -d $cleanLocalDbUrl --clean --no-owner --no-privileges -f $tempDumpFile
} catch {
    $dumpError = $_
}

if ($dumpError -or -not (Test-Path $tempDumpFile)) {
    Write-Host "Error: Failed to dump local database. $dumpError" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Local database successfully dumped to temp file." -ForegroundColor Green

# 5. Restore to remote database
Write-Host "2. Uploading data to remote database (this may take a moment)..." -ForegroundColor Yellow
Write-Host "Note: Existing tables in the remote database's public schema will be overwritten." -ForegroundColor DarkYellow

$restoreError = $null
try {
    & $psql -d $cleanRemoteDbUrl -f $tempDumpFile
} catch {
    $restoreError = $_
}

if ($restoreError) {
    Write-Host "Error occurred during migration: $restoreError" -ForegroundColor Red
} else {
    Write-Host "✓ Remote database successfully populated!" -ForegroundColor Green
}

# 6. Clean up temp dump file
if (Test-Path $tempDumpFile) {
    Remove-Item $tempDumpFile -Force
    Write-Host "✓ Cleaned up temporary dump file." -ForegroundColor Gray
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "   Migration Completed!" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Cyan
