# ESN Speed Friending - phone remote
#
# A tiny web server that uses only what comes with Windows (PowerShell).
# It serves the show from ..\current (the app file itself is never changed)
# and a control page for a phone on the same Wi-Fi / hotspot.
#
#   Double-click start-phone-remote.bat (it runs this script).
#
# Options (for testing):  -Port 8765  -LocalOnly  -NoBrowser  -TestMode
#   -LocalOnly  listen on this computer only (no firewall prompt)
#   -TestMode   requests with header "X-Test-Remote: 1" count as coming from a phone
param(
  [int]$Port = 8765,
  [switch]$LocalOnly,
  [switch]$NoBrowser,
  [switch]$TestMode
)

$ErrorActionPreference = 'Stop'
$Here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$Sep = [IO.Path]::DirectorySeparatorChar
$AppDir = [IO.Path]::GetFullPath([IO.Path]::Combine($Here, '..', 'current'))
$AppFile = 'speed-friending-esn.html'
if(-not (Test-Path -LiteralPath ([IO.Path]::Combine($AppDir, $AppFile)))){ Write-Host "Can't find $AppFile in $AppDir"; exit 1 }

# Short access code: the phone page and commands only work with it. It is
# kept for 24 hours, so restarting the launcher doesn't disconnect the phone.
$alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
$tokenFile = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'esn-remote-code.txt')
$Token = $null
if(-not $TestMode){
  try {
    $tf = Get-Item -LiteralPath $tokenFile -ErrorAction Stop
    if(([DateTime]::Now - $tf.LastWriteTime).TotalHours -lt 24){ $Token = ([IO.File]::ReadAllText($tokenFile)).Trim() }
    if($Token -notmatch '^[A-Z0-9]{6}$'){ $Token = $null }
  } catch {}
}
if(-not $Token){
  $Token = -join (1..6 | ForEach-Object { $alphabet[(Get-Random -Maximum $alphabet.Length)] })
  if(-not $TestMode){ try { [IO.File]::WriteAllText($tokenFile, $Token) } catch {} }
}
# Changes every start, so the show knows to forget old command numbers
$Boot = [string](Get-Random -Maximum 1000000000)

# Keys the phone may send (the same keys the laptop keyboard uses)
$AllowedKeys = @(' ', 'r', 'b', 'h', 'm', ']', '[', '+', '-', 'ArrowRight', 'ArrowLeft')

$Mime = @{
  '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'
  '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.gif'='image/gif'; '.svg'='image/svg+xml'
  '.mp3'='audio/mpeg'; '.wav'='audio/wav'; '.ico'='image/x-icon'; '.json'='application/json'; '.woff2'='font/woff2'
}

# ---------- listening ----------
$bindAddr = if($LocalOnly){ [Net.IPAddress]::Loopback } else { [Net.IPAddress]::Any }
# Always the same port: the show's saved Settings belong to this exact
# address, so moving to another port would start with empty Settings.
try { $listener = New-Object Net.Sockets.TcpListener($bindAddr, $Port); $listener.Start() }
catch {
  Write-Host ''
  Write-Host "  The phone remote is already running (port $Port is in use)." -ForegroundColor Yellow
  Write-Host '  Use the black window that is already open, or close it and start again.'
  Write-Host ''
  exit 1
}

