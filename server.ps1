# 서킷 트레이닝 웹서버 (Windows PowerShell 5.1 기본 기능만 사용, 추가 설치 불필요)
#
#   -Action start   서버를 최소화된 별도 창으로 시작 (서버시작.bat)
#   -Action stop    서버 중지                    (서버중지.bat)
#   -Action status  실행 여부 / 접속 주소 확인    (서버상태.bat)
#   -Action run     현재 창에서 서버 실행 (start 가 내부적으로 사용)

param(
  [ValidateSet('start', 'stop', 'status', 'run')]
  [string]$Action = 'run',
  [int]$Port = 8080
)

$ErrorActionPreference = 'Stop'
$Root     = $PSScriptRoot
$Public   = [IO.Path]::GetFullPath((Join-Path $Root 'public'))
$DataDir  = Join-Path $Root 'data'
$DataFile = Join-Path $DataDir 'circuit-data.json'
$PidFile  = Join-Path $DataDir 'server.pid'
$ErrFile  = Join-Path $DataDir 'server-error.txt'
$MaxBody  = 2MB

if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir | Out-Null }

# ───────── 공통 ─────────
function Get-LanIPs {
  $ips = @()
  try {
    $ips = @(Get-NetIPConfiguration -ErrorAction Stop |
      Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
      ForEach-Object { $_.IPv4Address.IPAddress })
  } catch { }
  if (-not $ips) {
    $ips = @([Net.Dns]::GetHostAddresses([Net.Dns]::GetHostName()) |
      Where-Object { $_.AddressFamily -eq 'InterNetwork' } |
      ForEach-Object { $_.ToString() } |
      Where-Object { -not $_.StartsWith('127.') -and -not $_.StartsWith('169.254.') })
  }
  return $ips
}

# data\server.pid 에 기록된 프로세스가 실제로 이 서버인지 확인
function Get-ServerProcess {
  if (-not (Test-Path $PidFile)) { return $null }
  $id = 0
  [void][int]::TryParse((Get-Content $PidFile -Raw).Trim(), [ref]$id)
  if ($id -gt 0) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
    if ($p -and $p.CommandLine -like '*server.ps1*' -and $p.CommandLine -like '*-Action run*') { return $p }
  }
  Remove-Item $PidFile -ErrorAction SilentlyContinue   # 남아 있던 PID 파일 정리
  return $null
}

function Get-ServerPort($proc) {
  if ($proc.CommandLine -match '-Port\s+(\d+)') { return [int]$Matches[1] }
  return $Port
}

function Show-Addresses([int]$p) {
  Write-Host ''
  Write-Host '  태블릿 브라우저에서 아래 주소로 접속하세요' -ForegroundColor Cyan
  foreach ($ip in Get-LanIPs) { Write-Host ("    http://{0}:{1}" -f $ip, $p) -ForegroundColor Green }
  Write-Host ("  이 PC에서는  http://localhost:{0}" -f $p)
  Write-Host ''
  try {
    $public = @(Get-NetConnectionProfile -ErrorAction Stop | Where-Object { $_.NetworkCategory -eq 'Public' })
    if ($public) {
      Write-Host '  [참고] 현재 네트워크가 "공용"으로 설정되어 있어 태블릿 접속이 막힐 수 있습니다.' -ForegroundColor Yellow
      Write-Host '         README.md 의 "태블릿에서 접속이 안 될 때" 항목을 확인하세요.' -ForegroundColor Yellow
      Write-Host ''
    }
  } catch { }
}

# ───────── start / stop / status ─────────
if ($Action -eq 'start') {
  $proc = Get-ServerProcess
  if ($proc) {
    Write-Host ("  서버가 이미 실행 중입니다. (PID {0})" -f $proc.ProcessId) -ForegroundColor Yellow
    Show-Addresses (Get-ServerPort $proc)
    exit 0
  }
  Remove-Item $ErrFile -ErrorAction SilentlyContinue
  $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Action', 'run', '-Port', $Port)
  Start-Process -FilePath 'powershell.exe' -ArgumentList $psArgs -WindowStyle Minimized -WorkingDirectory $Root | Out-Null

  Write-Host '  서버를 시작하는 중...'
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    if (Test-Path $ErrFile) { break }
    $proc = Get-ServerProcess
    if ($proc) { break }
  }
  if ($proc) {
    Write-Host ("  서버가 시작되었습니다. (PID {0})" -f $proc.ProcessId) -ForegroundColor Green
    Write-Host '  서버는 작업 표시줄의 최소화된 창에서 실행됩니다. 이 창은 닫아도 됩니다.'
    Write-Host '  끌 때는 서버중지.bat 을 실행하세요.'
    Show-Addresses $Port
    exit 0
  }
  Write-Host '  서버를 시작하지 못했습니다.' -ForegroundColor Red
  if (Test-Path $ErrFile) { Write-Host ('  ' + (Get-Content $ErrFile -Raw)) -ForegroundColor Red }
  exit 1
}

