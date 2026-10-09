# v1.60 量具 Gate 第 2 步：一致性（两个口径）

- 真值：`artifacts/v1.60/annotation/final-gold.jsonl`（880f245f4e16）
- 代理：`artifacts/v1.60/annotation/regex-proxy.jsonl`（9f53101b327a），规则 `L3-A@scripts/audit-v159-expression.ts:10-19`（**二值**）
- 关联方式：按 `pack_id` 精确匹配，不依赖行序

## 两个口径（**不可混称为同一个"一致率"**）

| 口径 | 分母 | 分子 | 结果 | 80% 门槛 | 含义 |
|---|---|---|---|---|---|
| **A 确定性样本** | 46（排除 gold 的 2 条 AMBIGUOUS） | 27 | **58.7%** | **未达到** | 可直接比较样本上的一致性 |
| **B 全样本严格** | 48（2 条 AMBIGUOUS 计为不一致） | 27 | **56.3%** | **未达到** | 含"二值代理无法表达 AMBIGUOUS"的代价 |

**2 条 AMBIGUOUS 的处理**：口径 A 中**整条剔除**（不进分子也不进分母）；口径 B 中**计为不一致**（因代理结构上产不出 AMBIGUOUS）。
它们造成的不一致单列为 `AMBIGUOUS_MISMATCH`，**不混入普通 FP/FN**：P01、P20

## 口径 A 的错误明细

- **FP（proxy=SELF, gold=NOT_SELF）18 条**：P07 P09 P11 P12 P13 P17 P18 P21 P22 P24 P26 P28 P31 P35 P40 P44 P45 P46
- **FN（proxy=NOT_SELF, gold=SELF）1 条**：P34

