import { useParams, Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'

const VALID_ENVS = ['dev', 'prod']

export default function EnvGuard({ children }: { children: ReactNode }) {
  const { env } = useParams<{ env: string }>()

  if (!env || !VALID_ENVS.includes(env)) {
    return <Navigate to="/dev/manager?config=true" replace />
  }

  return <>{children}</>
}
