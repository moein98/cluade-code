# Agentic OS - desktop widget (WPF, no dependencies). Start it with widget.vbs.
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$mutex = New-Object System.Threading.Mutex($false, 'Local\AgenticOSWidget')
if (-not $mutex.WaitOne(0)) { exit }

$cfgFile = @('config.json', 'config.example.json') | ForEach-Object { Join-Path $Root $_ } |
  Where-Object { Test-Path $_ } | Select-Object -First 1
$cfg = Get-Content -Raw -Encoding UTF8 $cfgFile | ConvertFrom-Json
$Base = "http://127.0.0.1:$($cfg.port)"
$PrefsFile = Join-Path $Root 'data\widget.json'
# The dashboard is on loopback; never route it through a system (VPN) proxy.
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

$C = @{
  ink = '#EBE8E2'; ink2 = '#C4C1BB'; mute = '#8B8882'; dim = '#5F5D59'
  orange = '#D0633D'; tick = '#2B2B2B'; err = '#D8463C'; ok = '#D9A047'
}
$script:brushes = @{}
function B($hex) {
  if (-not $script:brushes.ContainsKey($hex)) {
    $b = [Windows.Media.BrushConverter]::new().ConvertFromString($hex)
    $b.Freeze()
    $script:brushes[$hex] = $b
  }
  $script:brushes[$hex]
}

$script:prefs = @{ left = $null; top = $null; topmost = $true; compact = $false }
if (Test-Path $PrefsFile) {
  try {
    $p = Get-Content -Raw $PrefsFile | ConvertFrom-Json
    foreach ($k in 'left', 'top', 'topmost', 'compact') { if ($null -ne $p.$k) { $script:prefs[$k] = $p.$k } }
  } catch {}
}

