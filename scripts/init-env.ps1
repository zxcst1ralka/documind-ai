
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root '.env'
if (Test-Path -LiteralPath $target) { throw '.env already exists' }
function New-DocuMindSecret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}
$config = Get-Content -Raw -LiteralPath (Join-Path $root '.env.example')
foreach ($field in 'JWT_SECRET', 'DATABASE_PASSWORD', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY') {
    $config = $config -replace "(?m)^$field=\r?$", "$field=$(New-DocuMindSecret)"
}
[IO.File]::WriteAllText($target, $config, (New-Object Text.UTF8Encoding($false)))
Write-Output 'Created .env with randomly generated local credentials'
