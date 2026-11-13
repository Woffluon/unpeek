import {
  createUnpeekNextAdapter,
  readUnpeekNextOptionsFromEnv,
  type NextAdapterContext,
  type NextConfigObject,
} from './index.js';

const options = readUnpeekNextOptionsFromEnv();
const adapter = createUnpeekNextAdapter(options);

export default adapter;

export const name = adapter.name;

export async function modifyConfig(
  config: NextConfigObject,
  context?: Record<string, unknown>
): Promise<NextConfigObject> {
  if (typeof adapter.modifyConfig === 'function') {
    return adapter.modifyConfig(config, context);
  }
  return config;
}

export async function onBuildComplete(context: NextAdapterContext) {
  return adapter.onBuildComplete(context);
}
