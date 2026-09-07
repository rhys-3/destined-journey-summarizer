# 架构与运行依据

## 模块

| 路径 | 职责 |
| --- | --- |
| src/index.js | 单实例启动、卸载及启动错误传播 |
| src/preset/assistant.js | 实例状态、模块组装、启动与宿主事件接线 |
| src/preset/definitions.js | 预设条目 UUID、受管字段和界面默认值 |
| src/preset/store.js | 预设读写队列、同步、失败回滚 |
| src/preset/models.js、connections.js、managed.js | 模型选择、连接、受管宏和字段 |
| src/preset/worldbook.js | 变量世界书与预设模式联动 |
| src/preset/styles-editor.js、prompt-editor.js、placement.js | 文风、条目编辑、排序与分区位置 |
| src/preset/configuration-schema.js、configurations.js、custom-models.js | 配置白名单、导入导出、恢复与自定义模型 |
| src/preset/render.js、appearance.js、events.js | 页面渲染、主题与布局、交互与清理 |
| src/summary/service.js | 一次迁移、事件、嵌入页面、聊天切换 |
| src/summary/summary.js、batchPlan.js | 触发、整轮范围、按完整回复拆分批次与恢复入口 |
| src/summary/taskRunner.js | 串行／并发生成、顺序提交、逐批重试与暂停 |
| src/summary/api.js、prompt.js、messages.js | generateRaw、提示词与标签正文 |
| src/summary/worldbook.js | 绑定、普通／大总结、映射与楼层显隐 |
| src/summary/storage.js、settingsSchema.js | 总结参数缓存与白名单校验 |
| src/summary/taskState.js、provenance.js、result.js | 持久任务状态、来源指纹、结果协议 |
| src/summary/macros.js、archiveDefaults.js | 宏展开、场景快照、档案模板 |
| src/summary/ui/taskView.js、promptTools.js | 顶部提示、按钮权限、宏与请求预览 |
| src/summary/ui/floorBrowser.js、visibilityView.js | 楼层概览、延迟展开、分页与筛选 |
| src/summary/ui/batchSettings.js、tagEditor.js | 推荐批次方案、并发设置与逐项标签编辑 |
| src/platform/store.js | 共享变量读写协调 |
| src/platform/lifecycle.js、ambient.js | 互斥、上下文令牌、取消与宿主 API |
| src/ui/、src/summary/ui/ | 设置主题、统一弹窗与总结子页面 |
| src/summary/presetDefaults.js | 旧版默认提示词，仅用于迁移识别 |
| loader.js | 固定版本加载与重试 |

只有一份 ES 模块运行时源码与一个新版 bundle；旧总结 dist 是冻结兼容资产。

设置模块以工厂函数创建，每次启动拥有独立的状态与函数。模块间通过显式的实时访问器共享当前状态，避免异步保存、拖动、聊天切换和清理期间持有旧值；没有字符串拼接或运行时 eval。esbuild 将模块依赖打包为单文件。预设 split 中只维护固定版本加载器，完整预设 JSON 只在独立的本地工作区生成。

主分支工作流在所有测试通过后提交下载自同一次验证任务的构建产物，发布任务使用该提交打标签。PR 不回写仓库，已发布标签不覆盖；并发主分支更新会阻止过时产物写入。独立的类型声明工作流每三天检查上游，只提交 `@types/` 的内容变化。

## 摘要与请求

预设生成回复中的 summary，预设原生正则 07 在 maxDepth=10 范围去掉摘要，08 在 minDepth=11 范围保留时间地点与摘要。它们改变发送消息的处理结果，不是助手世界书记录。

助手通过 getChatMessages 读原始楼层，包含隐藏消息；范围计数与标签提取独立。默认提取 tp／gametxt 并去除 HTML 注释，排除标签默认为空。排除仅作用于提取后的 AI 正文，支持属性与同名嵌套；用户输入不受包含／排除标签限制。每段材料附原始楼层编号、发言角色与意图／事实说明。覆盖集合由实际来源楼层构成，不能用最大结束楼层代替。

自动触发一次确定整轮范围，batchPlan 按单批上限与 AI 回复边界拆分连续可用楼层。batchPreset 仅由用户选择推荐或编辑数字决定，不检测摘要状态；parallelBatches 默认 false，batchConcurrency 默认 2。behaviorVersion 标记默认值迁移，仅将旧默认 think 与大总结 8/6 更新为空和 15/10，保留自定义值。

taskRunner 为一轮建立一个互斥任务，设置快照在整轮固定。串行逐批准备，能读取之前批次的新记忆；并发按数量分组准备与生成，同组结果不互相进入请求。每组生成结束后按楼层顺序提交世界书，写入不并发。各批保留来源、正文、阶段和错误；任务根字段映射当前选中批次，兼容单批恢复。继续跳过已完成／已跳过批次，明确编辑或重生成只操作选中批次。持久恢复信息不保存设置快照、编译请求或密钥。

楼层统计保留一次全聊天快照，刷新时线性扫描以核对来源与覆盖。明细折叠时不创建表格行；展开后在快照上按类型、显隐筛选，每页最多 30 楼。翻页使用缓存，原文查看只调用所选范围的 getChatMessages，不随总楼数扩大。

