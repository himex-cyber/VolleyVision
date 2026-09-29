# Backs up the production database to a dated .sql file with pg_dump, run in
# Docker (postgres:17, matching Supabase's Postgres 17), so nothing needs
# installing. Take one before every prod migration and deploy: the Supabase free
# plan keeps no downloadable backups.
#
# Usage (from repo root, Docker Desktop running):
#   .\backup.ps1                              # -> $HOME\Backups\vv-backup-<date>.sql
#   .\backup.ps1 -OutDir D:\Backups           # somewhere else
#
# It reads DIRECT_URL (else DATABASE_URL) from backend/.env and never prints it.
# The URL goes to the container as an environment variable, not an argument.
# Prisma's query options (pgbouncer=true, connection_limit, schema, ...) aren't
# valid libpq options, so they're dropped. Supabase's transaction pooler (port
# 6543) can't run pg_dump, so the session pooler on 5432 is used instead.
#
# The file holds every user's and player's data (players can be minors): keep it
# out of the repo and somewhere private.
param(
  [string]$OutDir = (Join-Path $HOME 'Backups'),
  [string]$EnvFile = (Join-Path $PSScriptRoot 'backend\.env')
)

$ErrorActionPreference = 'Stop'
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

if (-not (Test-Path -LiteralPath $EnvFile)) { throw "Can't find $EnvFile." }
$url = Read-EnvValue $EnvFile 'DIRECT_URL'
if (-not $url) { $url = Read-EnvValue $EnvFile 'DATABASE_URL' }
if (-not $url) { throw "Neither DIRECT_URL nor DATABASE_URL is set in $EnvFile." }

# libpq-safe URL: no Prisma query options; session pooler instead of the
# transaction pooler; SSL for Supabase.
$uri = [System.Uri]$url
$port = if ($uri.Port -eq 6543) { 5432 } else { $uri.Port }
$ssl = if ($uri.Host -like '*.supabase.com' -or $uri.Host -like '*.supabase.co') { '?sslmode=require' } else { '' }
$clean = '{0}://{1}@{2}:{3}{4}{5}' -f $uri.Scheme, $uri.UserInfo, $uri.Host, $port, $uri.AbsolutePath, $ssl

& $Docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker is not running. Start Docker Desktop and try again.' }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$name = 'vv-backup-{0}.sql' -f (Get-Date -Format 'yyyy-MM-dd-HHmm')
$file = Join-Path $OutDir $name

Write-Host "Backing up to $file (host $($uri.Host), port $port)..."
& $Docker run --rm -e "DBURL=$clean" -v "${OutDir}:/backup" postgres:17 `
  sh -c "pg_dump `"`$DBURL`" --no-owner --no-privileges -f /backup/$name"
$code = $LASTEXITCODE

if ($code -ne 0 -or -not (Test-Path -LiteralPath $file) -or (Get-Item -LiteralPath $file).Length -eq 0) {
  if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
  Write-Host "BACKUP FAILED (pg_dump exit $code). Nothing was saved." -ForegroundColor Red
  if ($uri.Host -like 'db.*.supabase.co') {
    Write-Host "Docker on Windows often can't reach Supabase's direct host (IPv6 only). Put the Session pooler URL from Supabase > Connect into DIRECT_URL, or run with -EnvFile pointing at a file that has it."
  }
  exit 1
}

$kb = [math]::Round((Get-Item -LiteralPath $file).Length / 1KB)
$tables = (Select-String -LiteralPath $file -Pattern '^CREATE TABLE' | Measure-Object).Count
Write-Host "Backup saved: $file ($kb KB, $tables tables). Keep it private." -ForegroundColor Green
