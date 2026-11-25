# 创意中八 3D 网页游戏 Demo 实施计划

## Context

在空目录 `D:\game race` 中从零制作一个本地运行的 3D 台球 Demo。以正常中式八球为基础，提供经典中八和创意中八；两者均支持单人对 AI、三档难度和同一玩家轮流控制双方的练习模式。Demo 不开发双人模式、联网同步或公网部署。

已确认的决策：

- 直接复用并改造 `tailuge/billiards` 的合适代码，固定参考提交 `92a2818928e9ab8576fd300615509c88b0b0f183`，整体保留 GPLv3、版权和修改来源。
- 使用 Quaternius Regular 一男一女，搭配低模室内、木质球桌、绿色台呢。
- 按用户已核验的授权说明，采用指定 CGTrader vintage hairdryer；仍记录来源、实际文件格式和哈希，不绕过登录或访问控制。
- 当前只实现 3 个示例技能，但抽取、库存和状态机支持以后扩展到 5 抽 3 及更多技能。

## 技术路线与边界

采用 TypeScript、Three.js、Vite、Vitest 和 Playwright。物理使用移植后的台球专用固定步长模拟，不引入通用刚体引擎。应用无后端、无账号、无 CDN 和远程运行时依赖，构建后全部由本地静态服务器提供。

依赖保持单向：UI/Three.js 视图 → 对局协调器 → 规则、技能、AI → 纯 TypeScript 模拟。视图不能直接改权威球态；人类、练习和 AI 都通过同一命令队列操作；AI 不复制规则或读取假自由球隐藏标志。

主要新文件：

```text
src/app/{GameController.ts,matchMachine.ts,commands.ts,matchTypes.ts}
src/core/{random/SeededRng.ts,time/MatchClock.ts}
src/sim/{Simulation.ts,SimulationState.ts,ShotOutcome.ts}
src/rules/{chineseEightRules.ts,rack.ts,legalActions.ts}
src/skills/{skillCatalog.ts,skillDraft.ts,skillMachine.ts,handMicroAdjustment.ts,hairdryer.ts,fakeFreeBall.ts}
src/ai/{AiController.ts,ghostAim.ts,shotPlanner.ts,difficulty.ts,skillPolicy.ts}
src/controllers/{HumanController.ts,PracticeController.ts}
src/view/{SceneView.ts,TableView.ts,BallView.ts,CueView.ts,CameraController.ts,InputController.ts,CharacterView.ts,CharacterAnimator.ts,HairdryerEffect.ts}
src/view/assets/AssetLoader.ts
src/ui/{MainMenu.ts,MatchHud.ts,DraftDialog.ts,SkillBar.ts}
tests/{physics,rules,skills,ai,integration}/
e2e/
public/assets/{models,animations,textures,audio}/
assets/asset-manifest.json
scripts/{verify-assets.mjs,check-third-party.mjs}
LICENSE / NOTICE / licenses/
```

## 参考项目复用清单

从 `tailuge/billiards` 复制后改编，并在 `NOTICE` 和来源清单中记录原路径、提交号、目标路径及主要修改：

| 参考文件 | Demo 目标 | 改造重点 |
|---|---|---|
| `src/model/physics/physics.ts` | `src/sim/physics/physics.ts` | 保留滑动、滚动、旋转、击球杆法，改为纯固定步推进 |
| `collision.ts`、`collisionthrow.ts` | `src/sim/physics/` | 保留球-球碰撞与碰撞投掷，输出结构化事件 |
| `cushion.ts`、`mathavan.ts`、`stronge.ts`、`knuckle.ts` | `src/sim/physics/` | 保留库边、袋角模型，移除渲染依赖 |
| `pocket.ts`、`constants.ts` | `src/sim/physics/` | 统一米制几何、袋口捕获和物理常量 |
| `src/model/ball.ts`、`table.ts`、`outcome.ts` | `BallState.ts`、`TableState.ts`、`ShotOutcome.ts` | 拆除 `BallMesh`、`Cue`、`Session` 耦合，保留 1/512 秒步长 |
| `src/controller/rules/eightball.ts` 及测试 | `src/rules/chineseEightRules.ts` 及测试 | 复用通用八球结算，但补齐中八开球、自由球和 8 号胜负口径 |
| `src/utils/rack.ts` | `src/rules/rack.ts` | 合法中八摆球、种子随机 |
| `src/network/bot/aimcalculator.ts` | `src/ai/ghostAim.ts` | 复用幽灵球几何，不搬网络 Bot 状态机 |
| `src/network/bot/strategies/` | `src/ai/shotPlanner.ts` | 加候选评价、走位和三档误差，不复制胜负逻辑 |
| `src/view/{ballmesh,cuemesh,camera,cuehit,cueballspin}.ts` | `src/view/` 对应模块 | 保留瞄准、杆法和镜头体验，只发送应用命令 |
| `src/view/assets.ts`、`src/utils/gltf.ts` | `AssetLoader.ts` | 本地 GLB、加载失败提示和资源释放 |

`Simulation` 提供 `strike`、`step(1/512)`、`getSnapshot/restoreSnapshot`、`isMoving/allStopped`、`applyBrakingEffect`。`ShotOutcome` 记录首次接触、碰库、入袋顺序、洗袋、飞球和最终停球，供唯一规则函数结算。

## 分阶段实施

### 1. 工程、来源与灰盒物理

- 建立 Vite/TypeScript 严格模式、测试、静态构建和 GPLv3 来源记录。
- 获取固定提交参考代码，逐文件移植物理，先解除视图和网络耦合。
- 建立灰盒球桌、16 球、摆球、瞄准、力度、击球点、击球、入袋和停球。
- 用可注入种子随机数、命令序号和 `stateRevision` 防止重复点击及过期 AI 命令。
- 阶段门禁：同一命令序列在不同渲染帧率下结果一致，能完成开球到换方的灰盒流程。

### 2. 中八规则、练习模式与 AI

