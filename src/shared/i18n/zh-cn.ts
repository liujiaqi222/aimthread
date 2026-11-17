/**
 * 简体中文文案。`satisfies Messages` 保证与 en 键位完全对齐（#62）。
 */
import type { Messages } from './en'
import type { ErrorParams } from '../protocol/errors'

export const zhCN = {
  locale: 'zh-CN' as const,
  repair: {
    title: () => 'AimThread 无法启动',
    dataDirLabel: () => '数据目录',
    reasons: {
      'db.cannotOpen': (p: ErrorParams) => `无法打开数据库（${p.detail ?? '未知错误'}）。`,
      'db.directoryNotWritable': () => '数据目录不可写。请检查目录权限后重试。',
      'db.corrupt': () => '数据库似乎已损坏（完整性检查未通过）。数据保持原样，未被修改。',
      'db.tooNew': (p: ErrorParams) =>
        `这份数据来自更新版本的 AimThread（数据结构版本 ${p.found}，当前应用支持 ${p.supported}）。数据未被修改。`,
      'db.notAimThread': () => '数据目录中的文件不是 AimThread 数据库。数据未被修改。',
      'db.snapshotFailed': (p: ErrorParams) =>
        `升级前无法创建安全快照（${p.detail ?? '未知错误'}）。数据未被修改。`,
      'db.migrationFailed': (p: ErrorParams) =>
        `数据库升级失败（${p.detail ?? '未知错误'}）。数据库保持原样；数据目录中留有升级前的快照。`,
      'app.lockFailed': () => '另一个 AimThread 实例正在使用这个数据目录。同一时间只能有一个实例使用。',
      'app.serviceTimeout': () => '后台服务未能在规定时间内启动。',
      'app.serviceCrashed': () => '后台服务反复崩溃，已停止自动重启。你的数据安全地保存在磁盘上。'
    },
    actions: {
      retry: () => '重试',
      openDataDir: () => '打开数据目录',
      quit: () => '退出'
    }
  }
} satisfies Messages
