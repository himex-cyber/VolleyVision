# Deploys VolleyVision to Netlify (production by default, or staging) with an
# accurate deploy message, then runs the smoke check against what it deployed.
#
# Usage (from repo root):
#   .\deploy.ps1                      # prod; message auto-built from git state
#   .\deploy.ps1 -Target staging      # the staging site, using backend/.env.staging
#   .\deploy.ps1 -Message "hotfix x"  # explicit message override
#   .\deploy.ps1 -SkipMigrationCheck  # skip the pending-migrations check below
#   .\deploy.ps1 -Force               # prod from a dirty tree or a branch other than main
#
# The auto-built message is "<tag> (<sha>): <commit subject>", with a
# "+ uncommitted local changes" suffix when the working tree is dirty —
# so the Netlify Deploys list always says exactly what shipped.
#
# Before deploying, this script runs `npx prisma migrate status` from
# backend/ and aborts the deploy if migrations are pending or the database is
# unreachable. Pass -SkipMigrationCheck to bypass that check. For prod it reads
# backend/.env as before; for staging it loads backend/.env.staging into the
# environment for that step only (real environment variables override Prisma's
# own .env loading) and restores the environment afterwards.
#
# Prod refuses a dirty working tree or a branch other than main unless -Force:
# a prod deploy publishes the working tree, not a git ref.
#
# After a successful deploy it runs backend/scripts/smoke.mjs: against prod
# with no credentials (read-only checks), against staging with the SMOKE_*
# values from backend/.env.staging (logs in as the seed users).
#
# Notes:
# - Deploys build LOCALLY (--build) and publish the working tree, not a git
#   ref. --build is load-bearing: it runs netlify.toml's build command with
#   the site's env vars injected. Without it the CLI just uploads whatever
#   frontend/dist already holds, built against a shell that has no
#   VITE_SENTRY_DSN -- and since main.tsx guards Sentry.init on that var,
#   Vite tree-shakes the SDK out entirely and the frontend ships with no
#   error tracking at all, silently. Verified: the dist built that way
#   contains zero Sentry code.
# - Requires the Netlify CLI to be logged in as the himextradingltd
#   account (the KP Enterprise account can read the site but deploys 404).
# - If the schema changed, run `npx prisma migrate deploy` from backend/ first
#   (with backend/.env.staging loaded, for staging).
param(
  [ValidateSet('prod', 'staging')][string]$Target = 'prod',
  [string]$Message,
  [switch]$SkipMigrationCheck,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$ProdUrl = 'https://volleyvision-app.netlify.app'
# Prod identifiers a staging deploy must never point at (a copy-pasted
# .env.staging would otherwise publish any branch straight to prod).
$ProdSiteId = '7b2795e8-4722-40cf-bb35-b2fc4e17e813'
$ProdProjectRef = 'rkkhrmhorgdqkxflipui'

# Parses KEY=VALUE lines (comments and blanks skipped, one pair of surrounding
# quotes stripped). Never prints values: the file holds staging secrets.
function Read-EnvFile([string]$Path) {
  $vars = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }
    $eq = $trimmed.IndexOf('=')
    if ($eq -lt 1) { continue }
    $key = $trimmed.Substring(0, $eq).Trim()
    $value = $trimmed.Substring($eq + 1).Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $vars[$key] = $value
  }
  return $vars
}

# Runs $Block with $Vars set as environment variables, then puts every one of
# them back exactly as it was (including "was unset").
function Invoke-WithEnv([hashtable]$Vars, [scriptblock]$Block) {
  $saved = @{}
  foreach ($key in $Vars.Keys) {
    $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, $Vars[$key], 'Process')
  }
  try {
    & $Block
  } finally {
    foreach ($key in $saved.Keys) {
      [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process')
    }
  }
}

