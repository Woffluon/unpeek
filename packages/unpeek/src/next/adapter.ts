import { createUnpeekNextAdapter, type NextAdapterContext } from './index.js';

const options = typeof globalThis !== 'undefined' ? (globalThis as any).__unpeekNextOptions : undefined;
const adapter = createUnpeekNextAdapter(options);

export default adapter;

export const name = adapter.name;

export async function modifyConfig(config: any, context?: any) {
  if (typeof adapter.modifyConfig === 'function') {
    return adapter.modifyConfig(config, context);
  }
  return config;
}

export async function onBuildComplete(context: NextAdapterContext) {
  return adapter.onBuildComplete(context);
}
