import { useParams } from 'react-router-dom'
import { getEnvConfig, type EnvConfig, type EnvName } from '../config/environments'

/** Use this in every page/component instead of calling useParams directly —
 * it always resolves to a valid EnvName ('dev' if the URL param is missing
 * or invalid), so callers never have to null-check. */
export function useEnv(): { env: EnvName; config: EnvConfig } {
  const { env } = useParams<{ env: string }>()
  const safeEnv: EnvName = env === 'prod' ? 'prod' : 'dev'
  return { env: safeEnv, config: getEnvConfig(safeEnv) }
}
