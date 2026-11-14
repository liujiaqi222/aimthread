# 备份格式是单个 SQLite 文件

用户导出的 Backup（备份）是一个独立的 SQLite 数据库文件（扩展名 `.aimthread`），由 `VACUUM INTO` 生成，不是 zip 包，也不是 JSON。文件以固定的 `PRAGMA application_id` 标识自己是 AimThread 数据，以 `PRAGMA user_version` 标识 schema 版本，另有一张 `backup_meta` 表记录应用版本、导出时间、包含的数据类别和条目计数。`VACUUM INTO` 不依赖具体驱动，在 WAL 模式下也能得到一致快照（满足 PRD §10.2），恢复时只需以只读方式打开候选文件，依次检查 `application_id`、`user_version`（不得高于当前版本，较旧的恢复后走迁移）、`quick_check`，再读 `backup_meta` 向用户说明内容。

用户手里的旧备份会长期存在，以后改格式必须兼容旧文件，所以记录在此。

决定来源：[SQLite 驱动、schema 演进与备份恢复](https://github.com/liujiaqi222/aimthread/issues/53)。

## Considered Options

- **zip（数据库 + `manifest.json`）**：不打开 SQLite 也能读清单，但多一个依赖、多一层格式，恢复时仍要解出数据库再校验，收益不抵成本。
- **JSON 导出**：可读、跨工具，但要为每张表写序列化与反序列化，schema 每变一次都要同步维护，且恢复时要重建整个库。

## Consequences

- 备份天然不含 Key：Key 密文存于数据目录下的独立文件，从不进入 SQLite。
- 资料按原路径引用、不复制进应用数据（PRD §4.9），所以单文件足以覆盖备份范围；恢复到另一台机器后，原路径读不到的资料如实显示不可读。
- 备份与数据文件一样不加密，导出界面须说明其敏感性。
