# 注册 pi-web-console 计划任务：SYSTEM 开机自启 + 崩溃 1 分钟自动重启。
# 需管理员权限运行。幂等（先删旧任务再建）。参考 ops/frp/register_frpc_task.ps1。
$ErrorActionPreference = "Stop"
$taskName = "pi-web-console"
$script = "D:\code\workspace\pi-harness-101\web-console\scripts\start-web-console.ps1"

try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Output "已注册任务: $taskName（SYSTEM 开机自启，崩溃 1 分钟重启）"
Start-ScheduledTask -TaskName $taskName
Write-Output "已启动"
