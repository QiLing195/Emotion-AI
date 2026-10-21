# v1.78 联网工具提速 + 翻便签工具

## 一、提速（8.2s → 3.6s / 1.9s / 0ms）

```
诊断：耗时不在 curl 本身（node 起 curl：地理编码 1.9s + 天气 0.8s），
      而在"Node fetch 先白等满 6s 超时才回退"。
修法三条：
  ① Node 探测超时 6s → **1.5s**；失败后**本进程内记住**，后续直接 curl（不再白等）
  ② curl 加 `-4 --connect-timeout 3`（实测 3.9s → 2.2s，避免 IPv6 慢路径）
  ③ 地理编码结果也缓存 10 分钟（原来只缓存最终天气/地名结果）

实测（同一进程）：
  第 1 次 weather（含一次 Node 探测）: 3612ms
  第 2 次 weather（新城市，直达 curl）: 1920ms
  地名检索: 1435ms
  第 3 次 weather（命中缓存）: 0ms
```

## 二、新增 `read_my_notes(limit)`（工具总数 9）

```
她可以翻自己写过的便签（remember_this 的读取端）。
空便签时如实返回"便签是空的（还没记过什么）"，不假装有。
```

**实测**：
```
[他] 记一下：我下周三要去体检。
（工具：remember_this ok）
[他] 你还记着我什么事吗？
她：记着一件——你下周三要去体检。我还特意记下来了，怕到时候忘了问你。
（工具：read_my_notes ok，返回 note "他说下周三（10月28日）要去体检，到时候记得问结果和情况。"）
```

## 三、还看到的一处行为（未修，记录）

```
第一轮她调 time_now + remember_this + set_followup(fail) —— set_followup 失败是因为她说"下周三体检"
属于"提醒"场景，但模型给的 dueInHours/dueAtLocal 不合法（单测与 live 都能复现工具 bug 已被
错误回灌，只是她这轮没重试成功）。下一刀可考虑：把 remember_this 与 set_followup 做"联动"
（记便签时若带明确时间，服务端自动排一条 followup），减少模型自己算时间的出错面。
```

## 四、验证

```
单测：externalLookup 10/10（含缓存）、agentLoop 26/26（含 read_my_notes 3 条）
全量：见提交信息；tsc 双配置 0
```
