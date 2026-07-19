[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 9223
)

$ErrorActionPreference = 'Stop'
$expectedPublisher = 'Tencent Technology (Shenzhen) Company Limited'
$expectedVersion = '5.2.6'
$launchedByScript = $false

function Write-BoundedResult([bool]$Ok, [string]$Code, [hashtable]$Details) {
    [ordered]@{
        kind = 'cc-theme.win-workbuddy-proof-result'
        schemaVersion = 1
        operation = 'launch'
        ok = $Ok
        code = $Code
        details = $Details
    } | ConvertTo-Json -Compress -Depth 4
}

try {
    if (Get-Process -Name WorkBuddy -ErrorAction SilentlyContinue) {
        throw 'workbuddy-still-running'
    }

    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
        throw 'debug-port-already-in-use'
    }

    $exe = Join-Path $env:LOCALAPPDATA 'Programs\WorkBuddy\WorkBuddy.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
        throw 'workbuddy-not-found'
    }

    $item = Get-Item -LiteralPath $exe
    $signature = Get-AuthenticodeSignature -FilePath $exe
    $publisher = $signature.SignerCertificate.GetNameInfo(
        [Security.Cryptography.X509Certificates.X509NameType]::SimpleName,
        $false
    )
    if ($signature.Status -ne 'Valid') { throw 'signature-invalid' }
    if ($publisher -ne $expectedPublisher) { throw 'publisher-mismatch' }
    if ($item.VersionInfo.FileVersion -ne $expectedVersion) { throw 'client-version-unsupported' }

    $oldPort = $env:WORKBUDDY_REMOTE_DEBUGGING_PORT
    try {
        $env:WORKBUDDY_REMOTE_DEBUGGING_PORT = [string]$Port
        $started = Start-Process -FilePath $exe -PassThru
        $launchedByScript = $true
    } finally {
        if ($null -eq $oldPort) {
            Remove-Item Env:\WORKBUDDY_REMOTE_DEBUGGING_PORT -ErrorAction SilentlyContinue
        } else {
            $env:WORKBUDDY_REMOTE_DEBUGGING_PORT = $oldPort
        }
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    $listeners = @()
    while ([DateTime]::UtcNow -lt $deadline) {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
        if ($listeners.Count -gt 0) { break }
        Start-Sleep -Milliseconds 200
    }
    if ($listeners.Count -eq 0) { throw 'debug-listener-timeout' }

    $nonLoopback = @($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') })
    if ($nonLoopback.Count -gt 0) {
        Get-Process -Name WorkBuddy -ErrorAction SilentlyContinue | Stop-Process -Force
        throw 'debug-listener-not-loopback'
    }

    $owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($owners.Count -ne 1) { throw 'debug-listener-owner-ambiguous' }
    $owner = Get-Process -Id $owners[0]
    $ownerItem = Get-Item -LiteralPath $owner.Path
    $ownerSignature = Get-AuthenticodeSignature -FilePath $owner.Path
    $ownerPublisher = $ownerSignature.SignerCertificate.GetNameInfo(
        [Security.Cryptography.X509Certificates.X509NameType]::SimpleName,
        $false
    )
    if ($ownerItem.Name -ne 'WorkBuddy.exe') { throw 'debug-listener-owner-mismatch' }
    if ($ownerItem.FullName -ne $item.FullName) { throw 'debug-listener-path-mismatch' }
    if ($ownerItem.VersionInfo.FileVersion -ne $expectedVersion) { throw 'debug-listener-version-mismatch' }
    if ($owner.Id -ne $started.Id) { throw 'debug-listener-process-mismatch' }
    if ($ownerSignature.Status -ne 'Valid' -or $ownerPublisher -ne $expectedPublisher) {
        throw 'debug-listener-signature-mismatch'
    }

    Write-BoundedResult $true 'ok' @{
        clientVersion = $expectedVersion
        publisher = $expectedPublisher
        processRunning = $true
        listener = 'loopback'
        port = $Port
    }
} catch {
    $code = [string]$_.Exception.Message
    if ($code -notmatch '^[a-z][a-z0-9-]{1,79}$') { $code = 'launch-preflight-failed' }
    if ($launchedByScript) {
        Get-Process -Name WorkBuddy -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    Write-BoundedResult $false $code @{
        clientVersion = $expectedVersion
        processRunning = $false
        listener = 'unverified'
        port = $Port
    }
    exit 1
}
