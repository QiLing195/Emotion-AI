# v1.77 联网工具：天气 + 地图/地名（免 key）

## 一、做了什么

```
工具总数 8：读 6（check_my_state / recall_memory / time_now / recall_recent_events / get_weather / search_map）
           + 写 2（remember_this / set_followup）

get_weather(city)   → Open-Meteo：地理编码 + 当前天气（温度/体感/湿度/风/天气描述）
search_map(place)   → Open-Meteo 地名库（OSM 派生）：名称/省份/国家/经纬度
开关：ENABLE_AGENT_EXTERNAL_TOOLS（默认关，本机 .env 已开）
护栏：6s 超时、内存缓存 10 分钟（同一问题不反复打外部服务）、结果裁剪、
      失败即 { ok:false } 由她如实说"查不到"，**绝不编天气/地址**
```

## 二、发现并绕过的环境问题（重要）

```
现象：node 的 fetch 连不上外网（UND_ERR_CONNECT_TIMEOUT / fetch failed），
      但系统 curl 能通（HTTP 200, 2.1s）。IPv4 优先也不行。
处理：externalLookup 的 JSON 抓取器 = **先 Node fetch，失败回退 curl**（输出写临时文件，
      不走管道——受限环境里管道会 EPERM；临时文件解析后删除）。
      这样在"Node 能上网"的用户机器上走 Node，在"只有 curl 通"的环境里也能用。
另：Nominatim（OpenStreetMap 官方地理编码）在本机网络**完全不可达**（HTTP 000, 21s），
    因此地图检索改用 **Open-Meteo 地理编码**（与天气同源、可达）。它的定位是**地名库检索**，
    不是完整 POI 地图——工具描述和返回的 note 都写明了这一点。
```

## 三、实测（真管道）

```
[他] 北京今天天气怎么样？
她：北京现在晴，8.8 度，体感大概 5 度——夜里风一吹，比数字冷得多。这个点还在外面吗？
    工具：get_weather ok=true 8206ms {"city":"北京","temperatureC":8.8,"feelsLikeC":5.2,"humidity":55,"description":"晴"}

[他] 西湖在哪个省？
她：我查了一下，地名库里叫"西湖"的地方有好几个——重庆有一个、甘肃兰州和酒泉也各有一个。
    不过你问的大概是杭州那个西湖吧？那个在浙江省杭州市，是大家最熟的那个。你是想了解哪一个？
    工具：search_map ok=true 8104ms（返回 重庆/兰州/酒泉 三个"西湖"）

[他] 我周末可能去杭州。
她：杭州啊。是去玩还是有事？…（本轮没调工具，正常闲聊）
```

## 四、诚实的成本与限制

```
· 工具耗时 ~8.1s/次（两次 curl 子进程：地理编码 + 天气/地名）；等于单轮多花 ~8s。
  下一步优化：把 6s 超时降到 4s、或把 geocode 结果也缓存（目前只缓存最终结果）。
· 地名库不是地图 POI：具体店铺/门牌查不到；"西湖"这类同名地点会有歧义（她这次如实说了）。
· 依赖外部服务可用性；不可达时她会说"查不到"（单测钉住：上游 ok=false ⇒ 工具 ok=false）。
· 隐私：只发送城市/地名字符串，不上传对话内容。
```

## 五、验证

```
单测：externalLookup 10/10（解析/查不到/缓存/失败）、agentLoop 23/23（含联网工具 4 条）
全量：见提交信息（tsc 双配置 0）
```
