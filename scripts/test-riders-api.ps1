$body = '{"login":"김형진","password":"123456"}'
$signIn = Invoke-RestMethod -Uri 'https://brem.kr/api/admin/sign-in' -Method POST -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
$token = $signIn.session.access_token
Write-Output "token len=$($token.Length)"
$riderId = "test-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
$riderBody = "{`"rider`":{`"id`":`"$riderId`",`"name`":`"TestRider`",`"phone`":`"01055554444`",`"password`":`"1234`",`"joinDate`":`"2026-06-19`",`"status`":`"active`",`"platformCoupang`":true,`"platformBaemin`":false,`"hiddenFields`":{},`"createdAt`":`"2026-06-19T00:00:00.000Z`",`"updatedAt`":`"2026-06-19T00:00:00.000Z`"}}"
try {
  $post = Invoke-WebRequest -Uri 'https://brem.kr/api/admin/riders' -Method POST -Headers @{
    Authorization = "Bearer $token"
    'Content-Type' = 'application/json'
  } -Body $riderBody
  Write-Output "POST $($post.StatusCode)"
  Write-Output $post.Content
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Write-Output "POST ERR $status"
  $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
  Write-Output $reader.ReadToEnd()
}
$list = Invoke-RestMethod -Uri 'https://brem.kr/api/admin/riders' -Headers @{ Authorization = "Bearer $token" }
Write-Output "LIST count=$($list.riders.Count)"
$found = $list.riders | Where-Object { $_.id -eq $riderId }
Write-Output "FOUND=$([bool]$found)"