- 在 `chineseEightRules.ts` 中实现唯一规则源：开放球台、全色/花色分组、合法开球、首碰、碰库、洗袋、自由球、合法继续击球、本组清完后合法打进 8 号获胜、提前或犯规打进 8 号判负。
- 规则输入包含击球前快照，避免同杆最后一颗本组球与 8 号入袋被误判为合法获胜；同一 `shotId` 只能结算一次。
- 练习模式由同一人类控制器轮流控制甲乙双方，HUD 明示当前座位，不启动 AI。
- AI 使用幽灵球法枚举合法目标球和袋口，通过克隆模拟试算，并交给同一规则评价器判断结果。
- 简单/普通/困难仅改变瞄准与力度误差、候选数量和走位评价深度，不改变物理、规则或球的位置。
- 阶段门禁：经典单人和经典练习均可完整分出胜负，AI 不执行非法放置或回合外击球。

### 3. 创意模式与技能系统

主状态采用 `MENU → SETUP → OPENING_DRAFT → RACK → TURN_START → AIMING/BALL_IN_HAND → BALLS_ROLLING → RESOLVE_SHOT → TURN_END/MATCH_OVER`，技能以互斥子状态插入。动画只负责表现，不能单独决定换方、犯规或胜负。

**技能库存与抽取**

- 每个技能获得时生成独立 `instanceId`、`ownerSeat`、`source` 和 `remainingUses=1`；同名新实例不重置旧实例。
- 当前技能池只有 3 个，首轮按 `min(5,poolSize)` 不重复抽取、`min(3,candidateCount)` 选择，因此 Demo 明示“当前 3 个候选并获得 3 个”，不伪造 5 个不同技能；池扩展到至少 5 个后自动成为 5 抽 3。
- 有效对局时间达到 10 分钟后只触发一次加时抽取；在当前杆结算后的安全边界，双方各自从完整技能池随机得到 2 个候选并选 1 个，允许与首轮及双方之间重复，选中的是新的单次实例。
- `MatchClock` 是唯一权威时钟；菜单、抽取、显式暂停、页面隐藏和对局结束不计时，瞄准、滚动、技能操作和 AI 思考计时。不使用独立 `setTimeout` 决定规则。

**手部微操**

- 仅在对手回合且尚未击球、拥有者已分组、无其他技能事务时可用；只能选择自己的库边球，不能选白球、8 号、对方球或已入袋球。
- 选择最近袋口附近不进入捕获区、不与其他球重叠的合法点；没有合法点则不消耗技能。
- 对手输入和物理锁定后，角色走到库边，右手夹球并推到目标点；提交时原子更新位置、清零速度/角速度、消耗一次，再恢复原来的对手击球前状态。此次移动不算击球、不触发分组或换方。

**吹风机**

- 仅在对手正式击球后且球仍运动时可用，可选择一个仍在台面的运动球。
- 人类选球时暂停固定步模拟，确认后从同一步恢复；AI 也只能在合法固定步事件上选择。
- 对目标施加约 1.2 秒的有界减速度，方向与当前速度相反；无碰撞时不得增速或反向，碰撞仍按正常物理改变轨迹。停球、入袋、离台、超时或换局时清理效果。
- 吹风机模型持续朝向目标，风线和音效仅作表现，不参与力计算；合法目标确认后才消耗技能。

**假自由球**

- 拥有自己的击球前回合时可使用，将控制权交给对手并显示自由球界面和 10 秒倒计时。
- 对手主动拖动/放置白球、正式击球等操作只要造成球位置变化，即触发特殊犯规；镜头和单纯瞄准不算。若已经出杆，先等球停再统一结算；只移动白球则立即结算。
- 特殊犯规后技能使用者获得真自由球；不从该杆确定组别或产生胜负，避免重复结算。10 秒内没有任何球移动，则取消假自由球并让对手获得真自由球、继续正常回合。
- 到 10 秒先处理超时，迟到命令无效；技能无论结果都只消耗一次。AI 的等待或操作决策只基于公开局面和难度，不读取 `fake=true`。

为三个技能实现 AI 选择和时机策略，经典模式完全禁用技能。阶段门禁：取消选目标不消耗、成功提交不能复用、过期命令无效、加时同名实例独立，三个技能均可被人类和 AI 合法使用。

### 4. 正式模型、角色动作与室内

- 台球桌：优先 OpenGameArt `Billiards Pack`（CC0）中的 9 英尺 pool 桌、球和球杆；正式模型只替换视图，不改变已验证的物理几何。
- 角色：Quaternius Universal Base Characters 的 Regular male/female（专属页 CC0），配合 Universal Animation Library（CC0）的待机、走路和伸手动画；建立 Humanoid 骨骼映射及右手挂点。
- 手部微操采用右手双骨 IK/骨骼姿态对齐目标球，球的表现代理跟随右手，权威位置只在事务提交点更新；支持缩短或跳过表现而不改变结果。
- 室内：Quaternius Ultimate House Interior Pack 或 Kenney Furniture Kit（CC0），Poly Haven 补充本地 PBR 材质/HDRI，统一为风格化低模、木质球桌、绿色台呢。
- 吹风机：通过官方正常渠道取得用户指定的 CGTrader vintage hairdryer，检查网格、材质和比例，统一转换为本地 GLB，校准风口方向并加入轻量风线粒子。
- 所有原始和转换资产在 `assets/asset-manifest.json` 记录名称、作者、URL、获取日期、许可、用途限制、原始/转换 SHA-256 和本地路径；吹风机同时记录用户已核验授权、仅个人非商用 Demo 的说明。
- 资源加载有进度、失败提示和重开释放逻辑；运行时不请求外部 URL。

### 5. UI、音效与本地交付打磨

- 完成主菜单、模式/难度选择、当前回合、球组、剩余球、自由球、技能栏、候选对话框、倒计时、胜负和帮助说明。
- 加入瞄准线、力度/杆法控件、顶视与环绕镜头、碰撞/入袋音效；提供减少动画和画质档位。
- 限制实时阴影、共享球体几何与材质、控制粒子数量；重开多局释放事件监听器、几何体、材质和动画混合器。
- 最终只启动本地/局域网静态服务，不配置公网隧道或部署。

## 本地运行设计

