import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

/** All four pages (dev/prod × manager/cluster-head) default to the config UI
 * being available, so a bare /dev/manager lands on /dev/manager?config=true.
 * An explicit ?config=<anything> is left untouched, so ?config=false still
 * hides it. */
export default function ConfigDefault({ children }: { children: ReactNode }) {
  const location = useLocation()
  const params = new URLSearchParams(location.search)

  if (!params.has('config')) {
    params.set('config', 'true')
    return <Navigate to={`${location.pathname}?${params.toString()}${location.hash}`} replace />
  }

  return <>{children}</>
}
