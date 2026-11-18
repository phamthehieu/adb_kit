# ADB Kit desk board (keep this file ASCII: Windows PowerShell reads it as ANSI): prints one JSON line every two seconds with what Node cannot read by
# itself on Windows: network counters, GPU load, battery and the track that is playing.
# Read-only, except for the media buttons: a line "prev", "toggle" or "next" on stdin is passed to
# the player that is shown. Stops by itself when ADB Kit (the parent process) is gone.
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File desk-helper.ps1 -ParentId <pid> -Want net,gpu,battery,media
param([int]$ParentId = 0, [string]$Want = 'net,gpu,battery,media')

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$parts = $Want.Split(',')

$gpuName = ''
if ($parts -contains 'gpu') {
  $gpuName = [string](Get-CimInstance Win32_VideoController | Sort-Object AdapterRAM -Descending | Select-Object -First 1).Name
}

# The "now playing" information Windows keeps for the media keys (WinRT, Windows 10 1809+).
$mgr = $null
$mediaOk = $false
if ($parts -contains 'media') {
  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
      })[0]
    function Await($op, $type) {
      $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
      if ($task.Wait(3000)) { $task.Result } else { $null }
    }
    $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    $propType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
    $mediaOk = $true
    $mgr = Await ($mgrType::RequestAsync()) $mgrType
  } catch { $mgr = $null }
}

# The player Windows would send the media keys to. The manager asked for at start can fail (slow
# start) or keep saying "nothing" after a player opens later (a browser tab), so when it has no
# session, ask Windows again.
function CurrentSession {
  $s = $null
  if ($script:mgr) { $s = $script:mgr.GetCurrentSession() }
  if (-not $s) {
    try { $script:mgr = Await ($mgrType::RequestAsync()) $mgrType } catch { $script:mgr = $null }
    if ($script:mgr) { $s = $script:mgr.GetCurrentSession() }
  }
  return $s
}

function MediaInfo {
  $s = CurrentSession
  if (-not $s) { return $null }
  $p = Await ($s.TryGetMediaPropertiesAsync()) $propType
  $info = $s.GetPlaybackInfo()
  $playing = ([int]$info.PlaybackStatus -eq 4)
  $tl = $s.GetTimelineProperties()
  $dur = $tl.EndTime.TotalSeconds
  $pos = $tl.Position.TotalSeconds
  if ($playing) {
    $since = ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds
    if ($since -gt 0 -and $since -lt 86400) { $pos += $since }
  }
  if ($dur -gt 0 -and $pos -gt $dur) { $pos = $dur }
  if (-not ($p -and $p.Title)) { return $null }
  return @{
    title = [string]$p.Title; artist = [string]$p.Artist; playing = $playing
    position = [Math]::Round($pos, 1); duration = [Math]::Round($dur, 1)
    canPrev = [bool]$info.Controls.IsPreviousEnabled; canNext = [bool]$info.Controls.IsNextEnabled
  }
}

# Press a button of the player that is shown (not a global media key, which may reach another app).
function MediaDo($act) {
  $s = CurrentSession
  if (-not $s) { return }
  $op = $null
  if ($act -eq 'toggle') { $op = $s.TryTogglePlayPauseAsync() }
  elseif ($act -eq 'next') { $op = $s.TrySkipNextAsync() }
  elseif ($act -eq 'prev') { $op = $s.TrySkipPreviousAsync() }
  if ($op) { [void](Await $op ([bool])) }
}

function Emit($o) {
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}

# Commands from ADB Kit. Console.In would block here, a reader on the raw stream does not.
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$closed = $false

while (-not $closed) {
  if ($ParentId -and -not (Get-Process -Id $ParentId)) { break }
  $o = @{}

  if ($parts -contains 'net') {
    $rx = [double]0; $tx = [double]0; $seen = $false
    foreach ($a in (Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | Get-NetAdapterStatistics)) {
      $rx += $a.ReceivedBytes; $tx += $a.SentBytes; $seen = $true
    }
    if ($seen) { $o.net = @{ rx = $rx; tx = $tx } }
  }

  if ($parts -contains 'gpu') {
    # Load per kind of work (3D, video decode, ...) summed over processes; the busiest kind is
    # what Task Manager shows.
    $byKind = @{}
    foreach ($e in (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine)) {
      if ($e.Name -match 'engtype_(\w+)') { $byKind[$Matches[1]] = [double]$byKind[$Matches[1]] + [double]$e.UtilizationPercentage }
    }
    if ($byKind.Count) {
      $load = ($byKind.Values | Measure-Object -Maximum).Maximum
      $o.gpu = @{ name = $gpuName; load = [Math]::Min(100, [Math]::Round($load, 1)) }
    }
  }

  if ($parts -contains 'battery') {
    $b = Get-CimInstance Win32_Battery | Select-Object -First 1
    if ($b) { $o.battery = @{ level = [int]$b.EstimatedChargeRemaining; charging = ([int]$b.BatteryStatus -ne 1) } }
  }

  if ($mediaOk) {
    try {
      $m = MediaInfo
      if ($m) { $o.media = $m }
    } catch {}
  }

  Emit $o

  # Wait two seconds, answering media buttons at once instead of at the next reading.
  $until = [DateTime]::UtcNow.AddMilliseconds(2000)
  while ([DateTime]::UtcNow -lt $until) {
    if ($pending.IsCompleted) {
      $cmd = $pending.Result
      if ($null -eq $cmd) { $closed = $true; break } # stdin closed: ADB Kit is gone
      $pending = $stdin.ReadLineAsync()
      $cmd = $cmd.Trim()
      if ($mediaOk -and @('prev', 'toggle', 'next') -contains $cmd) {
        try {
          MediaDo $cmd
          Start-Sleep -Milliseconds 250 # the player needs a moment to report its new state
          $only = @{ only = 'media' }
          $m = MediaInfo
          if ($m) { $only.media = $m }
          Emit $only
        } catch {}
      }
    }
    Start-Sleep -Milliseconds 100
  }
}
