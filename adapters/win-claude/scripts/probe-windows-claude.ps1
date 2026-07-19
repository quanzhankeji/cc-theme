[CmdletBinding()]
param()

$ErrorActionPreference = 'SilentlyContinue'

function Get-SafeFileEvidence {
  param(
    [Parameter(Mandatory = $true)]
    [System.IO.FileInfo]$File,
    [Parameter(Mandatory = $true)]
    [string]$EvidenceType
  )

  $signature = Get-AuthenticodeSignature -LiteralPath $File.FullName
  $version = $File.VersionInfo

  [ordered]@{
    evidenceType = $EvidenceType
    fileName = $File.Name
    sizeBytes = $File.Length
    productName = $version.ProductName
    productVersion = $version.ProductVersion
    fileVersion = $version.FileVersion
    companyName = $version.CompanyName
    originalFileName = $version.OriginalFilename
    sha256 = (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    signatureStatus = $signature.Status.ToString()
    signerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
  }
}

$os = Get-CimInstance Win32_OperatingSystem
$interactiveShell = Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe'" |
  Select-Object -First 1
$interactiveSid = if ($interactiveShell) {
  (Invoke-CimMethod -InputObject $interactiveShell -MethodName GetOwnerSid).Sid
} else {
  $null
}
$interactiveSessions = @(
  Get-Process explorer | ForEach-Object {
    [ordered]@{
      sessionId = $_.SessionId
      shellProcessCount = 1
    }
  } | Group-Object sessionId | ForEach-Object {
    [ordered]@{
      sessionId = [int]$_.Name
      shellProcessCount = $_.Count
    }
  }
)

$interactiveAppxPackages = if ($interactiveSid) {
  Get-AppxPackage -User $interactiveSid -Name '*Claude*'
} else {
  @()
}
$appxMatches = @(
  $interactiveAppxPackages | Where-Object {
    (($_.Name, $_.PackageFullName, $_.Publisher) -join ' ') -match 'Claude|Anthropic'
  } | ForEach-Object {
    [ordered]@{
      name = $_.Name
      version = $_.Version.ToString()
      architecture = $_.Architecture.ToString()
      publisher = $_.Publisher
      status = $_.Status.ToString()
    }
  }
)

$uninstallRoots = @(
  'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
if ($interactiveSid) {
  $uninstallRoots += "Registry::HKEY_USERS\$interactiveSid\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"
}
$uninstallMatches = @(
  Get-ItemProperty $uninstallRoots | Where-Object {
    (($_.DisplayName, $_.Publisher) -join ' ') -match 'Claude|Anthropic'
  } | ForEach-Object {
    [ordered]@{
      displayName = $_.DisplayName
      displayVersion = $_.DisplayVersion
      publisher = $_.Publisher
      installDate = $_.InstallDate
    }
  }
)

$processMatches = @(
  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match 'Claude|Anthropic'
  } | ForEach-Object {
    $process = $_
    $file = if ($process.ExecutablePath) { Get-Item -LiteralPath $process.ExecutablePath } else { $null }
    [ordered]@{
      name = $process.Name
      processId = [int]$process.ProcessId
      sessionId = [int]$process.SessionId
      binary = if ($file) { Get-SafeFileEvidence -File $file -EvidenceType 'running-client' } else { $null }
    }
  }
)

$knownClientCandidates = @(
  'C:\Program Files\Claude\Claude.exe',
  'C:\Users\*\AppData\Local\Programs\Claude\Claude.exe',
  'C:\Users\*\AppData\Local\AnthropicClaude\Claude.exe'
)
$clientFiles = @(
  Get-Item $knownClientCandidates | Where-Object { $_ -is [System.IO.FileInfo] } | ForEach-Object {
    Get-SafeFileEvidence -File $_ -EvidenceType 'known-install-location'
  }
)

$installerFiles = @(
  Get-ChildItem 'C:\Users' -Directory | ForEach-Object {
    Get-ChildItem -LiteralPath (Join-Path $_.FullName 'Downloads') -File -Filter '*Claude*.exe'
  } | ForEach-Object {
    Get-SafeFileEvidence -File $_ -EvidenceType 'downloaded-installer'
  }
)

$result = [ordered]@{
  kind = 'cc-theme.windows-claude-environment-evidence'
  schemaVersion = 1
  evidenceClass = 'vm-verified'
  capturedAt = (Get-Date).ToUniversalTime().ToString('o')
  privacy = [ordered]@{
    includesCommandLines = $false
    includesEnvironmentVariables = $false
    includesFullPaths = $false
    includesUserNames = $false
  }
  operatingSystem = [ordered]@{
    caption = $os.Caption
    version = $os.Version
    build = $os.BuildNumber
    architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  }
  interactiveSessions = $interactiveSessions
  claude = [ordered]@{
    appxPackages = $appxMatches
    uninstallEntries = $uninstallMatches
    processes = $processMatches
    knownClientFiles = $clientFiles
    downloadedInstallers = $installerFiles
  }
}

$result | ConvertTo-Json -Depth 8 -Compress
