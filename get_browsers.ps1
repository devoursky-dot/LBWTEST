Get-Process chrome, msedge, whale, brave, firefox -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, MainWindowTitle | Format-Table -AutoSize