if ($Action -eq 'stop') {
  $proc = Get-ServerProcess
  if (-not $proc) {
    Write-Host '  실행 중인 서버가 없습니다.'
    exit 0
  }
  Stop-Process -Id $proc.ProcessId -Force
  Remove-Item $PidFile -ErrorAction SilentlyContinue
  Write-Host ("  서버를 중지했습니다. (PID {0})" -f $proc.ProcessId) -ForegroundColor Green
  exit 0
}

if ($Action -eq 'status') {
  $proc = Get-ServerProcess
  if ($proc) {
    Write-Host ("  서버 실행 중 (PID {0})" -f $proc.ProcessId) -ForegroundColor Green
    Show-Addresses (Get-ServerPort $proc)
  } else {
    Write-Host '  서버가 꺼져 있습니다. 서버시작.bat 으로 시작하세요.' -ForegroundColor Yellow
    Write-Host ''
  }
  Write-Host ("  데이터 파일: {0}" -f $DataFile)
  if (Test-Path $DataFile) { Write-Host ("  마지막 저장: {0}" -f (Get-Item $DataFile).LastWriteTime) }
  exit 0
}

# ───────── run: HTTP 서버 ─────────
$Latin1 = [Text.Encoding]::GetEncoding(28591)   # 바이트 위치를 그대로 유지하는 인코딩
$Utf8   = New-Object Text.UTF8Encoding($false)
$Types  = @{
  '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'
  '.txt'  = 'text/plain; charset=utf-8'; '.md' = 'text/plain; charset=utf-8'
}

