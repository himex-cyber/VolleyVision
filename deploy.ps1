# Deploys VolleyVision to Netlify production with an accurate deploy message.
#
# Usage (from repo root):
#   .\deploy.ps1                      # message auto-built from git state
#   .\deploy.ps1 -Message "hotfix x"  # explicit message override
#   .\deploy.ps1 -SkipMigrationCheck  # skip the pending-migrations check below
#
# The auto-built message is "<tag> (<sha>): <commit subject>", with a
# "+ uncommitted local changes" suffix when the working tree is dirty —
# so the Netlify Deploys list always says exactly what shipped.
#
# Before deploying, this script runs `npx prisma migrate status` from
# backend/ (so it picks up backend/.env) and aborts the deploy if migrations
# are pending or the database is unreachable. Pass -SkipMigrationCheck to
# bypass that check.
#
# Notes:
# - Deploys build LOCALLY and publish the working tree, not a git ref.
# - Requires the Netlify CLI to be logged in as the himextradingltd
#   account (the KP Enterprise account can read the site but deploys 404).
# - If the schema changed, run `npx prisma migrate deploy` from backend/ first.
param([string]$Message, [switch]$SkipMigrationCheck)

$ErrorActionPreference = 'Stop'

if (-not $SkipMigrationCheck) {
  Write-Host "Checking migration status (backend/)..."

  Push-Location backend
  try {
    # Run with ErrorActionPreference Continue: under Stop, PowerShell 5.1
    # turns a native command's stderr lines into terminating NativeCommandErrors
    # when redirected with 2>&1, which would abort the script before we get to
    # inspect the exit code ourselves.
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $migrationOutput = & npx prisma migrate status 2>&1 | Out-String
    $migrationExitCode = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP
  } finally {
    Pop-Location
  }

  if ($migrationExitCode -ne 0) {
    # Never dump prisma's raw output — it echoes the datasource host. Pull just
    # the migration names out of the text after the "not yet applied" heading;
    # a 14-digit-prefixed token there is always a migration directory name.
    $pendingNames = @()
    $markerIndex = $migrationOutput.IndexOf('have not yet been applied')
    if ($markerIndex -ge 0) {
      $tail = $migrationOutput.Substring($markerIndex)
      $pendingNames = @([regex]::Matches($tail, '\d{14}_[A-Za-z0-9_]+') | ForEach-Object { $_.Value } | Select-Object -Unique)
    }

    if ($markerIndex -ge 0) {
      Write-Host ""
      Write-Host "DEPLOY ABORTED: $($pendingNames.Count) migration(s) have not yet been applied:"
      foreach ($name in $pendingNames) { Write-Host "  - $name" }
      Write-Host ""
      Write-Host "Apply them, then re-run deploy:"
      Write-Host "  cd backend; npx prisma migrate deploy"
      exit 1
    } else {
      Write-Host ""
      Write-Host "DEPLOY ABORTED: 'npx prisma migrate status' failed (exit code $migrationExitCode) for a reason other than pending migrations - most likely the database is unreachable."
      Write-Host "Run this manually to see full details: cd backend; npx prisma migrate status"
      exit 1
    }
  }

  Write-Host "Migrations up to date."
}

if (-not $Message) {
  $tag = (git tag --points-at HEAD | Select-Object -First 1)
  $subject = git log -1 --pretty=%s
  $short = git rev-parse --short HEAD
  $dirty = ''
  if (git status --porcelain) { $dirty = ' + uncommitted local changes' }
  if ($tag) {
    $Message = "$tag ($short): $subject$dirty"
  } else {
    $Message = "($short): $subject$dirty"
  }
}

Write-Host "Deploying with message: $Message"
npx netlify-cli@26.2.0 deploy --prod --message "$Message"
