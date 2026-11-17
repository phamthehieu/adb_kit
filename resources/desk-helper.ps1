# ADB Kit desk board (keep this file ASCII: Windows PowerShell reads it as ANSI): prints one JSON line every two seconds with what Node cannot read by
# itself on Windows: network counters, GPU load, battery and the track that is playing.
# Read-only. Stops by itself when ADB Kit (the parent process) is gone.
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
    $mgr = Await ($mgrType::RequestAsync()) $mgrType
  } catch { $mgr = $null }
}

while ($true) {
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

  if ($mgr) {
    try {
      $s = $mgr.GetCurrentSession()
      if ($s) {
        $p = Await ($s.TryGetMediaPropertiesAsync()) $propType
        $playing = ([int]$s.GetPlaybackInfo().PlaybackStatus -eq 4)
        $tl = $s.GetTimelineProperties()
        $dur = $tl.EndTime.TotalSeconds
        $pos = $tl.Position.TotalSeconds
        if ($playing) {
          $since = ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds
          if ($since -gt 0 -and $since -lt 86400) { $pos += $since }
        }
        if ($dur -gt 0 -and $pos -gt $dur) { $pos = $dur }
        if ($p -and $p.Title) {
          $o.media = @{ title = [string]$p.Title; artist = [string]$p.Artist; playing = $playing; position = [Math]::Round($pos, 1); duration = [Math]::Round($dur, 1) }
        }
      }
    } catch {}
  }

  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 2000
}