[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Agentic OS" Width="340" SizeToContent="Height"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        ResizeMode="NoResize" ShowInTaskbar="False" Topmost="True"
        FontFamily="JetBrains Mono, Cascadia Mono, Consolas" FontSize="11" Foreground="#EBE8E2"
        UseLayoutRounding="True" TextOptions.TextFormattingMode="Display">
  <Window.Resources>
    <Style x:Key="Btn" TargetType="Button">
      <Setter Property="Foreground" Value="#C4C1BB"/>
      <Setter Property="Background" Value="#111111"/>
      <Setter Property="BorderBrush" Value="#2A2A2A"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="FontSize" Value="10"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Padding" Value="8,6"/>
      <Setter Property="HorizontalContentAlignment" Value="Left"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="b" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}"
                    BorderThickness="{TemplateBinding BorderThickness}" CornerRadius="2" Padding="{TemplateBinding Padding}">
              <ContentPresenter HorizontalAlignment="{TemplateBinding HorizontalContentAlignment}" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="b" Property="BorderBrush" Value="#9C4427"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="Icon" TargetType="Button" BasedOn="{StaticResource Btn}">
      <Setter Property="Padding" Value="5,0"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="Foreground" Value="#8B8882"/>
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="BorderBrush" Value="Transparent"/>
      <Setter Property="HorizontalContentAlignment" Value="Center"/>
    </Style>
  </Window.Resources>

  <Border x:Name="Card" Background="#F2141414" BorderBrush="#2A2A2A" BorderThickness="1" CornerRadius="4" Padding="14,12,14,14">
    <StackPanel>
      <Grid x:Name="Header" Background="Transparent">
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="Auto"/><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/>
        </Grid.ColumnDefinitions>
        <Canvas x:Name="Bot" Width="16" Height="20" Margin="0,0,10,0" VerticalAlignment="Center"/>
        <TextBlock Grid.Column="1" VerticalAlignment="Center" FontSize="17" FontWeight="Bold">
          <Run Text="AGENTIC" Foreground="#C9C6C0"/><Run Text="OS" Foreground="#D0633D"/>
        </TextBlock>
        <StackPanel Grid.Column="2" Orientation="Horizontal" VerticalAlignment="Center">
          <Ellipse x:Name="Online" Width="6" Height="6" Fill="#5F5D59" Margin="0,0,6,0" VerticalAlignment="Center"/>
          <Button x:Name="BtnOpen" Style="{StaticResource Icon}" Content="&#x2197;" ToolTip="Open dashboard"/>
          <Button x:Name="BtnClose" Style="{StaticResource Icon}" Content="&#x00D7;" ToolTip="Close widget"/>
        </StackPanel>
      </Grid>

      <StackPanel x:Name="Body" Margin="0,14,0,0">
        <StackPanel x:Name="Tiles"/>
        <StackPanel x:Name="Details">
          <Border Height="1" Background="#242424" Margin="0,2,0,12"/>
          <Border x:Name="LastBox" Background="#111111" BorderBrush="#2A2A2A" BorderThickness="1" CornerRadius="2" Padding="10,8" Cursor="Hand">
            <StackPanel>
              <TextBlock x:Name="LastLbl" FontSize="9.5" Foreground="#8B8882" TextTrimming="CharacterEllipsis"/>
              <StackPanel Orientation="Horizontal" Margin="0,5,0,3">
                <TextBlock x:Name="LastStatus" FontSize="18" FontWeight="Bold"/>
                <Ellipse x:Name="LastDot" Width="6" Height="6" Margin="10,0,0,0" VerticalAlignment="Center" Fill="#D0633D"/>
              </StackPanel>
              <TextBlock x:Name="LastStats" FontSize="10" Foreground="#8B8882" TextTrimming="CharacterEllipsis"/>
            </StackPanel>
          </Border>
          <TextBlock x:Name="Next" Margin="0,10,0,0" FontSize="10" Foreground="#8B8882" TextTrimming="CharacterEllipsis"/>
          <TextBlock Text="SKILLS" FontSize="9.5" Foreground="#D0633D" Margin="0,14,0,6"/>
          <UniformGrid x:Name="Skills" Columns="2" Margin="-2,0,-2,0"/>
        </StackPanel>
      </StackPanel>

      <StackPanel x:Name="Offline" Margin="0,14,0,0" Visibility="Collapsed">
        <TextBlock Text="DASHBOARD OFFLINE" FontSize="15" FontWeight="Bold"/>
        <TextBlock x:Name="OfflineMsg" FontSize="10" Foreground="#8B8882" Margin="0,4,0,10" TextWrapping="Wrap"
                   Text="The Agentic OS server is not running."/>
        <Button x:Name="BtnStart" Style="{StaticResource Btn}" HorizontalAlignment="Left">
          <TextBlock><Run Text="&#x25B8; " Foreground="#D0633D"/><Run Text="START SERVER"/></TextBlock>
        </Button>
      </StackPanel>
    </StackPanel>
  </Border>
</Window>
'@

$win = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))
$ui = @{}
foreach ($n in 'Card', 'Header', 'Bot', 'Online', 'BtnOpen', 'BtnClose', 'Body', 'Tiles', 'Details', 'LastBox', 'LastLbl',
  'LastStatus', 'LastDot', 'LastStats', 'Next', 'Skills', 'Offline', 'OfflineMsg', 'BtnStart') {
  $ui[$n] = $win.FindName($n)
}