function Get-LanUrls {
  $out = @()
  try {
    foreach($ni in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()){
      if($ni.OperationalStatus -ne 'Up' -or $ni.NetworkInterfaceType -eq 'Loopback'){ continue }
      $props = $ni.GetIPProperties()
      $hasGw = @($props.GatewayAddresses | Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' -and $_.Address.ToString() -ne '0.0.0.0' }).Count -gt 0
      foreach($ua in $props.UnicastAddresses){
        if($ua.Address.AddressFamily -ne 'InterNetwork'){ continue }
        $ip = $ua.Address.ToString()
        if($ip.StartsWith('169.254.')){ continue }
        $virtual = ($ni.Name + ' ' + $ni.Description) -match 'Tailscale|vEthernet|Hyper-V|VirtualBox|VMware|WSL|VPN|TAP-|WireGuard|ZeroTier|Docker|Loopback'
        $out += [pscustomobject]@{ ip=$ip; name=$ni.Name; gateway=$hasGw; virtual=$virtual; url="http://${ip}:$Port/remote?t=$Token" }
      }
    }
  } catch {}
  # Virtual/VPN adapters only if there is nothing else; networks with a router (Wi-Fi, hotspot) first
  $real = @($out | Where-Object { -not $_.virtual })
  if($real.Count){ $out = $real }
  return @($out | Sort-Object @{Expression={ -not $_.gateway }}, ip)
}

# ---------- shared state between the show and the phone ----------
$script:seq = 0
$script:cmds = New-Object Collections.ArrayList
$script:showState = 'null'
$script:showAt = [DateTime]::MinValue

function Json([string]$s){
  if($null -eq $s){ return 'null' }
  $sb = New-Object Text.StringBuilder
  [void]$sb.Append('"')
  foreach($ch in $s.ToCharArray()){
    switch($ch){
      '"'  { [void]$sb.Append('\"') }
      '\'  { [void]$sb.Append('\\') }
      default {
        if([int]$ch -lt 32){ [void]$sb.Append(('\u{0:x4}' -f [int]$ch)) } else { [void]$sb.Append($ch) }
      }
    }
  }
  [void]$sb.Append('"')
  return $sb.ToString()
}

# ---------- HTTP helpers ----------
function Send($client, [int]$code, [string]$type, [byte[]]$body, [hashtable]$extra){
  $reason = @{200='OK';206='Partial Content';204='No Content';400='Bad Request';403='Forbidden';404='Not Found';405='Method Not Allowed';416='Range Not Satisfiable';500='Server Error'}[$code]
  $h = "HTTP/1.1 $code $reason`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n"
  if($extra){ foreach($k in $extra.Keys){ $h += "${k}: $($extra[$k])`r`n" } }
  $h += "`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($h)
  $s = $client.GetStream()
  $s.Write($hb, 0, $hb.Length)
  if($body.Length){ $s.Write($body, 0, $body.Length) }
  $s.Flush()
}
function SendText($client, [int]$code, [string]$type, [string]$text){
  Send $client $code $type ([Text.Encoding]::UTF8.GetBytes($text)) $null
}

# Media is sent in pieces of at most 1 MB so one slow download never blocks
# the phone's commands.
$MaxChunk = 1MB
function SendFile($client, [string]$path, [string]$range){
  $ext = [IO.Path]::GetExtension($path).ToLower()
  $type = if($Mime.ContainsKey($ext)){ $Mime[$ext] } else { 'application/octet-stream' }
  $fs = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
  try {
    $len = $fs.Length
    if($range -and $range -match '^bytes=(\d*)-(\d*)$'){
      if($matches[1] -eq ''){ $start = [Math]::Max(0, $len - [long]$matches[2]); $end = $len - 1 }
      else { $start = [long]$matches[1]; $end = if($matches[2] -eq ''){ $len - 1 } else { [Math]::Min([long]$matches[2], $len - 1) } }
      if($start -ge $len -or $start -gt $end){
        Send $client 416 'text/plain' ([byte[]]@()) @{ 'Content-Range' = "bytes */$len" }; return
      }
      $end = [Math]::Min($end, $start + $MaxChunk - 1)
      $count = [int]($end - $start + 1)
      $buf = New-Object byte[] $count
      [void]$fs.Seek($start, 'Begin')
      $read = 0; while($read -lt $count){ $n = $fs.Read($buf, $read, $count - $read); if($n -le 0){ break }; $read += $n }
      Send $client 206 $type $buf @{ 'Content-Range' = "bytes $start-$end/$len"; 'Accept-Ranges' = 'bytes' }
    } else {
      $buf = New-Object byte[] $len
      $read = 0; while($read -lt $len){ $n = $fs.Read($buf, $read, [int]($len - $read)); if($n -le 0){ break }; $read += $n }
      Send $client 200 $type $buf @{ 'Accept-Ranges' = 'bytes' }
    }
  } finally { $fs.Dispose() }
}

function Get-Query([string]$qs){
  $q = @{}
  if(-not $qs){ return $q }
  foreach($part in $qs.Split('&')){
    if(-not $part){ continue }
    $kv = $part.Split('=', 2)
    $k = [Uri]::UnescapeDataString($kv[0].Replace('+', ' '))
    $v = if($kv.Length -gt 1){ [Uri]::UnescapeDataString($kv[1].Replace('+', '%20')) } else { '' }
    $q[$k] = $v
  }
  return $q
}

# The show, with the phone bridge added at the end (only when served from here)
function Get-ShowHtml {
  $html = [IO.File]::ReadAllText([IO.Path]::Combine($AppDir, $AppFile), [Text.Encoding]::UTF8)
  $tag = '<script src="/remote-files/bridge.js"></script>'
  $i = $html.LastIndexOf('</body>')
  if($i -ge 0){ return $html.Substring(0, $i) + $tag + $html.Substring($i) }
  return $html + $tag
}

function Handle($x, [string]$method, [string]$target, [hashtable]$headers, [byte[]]$body){
  $client = $x.c
  $pathPart = $target; $qs = ''
  $qi = $target.IndexOf('?')
  if($qi -ge 0){ $pathPart = $target.Substring(0, $qi); $qs = $target.Substring($qi + 1) }
  $path = [Uri]::UnescapeDataString($pathPart)
  $q = Get-Query $qs

  $remoteIp = $client.Client.RemoteEndPoint.Address
  $isLocal = [Net.IPAddress]::IsLoopback($remoteIp)
  if($TestMode -and $headers['x-test-remote'] -eq '1'){ $isLocal = $false }
  $authed = $isLocal -or ($q['t'] -and $q['t'].ToUpper() -eq $Token)

  switch -regex ($path){
    '^/api/sync$' {
      # The show (on this computer) sends its state and collects phone commands
      if(-not $isLocal){ SendText $client 403 'text/plain' 'forbidden'; return }
      if($body.Length){ $script:showState = [Text.Encoding]::UTF8.GetString($body) }
      $script:showAt = [DateTime]::UtcNow
      $since = -1; if(-not [int]::TryParse([string]$q['since'], [ref]$since)){ $since = -1 }
      $cutoff = [DateTime]::UtcNow.AddSeconds(-4)   # never replay old taps
      $list = @($script:cmds | Where-Object { $since -ge 0 -and $_.id -gt $since -and $_.at -gt $cutoff } | ForEach-Object { '{"id":' + $_.id + ',"key":' + (Json $_.key) + '}' })
      SendText $client 200 'application/json' ('{"boot":"' + $Boot + '","seq":' + $script:seq + ',"cmds":[' + ($list -join ',') + ']}')
      return
    }
    '^/api/cmd$' {
      if(-not $authed){ SendText $client 403 'application/json' '{"error":"code"}'; return }
      if($method -ne 'POST'){ SendText $client 405 'text/plain' 'POST only'; return }
      # Other web pages open on the laptop may not send commands
      if($headers['sec-fetch-site'] -eq 'cross-site'){ SendText $client 403 'application/json' '{"error":"site"}'; return }
      $k = [string]$q['k']
      if($AllowedKeys -notcontains $k){ SendText $client 400 'application/json' '{"error":"key"}'; return }
      $script:seq++
      [void]$script:cmds.Add([pscustomobject]@{ id = $script:seq; key = $k; at = [DateTime]::UtcNow })
      while($script:cmds.Count -gt 50){ $script:cmds.RemoveAt(0) }
      $fresh = ([DateTime]::UtcNow - $script:showAt).TotalSeconds -lt 3
      SendText $client 200 'application/json' ('{"ok":true,"id":' + $script:seq + ',"showConnected":' + $(if($fresh){'true'}else{'false'}) + '}')
      return
    }
    '^/api/state$' {
      if(-not $authed){ SendText $client 403 'application/json' '{"error":"code"}'; return }
      $age = ([DateTime]::UtcNow - $script:showAt).TotalSeconds
      $connected = if($age -lt 3){ 'true' } else { 'false' }
      SendText $client 200 'application/json' ('{"connected":' + $connected + ',"state":' + $script:showState + '}')
      return
    }
    '^/api/info$' {
      if(-not $isLocal){ SendText $client 403 'text/plain' 'forbidden'; return }
      $urls = @(Get-LanUrls | ForEach-Object { '{"ip":' + (Json $_.ip) + ',"name":' + (Json $_.name) + ',"gateway":' + $(if($_.gateway){'true'}else{'false'}) + ',"url":' + (Json $_.url) + '}' })
      SendText $client 200 'application/json' ('{"token":' + (Json $Token) + ',"port":' + $Port + ',"localOnly":' + $(if($LocalOnly){'true'}else{'false'}) + ',"urls":[' + ($urls -join ',') + ']}')
      return
    }
    '^/remote$' {
      if(-not $authed){ SendFile $client (Join-Path $Here 'wrong-code.html') $null; return }
      SendFile $client (Join-Path $Here 'remote.html') $null; return
    }
    '^/connect$' {
      if(-not $isLocal){ SendText $client 403 'text/plain' 'forbidden'; return }
      SendFile $client (Join-Path $Here 'connect.html') $null; return
    }
    '^/remote-files/(bridge\.js|qrcode\.js)$' {
      SendFile $client (Join-Path $Here $matches[1]) $null; return
    }
    default {
      # The show and its files: this computer, or a phone with the code
      if(-not $authed){ SendText $client 403 'text/plain' 'forbidden'; return }
      if($path -eq '/' -or $path -eq "/$AppFile"){ SendText $client 200 'text/html; charset=utf-8' (Get-ShowHtml); return }
      $full = [IO.Path]::GetFullPath([IO.Path]::Combine($AppDir, $path.TrimStart('/').Replace('/', [string]$Sep)))
      if(-not $full.StartsWith($AppDir + $Sep, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)){
        SendText $client 404 'text/plain' 'not found'; return
      }
      SendFile $client $full $headers['range']; return
    }
  }
}

# ---------- start ----------
$showUrl = "http://localhost:$Port/"
$connectUrl = "http://localhost:$Port/connect"
Write-Host ''
Write-Host '  ESN Speed Friending - phone remote is running' -ForegroundColor Cyan
Write-Host ''
Write-Host "  Show (put this on the projector):  $showUrl"
Write-Host "  Phone QR code:                     $connectUrl"
Write-Host "  Access code:                       $Token"
foreach($u in Get-LanUrls){ Write-Host "  Phone link ($($u.name)):  $($u.url)" }
Write-Host ''
Write-Host '  Keep this window open during the event. Close it to stop the remote.'
Write-Host ''
# Only the connect page opens; it has the button that opens the show, so
# there is never a second show tab by accident.
if(-not $NoBrowser){ Start-Process $connectUrl }

# ---------- main loop: a handful of short requests at a time ----------
$conns = New-Object Collections.ArrayList
$headerEnd = [byte[]](13,10,13,10)
while($true){
  $busy = $false
  try {
    while($listener.Pending()){
      $c = $listener.AcceptTcpClient()
      $c.SendTimeout = 5000
      [void]$conns.Add(@{ c = $c; t = [DateTime]::UtcNow; buf = New-Object IO.MemoryStream })
      $busy = $true
    }
  } catch { Write-Host "  (connection error: $($_.Exception.Message))" }
  foreach($x in @($conns)){
    $done = $false
    try {
      $c = $x.c
      while($c.Available -gt 0){
        $b = New-Object byte[] $c.Available
        $n = $c.GetStream().Read($b, 0, $b.Length)
        if($n -le 0){ break }
        $x.buf.Write($b, 0, $n)
        $busy = $true
      }
      if($x.buf.Length -gt 65536){ throw 'request too large' }
      $data = $x.buf.ToArray()
      $he = -1
      for($i = 0; $i -le $data.Length - 4; $i++){
        if($data[$i] -eq 13 -and $data[$i+1] -eq 10 -and $data[$i+2] -eq 13 -and $data[$i+3] -eq 10){ $he = $i; break }
      }
      if($he -ge 0){
        $head = [Text.Encoding]::ASCII.GetString($data, 0, $he)
        $lines = $head -split "`r`n"
        $parts = $lines[0].Split(' ')
        $headers = @{}
        foreach($l in @($lines | Select-Object -Skip 1)){ $ci = $l.IndexOf(':'); if($ci -gt 0){ $headers[$l.Substring(0, $ci).Trim().ToLower()] = $l.Substring($ci + 1).Trim() } }
        $clen = 0; if($headers['content-length']){ [void][int]::TryParse($headers['content-length'], [ref]$clen) }
        $have = $data.Length - $he - 4
        if($have -ge $clen){
          $body = New-Object byte[] $clen
          if($clen -gt 0){ [Array]::Copy($data, $he + 4, $body, 0, $clen) }
          try { Handle $x $parts[0] $parts[1] $headers $body }
          catch { try { SendText $c 500 'text/plain' 'error' } catch {} ; Write-Host "  (request error: $($_.Exception.Message))" }
          $done = $true
        }
      }
      if(-not $done -and ([DateTime]::UtcNow - $x.t).TotalSeconds -gt 15){ $done = $true }   # idle connection
    } catch { $done = $true }
    if($done){ try { $x.c.Close() } catch {}; $conns.Remove($x) }
  }
  if(-not $busy){ Start-Sleep -Milliseconds 5 }
}
