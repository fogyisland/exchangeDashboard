# Exchange Server Health Dashboard Troubleshooting

## Quick Triage

```powershell
# 1. Are services running?
Get-Service ExchangeHealthAgent, ExDashboardCenter

# 2. Is center reachable?
Invoke-WebRequest http://center:8080/healthz

# 3. Are agents heartbeating?
# Sign in → Agent 列表 (or GET /api/dashboard/agents)

# 4. What do logs say?
Get-Content "C:\exdashboard\Logs\ExDashboardCenter-stderr.log" -Tail 200
Get-Content "C:\exdashboard\Logs\ExchangeHealthAgent-stderr.log" -Tail 200
```

## Common Symptoms

### Symptom: Agent反复重启 (status: StartPending → Stopped)

**Likely causes:** PowerShell script error, missing Exchange Management Shell cmdlets, config file typo

**Steps:**
1. `Get-EventLog Application -Source NSSM -Newest 20`
2. `Get-Content "C:\exdashboard\Logs\ExchangeHealthAgent-stderr.log" -Tail 100`
3. Look for: `Exchange Management Shell cmdlets are unavailable` → install RSAT
4. Look for: `appsettings.json: ENOENT` → path contains spaces or wrong location
5. Manually run: `& "C:\exdashboard\Agent\agent.js"` to see Node.js stack trace

### Symptom: Agent心跳正常但无数据

**Steps:**
1. Verify `Test-NetConnection center -Port 8080` from the Exchange Server
2. Compare `appsettings.json` `agentToken` to `system_config.exchange_agent_token` (sign in as admin → 管理 → 系统配置)
3. On the Exchange Server, manually invoke PS: `powershell -File "C:\exdashboard\Agent\scripts\collect-exchange.ps1"` — should output JSON
4. If PS errors out with "Exchange Management Shell is unavailable": `Install-WindowsFeature -Name RSAT-Clustering-PowerShell`

### Symptom: Center启动失败 (status: Stopped immediately)

**Steps:**
1. `nssm get ExDashboardCenter` — show full config
2. `Get-Content "C:\exdashboard\Logs\ExDashboardCenter-stderr.log" -Tail 100`
3. Most common:
   - `ECONNREFUSED 127.0.0.1:1433` → SQL Server not running or wrong port
   - `Login failed for user 'sa'` → wrong SQL password in `appsettings.json`
   - `EADDRINUSE :::8080` → port 8080 occupied (`netstat -ano | findstr :8080`)
4. After fix, `Start-Service ExDashboardCenter`

### Symptom: 前端 502 Bad Gateway

**Likely cause:** Center process exited; check `center-stderr.log` for unhandled exception
**Steps:**
1. `Get-Service ExDashboardCenter` (likely Stopped)
2. `Get-Content "C:\exdashboard\Logs\ExDashboardCenter-stderr.log" -Tail 200`
3. Common: OOM (check `Get-Process | Sort-Object WorkingSet -Descending | Select -First 5`); reduce log level
4. Restart: `Start-Service ExDashboardCenter`

### Symptom: 数据长时间不更新

**Steps:**
1. `GET /api/dashboard/agents` — check `seconds_since_heartbeat`
2. If all agents stale:
   - Center may be unreachable from Exchange Servers
   - Check firewall: `Test-NetConnection -ComputerName center -Port 8080` from any Exchange Server
3. If individual agents stale:
   - That specific Exchange Server: `Get-Service ExchangeHealthAgent`
   - Check its stderr log

### Symptom: 错误码 1722 (RPC server unavailable)

**Operator guidance:** shown directly in `frontend/src/components/ErrorTable.vue` CODES map.
**Steps to investigate:**
1. From destination Exchange server: `Test-NetConnection -ComputerName <source-exchange-server> -Port 135`
2. Check Windows Firewall on source Exchange server allows inbound from destination subnet
3. Check `Test-ServiceHealth` on source Exchange server

### Symptom: 端口徽章全红

**Likely causes:** 该端口业务确实停 / Windows 防火墙拦截 / 端口被其他进程占用

**Steps:**
1. 从该 Exchange Server 直接验证：`Test-NetConnection -ComputerName localhost -Port <port>`（应该是 True/False）
2. 若 True 但 agent 报红：检查 `C:\exdashboard\Logs\ExchangeHealthAgent-stderr.log` 看 `tcpProbe` 异常
3. 若 False：业务停或服务没启，跟端口业务核对
4. 跨 Exchange Server 对比：若只有某台 Exchange Server 报红，检查该 Exchange Server 的 Windows Firewall inbound 规则

### Symptom: 端口徽章全灰 (—)

**Likely cause:** Agent 还没上报端口数据，或 system_ports 清单为空

**Steps:**
1. 登录 admin → `/admin/ports`——若清单为空，先加要监控的端口
2. 等 5s（agent 下一个心跳周期），Agents 视图应出现徽章
3. 若清单非空但仍全灰：
   - `GET /api/dashboard/agents` 的 `portStatuses` 应非空——查 agent 是否在跑：`Get-Service ExchangeHealthAgent`
   - agent 日志看端口拉取/探测相关报错（401/网络/DNS）

### Symptom: Agent 启动后没有任何端口数据

**Likely cause:** agent 拉取端口清单失败（agent 不会因此退出，会静默降级为空清单）

**Steps:**
1. `Get-Content "C:\exdashboard\Logs\ExchangeHealthAgent-stdout.log" -Tail 200` — 找端口拉取/探测相关错误
2. 验证 center 端：用 admin JWT 调 `Invoke-WebRequest http://center:8080/api/admin/ports -Headers @{Authorization="Bearer <jwt>"}` 确认清单非空（注：port 拉取在 agent 侧走 agentToken；清单维护走 admin `/api/admin/ports`）
3. 401 → token 不匹配；500 → center 端 DB 故障

### Symptom: 错误码 1311 (DNS)

**Steps:**
1. From destination Exchange server: `Resolve-DnsName <source-exchange-server>`
2. If fails, check DNS server config and `Test-ServiceHealth` on both Exchange Servers

### Symptom: "The memory usage exceeded" warnings

**Likely cause:** Better-sqlite3 native module in agent not closing transactions
**Steps:**
1. Restart agent: `Restart-Service ExchangeHealthAgent`
2. Apply update if newer version available: `.\scripts\update-agent.ps1`

## Diagnostic Data Collection

When escalating, capture:
```powershell
# Service config
nssm get ExDashboardCenter > nssm-center.txt
nssm get ExchangeHealthAgent > nssm-agent.txt

# Recent logs
Copy-Item "C:\exdashboard\Logs\*-stdout.log" .
Copy-Item "C:\exdashboard\Logs\*-stderr.log" .

# Health snapshot
Invoke-WebRequest http://center:8080/healthz | % Content
(Invoke-WebRequest http://center:8080/api/dashboard/overview -Headers @{Authorization="Bearer $t"} -UseBasicParsing).Content
```
