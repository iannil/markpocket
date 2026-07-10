'use client';

import csvClient from '@markpocket/plugin-csv/client';
import { registerSlot } from '@/lib/plugins/ui-slot-client';

// csv 的 UI 经 slot 挂载；trpc 交互（导出下载 / 导入）在 app 侧封装后由 ctx 注入。
registerSlot(csvClient.slotId, csvClient.Component);