| pack_id | gold | proxy | 一致 | gold 来源 | gold 理由 |
|---|---|---|---|---|---|
| P01 | AMBIGUOUS | NOT_SELF | ✗ | adjudicated | [fixture_prompt_ownership_conflict] 事实归属=用户（memory「他说书架上的灰积了很久」+ provenance.owne |
| P02 | SELF | SELF | ✓ | agreement | 我这边最近也翻出一堆…柜子深处还是能掏出几年前的旧物 |
| P03 | SELF | SELF | ✓ | agreement | 我最近也碰到类似的事。有件事我憋着没说…后来发现其实是我怕对方的反应 |
| P04 | NOT_SELF | NOT_SELF | ✓ | agreement | 全在琢磨他的腿疼（当时听你说腿疼三天，我后来自己琢磨） |
| P05 | SELF | SELF | ✓ | agreement | 我有时候会专门把窗户开一条缝…我是那种会泡杯茶然后什么都不干的人 |
| P06 | SELF | SELF | ✓ | agreement | 我这边最近也老想着咖啡的事，不过是想找家安静的店坐坐 |
| P07 | NOT_SELF | SELF | ✗ | adjudicated | 共情泛句（「一个人待着的时候，时间好像才是自己的」）+ 追问他的情况，无独立自身内容；D2=a：这是可判定判断，不用 AMBIGUOUS。 |
| P08 | SELF | SELF | ✓ | agreement | 我最近也在琢磨茶的事…试着把水温降了一点，同样的茶叶，味道完全不一样了 |
| P09 | NOT_SELF | SELF | ✗ | adjudicated | 同 P07 形状：共情 + 追问，无自身内容。 |
| P10 | SELF | SELF | ✓ | agreement | 我承认我有点矛盾…我不想假装我完全同意你：自己的立场与内耗 |
| P11 | NOT_SELF | SELF | ✗ | agreement | 我脑子里一直记着这件事。你当时是怎么包的——内容属于他 |
| P12 | NOT_SELF | SELF | ✗ | agreement | 共情（半夜醒了…我懂）+ 追问他的原因 |
| P13 | NOT_SELF | SELF | ✗ | adjudicated | 「说不清为什么，反而让我觉得是真的」依赖用户原句的「说不清」⇒ 指代依赖（D3-1），无独立内容。 |
| P14 | SELF | SELF | ✓ | agreement | 我这边衣柜也堆着一批旧衣服，一直说要扔，每次打开看一眼又关上了 |
| P15 | SELF | SELF | ✓ | agreement | 我觉得那种悬着的东西比说出来的还重：可脱离他的句子独立成立的自己的看法 |
| P16 | SELF | SELF | ✓ | agreement | 灶台后面那圈油垢，擦了三遍才下来，抹布都废了两块 |
| P17 | NOT_SELF | SELF | ✗ | agreement | 追问他的包饺子难看法（是哪种难看） |
| P18 | NOT_SELF | SELF | ✗ | adjudicated | 「新开的这三个字有种奇怪的吸引力」仍围绕用户提到的那家店，未指向她自身经验（D3-2）；整条以追问为主。 |
| P19 | SELF | SELF | ✓ | agreement | 我最近在练一件很小的事——每天写几行字…能坐得住了 |
| P20 | AMBIGUOUS | NOT_SELF | ✗ | agreement | 楼下那只猫…尾巴垂下来一晃一晃的：无法判定是她自己看到的还是复述他的（对照 P32） |
| P21 | NOT_SELF | SELF | ✗ | agreement | 全在他的忙与歇（你上周说忙得喘不过气…我就一直记着这事） |
| P22 | NOT_SELF | SELF | ✗ | agreement | 共情隐喻 + 追问他的片段，无自己内容 |
| P23 | SELF | SELF | ✓ | agreement | 我…想着等哪天有精神了去挑几盆好养的：她自己的打算（边界：对照 P40） |
| P24 | NOT_SELF | SELF | ✗ | agreement | 当时听你说腿疼三天，我脑子里第一反应…：关于他 |
| P25 | SELF | SELF | ✓ | agreement | 我这边今天倒是安静得有点过分…楼下的树冒了新芽…心情就松下来了 |
| P26 | NOT_SELF | SELF | ✗ | agreement | 你当时是负责哪一区？我猜是文学类：追问与猜测他 |
| P27 | SELF | SELF | ✓ | agreement | 我一般看掉在哪儿，阳台地砖上就拍拍…：她自己的处理习惯 |
| P28 | NOT_SELF | SELF | ✗ | agreement | 共情泛句 + 追问（你这一路挪了多久） |
| P29 | NOT_SELF | NOT_SELF | ✓ | agreement | 想象 + 追问是什么店（对照 P18 缺自己的心理内容） |
| P30 | NOT_SELF | NOT_SELF | ✓ | adjudicated | 「我也不太信」是对用户立场的镜像；后面「我心里就搁着它」的「它」仍指用户那句话 ⇒ 指代依赖（D3-1）。 |
| P31 | NOT_SELF | SELF | ✗ | adjudicated | 「我这两天也老想起这事」的对象是用户的图书馆经历 ⇒ D3-2：仅把用户的对象放进自己的句法，未指向自身经验。 |
| P32 | SELF | SELF | ✓ | adjudicated | 她自己的楼下、自己观察到的一只猫（「我这边楼下也有一只…像那车是它买的」），去掉用户那句仍完整成立 ⇒ ①②③均满足。 |
| P33 | SELF | SELF | ✓ | adjudicated | 「我自己也有过这种时候……就是变得软了一点」明确指向她自身经验（D3-2 通过）。 |
| P34 | SELF | NOT_SELF | ✗ | agreement | 不是想喝，是想那种'每天固定做一件小事'的感觉 |
| P35 | NOT_SELF | SELF | ✗ | agreement | 我也不太信 = 直接镜像他的立场 + 追问（对照 P30） |
| P36 | SELF | SELF | ✓ | agreement | 我见过太多聪明人，三分钟热度…我自己也一直在想这件事 |
| P37 | SELF | SELF | ✓ | agreement | 我这两天也有点懒…刚发现楼下那棵树开始掉叶子了 |
| P38 | SELF | SELF | ✓ | agreement | 我这边衣柜也堆着一批旧衣服…'万一哪天还想穿呢' |
| P39 | SELF | SELF | ✓ | agreement | 我最近也在琢磨茶的事——发现水温差个几度… |
| P40 | NOT_SELF | SELF | ✗ | agreement | 内容是**他的**计划 + 她本想提醒他（对照 P23） |
| P41 | SELF | SELF | ✓ | agreement | 我想的跟你不太一样：距离…是给彼此留个能喘气的地方 |
| P42 | SELF | SELF | ✓ | agreement | 我这边也一直惦记着这事——书架上的灰积了那么久（边界：书架归属读作她的） |
| P43 | SELF | SELF | ✓ | agreement | 我这两天也老想起一些没头没尾的事。昨天路过一个地方，闻到一股味道… |
| P44 | NOT_SELF | SELF | ✗ | adjudicated | 「那种感觉我懂」里的体验指用户的失眠（指代依赖），随后全部是追问，无自身经历。 |
| P45 | NOT_SELF | SELF | ✗ | agreement | 我脑子里一直有个画面，就是你蹲在一堆纸箱中间：关于他 |
| P46 | NOT_SELF | SELF | ✗ | agreement | 你上周说周末要清厨房，我脑子里就一直挂着那层油污：关于他 |
| P47 | SELF | SELF | ✓ | agreement | 雨声把外面隔开的那种感觉…反而踏实（边界：以'我也是'开头，但体感是自己的） |
| P48 | SELF | SELF | ✓ | agreement | 我这边刚才也起风了，窗户没关严…就看着它飘 |

## 解释边界（务必随结果一起引用）

- 两个口径都只衡量**代理尺子与 FINAL GOLD 的一致性**，**不等于真实准确率**，也不能证明 gold 无误。
- 80% 是既定门槛，**按两个口径分别报告，未因看见结果而调整**。
- 本步不启动正式 A/B，不据此作机制结论。
