# BOLD EDIT SYSTEM - bootstrap Windows (R12.2) - EXPERIMENTAL, NAO TESTADO EM WINDOWS REAL.
# Funciona SEM Node: detecta a arquitetura, procura um Node utilizavel (BOLD_NODE_PATH > toolchain > PATH) e, se houver,
# entrega para `bold setup` (plano somente leitura). Sem Node: se o lock fixou o Node win32-x64 (bloco BOLD-LOCK abaixo),
# mostra o plano e PEDE CONFIRMACAO (Read-Host ou --yes) -> checa espaco -> baixa SO por HTTPS do host permitido, sem
# seguir redirects -> confere tamanho + SHA-256 -> valida os nomes do zip (sem absolutos/..) -> extrai num staging do BOLD
# -> entrega para `bold setup apply --archive` (re-confere o lock, extrai com o extrator seguro e ativa) -> limpa o que criou.
# Sem constantes fixadas para a plataforma -> so mostra o plano e sai com 5.
# Nunca: admin, PATH global, registro, Set-ExecutionPolicy, Invoke-Expression, download sem confirmacao.
# Uso (politica so deste processo):  powershell -NoProfile -ExecutionPolicy Bypass -File bootstrap\bootstrap.ps1 [--yes] [args do bold setup]
# Compativel com Windows PowerShell 5.1 (sem operadores ?? / ternario).
$ErrorActionPreference = 'Stop'
$NodeTarget = '24'   # alvo LTS - deve bater com setup/toolchain.lock.json (testado)
$NodeMinMajor = 20
$NodeHosts = @('nodejs.org')
# >>> BOLD-LOCK (gerado de setup/toolchain.lock.json - node setup/bootstrap-lock.mjs --write)
$NodeVersion = '24.22.0'
$Node_WIN32_X64_Url = 'https://nodejs.org/dist/v24.22.0/node-v24.22.0-win-x64.zip'
$Node_WIN32_X64_Sha256 = 'f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3'
$Node_WIN32_X64_Size = '37733703'
$Node_WIN32_X64_Bin = 'node.exe'
# <<< BOLD-LOCK
# >>> BOLD-TEST (VAZIO na distribuicao; so copias geradas pela suite o preenchem - nunca lido do ambiente)
$Test_Url = ''
$Test_Sha256 = ''
$Test_Size = ''
$Test_Bin = ''
# <<< BOLD-TEST

$BoldHome = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$yes = $args -contains '--yes'
$fwd = @($args | Where-Object { $_ -ne '--yes' })

# Arquitetura real da maquina (processo x86/x64 emulado em ARM64 tambem e detectado).
$arch = $env:PROCESSOR_ARCHITECTURE
if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
if ($env:BOLD_BOOTSTRAP_ARCH) { $arch = $env:BOLD_BOOTSTRAP_ARCH }   # somente teste
switch ($arch.ToUpper()) {
  'AMD64' { $platform = 'win32-x64'; $support = 'EXPERIMENTAL' }
  'ARM64' { $platform = 'win32-arm64'; $support = 'UNSUPPORTED' }
  default { $platform = "win32-$arch"; $support = 'UNSUPPORTED' }
}
Write-Host "bootstrap: plataforma $platform ($support) - BOLD_HOME $BoldHome"
if ($support -eq 'UNSUPPORTED') { Write-Host "bootstrap: arquitetura $arch sem suporte (Windows ARM64 nao e alvo do setup) - nada a fazer"; exit 5 }

if ($env:BOLD_TOOLCHAIN_DIR) { $toolchain = $env:BOLD_TOOLCHAIN_DIR } else { $toolchain = Join-Path $env:LOCALAPPDATA 'bold\toolchain' }

