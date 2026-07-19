[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('preflight', 'apply', 'verify', 'pause', 'restore')]
    [string]$Operation,

    [ValidateRange(1024, 65535)]
    [int]$Port = 9223
)

$ErrorActionPreference = 'Stop'
$expectedPublisher = 'Tencent Technology (Shenzhen) Company Limited'
$expectedVersion = '5.2.6'

try {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop)
    if ($listeners.Count -eq 0) { throw 'debug-listener-missing' }
    if (@($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }).Count -gt 0) {
        throw 'debug-listener-not-loopback'
    }

    $ownerIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($ownerIds.Count -ne 1) { throw 'debug-listener-owner-ambiguous' }
    $owner = Get-Process -Id $ownerIds[0]
    $item = Get-Item -LiteralPath $owner.Path
    $signature = Get-AuthenticodeSignature -FilePath $owner.Path
    $publisher = $signature.SignerCertificate.GetNameInfo(
        [Security.Cryptography.X509Certificates.X509NameType]::SimpleName,
        $false
    )
    if ($item.Name -ne 'WorkBuddy.exe') { throw 'debug-listener-owner-mismatch' }
    if ($item.VersionInfo.FileVersion -ne $expectedVersion) { throw 'client-version-unsupported' }
    if ($signature.Status -ne 'Valid' -or $publisher -ne $expectedPublisher) {
        throw 'debug-listener-signature-mismatch'
    }

    $script = Join-Path $PSScriptRoot 'proof-cdp.mjs'
    $oldRunAsNode = $env:ELECTRON_RUN_AS_NODE
    try {
        $env:ELECTRON_RUN_AS_NODE = '1'
        & $owner.Path $script $Operation --port $Port
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        if ($null -eq $oldRunAsNode) {
            Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
        } else {
            $env:ELECTRON_RUN_AS_NODE = $oldRunAsNode
        }
    }
} catch {
    $code = [string]$_.Exception.Message
    if ($code -notmatch '^[a-z][a-z0-9-]{1,79}$') { $code = 'proof-preflight-failed' }
    [ordered]@{
        kind = 'cc-theme.win-workbuddy-proof-result'
        schemaVersion = 1
        operation = $Operation
        ok = $false
        code = $code
        details = @{ listener = 'unverified'; clientVersion = $expectedVersion }
    } | ConvertTo-Json -Compress -Depth 4
    exit 1
}