# Pixel robot (same art as the dashboard icon), 2px per pixel.
foreach ($r in @(
    @(3, 0, 2, 1, '#C2552F'), @(1, 1, 6, 3, '#C2552F'), @(2, 4, 4, 1, '#C2552F'), @(0, 5, 8, 1, '#C2552F'),
    @(0, 6, 1, 1, '#C2552F'), @(7, 6, 1, 1, '#C2552F'), @(2, 6, 4, 2, '#9A4024'), @(2, 8, 1, 2, '#9A4024'),
    @(5, 8, 1, 2, '#9A4024'), @(2, 2, 1, 1, '#161616'), @(5, 2, 1, 1, '#161616'), @(3, 3, 2, 1, '#7D3219'))) {
  $rect = New-Object Windows.Shapes.Rectangle
  $rect.Width = $r[2] * 2; $rect.Height = $r[3] * 2; $rect.Fill = B $r[4]
  [Windows.Controls.Canvas]::SetLeft($rect, $r[0] * 2); [Windows.Controls.Canvas]::SetTop($rect, $r[1] * 2)
  [void]$ui.Bot.Children.Add($rect)
}

# ---------- formatting (mirrors public/app.js) ----------
function Format-Tok($n) {
  $n = [double]$n
  if ($n -ge 1e9) { return ('{0:0.0}B' -f ($n / 1e9)) }
  if ($n -ge 1e6) { return ('{0:0.0}M' -f ($n / 1e6)) }
  if ($n -ge 1e3) { return ('{0:0.0}K' -f ($n / 1e3)) }
  return [string][Math]::Round($n)
}
function Format-Dur($ms) {
  if ($null -eq $ms) { return [string][char]0x2014 }
  $m = [Math]::Max(0, [Math]::Round([double]$ms / 60000))
  $d = [Math]::Floor($m / 1440); $h = [Math]::Floor(($m % 1440) / 60)
  if ($d -gt 0) { return "${d}D ${h}H" }
  return ('{0}H {1:00}M' -f $h, ($m % 60))
}
function Format-Trend($t) {
  if ($null -eq $t -or [Math]::Abs([double]$t) -lt 0.1) { return "$([char]0x00B7) FLAT" }
  $arrow = if ($t -gt 0) { [char]0x25B2 } else { [char]0x25BC }
  return "$arrow $([Math]::Round([Math]::Abs([double]$t) * 100))%"
}
function ConvertTo-LocalTime($v) {
  if ($v -is [datetime]) { return $v.ToLocalTime() }
  return [DateTimeOffset]::Parse([string]$v).LocalDateTime
}
$dot = [char]0x00B7