提供脚本：`dev`、`dev:lan`、`build`、`preview`、`preview:lan`、`typecheck`、`test`、`test:e2e`、`assets:verify`。

最终使用 `npm run preview:lan -- --port 4173` 绑定局域网地址，在实际启动后给出 `http://<本机局域网IP>:4173`。防火墙仅对专用网络开放该端口；同一浏览器轮流操作不等于联网双人。

## 验证与验收

1. **物理单元测试**：移植参考项目有效用例，覆盖滑滚、旋转衰减、正碰/斜碰、多球接触、库边、袋角、入袋、洗袋、非有限数值保护、固定步确定性及不同渲染帧率一致性。
2. **规则单元测试**：覆盖合法/非法开球、开放球台、分组、错误首碰、无碰库、自由球合法位置、继续/换方、提前 8 号、同杆最后本组球与 8 号、合法获胜、重复结算拒绝。
3. **技能与计时测试**：覆盖池大小 0–5 的候选策略、10 分钟只触发一次、页面隐藏/恢复、同名实例独立、三个技能合法与非法时机；吹风机不增速/不无故反向；假自由球在 9.999 秒和 10.000 秒边界结果正确且只结算一次。
4. **AI/练习集成测试**：三档难度均生成合法命令，固定种子可重放，AI 试算不污染真实模拟或随机流，困难误差小于简单；练习连续多杆没有后台 AI。
5. **Playwright 端到端**：实际进入“经典/创意 × 单人/练习”四个入口，用测试时钟推进 10 分钟，使用真实按钮完成三个技能，验证胜负、重开、失焦恢复、窗口缩放、动画跳过、本地资源成功和无外部请求。
6. **视觉与性能检查**：在浏览器实际查看球桌、两角色、室内和技能动画，检查手球接触、吹风机朝向、材质/法线、镜头遮挡和 HUD；记录 1080p 默认画质实测帧率，不预先宣称性能通过。
7. **交付命令**：依次运行 `npm run assets:verify`、`npm run typecheck`、`npm test`、`npm run test:e2e`、`npm run build`，再启动局域网预览并进行浏览器冒烟验收，报告实际结果和任何未能完成的检查。

## Demo 明确不包含

双人模式及其入口、联网对战、房间/匹配、公网部署、账号/排行榜、完整 20 技能池、移动端专项、VR、报袋/跳球等高级裁判规则、复杂动作捕捉或大型室内场景。

## 主要参考来源

