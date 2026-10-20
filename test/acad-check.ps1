# Opens DXF files in AutoCAD Core Console (if installed) and reports load errors and entity counts.
# Usage: powershell -File test/acad-check.ps1 test/out/synthetic.dxf [more.dxf ...]
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Files)

$acc = 'C:\Program Files\Autodesk\AutoCAD 2025\accoreconsole.exe'
if (-not (Test-Path $acc)) { Write-Output 'AutoCAD Core Console not found; skipping.'; exit 0 }
$work = Join-Path $env:TEMP 'craftcad-acad-check'
New-Item -ItemType Directory -Force $work | Out-Null
$result = (Join-Path $work 'result.txt') -replace '\\', '/'
$scr = Join-Path $work 'check.scr'
@(
  "(setq f (open `"$result`" `"w`"))",
  '(setq ss (ssget "_X"))',
  '(write-line (strcat "COUNT=" (itoa (if ss (sslength ss) 0))) f)',
  '(setq tl nil i 0)',
  '(if ss (repeat (sslength ss) (setq tp (cdr (assoc 0 (entget (ssname ss i))))) (setq tl (if (assoc tp tl) (subst (cons tp (1+ (cdr (assoc tp tl)))) (assoc tp tl) tl) (cons (cons tp 1) tl))) (setq i (1+ i))))',
  '(write-line (vl-prin1-to-string tl) f)',
  '(vl-load-com)',
  '(setq i 0)',
  '(if ss (repeat (sslength ss) (setq ed (entget (ssname ss i))) (if (= (cdr (assoc 0 ed)) "VIEWPORT") (write-line (vl-prin1-to-string (mapcar (function (lambda (c) (cdr (assoc c ed)))) (list 410 69 10 40 41 12 45 90))) f)) (setq i (1+ i))))',
  '(write-line (strcat "LAYOUTS=" (vl-prin1-to-string (mapcar (function cdr) (vl-remove-if-not (function (lambda (x) (= (car x) 3))) (dictsearch (namedobjdict) "ACAD_LAYOUT"))))) f)',
  '(close f)',
  '_.QUIT _Y'
) | Set-Content -Encoding ascii $scr

$failed = 0
foreach ($file in $Files) {
  $src = (Resolve-Path $file).Path
  $copy = Join-Path $work ([IO.Path]::GetFileName($src))
  Copy-Item $src $copy -Force
  Remove-Item (Join-Path $work 'result.txt') -ErrorAction SilentlyContinue
  $log = & $acc /i $copy /s $scr /l en-US 2>&1 | Out-String
  $log = $log -replace "`0", ''
  Write-Output "=== $file"
  $errs = $log -split "`r?`n" | Where-Object { $_ -match 'Error|Invalid|Did not receive|discarded|Undefined' }
  if ($errs) { $errs | ForEach-Object { Write-Output "  $_" } }
  $res = Join-Path $work 'result.txt'
  if (Test-Path $res) { Get-Content $res | ForEach-Object { Write-Output "  $_" } } else { Write-Output '  FAILED: drawing did not open'; $failed++ }
}
exit $failed
