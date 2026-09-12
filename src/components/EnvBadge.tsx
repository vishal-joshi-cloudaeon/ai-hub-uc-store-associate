import { useEnv } from '../hooks/useEnv'

export default function EnvBadge() {
  const { config } = useEnv()

  return (
    <span
      className={`inline-flex items-center rounded-badge border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${config.badgeClassName}`}
    >
      {config.label}
    </span>
  )
}