世界书普通／大总结分别深度 9998／9999。配套预设的「消息处理」脚本将历史中的 system 注入按 901 以上、3～900、0～2 分别放入 VOID_memory、VOID_reference、VOID_runtime；头尾保持独立，正文合成 user。脚本与结构边界在私有预设工作区维护，完整预设不进入本仓库。旧 SP 配置夹具仅保留作历史格式兼容测试。

主连接与自定义 API 都经 generateRaw。准备阶段以目标材料 dry-run 扫描世界书，显式展开角色、用户和场景宏；先移除自身总结，不读取深度条目。请求由普通或大总结中启用的条目直接展开；max_chat_history=0 与空历史覆盖阻止夹带实时 RP 历史。配置只传给当前请求，不替换主连接。自动重试复用展开后的材料和请求参数。

api 直接将编译好的自然 role、顺序和内容交给 generateRaw，不注入防合并标记，不注册发送事件或序列化补丁。配套预设只处理含其完整正文边界的请求，总结因此自然跳过。酒馆连接的后处理、停止词与接口角色转换保持原设置；助手不再承担旧全局 SP 合并器的隔离。独立 generation_id、取消、超时和上下文核对仍由 lifecycle 负责。

## 生命周期与存储

写操作与生成检查聊天、预设和生命周期代次。切换上下文或卸载使令牌失效；暂停自动处理允许已启动的一组完成，后续批次标为未执行。每个并发请求使用独立 generation_id；停止或上下文失效时取消本轮所有活动 ID。互斥阻止连续消息和重复点击重复提交。取消／超时结束等待，迟到结果不能写入。任务状态经同一发布接口驱动顶部提示、入口标记和面板；浏览、草稿编辑不占生成互斥。

聊天状态通过 writeVariableKeys 同步读取最新变量表、替换指定键的完整值，再读回校验；其他键原样保留。手动显隐覆盖、来源档案和大总结映射会删除旧成员，不能使用酒馆助手的递归合并接口保存，否则被移除的成员仍会保留。原生变量接口行为见[酒馆助手实现](https://github.com/N0VI028/JS-Slash-Runner/blob/main/src/function/variables.ts)。

宿主没有跨世界书、聊天变量和消息的数据库事务。写入前后及回调再次检查上下文；已被宿主接受的单次写入无法由浏览器原子撤销。真实宿主异步时序仍需实测。

| 范围 | 内容 |
| --- | --- |
| 设置脚本变量 | 原设置偏好、模型、configuration_library |
| 设置脚本变量 | summary_assistant_settings：白名单参数 |
| 设置脚本变量 | summary_assistant_secrets：按地址保存 Key |
| 设置脚本变量 | summary_assistant_migration：迁移版本 |
| 设置脚本变量 | summary_assistant_runtime：按预设／聊天上下文保存待处理任务，不含连接密钥 |
| 设置脚本变量 | summary_assistant_owned_books：实际加入全局的书；summary_assistant_books：独立总结书目录 |
| 聊天变量 | summary_assistant_worldbook：绑定 |
| 聊天变量 | summary_assistant_mega_summary_map：大总结来源 |
| 聊天变量 | summary_assistant_auto_hidden_floors：自动隐藏楼层 |
| 聊天变量 | summary_assistant_visibility_auto：本聊天自动隐藏开关 |
| 聊天变量 | summary_assistant_visibility_overrides：本面板手动显隐的来源与状态 |
| 聊天变量 | summary_assistant_archive：按书保存来源指纹、父记录与手动排除范围 |
| 聊天变量 | summary_assistant_binding_paused：主动解绑后暂停自动建书 |
| 世界书 | 普通／大总结正文 |

设置整表写入先读取并保留最新总结字段；总结写入合并最新脚本变量。写入与读回验证失败均传播，不能显示成功或发布成功缓存。

绑定记在聊天变量中，生效沿用全局世界书列表。只移除助手实际添加过的书；预先启用的全局书不会被认领。显式绑定可选择酒馆全部世界书；不凭名称自动认领已有书。删除和刷新会清除失效绑定与目录项。关闭自动总结本身不解绑。

楼层自动隐藏开关按聊天保存，不进入命名配置、恢复点或配置导出。旧聊天尚无开关键时，有有效手动显隐记录则按暂停处理，否则沿用旧参数 autoHideSummarizedFloors 作为默认值。显式开关值优先，手动操作同时保存暂停状态。重新开启时同步清空全部手动显隐记录，并把这些楼层交回自动管理；随后按有效总结覆盖更新原生显隐，没有总结也能恢复。暂停保留现有显隐，但失去总结覆盖的自动隐藏仍需恢复。

保存先建立未提交的来源记录，再写世界书；大总结启用和父记录停用在同一世界书更新内完成。读回通过后提交来源状态，随后同步显隐。显隐先记受管楼层，再用 refresh: affected 分批更新，避免 all 触发 CHAT_CHANGED；部分写入可按原阶段重试。详情见 [后台总结说明](SUMMARY.md)。

命名快照 v2 含可选 preset／summary，内部配置库版本仍为 1，分享文件外层版本为 2。v1 快照规范化为 preset 部分。所有分享路径采用白名单；Key、世界书、绑定、聊天、总结和隐藏记录不进入命名配置或恢复点。
