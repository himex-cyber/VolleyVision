# Backs up the production database to a dated .sql file with pg_dump, run in
# Docker (postgres:17, matching Supabase's Postgres 17), so nothing needs
# installing. Take one before every prod migration and deploy: the Supabase free
# plan keeps no downloadable backups.
#
# Usage (from repo root, Docker Desktop running):
#   .\backup.ps1                              # -> $HOME\Backups\vv-backup-<date>.sql
#   .\backup.ps1 -OutDir D:\Backups           # somewhere else
#
# It reads DIRECT_URL, then DATABASE_URL, from backend/.env and never prints
# them; the first that works is used. (Docker on Windows often can't reach
# Supabase's direct host, which is IPv6-only; the pooler URL then works.) The
# URL reaches the container through this script's environment (`-e DBURL`
# with no value), so it never appears on docker.exe's command line or in the
# process list. `docker inspect` still shows it while the (--rm, seconds-long)
# container runs; that's the local Docker daemon only.
# Prisma's query options (pgbouncer=true, connection_limit, schema, ...) aren't
# valid libpq options, so they're dropped. Supabase's transaction pooler (port
# 6543) can't run pg_dump, so the session pooler on 5432 is used instead.
#
# The file holds every user's and player's data, in plain text: emails,
# password hashes, and players who can be minors. Keep it somewhere private; it
# refuses to write inside the repo. It doesn't cover chat attachments, which
# live in Supabase Storage.
param(
  [string]$OutDir = (Join-Path $HOME 'Backups'),
  [string]$EnvFile = (Join-Path $PSScriptRoot 'backend\.env')
)

$ErrorActionPreference = 'Stop'
# Resolved against PowerShell's location, not .NET's current directory (which
# Set-Location doesn't move): the in-repo check below and docker's -v mount
# must see the folder New-Item actually creates.
$OutDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutDir)
$Docker = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'

function Read-EnvValue([string]$Path, [string]$Key) {
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match "^\s*$Key\s*=\s*(.*)$") {
      $v = $Matches[1].Trim()
      if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) {
        $v = $v.Substring(1, $v.Length - 2)
      }
      return $v
    }
  }
  return $null
}

# libpq-safe URL: no Prisma query options; session pooler instead of the
# transaction pooler; SSL for Supabase.
function ConvertTo-PgDumpUrl([string]$Url) {
  # A malformed URL (an unencoded special character in the password) makes the
  # cast throw an error that quotes the whole value, password included.
  try { $uri = [System.Uri]$Url } catch { return $null }
  $port = if ($uri.Port -eq 6543) { 5432 } else { $uri.Port }
  $ssl = if ($uri.Host -like '*.supabase.com' -or $uri.Host -like '*.supabase.co') { '?sslmode=require' } else { '' }
  return @{
    Url  = '{0}://{1}@{2}:{3}{4}{5}' -f $uri.Scheme, $uri.UserInfo, $uri.Host, $port, $uri.AbsolutePath, $ssl
    Where = "host $($uri.Host), port $port"
  }
}

if (-not (Test-Path -LiteralPath $EnvFile)) { throw "Can't find $EnvFile." }
$candidates = @('DIRECT_URL', 'DATABASE_URL') |
  ForEach-Object { Read-EnvValue $EnvFile $_ } |
  Where-Object { $_ } |
  Select-Object -Unique
if (-not $candidates) { throw "Neither DIRECT_URL nor DATABASE_URL is set in $EnvFile." }

& $Docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker is not running. Start Docker Desktop and try again.' }

$sep = [System.IO.Path]::DirectorySeparatorChar
$repoRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd($sep) + $sep
$outFull = [System.IO.Path]::GetFullPath($OutDir).TrimEnd($sep) + $sep
if ($outFull.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to write a backup inside the repo ($OutDir): it holds everyone's data in plain text. Pick a folder outside it."
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$name = 'vv-backup-{0}.sql' -f (Get-Date -Format 'yyyy-MM-dd-HHmm')
$file = Join-Path $OutDir $name

foreach ($raw in $candidates) {
  $target = ConvertTo-PgDumpUrl $raw
  if (-not $target) {
    Write-Host "One of the connection strings in the env file isn't a valid URL (check for unencoded special characters in the password); trying the next one if there is one." -ForegroundColor Yellow
    continue
  }
  Write-Host "Backing up ($($target.Where)) to $file ..."
  try {
    $env:DBURL = $target.Url
    & $Docker run --rm -e DBURL -v "${OutDir}:/backup" postgres:17 `
      sh -c "pg_dump `"`$DBURL`" --no-owner --no-privileges -f /backup/$name"
  } finally {
    Remove-Item Env:DBURL -ErrorAction SilentlyContinue
  }
  if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $file) -and (Get-Item -LiteralPath $file).Length -gt 0) {
    $kb = [math]::Round((Get-Item -LiteralPath $file).Length / 1KB)
    $tables = (Select-String -LiteralPath $file -Pattern '^CREATE TABLE' | Measure-Object).Count
    Write-Host "Backup saved: $file ($kb KB, $tables tables). Keep it private." -ForegroundColor Green
    Write-Host 'Not included: chat attachments (they live in Supabase Storage).'
    exit 0
  }
  if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
  Write-Host "That connection didn't work; trying the next one if there is one." -ForegroundColor Yellow
}

Write-Host 'BACKUP FAILED. Nothing was saved.' -ForegroundColor Red
Write-Host "If Docker can't reach Supabase, put the Session pooler URL (Supabase > Connect > Session pooler) into DIRECT_URL in backend/.env and run this again."
exit 1