function Find-Node {
  $script:nodeBin = $null; $script:src = $null; $script:major = $null
  if ($env:BOLD_NODE_PATH) { $script:nodeBin = $env:BOLD_NODE_PATH; $script:src = 'BOLD_NODE_PATH' }
  elseif (Test-Path -LiteralPath (Join-Path $toolchain 'node.path')) {
    $p = (Get-Content -LiteralPath (Join-Path $toolchain 'node.path') -TotalCount 1).Trim()
    if ($p -and (Test-Path -LiteralPath $p)) { $script:nodeBin = $p; $script:src = 'toolchain' }
  }
  if (-not $script:nodeBin) { $c = Get-Command node -ErrorAction SilentlyContinue; if ($c) { $script:nodeBin = $c.Source; $script:src = 'PATH' } }
  if ($script:nodeBin) { try { $script:major = [int](& $script:nodeBin -p 'process.versions.node.split(".")[0]' 2>$null) } catch { $script:major = $null } }
}

Find-Node
if ($major -and $major -ge $NodeMinMajor) {
  Write-Host "bootstrap: Node $major encontrado ($src`: $nodeBin) -> bold setup"
  & $nodeBin (Join-Path $BoldHome 'bin\bold.mjs') setup @fwd
  exit $LASTEXITCODE
}
if ($major) { Write-Host "bootstrap: Node $major em $nodeBin e antigo (minimo $NodeMinMajor; recomendado >= 22)" }

$url = $Node_WIN32_X64_Url; $sha = $Node_WIN32_X64_Sha256; $size = $Node_WIN32_X64_Size; $bin = $Node_WIN32_X64_Bin; $mode = 'lock'
# R12.5 B3: artefato de teste so do bloco BOLD-TEST (vazio na distribuicao), nunca do ambiente
if ($Test_Url) {
  if ($Test_Url -notlike 'http://127.0.0.1:*/*') { Write-Host 'bootstrap: URL de teste so e aceita em http://127.0.0.1'; exit 64 }
  $url = $Test_Url; $sha = $Test_Sha256; $size = $Test_Size; $bin = $Test_Bin; $mode = 'teste-loopback'
  if (-not $bin) { $bin = 'node.exe' }
}

