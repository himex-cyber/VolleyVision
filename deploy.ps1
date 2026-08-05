# Deploys VolleyVision to Netlify production with an accurate deploy message.
#
# Usage (from repo root):
#   .\deploy.ps1                      # message auto-built from git state
#   .\deploy.ps1 -Message "hotfix x"  # explicit message override
#
# The auto-built message is "<tag> (<sha>): <commit subject>", with a
# "+ uncommitted local changes" suffix when the working tree is dirty —
# so the Netlify Deploys list always says exactly what shipped.
#
# Notes:
# - Deploys build LOCALLY and publish the working tree, not a git ref.
# - Requires the Netlify CLI to be logged in as the himextradingltd
#   account (the KP Enterprise account can read the site but deploys 404).
# - If the schema changed, run `npx prisma migrate deploy` from backend/ first.
param([string]$Message)

$ErrorActionPreference = 'Stop'

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