$stagingVars = @{}
if ($Target -eq 'staging') {
  $stagingEnvPath = Join-Path $PSScriptRoot 'backend/.env.staging'
  if (-not (Test-Path -LiteralPath $stagingEnvPath)) {
    Write-Host "DEPLOY ABORTED: backend/.env.staging not found (see backend/.env.staging.example)."
    exit 1
  }
  $stagingVars = Read-EnvFile $stagingEnvPath
  foreach ($required in @('DATABASE_URL', 'DIRECT_URL', 'NETLIFY_STAGING_SITE_ID', 'STAGING_URL')) {
    if (-not $stagingVars[$required]) {
      Write-Host "DEPLOY ABORTED: $required is missing from backend/.env.staging."
      exit 1
    }
  }
  if ($stagingVars['NETLIFY_STAGING_SITE_ID'] -eq $ProdSiteId -or $stagingVars['STAGING_URL'].TrimEnd('/') -eq $ProdUrl -or
      $stagingVars['DATABASE_URL'].Contains($ProdProjectRef) -or $stagingVars['DIRECT_URL'].Contains($ProdProjectRef)) {
    Write-Host "DEPLOY ABORTED: backend/.env.staging points at production (site id, URL or database). Fix it before deploying to staging."
    exit 1
  }
} else {
  $branch = git rev-parse --abbrev-ref HEAD
  $isDirty = [bool](git status --porcelain)
  if (-not $Force -and ($isDirty -or $branch -ne 'main')) {
    Write-Host "DEPLOY ABORTED: prod deploys run from a clean checkout of main (branch: $branch, uncommitted changes: $isDirty)."
    Write-Host "Commit or stash, switch to main, or pass -Force if you really mean it."
    exit 1
  }
}

if (-not $SkipMigrationCheck) {
  Write-Host "Checking migration status ($Target)..."

  # The staging variables are set only around this step; the Netlify build
  # below must see the staging SITE's env vars, not this shell's.
  $migrationEnv = @{}
  if ($Target -eq 'staging') {
    $migrationEnv = @{ DATABASE_URL = $stagingVars['DATABASE_URL']; DIRECT_URL = $stagingVars['DIRECT_URL'] }
  }

  Push-Location backend
  try {
    Invoke-WithEnv $migrationEnv {
      # Run with ErrorActionPreference Continue: under Stop, PowerShell 5.1
      # turns a native command's stderr lines into terminating NativeCommandErrors
      # when redirected with 2>&1, which would abort the script before we get to
      # inspect the exit code ourselves.
      $prevEAP = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      $script:migrationOutput = & npx prisma migrate status 2>&1 | Out-String
      $script:migrationExitCode = $LASTEXITCODE
      $ErrorActionPreference = $prevEAP
    }
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
      if ($Target -eq 'staging') {
        Write-Host "  (with backend/.env.staging loaded) cd backend; npx prisma migrate deploy"
      } else {
        Write-Host "  cd backend; npx prisma migrate deploy"
      }
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

$netlifyArgs = @('netlify-cli@26.2.0', 'deploy', '--prod', '--build', '--message', "$Message")
# --prod publishes to the site's production URL; --site always names the site,
# so a stale local .netlify link can't publish prod code to another site while
# the smoke check passes against the unchanged prod URL.
if ($Target -eq 'staging') {
  $netlifyArgs += @('--site', $stagingVars['NETLIFY_STAGING_SITE_ID'])
} else {
  $netlifyArgs += @('--site', $ProdSiteId)
}

Write-Host "Deploying to $Target with message: $Message"
# Same PowerShell 5.1 trap as the migration check above: under Stop, npm's
# harmless stderr warnings (e.g. "npm warn allow-scripts") become terminating
# NativeCommandErrors and abort the deploy before it starts. Run with Continue
# and judge success by the CLI's exit code instead.
$ErrorActionPreference = 'Continue'
& npx @netlifyArgs
$deployExitCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($deployExitCode -ne 0) {
  Write-Host ""
  Write-Host "DEPLOY FAILED (exit code $deployExitCode). Check the output above for whether anything was published."
  exit $deployExitCode
}

Write-Host ""
Write-Host "Running the smoke check against $Target..."
if ($Target -eq 'staging') {
  $smokeEnv = @{}
  foreach ($key in $stagingVars.Keys) {
    if ($key.StartsWith('SMOKE_')) { $smokeEnv[$key] = $stagingVars[$key] }
  }
  $smokeUrl = $stagingVars['STAGING_URL']
} else {
  # Prod runs only the read-only checks: blank any SMOKE_* left in this shell.
  $smokeEnv = @{ SMOKE_EMAIL = $null; SMOKE_PASSWORD = $null; SMOKE_OUTSIDER_EMAIL = $null; SMOKE_OUTSIDER_PASSWORD = $null }
  $smokeUrl = $ProdUrl
}
Invoke-WithEnv $smokeEnv {
  $ErrorActionPreference = 'Continue'
  & node (Join-Path $PSScriptRoot 'backend/scripts/smoke.mjs') $smokeUrl
  $script:smokeExitCode = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
}
if ($smokeExitCode -ne 0) {
  Write-Host ""
  Write-Host "DEPLOYED, BUT THE SMOKE CHECK FAILED (exit code $smokeExitCode). The new version is live on $Target - check it now."
  exit $smokeExitCode
}
