import { loadPlugins } from './loader';
import { plugins } from '@/plugins.config';

// 进程首次 import 本模块时同步跑一次加载器 —— 所有注册表消费者都经此 barrel，
// 故读注册表前必已填充。等价于旧 storage barrel 的副作用 import 纪律，但集中化。
loadPlugins(plugins);

export { getStorage } from './storage';
export * from './registry';
