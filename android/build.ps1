# Builds out\OfflinePlayer.apk with the JDK and Android SDK already on this PC.
$ErrorActionPreference = 'Stop'
# aapt2 cannot open paths with Hebrew letters: the sources are copied under VODOS-build and
# everything goes through 8.3 short paths.
$fso = New-Object -ComObject Scripting.FileSystemObject
$local = $fso.GetFolder($env:LOCALAPPDATA).ShortPath
$tools = "$local\VODOS-build"
$staging = "$tools\offlineplayer-src"
Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $staging | Out-Null
Copy-Item "$PSScriptRoot\AndroidManifest.xml", "$PSScriptRoot\src", "$PSScriptRoot\res", "$PSScriptRoot\assets" $staging -Recurse
$root = $fso.GetFolder($staging).ShortPath
$jdk = "$tools\jdk-17.0.21+9\bin"
$bt = "$tools\sdk\bt\android-14"
$jar = "$tools\sdk\pf\android-34\android.jar"
$env:JAVA_HOME = "$tools\jdk-17.0.21+9"
$out = "$local\OfflinePlayer-Build"
$keystore = "$local\OfflinePlayer-Build-key\release.jks"
$pass = 'offlineplayer'

Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$out\classes", "$out\dex", (Split-Path $keystore) | Out-Null

Add-Type -AssemblyName System.Drawing
$icon = "$root\res\drawable\icon.png"
if (-not (Test-Path $icon)) {
  $size = 192
  $bmp = New-Object Drawing.Bitmap $size, $size
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([Drawing.Color]::Transparent)
  $rect = New-Object Drawing.Rectangle 0, 0, $size, $size
  $brush = New-Object Drawing.Drawing2D.LinearGradientBrush $rect, ([Drawing.Color]::FromArgb(106, 90, 255)), ([Drawing.Color]::FromArgb(74, 58, 255)), 60
  $path = New-Object Drawing.Drawing2D.GraphicsPath
  $r = 84
  $path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc($size - $r, 0, $r, $r, 270, 90)
  $path.AddArc($size - $r, $size - $r, $r, $r, 0, 90); $path.AddArc(0, $size - $r, $r, $r, 90, 90); $path.CloseFigure()
  $g.FillPath($brush, $path)
  $white = [Drawing.Brushes]::White
  $pen = New-Object Drawing.Pen ([Drawing.Color]::White), 11
  $g.FillEllipse($white, 42, 118, 44, 36); $g.FillEllipse($white, 108, 104, 44, 36)
  $g.DrawLine($pen, 81, 136, 81, 56); $g.DrawLine($pen, 147, 122, 147, 42)
  $thick = New-Object Drawing.Pen ([Drawing.Color]::White), 17
  $g.DrawLine($thick, 78, 58, 150, 44)
  $bmp.Save($icon, [Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

& "$bt\aapt2.exe" compile --dir "$root\res" -o "$out\res.zip"
if ($LASTEXITCODE) { throw 'aapt2 compile' }
& "$bt\aapt2.exe" link -I $jar --manifest "$root\AndroidManifest.xml" -A "$root\assets" -o "$out\base.apk" "$out\res.zip"
if ($LASTEXITCODE) { throw 'aapt2 link' }

$sources = Get-ChildItem "$root\src" -Recurse -Filter *.java | ForEach-Object { $_.FullName }
# javac prints harmless notes on stderr, which 'Stop' would treat as a failure.
$ErrorActionPreference = 'Continue'
& "$jdk\javac.exe" -nowarn -encoding UTF-8 --release 8 -cp $jar -d "$out\classes" $sources 2>&1 | Where-Object { "$_" -notmatch 'warning|^Note:' }
$javacExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($javacExit) { throw 'javac' }
$classes = Get-ChildItem "$out\classes" -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& "$bt\d8.bat" --lib $jar --min-api 19 --output "$out\dex" $classes
if ($LASTEXITCODE) { throw 'd8' }

& "$jdk\jar.exe" uf "$out\base.apk" -C "$out\dex" classes.dex
if ($LASTEXITCODE) { throw 'jar' }
& "$bt\zipalign.exe" -f 4 "$out\base.apk" "$out\aligned.apk"
if ($LASTEXITCODE) { throw 'zipalign' }

if (-not (Test-Path $keystore)) {
  # keytool reports progress on stderr, which 'Stop' would treat as a failure.
  $ErrorActionPreference = 'Continue'
  & "$jdk\keytool.exe" -genkeypair -keystore $keystore -storepass $pass -keypass $pass -alias app -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Offline Player' 2>&1 | Out-Null
  $ErrorActionPreference = 'Stop'
}
& "$bt\apksigner.bat" sign --ks $keystore --ks-pass "pass:$pass" --min-sdk-version 19 --v1-signing-enabled true --v2-signing-enabled true --out "$root\OfflinePlayer.apk" "$out\aligned.apk"
if ($LASTEXITCODE) { throw 'apksigner' }
& "$bt\aapt2.exe" dump badging "$root\OfflinePlayer.apk" | Select-Object -First 3
Copy-Item "$root\OfflinePlayer.apk" "$PSScriptRoot\OfflinePlayer.apk" -Force
(Get-Item "$PSScriptRoot\OfflinePlayer.apk").Length