# ---------- usage tiles ----------
$TICKS = 62
function New-Text($size, $color) {
  $t = New-Object Windows.Controls.TextBlock
  $t.FontSize = $size; $t.Foreground = B $color
  $t
}
function New-Tile {
  $sp = New-Object Windows.Controls.StackPanel
  $sp.Margin = '0,0,0,12'
  $top = New-Object Windows.Controls.Grid
  $lbl = New-Text 9.5 $C.mute
  $rt = New-Text 9.5 $C.dim
  $rt.HorizontalAlignment = 'Right'
  [void]$top.Children.Add($lbl); [void]$top.Children.Add($rt)

  $meter = New-Object Windows.Controls.StackPanel
  $meter.Orientation = 'Horizontal'; $meter.Height = 9; $meter.Margin = '0,7,0,7'
  for ($i = 0; $i -lt $TICKS; $i++) {
    $tk = New-Object Windows.Shapes.Rectangle
    $tk.Width = 3; $tk.Height = 9; $tk.Margin = '0,0,2,0'; $tk.Fill = B $C.tick
    [void]$meter.Children.Add($tk)
  }

  $bot = New-Object Windows.Controls.Grid
  foreach ($w in @([Windows.GridLength]::new(1, 'Star'), [Windows.GridLength]::Auto, [Windows.GridLength]::new(1, 'Star'))) {
    $cd = New-Object Windows.Controls.ColumnDefinition
    $cd.Width = $w
    [void]$bot.ColumnDefinitions.Add($cd)
  }
  $val = New-Text 13 $C.ink
  $val.FontWeight = 'SemiBold'
  $vRun = New-Object Windows.Documents.Run
  $lRun = New-Object Windows.Documents.Run
  $lRun.FontSize = 10.5; $lRun.FontWeight = 'Normal'; $lRun.Foreground = B $C.mute
  [void]$val.Inlines.Add($vRun); [void]$val.Inlines.Add($lRun)
  $mid = New-Text 9.5 $C.mute
  $mid.VerticalAlignment = 'Center'
  [Windows.Controls.Grid]::SetColumn($mid, 1)
  $badge = New-Object Windows.Controls.Border
  $badge.BorderBrush = B '#3A3A3A'; $badge.BorderThickness = 1; $badge.CornerRadius = 2; $badge.Padding = '6,1'
  $badge.HorizontalAlignment = 'Right'; $badge.VerticalAlignment = 'Center'
  $bt = New-Text 9 $C.ink2
  $badge.Child = $bt
  [Windows.Controls.Grid]::SetColumn($badge, 2)
  [void]$bot.Children.Add($val); [void]$bot.Children.Add($mid); [void]$bot.Children.Add($badge)

  [void]$sp.Children.Add($top); [void]$sp.Children.Add($meter); [void]$sp.Children.Add($bot)
  [void]$ui.Tiles.Children.Add($sp)
  @{ Label = $lbl; Right = $rt; Meter = $meter; Value = $vRun; Limit = $lRun; Mid = $mid; Badge = $bt; BadgeBox = $badge }
}
function Set-Tile($t, $label, $right, $used, $limit, $mid, $badge) {
  $t.Label.Text = $label
  $t.Right.Text = $right
  $pct = if ($limit -gt 0) { [Math]::Min(1, [double]$used / [double]$limit) } else { 0 }
  $lit = [int][Math]::Round($pct * $TICKS)
  if ($used -gt 0 -and $lit -eq 0) { $lit = 1 }
  for ($i = 0; $i -lt $TICKS; $i++) {
    $t.Meter.Children[$i].Fill = if ($i -lt $lit) { B $C.orange } else { B $C.tick }
  }
  $t.Mid.Text = $mid
  if ($badge) { $t.Badge.Text = $badge; $t.BadgeBox.Visibility = 'Visible' } else { $t.BadgeBox.Visibility = 'Collapsed' }
}
$tile5h = New-Tile
$tileWeek = New-Tile
$tileRoutines = New-Tile

