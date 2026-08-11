# web-console 生产启动（开机启动文件夹调用 / 手动）。
# 以当前登录用户身份运行，home/PATH 天然正确，无需 SYSTEM 账户的环境绕路。
$ErrorActionPreference = "Continue"
$env:ALLOWED_DIRS = "D:\code\workspace\pi-harness-101"
$env:PORT = "3000"
# WC_MODEL 默认 zai-coding-cn/glm-5.2（server/index.ts 内默认）
Set-Location "D:\code\workspace\pi-harness-101\web-console"
& "D:\code\env\node-v24.13.1-win-x64\node.exe" "node_modules\tsx\dist\cli.mjs" "server/index.ts"
