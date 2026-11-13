import {
  createUnpeekNextAdapter,
  type NextAdapterContext,
  type NextConfigObject,
  type UnpeekNextAdapter,
} from './index.js';
import { readUnpeekNextOptionsFromEnv } from '../../internal/next.js';

let cachedAdapter: UnpeekNextAdapter | undefined;

function getAdapter(): UnpeekNextAdapter {
  if (!cachedAdapter) {
    cachedAdapter = createUnpeekNextAdapter(readUnpeekNextOptionsFromEnv());
  }
  return cachedAdapter;
}

export const name = 'unpeek';

export async function modifyConfig(
  config: NextConfigObject,
  context?: Record<string, unknown>
): Promise<NextConfigObject> {
  const adapter = getAdapter();
  if (typeof adapter.modifyConfig === 'function') {
    return adapter.modifyConfig(config, context);
  }
  return config;
}

export async function onBuildComplete(context: NextAdapterContext) {
  return getAdapter().onBuildComplete(context);
}

const adapter: UnpeekNextAdapter = {
  name,
  modifyConfig,
  onBuildComplete,
};

export default adapter;