if (-not $url) {
  Write-Host @"
bootstrap: Node.js utilizavel NAO encontrado. Plano (nada foi baixado nem instalado):
  componente  Node.js $NodeTarget LTS (ESSENCIAL) - licenca MIT
  fonte       oficial: https://nodejs.org/dist/ (SHASUMS256.txt assinado por GPG)
  destino     $toolchain\node\<versao>-$platform\  (local do BOLD; sem admin; sem PATH global)
  integridade sha256 fixado em setup\toolchain.lock.json - conferido ANTES de extrair
  aviso       o Smart App Control (Windows 11) pode bloquear executaveis sem assinatura
  estado      o lock nao fixou um artefato do Node para esta plataforma
Agora: instale o Node.js LTS manualmente (https://nodejs.org) ou defina BOLD_NODE_PATH, e rode este script de novo.
"@
  exit 5
}

if ($sha -notmatch '^[0-9a-f]{64}$') { Write-Host 'bootstrap: sha256 do lock invalido'; exit 64 }
if ($size -notmatch '^[0-9]+$') { Write-Host 'bootstrap: tamanho do lock invalido'; exit 64 }
if ($bin -match '^[\\/]|\.\.|:') { Write-Host 'bootstrap: bin do lock invalido'; exit 64 }
if ($mode -eq 'lock') {
  $u = [Uri]$url
  if ($u.Scheme -ne 'https') { Write-Host 'bootstrap: o lock so pode usar HTTPS'; exit 64 }
  if ($NodeHosts -notcontains $u.Host.ToLower()) { Write-Host "bootstrap: host $($u.Host) fora da allowlist"; exit 64 }
}

Write-Host @"
bootstrap: Node.js utilizavel NAO encontrado. Plano:
  componente  Node.js $NodeVersion (ESSENCIAL) - licenca MIT - modo $mode
  fonte       $url
  tamanho     $size bytes - sha256 $sha
  destino     $toolchain\node\$NodeVersion-$platform\  (local do BOLD; sem admin; sem PATH global)
"@
if ($env:BOLD_SETUP_OFFLINE -eq '1' -and $mode -ne 'teste-loopback') { Write-Host 'bootstrap: modo offline (BOLD_SETUP_OFFLINE=1) - download externo recusado; nada foi baixado'; exit 3 }
if (-not $yes) {
  if ([Environment]::UserInteractive -and -not $env:BOLD_BOOTSTRAP_NO_TTY) {
    $ans = Read-Host 'Confirmar download e instalacao do Node? [s/N]'
    if ($ans -notmatch '^(s|sim|y|yes)$') { Write-Host 'bootstrap: cancelado - nada foi baixado'; exit 3 }
  } else { Write-Host 'bootstrap: confirmacao necessaria (rode num terminal ou use --yes) - nada foi baixado'; exit 3 }
}

# espaco: arquivo + conteudo estimado (5x) + margem de 256 MiB
$qual = Split-Path -Qualifier $toolchain
$free = (New-Object System.IO.DriveInfo($qual)).AvailableFreeSpace
$need = [int64]$size * 5 + 256MB
if ($free -lt $need) { Write-Host "bootstrap: espaco insuficiente ($free B livres, $need B necessarios)"; exit 3 }

$dl = Join-Path $toolchain '.downloads'; $stg = Join-Path $toolchain '.staging'
New-Item -ItemType Directory -Force -Path $dl, $stg | Out-Null
$file = Join-Path $dl "node-$NodeVersion-$platform.zip"; $part = "$file.part"; $x = Join-Path $stg "bootstrap-$PID"
function Clear-Bootstrap { Remove-Item -LiteralPath $x -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath $part, $file -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath $dl, $stg -ErrorAction SilentlyContinue }
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $resp = Invoke-WebRequest -Uri $url -OutFile $part -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 900 -PassThru
  if ($resp.StatusCode -ne 200) { throw "HTTP $($resp.StatusCode) (redirects nao sao seguidos)" }
  if ((Get-Item -LiteralPath $part).Length -ne [int64]$size) { throw 'tamanho nao confere - arquivo descartado' }
  if ((Get-FileHash -LiteralPath $part -Algorithm SHA256).Hash.ToLower() -ne $sha) { throw 'sha256 nao confere - arquivo descartado' }
  Move-Item -LiteralPath $part -Destination $file
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $z = [IO.Compression.ZipFile]::OpenRead($file)
  try { foreach ($e in $z.Entries) { if ($e.FullName -match '^[\\/]|(^|[\\/])\.\.([\\/]|$)|:') { throw "caminho inseguro no zip: $($e.FullName)" } } } finally { $z.Dispose() }
  Expand-Archive -LiteralPath $file -DestinationPath $x
  $tnode = Get-ChildItem -LiteralPath $x -Directory | ForEach-Object { Join-Path $_.FullName $bin } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $tnode) { throw 'Node extraido nao encontrado' }
  & $tnode --version | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Node extraido nao executa' }
  Write-Host 'bootstrap: artefato verificado -> bold setup apply (re-confere o lock e ativa no toolchain)'
  $env:BOLD_TOOLCHAIN_DIR = $toolchain
  & $tnode (Join-Path $BoldHome 'bin\bold.mjs') setup apply --components node --archive $file --yes
  $rc = $LASTEXITCODE
} catch { Write-Host "bootstrap: $($_.Exception.Message)"; Clear-Bootstrap; exit 1 }
Clear-Bootstrap
if ($rc -ne 0) { Write-Host "bootstrap: instalacao gerenciada falhou (exit $rc)"; exit $rc }
Find-Node
Write-Host "bootstrap: Node $major gerenciado ativo -> bold setup"
& $nodeBin (Join-Path $BoldHome 'bin\bold.mjs') setup @fwd
exit $LASTEXITCODE
