Set-StrictMode -Version Latest
$CliArgs = @($args)
$ErrorActionPreference = 'Stop'

function Fail([string] $Message, [int] $Code = 2) {
    [Console]::Error.WriteLine("agent-browser wrapper: $Message")
    exit $Code
}


if ($null -eq $CliArgs) { $CliArgs = @() }
if ($CliArgs -contains '--') {
    $CliArgs = @($CliArgs | Where-Object { $_ -ne '--' })
}

$sessionIndexes = @()
for ($i = 0; $i -lt $CliArgs.Count; $i++) {
    if ($CliArgs[$i] -eq '--session') { $sessionIndexes += $i }
    elseif ($CliArgs[$i] -like '--session=*') { $sessionIndexes += $i }
}
if ($sessionIndexes.Count -gt 1) {
    Fail 'at most one --session <name> or --session=<name> is allowed.'
}

$session = $null
$sessionIndex = -1
if ($sessionIndexes.Count -eq 1) {
    $sessionIndex = $sessionIndexes[0]
    if ($CliArgs[$sessionIndex] -eq '--session' -and $sessionIndex + 1 -ge $CliArgs.Count) {
        Fail '--session requires a value.'
    }
    $session = if ($CliArgs[$sessionIndex] -like '--session=*') {
        $CliArgs[$sessionIndex].Substring('--session='.Length)
    } else {
        $CliArgs[$sessionIndex + 1]
    }
    if ([string]::IsNullOrWhiteSpace($session) -or $session -notmatch '^[A-Za-z0-9._-]+$') {
        Fail "unsafe or missing session name '$session'. Use only letters, digits, '.', '_' and '-'."
    }
}

$command = ''
for ($i = 0; $i -lt $CliArgs.Count; $i++) {
    if ($CliArgs[$i] -eq '--session') { $i++; continue }
    if ($CliArgs[$i] -like '--session=*' -or $CliArgs[$i].StartsWith('-')) { continue }
    $command = $CliArgs[$i]
    break
}
$managementCommands = @('skills', 'doctor', 'profiles', 'session', 'dashboard', 'install', 'upgrade')
$flagMatches = @($CliArgs | Where-Object { $_ -in @('--help', '-h', '--version', '-V') })
$isFlagOnlyManagement = ($CliArgs.Count -eq 0) -or ($flagMatches.Count -gt 0 -and [string]::IsNullOrWhiteSpace($command))
$isManagement = $isFlagOnlyManagement -or ($command -in $managementCommands)
if (-not $isManagement -and $null -eq $session) {
    Fail 'exactly one --session <name> or --session=<name> is required for browser commands.'
}

$executable = $null
$explicit = [Environment]::GetEnvironmentVariable('AGENT_BROWSER_WIN32_EXE')
if (-not [string]::IsNullOrWhiteSpace($explicit)) {
    if (-not (Test-Path -LiteralPath $explicit -PathType Leaf)) { Fail "AGENT_BROWSER_WIN32_EXE does not point to a file: $explicit" }
    $executable = (Resolve-Path -LiteralPath $explicit).Path
} else {
    $nativeCandidates = @(
        (Join-Path $env:APPDATA 'npm\node_modules\agent-browser\bin\agent-browser-win32-x64.exe'),
        (Join-Path $env:LOCALAPPDATA 'npm\node_modules\agent-browser\bin\agent-browser-win32-x64.exe')
    )
    foreach ($candidatePath in $nativeCandidates) {
        if (Test-Path -LiteralPath $candidatePath -PathType Leaf) {
            $executable = (Resolve-Path -LiteralPath $candidatePath).Path
            break
        }
    }
    if ([string]::IsNullOrWhiteSpace($executable)) {
        $candidate = Get-Command 'agent-browser-win32-x64.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $candidate) { $executable = $candidate.Source }
    }
    if ([string]::IsNullOrWhiteSpace($executable)) {
        $shim = Get-Command 'agent-browser.cmd' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $shim) {
            $shimText = Get-Content -LiteralPath $shim.Source -Raw
            $relativeNative = [regex]::Match($shimText, '"%~dp0([^"\r\n]+agent-browser-win32-x64\.exe)"')
            if ($relativeNative.Success) {
                $nativePath = Join-Path (Split-Path -Parent $shim.Source) $relativeNative.Groups[1].Value
                if (Test-Path -LiteralPath $nativePath -PathType Leaf) { $executable = (Resolve-Path -LiteralPath $nativePath).Path }
            }
        }
    }
}
if ([string]::IsNullOrWhiteSpace($executable)) {
    Fail 'could not find agent-browser-win32-x64.exe or the Windows agent-browser command. Set AGENT_BROWSER_WIN32_EXE if needed.' 127
}

$mutex = $null
$mutexHeld = $false
try {
    if ($null -ne $session -and -not $isManagement) {
        $mutexName = "Local\bontop-agent-browser-session-$session"
        $mutex = [Threading.Mutex]::new($false, $mutexName)
        $mutexHeld = $mutex.WaitOne(0)
        if (-not $mutexHeld) { Fail "session '$session' is busy; do not run concurrent browser commands." 11 }
    }

    # Invoke the native CLI directly. Its own process/daemon protocol determines
    # completion; wrapping it in ProcessStartInfo changes Windows std-handle behavior
    # and can leave the caller waiting after the CLI has already emitted its result.
    & $executable @CliArgs
    $exitCode = $LASTEXITCODE
    exit $exitCode
} catch {
    Fail "failed to run agent-browser: $($_.Exception.Message)" 126
} finally {
    if ($mutexHeld -and $null -ne $mutex) { $mutex.ReleaseMutex() }
    if ($null -ne $mutex) { $mutex.Dispose() }
}
