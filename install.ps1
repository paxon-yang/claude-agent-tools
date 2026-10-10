# Claude Agent Tools - Windows installer (PowerShell)
# Usage:  irm https://raw.githubusercontent.com/paxon-yang/claude-agent-tools/main/install.ps1 | iex
# It clones (or updates) the repo into %USERPROFILE%\claude-agent-tools and runs install.sh with Git Bash,
# which Claude Code on Windows already requires.
$ErrorActionPreference = 'Stop'
function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Host "x  $cmd not found. $hint" -ForegroundColor Red; exit 1 }
}
Need git    'Install Git for Windows first: https://git-scm.com/download/win'
Need node   'Install Node.js 18+ first: https://nodejs.org'
Need claude 'Install Claude Code first: https://code.claude.com/docs/en/setup'

$dir = Join-Path $HOME 'claude-agent-tools'
if (Test-Path (Join-Path $dir '.git')) {
  Write-Host "Updating $dir ..."
  git -C $dir pull --ff-only
} else {
  Write-Host "Cloning into $dir ..."
  git clone https://github.com/paxon-yang/claude-agent-tools.git $dir
}

$candidates = @(
  "$env:ProgramFiles\Git\bin\bash.exe",
  "${env:ProgramFiles(x86)}\Git\bin\bash.exe",
  "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
)
$gitExe = (Get-Command git).Source
$candidates += (Join-Path (Split-Path (Split-Path $gitExe)) 'bin\bash.exe')
$bash = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $bash) { Write-Host 'x  Git Bash (bash.exe) not found. Reinstall Git for Windows.' -ForegroundColor Red; exit 1 }

# Language for the installers and the router UI (en|zh). An existing CAT_LANG wins;
# otherwise Chinese Windows UI/culture -> zh, anything else -> en. Bash inherits the variable.
if (-not $env:CAT_LANG) {
  $ui = ''
  try { $ui = [string](Get-UICulture).Name } catch { }
  $cu = ''
  try { $cu = [string](Get-Culture).Name } catch { }
  if ($ui.StartsWith('zh') -or $cu.StartsWith('zh')) { $env:CAT_LANG = 'zh' } else { $env:CAT_LANG = 'en' }
}

& $bash -lc 'bash ~/claude-agent-tools/install.sh'