# ---------- server calls ----------
function Get-State {
  try { Invoke-RestMethod -Uri "$Base/api/state" -TimeoutSec 4 } catch { $null }
}
function Post($path, $body) {
  $json = if ($body) { $body | ConvertTo-Json -Compress } else { '{}' }
  try {
    Invoke-RestMethod -Method Post -Uri "$Base$path" -Headers @{ 'X-Agentic-OS' = '1' } `
      -ContentType 'application/json' -Body $json -TimeoutSec 8 | Out-Null
    return $null
  } catch {
    $msg = $_.Exception.Message
    try { $msg = ($_.ErrorDetails.Message | ConvertFrom-Json).error } catch {}
    return $msg
  }
}
function Flash($msg) {
  $script:flashMsg = $msg
  $script:flashUntil = (Get-Date).AddSeconds(5)
  Render
}
function Start-Server {
  Start-Process wscript.exe -ArgumentList "`"$Root\start-hidden.vbs`""
  $ui.OfflineMsg.Text = 'Starting server...'
  $script:startedServerAt = Get-Date
}

# ---------- skills ----------
$script:skillButtons = @{}
$script:skillNames = ''
$script:armed = $null
$script:armedAt = [datetime]::MinValue

function Invoke-Skill($name) {
  $s = $script:state.skills | Where-Object { $_.name -eq $name }
  if (-not $s -or $s.running) { return }
  if ($s.prompt -like '*<topic here>*') {
    # Needs input (e.g. deep-research topic): hand off to the dashboard's prompt editor.
    Start-Process $Base
    return
  }
  # Two-click confirm: every run spends plan usage.
  if ($script:armed -ne $name -or ((Get-Date) - $script:armedAt).TotalSeconds -gt 4) {
    $script:armed = $name
    $script:armedAt = Get-Date
    Render
    return
  }
  $script:armed = $null
  $err = Post "/api/run/$name" $null
  if ($err) { Flash $err } else { Refresh }
}

function Update-Skills($skills) {
  $names = ($skills | ForEach-Object { $_.name }) -join ','
  if ($names -ne $script:skillNames) {
    $ui.Skills.Children.Clear()
    $script:skillButtons = @{}
    foreach ($s in $skills) {
      $b = New-Object Windows.Controls.Button
      $b.Style = $win.FindResource('Btn')
      $b.Margin = '2'
      $b.Tag = $s.name
      $b.Add_Click({ param($src, $e) Invoke-Skill $src.Tag })
      [void]$ui.Skills.Children.Add($b)
      $script:skillButtons[$s.name] = $b
    }
    $script:skillNames = $names
  }
  $armedLive = $script:armed -and ((Get-Date) - $script:armedAt).TotalSeconds -le 4
  foreach ($s in $skills) {
    $b = $script:skillButtons[$s.name]
    $tb = New-Object Windows.Controls.TextBlock
    $tb.TextTrimming = 'CharacterEllipsis'
    $icon = New-Object Windows.Documents.Run
    $text = New-Object Windows.Documents.Run
    $icon.Foreground = B $C.orange
    if ($s.running) {
      $icon.Text = "$([char]0x25CF) "; $text.Text = 'RUNNING'
    } elseif ($armedLive -and $script:armed -eq $s.name) {
      $icon.Text = "$([char]0x25B8) "; $text.Text = 'CLICK TO RUN'; $text.Foreground = B $C.orange
    } else {
      $icon.Text = "$([char]0x25B8) "; $text.Text = $s.label
    }
    [void]$tb.Inlines.Add($icon); [void]$tb.Inlines.Add($text)
    $b.Content = $tb
    $when = if ($s.schedule) { "$(if ($s.days) { ($s.days -join ' ').ToUpper() } else { 'DAILY' }) $dot $($s.schedule)" } else { 'ON DEMAND' }
    $b.ToolTip = "$($s.label)  $dot  $($s.domain.ToUpper())  $dot  $when`n`n$($s.description)"
  }
}

# ---------- render ----------
$pulse = New-Object Windows.Media.Animation.DoubleAnimation(1, 0.2, [Windows.Duration]::new([TimeSpan]::FromMilliseconds(550)))
$pulse.AutoReverse = $true
$pulse.RepeatBehavior = [Windows.Media.Animation.RepeatBehavior]::Forever

function Render {
  $s = $script:state
  if (-not $s) {
    $ui.Online.Fill = B $C.err
    $ui.Online.ToolTip = 'Dashboard offline'
    $ui.Body.Visibility = 'Collapsed'
    $ui.Offline.Visibility = 'Visible'
    return
  }
  $ui.Online.Fill = B $C.ok
  $ui.Online.ToolTip = "Dashboard online $dot $Base"
  $ui.Offline.Visibility = 'Collapsed'
  $ui.Body.Visibility = 'Visible'
  $ui.Details.Visibility = if ($script:prefs.compact) { 'Collapsed' } else { 'Visible' }

  $f = $s.fiveHour
  Set-Tile $tile5h '5-HOUR WINDOW' "RESETS $dot $(Format-Dur $f.resetsIn)" $f.used $f.limit "$dot $($f.sessions) SESSIONS" (Format-Trend $f.trend)
  $tile5h.Value.Text = Format-Tok $f.used; $tile5h.Limit.Text = " / $(Format-Tok $f.limit)"
  $w = $s.weekly
  Set-Tile $tileWeek 'WEEKLY WINDOW' "RESETS $dot $(Format-Dur $w.resetsIn)" $w.used $w.limit "$dot $($w.sessions) SESSIONS" (Format-Trend $w.trend)
  $tileWeek.Value.Text = Format-Tok $w.used; $tileWeek.Limit.Text = " / $(Format-Tok $w.limit)"
  $r = $s.routines
  Set-Tile $tileRoutines "ROUTINES $dot $($s.meta.plan)" '' $r.runsToday $r.limit ('${0:0.0} TODAY' -f [double]$r.costToday) $null
  $tileRoutines.Value.Text = [string]$r.runsToday; $tileRoutines.Limit.Text = " / $($r.limit)"

  # Last run (a running one takes precedence)
  $run = $s.recentRuns | Where-Object { $_.status -eq 'RUNNING' } | Select-Object -First 1
  if (-not $run) { $run = $s.lastRun }
  if ($run) {
    $ui.LastLbl.Text = "LAST RUN $dot $($run.label)"
    $ui.LastStatus.Text = $run.status
    $ui.LastBox.Tag = $run.note
    $ui.LastBox.ToolTip = if ($run.note) { "Open in Obsidian $dot $($run.note)" } else { $null }
    $started = (ConvertTo-LocalTime $run.startedAt).ToString('HH:mm')
    switch ($run.status) {
      'RUNNING' {
        $ui.LastDot.Fill = B $C.orange
        $ui.LastDot.BeginAnimation([Windows.UIElement]::OpacityProperty, $pulse)
        $ui.LastStats.Foreground = B $C.mute
        $ui.LastStats.Text = "STARTED $started $dot $($run.trigger.ToUpper())"
      }
      'FAILED' {
        $ui.LastDot.BeginAnimation([Windows.UIElement]::OpacityProperty, $null)
        $ui.LastDot.Fill = B $C.err
        $ui.LastStats.Foreground = B '#E0786F'
        $ui.LastStats.Text = "$started $dot $($run.error)"
      }
      default {
        $ui.LastDot.BeginAnimation([Windows.UIElement]::OpacityProperty, $null)
        $ui.LastDot.Fill = B $C.orange
        $ui.LastStats.Foreground = B $C.mute
        $ui.LastStats.Text = ('{0} {1} ${2:0.0000} {1} {3} IN {1} {4} OUT' -f $started, $dot, [double]$run.cost, $run.input, $run.output)
      }
    }
  } else {
    $ui.LastLbl.Text = 'LAST RUN'
    $ui.LastStatus.Text = 'IDLE'
    $ui.LastBox.Tag = $null
    $ui.LastStats.Text = 'NO RUNS YET'
  }

  # Next scheduled run, or a transient message
  if ($script:flashMsg -and (Get-Date) -lt $script:flashUntil) {
    $ui.Next.Foreground = B '#E0786F'
    $ui.Next.Text = $script:flashMsg
  } elseif ($s.upcoming -and @($s.upcoming).Count) {
    $u = @($s.upcoming)[0]
    $at = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$u.at).LocalDateTime
    $ui.Next.Foreground = B $C.mute
    $ui.Next.Text = "NEXT $dot $($u.label) $dot $($at.ToString('HH:mm')) $dot IN $(Format-Dur (($at - (Get-Date)).TotalMilliseconds))"
  } else {
    $ui.Next.Foreground = B $C.mute
    $ui.Next.Text = "NEXT $dot NOTHING SCHEDULED"
  }

  Update-Skills @($s.skills)
}

