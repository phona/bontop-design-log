# Capture floor plan screenshot from Edge and save as PNG
$ErrorActionPreference = "Stop"

# Get the page list
$pageList = Invoke-RestMethod -Uri "http://127.0.0.1:9222/json" -Method Get

# Find the page with our app
$targetPage = $pageList | Where-Object { $_.url -eq "http://localhost:5173/" -and $_.type -eq "page" } | Select-Object -First 1

if (-not $targetPage) {
    Write-Error "Could not find target page"
    exit 1
}

$wsUrl = $targetPage.webSocketDebuggerUrl
Write-Host "Connecting to: $wsUrl"

# Create WebSocket connection
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ct = [System.Threading.CancellationToken]::None

# Connect
$connectTask = $ws.ConnectAsync([uri]$wsUrl, $ct)
$connectTask.Wait()

if ($ws.State -ne [System.Net.WebSockets.WebSocketState]::Open) {
    Write-Error "WebSocket not connected"
    exit 1
}

Write-Host "Connected to WebSocket"

# Enable Page domain
$msg = @{
    id = 1
    method = "Page.enable"
    params = @{}
} | ConvertTo-Json -Depth 5

$bytes = [System.Text.Encoding]::UTF8.GetBytes($msg)
$sendTask = $ws.SendAsync([ArraySegment[byte]]$bytes, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct)
$sendTask.Wait()

# Wait for response
$buffer = New-Object byte[] 65536
$recvTask = $ws.ReceiveAsync([ArraySegment[byte]]$buffer, $ct)
$recvTask.Wait()
$response = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $recvTask.Result.Count)

# Wait for app to be ready
$maxWait = 30
$startTime = Get-Date
$ready = $false

while (-not $ready -and ((Get-Date) - $startTime).TotalSeconds -lt $maxWait) {
    $checkMsg = @{
        id = 2
        method = "Runtime.evaluate"
        params = @{
            expression = 'window.__APP__ && typeof window.__APP__.captureFloorPlan === "function"'
            returnByValue = $true
        }
    } | ConvertTo-Json -Depth 5
    
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($checkMsg)
    $sendTask = $ws.SendAsync([ArraySegment[byte]]$bytes, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct)
    $sendTask.Wait()
    
    $buffer = New-Object byte[] 65536
    $recvTask = $ws.ReceiveAsync([ArraySegment[byte]]$buffer, $ct)
    $recvTask.Wait()
    $response = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $recvTask.Result.Count)
    
    if ($response -match '"value":true') {
        $ready = $true
        Write-Host "App is ready"
    } else {
        Start-Sleep -Milliseconds 500
    }
}

if (-not $ready) {
    Write-Error "App did not become ready in time"
    $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "", $ct).Wait()
    exit 1
}

# Capture floor plan
$captureMsg = @{
    id = 3
    method = "Runtime.evaluate"
    params = @{
        expression = "window.__APP__.captureFloorPlan().then(dataUrl => ({dataUrl}))"
        awaitPromise = $true
        returnByValue = $true
    }
} | ConvertTo-Json -Depth 5

$bytes = [System.Text.Encoding]::UTF8.GetBytes($captureMsg)
$sendTask = $ws.SendAsync([ArraySegment[byte]]$bytes, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct)
$sendTask.Wait()

# Receive response (may be large)
$buffer = New-Object byte[] 65536
$result = ""
do {
    $recvTask = $ws.ReceiveAsync([ArraySegment[byte]]$buffer, $ct)
    $recvTask.Wait()
    $result += [System.Text.Encoding]::UTF8.GetString($buffer, 0, $recvTask.Result.Count)
} while (-not $recvTask.Result.EndOfMessage)

# Close WebSocket
$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "", $ct).Wait()

# Parse result and extract data URL
$json = $result | ConvertFrom-Json
$dataUrl = $json.result.result.value.dataUrl

if (-not $dataUrl) {
    Write-Error "Failed to capture floor plan"
    exit 1
}

# Extract base64 data
if ($dataUrl -match '^data:image/png;base64,(.+)$') {
    $base64Data = $matches[1]
    $pngBytes = [Convert]::FromBase64String($base64Data)
    
    # Save to PNG file
    $outputPath = "C:\temp\floorplan-701-v9.png"
    [System.IO.File]::WriteAllBytes($outputPath, $pngBytes)
    
    Write-Host "PNG saved to $outputPath"
    Write-Host "File size: $($pngBytes.Length) bytes"
} else {
    Write-Error "Invalid data URL format"
    exit 1
}