function Send-Response($stream, [int]$code, [string]$ctype, [byte[]]$body) {
  $reason = @{ 200 = 'OK'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 405 = 'Method Not Allowed'; 413 = 'Payload Too Large'; 500 = 'Internal Server Error' }[$code]
  if ($null -eq $body) { $body = [byte[]]@() }
  $head = "HTTP/1.1 $code $reason`r`nContent-Type: $ctype`r`nContent-Length: $($body.Length)`r`n" +
          "Cache-Control: no-cache`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($body.Length) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

function Send-Text($stream, [int]$code, [string]$text) {
  Send-Response $stream $code 'text/plain; charset=utf-8' $Utf8.GetBytes($text)
}

# 버퍼에 요청이 다 들어왔으면 파싱 결과, 아직이면 $null, 잘못된 요청이면 숫자(에러 코드)
function Read-Request([IO.MemoryStream]$buf) {
  $bytes = $buf.ToArray()
  $text = $Latin1.GetString($bytes)
  $end = $text.IndexOf("`r`n`r`n")
  if ($end -lt 0) { if ($bytes.Length -gt 65536) { return 400 } else { return $null } }

  $lines = $text.Substring(0, $end) -split "`r`n"
  $parts = $lines[0] -split ' '
  if ($parts.Count -lt 3) { return 400 }
  $len = 0
  foreach ($l in $lines[1..($lines.Count - 1)]) {
    if ($l -match '^Content-Length:\s*(\d+)\s*$') { $len = [long]$Matches[1] }
  }
  if ($len -gt $MaxBody) { return 413 }
  $start = $end + 4
  if ($bytes.Length - $start -lt $len) { return $null }
  $body = New-Object byte[] $len
  if ($len) { [Array]::Copy($bytes, $start, $body, 0, $len) }
  return @{ Method = $parts[0].ToUpper(); Path = ($parts[1] -split '\?')[0]; Body = $body }
}

function Handle-Request($stream, $req) {
  $path = [Uri]::UnescapeDataString($req.Path)

  if ($path -eq '/api/data') {
    if ($req.Method -eq 'GET') {
      if (Test-Path $DataFile) { $bytes = [IO.File]::ReadAllBytes($DataFile) } else { $bytes = $Utf8.GetBytes('{}') }
      Send-Response $stream 200 $Types['.json'] $bytes
      return 200
    }
    if ($req.Method -eq 'PUT' -or $req.Method -eq 'POST') {
      $json = $Utf8.GetString($req.Body)
      try { $obj = $json | ConvertFrom-Json } catch { $obj = $null }
      if (-not $obj -or -not $obj.settings) {
        Send-Text $stream 400 'invalid json'
        return 400
      }
      # 임시 파일에 쓴 뒤 교체 (저장 중 꺼져도 기존 파일 보존, 직전 파일은 .bak 으로 보관)
      $tmp = "$DataFile.tmp"
      [IO.File]::WriteAllText($tmp, $json, $Utf8)
      if (Test-Path $DataFile) { [IO.File]::Replace($tmp, $DataFile, "$DataFile.bak") } else { [IO.File]::Move($tmp, $DataFile) }
      Send-Response $stream 200 $Types['.json'] $Utf8.GetBytes('{"ok":true}')
      return 200
    }
    Send-Text $stream 405 'method not allowed'
    return 405
  }

  if ($req.Method -ne 'GET') {
    Send-Text $stream 405 'method not allowed'
    return 405
  }

  # 정적 파일: public 폴더 밖은 접근 불가
  $rel = $path.TrimStart('/')
  if ($rel -eq '') { $rel = 'index.html' }
  if ($rel.Contains('..') -or $rel.Contains(':') -or $rel.StartsWith('\') -or $rel.StartsWith('/')) {
    Send-Text $stream 403 'forbidden'
    return 403
  }
  $full = [IO.Path]::GetFullPath((Join-Path $Public $rel))
  if (-not $full.StartsWith($Public + '\', [StringComparison]::OrdinalIgnoreCase)) {
    Send-Text $stream 403 'forbidden'
    return 403
  }
  if (-not [IO.File]::Exists($full)) {
    Send-Text $stream 404 'not found'
    return 404
  }
  $ext = [IO.Path]::GetExtension($full).ToLower()
  $ctype = $Types[$ext]
  if (-not $ctype) { $ctype = 'application/octet-stream' }
  Send-Response $stream 200 $ctype ([IO.File]::ReadAllBytes($full))
  return 200
}

$Host.UI.RawUI.WindowTitle = "서킷 트레이닝 서버 (포트 $Port) - 이 창을 닫으면 서버가 꺼집니다"
$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Any, $Port)
try {
  $listener.Start()
} catch {
  $msg = "포트 $Port 를 열 수 없습니다. 이미 다른 프로그램이 사용 중일 수 있습니다. ($($_.Exception.Message))"
  Set-Content -Path $ErrFile -Value $msg -Encoding UTF8
  Write-Host $msg -ForegroundColor Red
  Start-Sleep -Seconds 10
  exit 1
}
Set-Content -Path $PidFile -Value $PID -Encoding ASCII

Write-Host '  서킷 트레이닝 서버 실행 중 — 이 창을 닫거나 서버중지.bat 을 실행하면 꺼집니다.' -ForegroundColor Green
Show-Addresses $Port

# 단일 스레드 비동기 루프: 여러 연결을 동시에 받아 요청이 다 들어온 연결부터 처리
$conns = New-Object Collections.ArrayList
$readBuf = New-Object byte[] 16384
try {
  while ($true) {
    $busy = $false
    while ($listener.Pending()) {
      $c = $listener.AcceptTcpClient()
      $c.NoDelay = $true
      [void]$conns.Add(@{ Client = $c; Stream = $c.GetStream(); Buf = (New-Object IO.MemoryStream); Start = [DateTime]::UtcNow })
      $busy = $true
    }

    foreach ($cn in @($conns)) {
      $close = $false
      try {
        $s = $cn.Stream
        while ($s.DataAvailable) {
          $n = $s.Read($readBuf, 0, $readBuf.Length)
          if ($n -le 0) { break }
          $cn.Buf.Write($readBuf, 0, $n)
          $busy = $true
        }
        $req = Read-Request $cn.Buf
        if ($req -is [int]) {
          Send-Text $s $req 'bad request'
          $close = $true
        } elseif ($req) {
          $code = Handle-Request $s $req
          $ip = $cn.Client.Client.RemoteEndPoint.Address
          Write-Host ("{0}  {1,-15} {2,-4} {3} {4}" -f (Get-Date -Format 'HH:mm:ss'), $ip, $req.Method, $req.Path, $code)
          $close = $true
        } elseif (([DateTime]::UtcNow - $cn.Start).TotalSeconds -gt 15) {
          $close = $true   # 아무 요청 없이 열려 있는 연결 정리
        } elseif ($cn.Client.Client.Poll(0, [Net.Sockets.SelectMode]::SelectRead) -and $cn.Client.Available -eq 0) {
          $close = $true   # 상대가 연결을 끊음
        }
      } catch {
        Write-Host ("{0}  오류: {1}" -f (Get-Date -Format 'HH:mm:ss'), $_.Exception.Message) -ForegroundColor Red
        try { Send-Text $cn.Stream 500 'server error' } catch { }
        $close = $true
      }
      if ($close) {
        try { $cn.Client.Close() } catch { }
        $conns.Remove($cn)
      }
    }

    if (-not $busy) { Start-Sleep -Milliseconds 15 }
  }
} finally {
  $listener.Stop()
  Remove-Item $PidFile -ErrorAction SilentlyContinue
}