function Refresh {
  $script:state = Get-State
  Render
  $busy = $script:state -and @($script:state.recentRuns | Where-Object { $_.status -eq 'RUNNING' }).Count
  $timer.Interval = [TimeSpan]::FromSeconds($(if ($busy) { 3 } else { 10 }))
}

# ---------- window behaviour ----------
function Save-Prefs {
  $script:prefs.left = $win.Left
  $script:prefs.top = $win.Top
  $script:prefs.topmost = $win.Topmost
  New-Item -ItemType Directory -Force (Split-Path $PrefsFile) | Out-Null
  $script:prefs | ConvertTo-Json | Set-Content -Encoding UTF8 $PrefsFile
}

function Set-Compact($on) {
  $script:prefs.compact = $on
  $script:miCompact.IsChecked = $on
  Render
  Save-Prefs
}

$ui.Card.Add_MouseLeftButtonDown({
    param($src, $e)
    if ($e.ClickCount -eq 2) { Set-Compact (-not $script:prefs.compact); return }
    $win.DragMove()
    Save-Prefs
  })
$ui.LastBox.Add_MouseLeftButtonDown({ param($src, $e) $e.Handled = $true })
$ui.LastBox.Add_MouseLeftButtonUp({
    param($src, $e)
    if ($ui.LastBox.Tag) {
      $err = Post '/api/open/note' @{ file = [string]$ui.LastBox.Tag }
      if ($err) { Flash $err }
    }
  })
