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
# URL goes to the container as an environment variable, not an argument.
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

# libpq-safe URL: no Prisma query options; session pooler instead of the
# transaction pooler; SSL for Supabase.
function ConvertTo-PgDumpUrl([string]$Url) {
  $uri = [System.Uri]$Url
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

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$name = 'vv-backup-{0}.sql' -f (Get-Date -Format 'yyyy-MM-dd-HHmm')
$file = Join-Path $OutDir $name

foreach ($raw in $candidates) {
  $target = ConvertTo-PgDumpUrl $raw
  Write-Host "Backing up ($($target.Where)) to $file ..."
  & $Docker run --rm -e "DBURL=$($target.Url)" -v "${OutDir}:/backup" postgres:17 `
    sh -c "pg_dump `"`$DBURL`" --no-owner --no-privileges -f /backup/$name"
  if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $file) -and (Get-Item -LiteralPath $file).Length -gt 0) {
    $kb = [math]::Round((Get-Item -LiteralPath $file).Length / 1KB)
    $tables = (Select-String -LiteralPath $file -Pattern '^CREATE TABLE' | Measure-Object).Count
    Write-Host "Backup saved: $file ($kb KB, $tables tables). Keep it private." -ForegroundColor Green
    exit 0
  }
  if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
  Write-Host "That connection didn't work; trying the next one if there is one." -ForegroundColor Yellow
}

Write-Host 'BACKUP FAILED. Nothing was saved.' -ForegroundColor Red
Write-Host "If Docker can't reach Supabase, put the Session pooler URL (Supabase > Connect > Session pooler) into DIRECT_URL in backend/.env and run this again."
exit 1
