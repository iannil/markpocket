# Airtable 基础迁移页面向导

日期：2026-10-10。用户选择页面入口。实现范围是整体路线图 B；A1/A2 已在 `docs/release/2026-10-09-recovery-evidence.md` 验收，C/D 不在本次实现中。

## 产品行为

- 登录用户从 Workspace 的 Import from Airtable 入口进入 `/bases/import-airtable`，填写 Base ID、只读 PAT、新 Base 名称。PAT 需要 `schema.bases:read` 和 `data.records:read`，只授权源 Base；不请求写权限。
- 预检只读 schema，列出每表字段及转换/跳过说明；确认后重新取 schema，比对摘要，变化要求重新预检。原始 schema 和 PAT 不放 URL、日志、localStorage 或数据库。PAT 仅页面内存及当次服务调用使用，完成/取消/离开清空。服务器不缓存凭据。
- 首版导入整个源 Base 到全新目标，禁止覆盖现有 Base。用户须暂停 Airtable 写入；分页 API 不提供跨请求快照，不宣称一致性快照迁移。
- 支持 text 类（singleLineText,multilineText,richText,email,url,phoneNumber）、number/currency/percent/duration/rating、checkbox、date/dateTime、singleSelect/multipleSelects、multipleAttachments、multipleRecordLinks。所有非空值按类型校验，不可静默丢失。
- formula/rollup/multipleLookupValues/count/autoNumber/createdTime/lastModifiedTime 仅导入文本静态值，字段名追加 `[snapshot]` 并逐字段报告；保留原始 JSON 的文本表示，不创建表达式。其余类型跳过，必须在预检及结果中列明且明确确认。Airtable 自动化、Interface、视图配置、权限、评论、历史不迁移。
- 每表增加 `Airtable record ID` 来源列（与同名原字段冲突时追加来源字段 ID）。映射后的字段 options 保存 source Base/table/field IDs，结果报告有源表→目标表映射。关联在所有目标记录 ID 确定后第二阶段写入；缺失/跨表关联失败而不是留下悬空引用。选择值按名称映射成目标选项 ID。

## 资源与网络约束

单租户自托管；Node >=22 / pnpm10.32.1 / PG16；不添加运行时依赖、后台任务队列或多租户系统。只支持当前 local storage adapter。

每次最多20张表、每表100个源字段、总10000条记录、总100000个非空单元格（含来源列）、16MiB JSON记录数据、200个唯一附件、每附件10MiB、附件总64MiB；全部是硬上限，超限明确失败。单实例进程一次导入，预检同样占用网络并发槽。整个导入120秒deadline，每网络请求30秒且不得超过剩余期限；所有等待、下载、循环可取消。每个 API 请求间隔至少250ms；遇429最多重试1次且等待30秒，5xx最多2次指数退避；重复offset、重复record ID、畸形schema/数据均失败。

API固定 HTTPS `api.airtable.com`，使用schema及records公开API、记录pageSize100、字段ID键；不能配置任意API URL。附件仅允许HTTPS、端口443、无userinfo，域名必须为 `airtableusercontent.com` 或其严格子域；无重定向自动跟随（重定向明确失败），禁止IP literal。DNS解析拒绝任意非公共IPv4/IPv6结果，实际连接固定到已验证地址并保留TLS主机校验，防止DNS重绑定。附件请求不携带PAT；响应流增量检查字节上限及timeout，不信任Content-Length。日志/错误只输出安全类别，不输出URL/PAT/上游body。

## 原子性、凭据与重试

使用新表 `airtable_import_receipt` 记录完成回执（id UUID由客户端生成、userId、sourceBaseId、baseId FK、report JSON、createdAt），不存PAT、附件URL、源行内容或运行中任务。用户相同requestId再次执行先查回执，返回既有结果；他人requestId返回拒绝，不能获知数据。回执和新Base/成员/表/字段/记录/单元格/附件元数据在同一事务提交。删除Base级联删除回执；重跑同requestId可重新创建已删除Base，UI说明这是重新导入而不是同步。

先完整下载并验证数据，再写目标。使用事务级 advisory lock（由requestId派生）防跨进程同requestId并发；检查回执后写入。所有记录先插入，再写关联单元格。使用250行/单元格批次；事务内statement_timeout30s，取消在批次和提交前检查。只读预检/网络下载不持有DB事务。

文件不受DB事务保护：每次尝试随机storage keys，put之前写权限0700目录下的0600私有journal，记录requestId与文件keys（不含凭据、URL）。普通失败/取消回滚并删除本次已写文件，删除失败保留journal并返回明确待清理提示；提交不确定时先查回执，无法确认则保留文件和journal，不能删已提交附件。成功删除journal。进程硬退出可能留下journal和文件：提供受控恢复清理函数/管理员命令，获取同一advisory lock后检查回执，已完成只删除journal，未完成清除journal记录的合法keys；只扫描专用journal目录，不能按全uploads目录推测孤儿。恢复清理不作为公开接口，不自动删除其它上传文件。

运行中只有短期进程Map保存requestId,userId,AbortController,phase/count（无token/schema），受保护的status/cancel只能查询/取消本用户请求；重启后status从完成回执恢复，否则not-running。取消按钮发独立取消mutation；取消是协作式，提交完成则返回成功结果，不声称撤销已提交导入。浏览器请求断开不承诺自动取消，120秒deadline仍有效。

## 页面与验收

页面显示连接/预检/运行/结果四阶段；预检显示转换及跳过项，确认checkbox后方可开始。运行显示真实阶段和计数，取消可用；失败可用同requestId重试（重新输入PAT），结果链接新Base并下载无敏感信息JSON报告。仅requestId可放sessionStorage用于刷新后status恢复，不缓存凭据。数据不完整时不出现成功目标链接。

必测：分页>100、空值/false、选择映射、跨表关联、附件字节、未知字段报告、schema变更、429和重试预算、URL绕过/私网IPv4IPv6/redirect/下载超限、取消、重复调用、无权限receipt/status/cancel、DB失败文件清理、提交不确定、硬退出journal恢复。真实PG验证完整两表关联+附件元数据+重复调用只一个Base；普通单测不依赖DATABASE_URL。浏览器验收使用依赖注入的本地可控fixture，不启用生产任意URL开关；真实Airtable PAT未提供时必须明确标为未验证，不能声称真实迁移成功。

## API依据

- https://support.airtable.com/articles/6292134965-getting-started-with-airtable-s-web-api （100行分页、offset、5请求/秒、空值省略、schema scope）
- https://support.airtable.com/articles/9671148410-airtable-attachment-url-behavior （下载域名、临时URL必须复制字节）
- https://airtable.com/developers/web/api/get-base-schema
- https://airtable.com/developers/web/api/list-records

官方开发文档当前返回客户端应用壳，以上可读取support文档确认的约束作为依据；字段契约以典型API fixtures验证并记录需要真实PAT最终确认的限制。