$ui.BtnOpen.Add_Click({ Start-Process $Base })
$ui.BtnClose.Add_Click({ $win.Close() })
$ui.BtnStart.Add_Click({ Start-Server })

$menu = New-Object Windows.Controls.ContextMenu
function Add-MenuItem($header, $action) {
  $mi = New-Object Windows.Controls.MenuItem
  $mi.Header = $header
  $mi.Add_Click($action)
  [void]$menu.Items.Add($mi)
  $mi
}
$script:miTop = Add-MenuItem 'Always on top' {
  $win.Topmost = -not $win.Topmost
  $script:miTop.IsChecked = $win.Topmost
  Save-Prefs
}
$script:miCompact = Add-MenuItem 'Compact (double-click)' { Set-Compact (-not $script:prefs.compact) }
[void]$menu.Items.Add((New-Object Windows.Controls.Separator))
[void](Add-MenuItem 'Open dashboard' { Start-Process $Base })
[void](Add-MenuItem 'Claude Code' { $e = Post '/api/open/claude' $null; if ($e) { Flash $e } })
[void](Add-MenuItem 'Vault' { $e = Post '/api/open/vault' $null; if ($e) { Flash $e } })
[void](Add-MenuItem 'Daily note' { $e = Post '/api/open/daily' $null; if ($e) { Flash $e } })
[void](Add-MenuItem 'Runs folder' { $e = Post '/api/open/runs' $null; if ($e) { Flash $e } })
[void]$menu.Items.Add((New-Object Windows.Controls.Separator))
[void](Add-MenuItem 'Refresh' { Refresh })
[void](Add-MenuItem 'Close widget' { $win.Close() })
$ui.Card.ContextMenu = $menu

# Position: saved spot if still on a screen, otherwise the top-right corner of the work area.
$vs = [Windows.SystemParameters]
$left = $script:prefs.left; $top = $script:prefs.top
if ($null -eq $left -or $left -lt $vs::VirtualScreenLeft -or $left -gt ($vs::VirtualScreenLeft + $vs::VirtualScreenWidth - 60) -or
  $top -lt $vs::VirtualScreenTop -or $top -gt ($vs::VirtualScreenTop + $vs::VirtualScreenHeight - 60)) {
  $left = $vs::WorkArea.Right - 340 - 24
  $top = $vs::WorkArea.Top + 24
}
$win.Left = $left; $win.Top = $top
$win.Topmost = [bool]$script:prefs.topmost
$script:miTop.IsCheckable = $true; $script:miTop.IsChecked = $win.Topmost
$script:miCompact.IsCheckable = $true; $script:miCompact.IsChecked = [bool]$script:prefs.compact

$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(10)
$timer.Add_Tick({ Refresh })

$win.Add_Closing({ Save-Prefs; $timer.Stop() })
$win.Add_ContentRendered({
    Refresh
    if (-not $script:state) { Start-Server }
    $timer.Start()
  })

[void]$win.ShowDialog()
$mutex.ReleaseMutex()
