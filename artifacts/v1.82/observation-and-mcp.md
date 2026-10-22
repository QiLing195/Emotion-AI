# v1.82 只读观察（她在看你做什么）+ 标准 MCP 客户端

> 用户裁定：**先只读**（看窗口/活动应用/读文件）、活动记录**只存窗口标题**（每 20 秒）、MCP 要**标准客户端**（配 `mcp-servers.json`）。

## 一、她能看见你在做什么（`read_my_activity`）

```
采样：长驻 PowerShell 进程（scripts/activity-sampler.ps1）每 20 秒往 memories/activity_log.jsonl 追加
      {"ts":…, "title":"前台窗口标题", "process":"进程名"}
      —— 只记标题与进程；**不记键盘输入、不截屏、不读剪贴板**
隐私：标题命中敏感词（password/密码/银行/支付/登录/token…）⇒ 采样器替换为 [已隐藏]；Node 侧读取时**再过滤一次**
读取：她的工具 read_my_activity(limit 1~20) → 最近条目（连续同窗口去重）+ "x 分钟前"；没开/没记录就如实说
开关：ENABLE_ACTIVITY_WATCH=true（默认关，本机 .env 已开）
```

**实测（真管道）**：
```
[他] 你知道我现在在电脑上干什么吗？
她：在看一个很长的课程视频——AI Agents，标题里还写着"2026年最值得学的技能"。
    看来你今天是打算认真啃点东西了。
工具：read_my_activity ok=true 2ms（entries[0].title=(5) AI Agents: … - YouTube - Google Chrome）
```

顺带修了一个坑：**Windows PowerShell 5.1 读无 BOM 的 .ps1 会把中文读乱**（字符串终止符都断了，脚本直接 exit 1）。
⇒ 采样脚本必须以 **UTF-8 BOM** 保存（已改；文件里已注明）。

## 二、标准 MCP 客户端（`mcp__<server>__<tool>`）

```
配置：mcp-servers.json（复制 mcp-servers.example.json 改；不随仓库分发）
结构：{ "servers": { "fs": { "command":"npx", "args":[…], "enabled":true, "allowTools":["read_file","list_directory"] } } }
协议：官方 SDK（@modelcontextprotocol/sdk 1.30）Client + StdioClientTransport；tools/list → 挂进她的工具表；tools/call 执行
安全：①每个 server 必须 enabled:true ②allowTools 是白名单；不写时**只放行名字像只读**的工具
      （read/list/search/get/find/view/stat/query/head/cat/show/describe/fetch/lookup/inspect）
      ③每次调用写审计账本 memories/mcp_calls.jsonl（server/tool/耗时/成败/入参摘要 200 字）④15s 超时
开关：ENABLE_MCP_CLIENT=true（默认关，本机 .env 已开）
```

**实测（真管道，用 mock MCP server 验证协议链路）**：
```
[他] 用你的 echo 工具回显"测试成功"这句话。
她：回显出来了——"echo:测试成功"。顺手用了一下那个工具，挺干脆的。
工具：[AgentTool] r1 mcp__mock__echo ok=true 8ms → {"content":[{"type":"text","text":"echo:测试成功"}]}
审计：{"ts":…,"server":"mock","tool":"echo","ok":true,"ms":5,"argsPreview":"{\"text\":\"测试成功\"}"}
```

## 三、边界（这一版刻意没做）

```
· 不开放写文件 / 执行命令 / 模拟鼠标键盘（用户选择"先只读"；以后按风险分批加，每批单独开关）
· MCP 只跑你配置里写死的命令；不自动发现、不自动联网、不装包
· 活动采样只看**前台**窗口；不枚举后台窗口，避免记到不该记的东西
· 文件读取能力由 MCP server 提供（例如官方 filesystem server），她的工具表里只有你 allowTools 放行的那些
```

## 四、验证

```
单测：mcpClient 9/9（含真实起一个 mock MCP server：list/call/白名单拦截/未启用拒绝）
      activityWatcher 8/8（开关/脱敏/坏行/去重/limit 夹取）
      agentLoop 36/36（工具表 10 个 + read_my_activity 路由 + MCP 声明合并/路由/未接 disabled）
全量 1830/1830 ｜ tsc 双配置 0 ｜ vite build ✓
现场：采样日志 4 行、她成功调用 read_my_activity 与 mcp__mock__echo；memories/ 已还原、mcp-servers.json 已移除
```
