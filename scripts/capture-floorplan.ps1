$wsUrl = "ws://localhost:9222/devtools/page/C4352A55E1C6B189551C1E46DF503310"
$outputPath = "C:\temp\floorplan-capture.txt"

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ct = [System.Threading.CancellationToken]::None
$connectTask = $ws.ConnectAsync([uri]$wsUrl, $ct)
$connectTask.Wait()

if ($ws.State -ne [System.Net.WebSockets.WebSocketState]::Open) {
    Write-Error "WebSocket not connected"
    exit 1
}

$msg = @{
    id = 1
    method = "Runtime.evaluate"
    params = @{
        expression = "(async () => { const dataUrl = await window.__APP__.captureFloorPlan(); return dataUrl; })()"
        awaitPromise = $true
        returnByValue = $true
    }
} | ConvertTo-Json -Depth 5

$bytes = [System.Text.Encoding]::UTF8.GetBytes($msg)
$sendTask = $ws.SendAsync([ArraySegment[byte]]$bytes, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct)
$sendTask.Wait()

$buffer = New-Object byte[] 65536
$result = ""
do {
    $recvTask = $ws.ReceiveAsync([ArraySegment[byte]]$buffer, $ct)
    $recvTask.Wait()
    $result += [System.Text.Encoding]::UTF8.GetString($buffer, 0, $recvTask.Result.Count)
} while (-not $recvTask.Result.EndOfMessage)

$closeTask = $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "", $ct)
$closeTask.Wait()

$result | Out-File -FilePath $outputPath -Encoding UTF8
Write-Host "Done. Result saved to $outputPath"