- [tailuge/billiards 固定提交](https://github.com/tailuge/billiards/commit/92a2818928e9ab8576fd300615509c88b0b0f183) 与 [GPLv3 许可](https://github.com/tailuge/billiards/blob/master/LICENSE)
- [Quaternius Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) 与 [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html)
- [OpenGameArt Billiards Pack](https://opengameart.org/content/billiards-pack)
- [CGTrader vintage hairdryer](https://www.cgtrader.com/free-3d-models/household/other/vintage-hairdryer)
- [Quaternius Ultimate House Interior Pack](https://quaternius.com/packs/ultimatehomeinterior.html)、[Kenney Furniture Kit](https://kenney.nl/assets/furniture-kit) 与 [Poly Haven 许可](https://polyhaven.com/license)

## 第四轮修改完成记录（2026-11-19）

1. 场景替换：删除 comfy_cafe_4k.exr（runtime 与 source 两份），导入用户提供的 sitting_room_with_baked_textures.glb（jimbogies / CC-BY-4.0，已登记 manifest 与 NOTICE）。房间按实测包围盒居中（group.position −0.08, 0, −0.007），地面 y=0 承托桌腿；茶几组合因落在 playfield 内按三角形剔除；墙体与天花板拆分，顶视隐藏天花板与吊灯；烘焙贴图用无光照 DoubleSide 材质，RoomEnvironment PMREM 0.5 补环境光；相机环绕距离/高度钳制在房间内部（1.8–2.4 / 1.15–2.2 局部）。
2. 球杆修复：真实 GLB 球杆含沿半根杆长的桨状装饰，端切片/中位数估计均被污染。改为「环状端切片定轴心 + 全顶点径向排序取最大乘法间隙定剔除阈值」，剔除桨状三角形后保留完整杆身，径向归一化 31mm、长度 1.45m。真实 GLB 节点测试实测 [1.45, 0.0305, 0.0305]；运行时 cue-mesh 世界包围盒 2.32×0.049×0.049，与白球同轴对准。吊灯绳轴判定与缩放此前已修复并通过真实 GLB 测试。
3. 回归：typecheck 通过；build 通过；单元 100/100（18 文件，含 2 个真实 GLB 几何测试）；e2e 14/14；assets:verify 111 文件 382,223,804 字节哈希全过；check-third-party 通过；round3-shots 连续两次通过（0 页面错误）；lan-smoke 通过（room:true）；probe 三视角截图人工目检通过。
4. 脚本修正：round3-shots 原假设「假自由球超时后必有人类放置光标」不成立（超时分支真自由球归 AI 座位），改为经 debug placeCue 确定性走特殊犯规分支；放置等待改 100ms 间隔轮询以覆盖低帧率下 AI 的短 aiming 窗口。

## 第五轮修改完成记录（2026-11-19）

1. 球杆替换与防穿模（#29）：改用用户提供的 cc0_-_cue_stick.glb（实际许可为 CC-BY-4.0，作者 plaggy，已按真实许可登记 manifest 与 NOTICE，三份副本 sha256 一致）。createCueStick 以世界坐标克隆 + 协方差功率迭代定主轴、端切片判杆头，归一化 1.45m × 31mm；installTraditionalTable 剔除桌模型自带球杆。computeCuePose 使杆轴严格过球心（alignment=0），杆头间隙 0.008m（蓄力 0.188m），杆身抬升越过库边帽（rail top 0.8469m）：常规角度 railClearance≥0.0096，贴库冻结态 tilt=30°、gap=0.06025、railClearance=0.005。probe-round5 五角度 + 贴库 + 贴角全过、0 页面错误；新增 cuePose 单测 4 项与真实 GLB 几何断言。
2. HUD 重排（#30）：四角面板改为顶栏两行（品牌/回合/比分/规则用时杆数/静音设置暂停；状态文案单行省略 + 缩略技能条 + 键位展开按钮）+ 左下操作条。技能缩略为图标+名称+状态徽章（详情在 title），对手技能同条显示；键位提示改为顶栏右侧下拉、默认收起（.key-hints.collapsed），8 条键位含 WASD 新语义。顶栏实测约 110px 高：顶视桌面 y≈165 起、环绕 y≈340 起、瞄准台呢 y≈310 起，均不被遮挡；左下操作条 y≈810 起仅覆盖瞄准视角玩家侧近端台呢，球堆/瞄准线/白球全程可见。toast 下移至 122px 避免压顶栏。三视角 + 自由球光标截图人工目检通过。
3. WASD 与方向键同功能（#31）：InputController 将 KeyW/A/S/D 与四方向键统一映射（左右瞄准 ±0.004rad、上下杆法 ±0.08、Shift+方向侧旋、Alt 四分之一微调）；自由球阶段同组键仍移动放置光标（GameController 按相位路由，瞄准/杆法微调仅在 aiming 生效）。原 WASD 视角移动移除，推拉视角改滚轮（新增 CameraController.zoom，钳制 aim 0.28–1.25 / orbit 1.8–2.4，顶视不变），环绕仍右键拖拽。新增 e2e：WASD/方向键逐键等价断言（含 Shift 与 Alt）、滚轮推拉钳制断言；camera 单测新增滚轮钳制项；debug getState 暴露 human{angle,power,spin} 供确定性断言。
4. 回归（#32）：typecheck 通过；build 通过（index-zUJNKBZe.js，本地与 LAN 入口哈希一致）；单元 105/105（19 文件）；e2e 16/16；assets:verify 113 文件 407,950,788 字节哈希全过；check-third-party 通过；round3-shots 通过（0 页面错误）；lan-smoke 通过（room:true）；probe-round5 全过；1080p 实测 165 aim / 146 roll FPS（headless 软件 GL）。
5. 测试修正：吹风机 e2e 原优先选白球，开球后白球常以接近停止阈值的速度滚动，恢复物理后几步内停球、减速效果按规则随停球清理，100ms 轮询观测不到（产品行为正确，属观测窗口问题）；改为选速度最快的运动球，连续两次通过。input-camera 在全量并发负载下出现过一次超时 flake，单独与随后全量复跑均通过，未改产品代码。

## 第六轮修改完成记录（2026-11-19）

1. 点击目标球自动指向（#33）：沿用 ballClick 路径（aiming 且人类回合时 human.angle=atan2(目标−白球)），新增专项 e2e「点击目标球后球杆自动指向该球」：ballScreen 稳定轮询后真实鼠标点击，断言 angle 与解析值五位小数一致；键位提示同步写明「点击目标球」。
2. 顶栏中间栏（#34）：row-sub 改 1fr auto 1fr 网格，技能条+键位展开按钮居中（.sub-center），键位下拉改为相对顶栏水平居中（left:50% + translateX(-50%)，宽 300px）；8 条键位更新（含点击目标球、WASD/方向键合并、摆球拖动+微调+Space 确定）。截图目检居中生效。
3. 自由球顶视拖放（#35）：CameraPhase 新增 placing，ballInHand 立即顶视（删除旧的首人称停留/环绕缓转逻辑）；InputController 新增 placingActive/onPlaceDrag，放置期左键按下即拖拽白球预览（setPointerCapture），GameController 按相位钳制（validCuePosition）；WASD/方向键步进 0.02、Alt 微调 0.004；Space/Enter 仅确认放置（beginCharge 在放置期提前返回，确认后再按才蓄力）； SceneView.previewBallPosition 只做展示预览，确认后权威位置才更新，取消时恢复权威位置。e2e 覆盖拖动落点、微调、Space 确认后 camera 回 aim。
4. 击球后自动顶视（#36）：rolling 立即 top（阻尼 9/10 收敛），删除 ROLLING_FIRST_PERSON_MS/ORBIT_GLIDE_MS/pendingOrbit；顶视隐藏吊灯与天花板。回归中发现吹风机选球（skillTargeting，物理暂停）被映射成 orbit 的真实缺陷：改为 returnPhase==='rolling' 的选球保持顶视，修复后 e2e 通过。
5. 开球线自由摆白球（#37）：新增 breakPlacement 相位与状态机转换；HEAD_STRING_X=−CUSHION_HALF_X/2，clampBreakPlacement/stepBreakPlacement 限制开球线后；SceneView.breakLine 琥珀开球线仅该相位显示；与自由球共用拖拽/微调/确认 UX；AI 开球自动摆位（-0.72,0 等候选）；status-title「开球摆位」；menu/gameplay/ui-round3/input-camera 各 e2e 与 round3-shots/lan-smoke/measure-fps/probe-round5 脚本同步补 Space 确认步骤。
6. 黑8入袋不结束修复（#38）：resolveChineseEight 统一为「任何进8立即终局」——合法清台后进8判胜，其余（提前进8、同杆清台带8、进8犯规、开球进8）判负；开球进8消息「开球击入8号球，提前进8判负」；respotEight 恒 false（假自由球特殊犯规仍经 respotEightBall 重置8号）。单测改断言开球进8立即判负；新增 e2e「开球击入黑8立即结束对局」真实 strike 后断言 gameOver+乙方获胜。
7. 袋口微扩（#39）：POCKET_RADIUS 0.073→0.077（+5.5%），袋 jaw/knuckle/mouth 几何自动派生；SceneView 袋口视觉原本即 0.077，现与物理一致。
8. 目标球方向短辅助线（#40）：SceneView.targetLine（琥珀 0xffd27a、0.22m）由 ghost-ball 射线圆交（接触半径 2R）求首碰球，沿碰后运动方向绘制；初版高度在球心导致顶视被球体上半遮挡，改为球顶上方 1.05R 悬浮，顶视/瞄准两视角均可读；debugNodeReport 增补 aim-line/target-line/break-line 节点（visible+世界包围盒）作确定性证据；新增 scripts/probe-round6.mjs（球堆顶视、孤立球顶视/瞄准、局部放大截图）。nodeReport 实测 target-line visible=true、跨度 0.352 世界单位（=0.22m）、高度球顶+0.0016 局部。
9. 回归（#41）：typecheck 通过；build 通过（index-BuhReeHj.js）；单元 105/105（19 文件）；e2e 18/18（修复吹风机顶视缺陷后全量复跑绿）；assets:verify 113 文件 407,950,788 字节哈希全过；check-third-party 通过；round3-shots 通过（0 页面错误，03 开球摆位顶视/04 双辅助线/06 顶视无吊灯/07 自由球顶视/08 滚动顶视目检通过）；lan-smoke 通过（rolling+top，LAN 入口同步新构建）；probe-round5 全过（cc0 球杆、五角度+贴库+贴角 alignment=0）；probe-round6 通过（0 页面错误）；1080p 默认画质 headless 软件 GL 实测 165 aim / 152 roll FPS。

## 单文件试玩版打包记录（2026-11-19）

1. 产物：release/库边秘技-试玩版.html，63.4MB，内联 71 项运行时素材（base64 data URL）+ 全量 JS/CSS。排除 characters/ 与 animations/（第三轮起运行时不再加载，合计约 38MB）；其余素材（房间/球桌/球杆/吹风机 GLB、BGM 四轨、SFX、图标、manifest、OBJ 回退件）全部内联，视觉与服务器版一致。仅本地文件分发，不涉及公网部署。
2. 机制：scripts/build-single-file.mjs 读取 dist/index.html，内联 CSS/JS；头部经典脚本预置 ASSETS 映射并拦截 window.fetch、HTMLImageElement.src、HTMLMediaElement.src（BGM 走 audio.src），将 /assets/ 路径映射为 data URL；file:// 下 pathname 带盘符（/D:/assets/…）需归一化。两个实测陷阱：String.replace 的替换串会解释 bundle 模板字面量中的 `$`（正则锚点 `$` 后接反引号构成 $` 模式）导致内联代码损坏，改函数替换；file:// 的 URL pathname 含盘符导致查表失配。
3. 验证：scripts/verify-single-file.mjs 以 file:// 真实打开：启动 1.1–4.0s、创意抽取→开球摆位→蓄力开球→滚动顶视全链路通过、0 页面错误、0 外部请求（blob: 为 GLTFLoader 本地解码临时 URL，计入本地）、SFX 五样本与 BGM 正常；截图 shots-single/01–05 目检与服务器版一致（砖墙房间、传统球桌、cc0 球杆、顶视）。
4. 使用方式：双击用桌面 Chrome/Edge 打开即可离线试玩；文件可直接经微信/QQ/网盘发送；无需服务器与安装。

## 第七轮修改完成记录（2026-11-20）

1. 鼠标击球方案（#42）：InputController 重写为「移动鼠标瞄准（0.0035 rad/px，Alt 四分之一微调）；左键按住向后拖蓄力（拖距/220px 映射力度，8px 启动阈值），松开击球；右键单击锁定/解锁球杆（锁定期间所有瞄准输入冻结、杆法面板可点，HUD 杆法标签显示「已锁定」+琥珀描边）；滚轮微调瞄准 ±0.0015 rad，Shift+滚轮推拉视角；Esc 取消蓄力」。后拖方向按屏幕空间「白球投影−瞄准前方投影」单位向量实时计算，任意镜头朝向都成立；pointercancel/窗口失焦自动取消不击球。GameController 新增 dragCharging/cueLocked 状态与 cancelChargeWithFeedback（toast「已取消蓄力，未击球」）、toggleCueLock、beginDragCharge/endDragCharge；strike 后自动解锁。Space 长按蓄力保留为等价入口。新增 e2e round7：拖距 150px→力度 0.68±0.08 且松开只击一杆、Esc 双入口取消、右键锁定/解锁与杆法面板、滚轮微调与 Shift 隔离。
2. 360° 自由瞄准全视角适配（#43）：瞄准改为无界相对增量（删除旧角度钳制），probe-round7 实测顶视/第一人称/环绕三模式鼠标 200px 均 +0.7000 rad，连续两段前扫累计 9.100 rad（1.45 圈）无钳制无回绕；球杆 pose 与辅助线随角度全周更新（probe-round5 五角度 alignment=0 复跑通过）。
3. 台呢摩擦（#44）：ROLLING_DECELERATION 0.3→0.75 m/s²（滚动衰减 2.5 倍），滑动衰减保持 9.8×0.2；单测断言 1 m/s 滚动 512 步后速度落在 0.15–0.35 m/s。副作用：滚动结算窗口变短，吹风机 e2e 改为满力开球 + 页面内按钮可用当帧原子点击（真实 DOM click），消除 Playwright 重试间隙结算导致的禁用竞态。
4. Poolians 式辅助线（#45）：虚线瞄准线终止于精确幽灵球接触点（射线与 2R 接触圆求交，不再固定库边钳制）；接触点白色幽灵圈（LineLoop 40 段、半径 R、opacity 0.55）；目标球运动方向琥珀线保留（球顶上方 1.05R、0.22m）；新增白球切向偏转线（0x9fd8ff、0.14m，tangent=dir−n(dir·n)，正对心球时切向为零自动隐藏，属正确物理）。nodeReport 增补 ghost-ball/deflection-line；e2e 薄切角摆位断言三节点 visible；probe-round7 顶视全画质截图目检：幽灵圈贴接触点、目标线与偏转线分居法线两侧。
5. Esc 取消击球（#46）：keydown Escape 优先于 Space 处理，取消拖拽蓄力与键盘蓄力并 toast 反馈；e2e 断言取消后 phase 保持 aiming、杆数 0。
6. 入袋球被袋角兜出（#47）：根因是袋喉内球与 knuckle 接触后被 resolveJaws 反射回台面。新增 pocketJaws（每袋喉内 knuckle + 朝台内单位向量）与 inPocketThroat 判定（接触距离内 + 朝袋内投影为正 + 袋口开口守卫），captureAtPocket 在 resolveJaws 之前每步执行，喉内球直接判进袋。单测：角袋喉内直推必进（pocketId 5、flewOffTable 空）。多边形喉口方案两版均被单测证伪后弃用（真实静止法线非精确对角线，凸包退化/反射先于判定）。
7. 球杆/镜头穿模（#48）：根因是第一人称机位随瞄准方向推到库边外的木家具内。CameraController.updateAimDesired 增加房间钳制 |x|≤1.55s、|z|≤0.95s，且越过库边（|localX|>1.2122 或 |localZ|>0.5794）时机位抬到轨顶之上 y≥(0.8469+0.08)s。单测贴库反向瞄准断言三轴钳制；e2e + probe-round7 全画质截图目检：砖墙/挂画/沙发可见、无木纹糊屏、球杆在轨顶之上。
8. 打完不结算（#49）：两条根因——跳离台面的球未回置导致局面悬空、袋喉兜出球反复振荡不静止。ruleTypes 新增 respotBalls（8 号跳离判负；其余跳离球回置脚点并扫描空位防重叠；白球跳离走自由球），GameController.resolveShot 与假自由球特殊犯规分支统一应用回置快照；配合 #47 喉口捕获保证 allStopped 可达。单测 3 项（8 跳离判负、双球回置不重叠、白球不回置）+ 既有清台/开球进8 e2e 复跑通过。
9. 回归（#50）：typecheck 通过；build 通过（index-uFEmdjMp.js，本地与 LAN 入口哈希一致）；单元 111/111（19 文件）；e2e 24/24（新增 round7 六项；ui-round3 键位 11 条与滚轮语义同步更新）；assets:verify 113 文件 407,950,788 字节哈希全过；check-third-party 通过；round3-shots 通过（0 页面错误）；lan-smoke 通过；probe-round5 全过；probe-round6 通过（aim-line 终止于精确接触点 0.915=1.016−2R）；probe-round7 新增（钳制机位 [2.48,1.81,0.80]、三模式鼠标瞄准、1.45 圈扫角、全画质截图）；1080p 默认画质 headless 软件 GL 实测 165 aim / 148 roll FPS；单文件试玩版重打包 63.4MB（71 素材内联）并 file:// 实跑验证（0 外部请求、0 页面错误、BGM 与五 SFX 正常）。

## 第八轮修改完成记录（2026-11-20）

1. 球面连续加塞与真实旋转物理（#51）：SpinFace 取代九宫格预设——SVG 球面（viewBox 100、有效半径 46）点击/拖动连续加塞，超出球面按方向钳制到单位圆并提示「接近滑杆极限」（at-edge 描边）；键盘微调 0.05/步、Alt 0.012、Home 回中，焦点在球面时不触发全局瞄准；读数（高/低杆 · 左/右塞 数值）与标记实时同步。物理：ω_z=−side×1.25×v/R，rollFactor=1+vertical×(vertical≥0?1:2)，吃库切向冲量上限 0.5×法向冲量（不凭空造能量）；低杆回撤/高杆跟进/半低杆定杆、侧旋吃库横向弹出、碰撞 throw 与滑行 swerve 均按固定步长单测核验。杆头落在所选击球点：横移 0.5R×side、上抬 0.5R×vertical，gap≥0.006、railClearance≥0。键位提示同步 12 条（新增球面加塞条）。e2e round8 九项 + probe-round8 全画质截图。
2. 摩擦力再提高（#52）：ROLLING_DECELERATION 0.75→1.15 m/s²（滑动衰减不变）；轻推 0.2 力度实测滚动 0.6249 m（v=1.2 m/s，s=v²/2a≈0.626 m）。
3. 转向更灵敏且多圈自由（#53）：鼠标瞄准 0.0035→0.008 rad/px（200px≈1.6 rad），无界累计实测 5.14 圈无钳制无回绕、球杆 alignment≈4e-17；顶视/环绕/瞄准三视角灵敏度一致。
4. 微调更精细（#54）：滚轮 0.0015→0.0005 rad/格，Alt+滚轮 0.00006 rad/格，Alt+鼠标 0.12 倍（100px=0.096 rad）。
5. 回归中发现并修复的两处产品缺陷：a) 开球自动补力——摩擦 1.15 下开球临界力度随球堆随机微扰变化（实测 0.80 仅 22/40 种子合法），确认开球摆位后自动补到 0.94（40/40 种子合法，breakSweep 单测钉住），首杆结算后还原玩家原力度；HUD 力度条改为始终跟随权威力度（含补力/还原）。b) 自由球默认落点回退——犯规后白球原位可能贴球或落袋，「Space 确定放置」无法一次确认；defaultPlacement 原位不合法时经 firstLegalPlacement 扫描合法落点（光标初始化与 Space 确认共用），玩家手动拖到非法点仍拒绝并提示。
6. 回归（#55）：typecheck 通过；build 通过（index-CfXLDK9g.js，本地/LAN/dist 入口 sha256 0ab8df10646b… 一致）；单元 123/123（20 文件，含 breakSweep 40 种子钉与满力开球四球碰库钉）；e2e 34/34（9.2m，含新增开球自动补力专项；上轮唯一失败项在落点回退修复后通过）；assets:verify 113 文件 407,950,788 字节哈希全过；check-third-party 通过；diag-break 五力度曲线（0.56/0.68/0.80 犯规、0.94/1.00 合法）且犯规后 Space 一次确认全过；round3-shots 通过（0 页面错误）；lan-smoke 通过（rolling+top、room:true）；probe-round5 全过（五角度+贴库+贴角 alignment=0）；probe-round6 通过（aim-line 终止 0.915）；probe-round7 通过（钳制机位 [2.48,1.81,0.80]、三模式 1.6 rad、3.31 圈扫角）；probe-round8 通过（杆头横移 0.00959/上抬 0.00890 与解析值一致、draw minX −0.4002、follow maxX 0.6056、stun −0.0467、吃库 ±0.2484 对称、摩擦 0.6249 m、5.14 圈、滚轮 0.0005/0.00056、0 错误）；1080p 默认画质 headless 软件 GL 实测 165 aim / 148 roll FPS（probe 全画质真实 GPU 165.4）；单文件试玩版重打包 63.4MB（71 素材内联、确认内联新包）并 file:// 实跑验证（启动 1.1s、0 外部请求、0 页面错误、BGM 与五 SFX 正常）；shots-round8/30–34 目检通过（力度条 94、键位展开按钮卡片面、顶视无吊灯、多圈后辅助线正常）。

## 第九轮修改完成记录（2026-11-20）

1. 摩擦回调（#56）：ROLLING_DECELERATION 1.15→0.85 m/s²（滑动衰减 9.8×0.2 不变）。开球散开度实测显著改善：0.94 补力下合计移动 99/180 球、平均位移 0.321m（1.15 基线 78/180、0.268m），最少单种子 7/15、平均最小 0.310m；breakSweep 40/40 种子合法不变。新增 tests/physics/breakScatter.spec.ts 钉住「≥6 球移动>0.2m 且平均≥0.28m」（12 种子）。
2. 辅助线调短（#57）：目标球运动方向线 0.22→0.12m、白球切向偏转线 0.14→0.08m（SceneView），幽灵球接触圈与虚线瞄准线不变，降低进球提示强度。新增 e2e round9 断言两线世界跨度 0.186–0.198 / 0.122–0.134（×1.6 场景缩放）。
3. 球速观感慢放（#58）：新增 src/app/presentation.ts PRESENTATION_TIME_SCALE=0.85，GameController 滚动相位累加器 += delta×0.85，球看上去慢 15% 但物理步数、轨迹、停点距离与种子确定性完全不变；对局时钟、十分钟加时、假自由球倒计时与蓄力节奏仍走真实时间。新增 e2e round9-timescale（chrome 通道）清洁窗口墙钟/物理比 ≈1.176（=1/0.85），断言停点距离与全速一致。
4. 回归（#59）：typecheck/build 通过；单元 124/124（21 文件，新增 breakScatter）；新增 e2e round9×2 + round9-timescale×1（全量 37 项）；开球散开、慢放比例、辅助线长度专项均通过。完整套件最终绿见第十二轮（参数定稿后统一复跑）。

## 第十轮修改完成记录（2026-11-20）

1. 最大力度上调（#60 第一步）：MAX_SHOT_SPEED 6→7 m/s，满力出杆速度上限提高，滚动距离按 s=v²/2a 相应增大。摩擦诊断 e2e 力度 20 停点距离重标定为 ≈1.152m（0.85 摩擦）；单元 strike/接触/杆法力度钉与 e2e 距离断言同步更新。

## 第十一轮修改完成记录（2026-11-20）

1. 最大力度再上调（#60 第二步）：MAX_SHOT_SPEED 7→8 m/s，摩擦诊断 e2e 力度 20 停点 ≈1.504m。回归发现 gameplay 清台进 8 专项在力度 21（1.68 m/s）下白球跟袋洗袋判负——摩擦 0.85 时停得住、速度上限提高后中杆跟进更远；经确定性模拟扫力重标定为力度 24（1.92 m/s），单测复跑通过（14.2s）。全量套件复跑被第十二轮请求打断，统一并入第十二轮定稿回归。

## 第十二轮修改完成记录（2026-11-20）

1. 摩擦再调小（#61）：ROLLING_DECELERATION 0.85→0.7 m/s²（滑动衰减不变）。开球散开度实测合计 130/180 球移动、平均位移 0.582m（0.85 时 99/180、0.321m；1.15 基线 78/180、0.268m），最少单种子 9/15、平均最小 0.494m；breakSweep 0.94 补力 40/40 种子合法不变，breakScatter「≥6 球移动>0.2m 且平均≥0.28m」钉通过。轻推 0.15 力度（v=9×0.15=1.35 m/s）滚动 s=v²/2a≈1.302m 后停住（0.20 力度会滚 2.31m 撞库，故诊断用 0.15）。
2. 力度范围两端扩大（#61）：MAX_SHOT_SPEED 8→9 m/s（满力更猛），MIN_SHOT_POWER 0.08→0.04（charge.ts 下限，最轻杆 0.36 m/s，原 0.64）。有效出杆速度 0.36–9 m/s。Simulation.strike 仍为 speed=MAX×clampedPower 线性、无内部下限；HumanController.setPower 与拖拽蓄力按 MIN_SHOT_POWER 钳制，HUD 力度条始终跟随权威力度。
3. 测试标定同步：单元 strike 首步 4.5×FIXED_DT、摩擦 256 步速度 0.6–0.7、draw/follow/stun 力度 1/3（=3.0 m/s）；e2e round8 杆法力度 38→33、摩擦诊断力度 20→15（停点界 1.18–1.43）、round9-timescale 力度 20→15；probe-round8 与 diag-timescale 同步。开球自动补力 0.94 与首杆还原 0.72 断言不变。
4. 回归中发现并修正的测试标定（非产品缺陷）：gameplay 清台进 8 专项原力度在摩擦 0.7 下白球中杆跟进 ≥1.80 m/s（力度≥20）会跟袋洗袋判负；经确定性模拟扫力（种子 1/7/42、力度 12–26）确认阈值 ≤19 胜 / ≥20 洗袋，重定为力度 18（1.62 m/s），跨 40 个球堆种子 40/40 获胜，全量套件中该项复跑通过（15.4s）。属规则正确的物理（中杆跟进随摩擦减小而变远），已钉进测试并写入项目记忆「摩擦/球速变更需重扫此钉」。
5. 回归（#61）：typecheck 通过；build 通过（index-CmA7hkPq.js，sha256 15ec79d5…，本地/LAN/dist 入口一致）；单元 124/124（21 文件）；e2e 37/37（10.4m）；assets:verify 113 文件 407,950,788 字节哈希全过；check-third-party 通过。diag-break 五力度 0.56/0.68/0.80/0.94/1.00 在摩擦 0.7+上限 9 下全部合法开球（低力度亦能散开）。probe-round5 全过（cc0 球杆、五角度+贴库+贴角 alignment=0）；probe-round6 通过（aim-line 终止精确接触点 0.915、target-line 0.192 世界=0.12m）；probe-round7 通过（钳制机位 [2.48,1.81,0.80]、三模式 200px=1.6 rad、3.31 圈扫角）；probe-round8 通过（杆头横移 0.00959/上抬 0.00890 与解析一致、draw minX −0.5216、follow maxX 0.6112、stun −0.0377、吃库 ±0.5476 对称、摩擦停点 1.3005m、5.14 圈、滚轮 0.0005/0.00056、0 错误）。measure-fps 1080p 默认 headless 软件 GL 实测 165 aim / 153 roll；round3-shots 通过（0 页面错误、room:true）；lan-smoke 通过（rolling+top、room:true）；diag-timescale 清洁窗口墙钟/物理比 1.174（≈1/0.85）、停点 cueX 0.8 不变、0 错误；verify-single-file file:// 实跑启动 1.12s、63.4MB、0 外部请求、0 页面错误、BGM 与五 SFX 正常。截图目检：04 瞄准双辅助线、06 顶视无吊灯、34 多圈后辅助线均正常；34 原立即截图捕到相机阻尼摆动中间帧（空台呢），补 600ms 稳定等待后重生成，属截图时序非产品缺陷。

## 第十三轮修改完成记录（2026-11-21）

1. 键盘单步瞄准再精细化（#62）：ARROW_AIM_STEP 0.004→0.0005 rad（约 0.029°/次，A/D 与左右方向键单次点击），Alt 微调系数 0.25 → 0.000125 rad；滚轮 WHEEL_AIM_STEP 同步 0.0005 rad/格。鼠标 0.008 rad/px 与 Alt+鼠标 0.12 倍不变；自由球摆位/球面加塞步长不变。
2. 力度两端再扩大且区间线性均布（#63）：MAX_SHOT_SPEED 9→10 m/s、MIN_SHOT_POWER 0.04→0.02（charge.ts 下限），有效出杆速度 0.2–10 m/s。Simulation.strike 仍 speed=MAX×clampedPower 线性无内部下限；HUD 力度条 min 跟随 MIN_SHOT_POWER（=2）、max=100、显式 step="1" → 99 档每档 1%=0.1 m/s 均匀分布；蓄力/拖拽/onPower 均按 [MIN,1] 钳制。
3. 回归中发现并修复的两处缺陷：a) 滑块 step 属性缺失——input.step 反射内容属性，缺省读 ""（浏览器默认步长虽为 1），显式 step="1" 使均布契约可测（ui-round3 断言 step==="1"）。b) 袋口高速飞球——袋口间隙宽于捕获圆+袋角覆盖，满力开球个别种子（0.80 力度 4/40 种子，seed 9 的 10 号球 y≈0.53）滑过离散捕获窗从袋口飞出判犯规；detectFlight 改为兜底落入最近袋（2D 无跳球，唯一出口即袋口），新增 tests/physics/breakFlight.spec.ts 钉住 0.80/0.89/1.00 × 40 种子永不飞球且 16 球全 accounted。
4. 开球自动补力重标定 0.94→0.89（8.9 m/s）：摩擦 0.7+上限 10 下连续合法带 0.80–0.89（40/40 种子 ≥4 目标球碰库+白球不洗袋+不飞球），0.90 起洗袋随种子混沌出现（0.90 挂 seed 27、0.94 挂 seed 19），取连续安全带上沿 0.89；breakSweep 单测钉住。AI 开球同 0.89。
5. 测试标定同步：gameplay 清台进 8 力度 18→17（1.70 m/s，40/40 种子胜；10–17 胜、18–24 洗袋，阈值恰 1.80 m/s）；摩擦诊断力度 15 停点界 [−0.5+1.45,−0.5+1.75]（v1.5→s≈1.607）；draw/follow/stun 力度 30%=3.0 m/s；单元摩擦 256 步速度 0.6–0.7、strike 首步 5×FIXED_DT。
6. e2e 假自由球超时项确定性修复（测试脆弱性，非产品缺陷）：主循环按真实时间推进假自由球 10 秒寿命，软件渲染慢帧下发动到读状态的真实间隙可推过 10 秒造成提前超时。DebugApi 新增幂等 pause(enabled) 钩子冻结真实时间 RAF（advanceTime 不受 paused 门控、仍为唯一时间源），测试发动后立即 pause(true)、按已冻结 elapsedMs 相对推进到 9000 断言 active、再 +1100 断言超时结算，结果完全确定。
7. 回归（#64）：typecheck 通过；build 通过（index-BErBto03.js，sha256 f424080b…，本地/LAN/dist 入口一致）；单元 126/126（22 文件，新增 breakFlight×2）；e2e 38/38（15.0m，含修复后的假自由球超时项 37.6s）；assets:verify 113 文件 407,950,788 字节哈希全过；check-third-party 通过。diag-break 五力度 0.56/0.68/0.80/0.89/1.00 全合法（0.80 由飞球犯规转合法，1.00 进 7 号）；probe-round5 全过（五角度+贴库+贴角 alignment=0、cc0 球杆）；probe-round6 通过（aim-line 终止 0.915、target-line 0.192 世界=0.12m）；probe-round7 通过（钳制机位 [2.48,1.81,0.80]、三模式 200px=1.6 rad、3.31 圈）；probe-round8 通过（杆头横移 0.00959/上抬 0.00890 与解析一致、draw minX −0.5377、follow maxX 0.6033、stun −0.0402、吃库 ±0.547 对称、摩擦停点 1.6057m、5.14 圈、滚轮 0.0005/0.00056、0 错误）；measure-fps 1080p 默认 headless 软件 GL 实测 154 aim / 138 roll（较上轮 165/153 略低，系统负载波动）；round3-shots 通过（0 页面错误、room:true）；lan-smoke 通过（rolling+top、room:true）；diag-timescale 清洁窗口比 1.177（≈1/0.85）、停点 cueX 1.106 不变、0 错误；verify-single-file file:// 实跑启动 1.5s、63.4MB（71 素材内联）、0 外部请求、0 页面错误、BGM 与五 SFX 正常。截图目检：04 瞄准双辅助线、06 顶视无吊灯、32 完整 HUD、34 多圈后辅助线均正常。
