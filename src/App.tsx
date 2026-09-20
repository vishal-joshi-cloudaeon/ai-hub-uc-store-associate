import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ManagerChat from './pages/ManagerChat'
import ClusterHead from './pages/ClusterHead'
import ConfigDefault from './components/ConfigDefault'
import EnvGuard from './components/EnvGuard'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dev/manager?config=true" replace />} />
        <Route
          path="/:env/manager"
          element={
            <EnvGuard>
              <ConfigDefault>
                <ManagerChat />
              </ConfigDefault>
            </EnvGuard>
          }
        />
        <Route
          path="/:env/cluster-head"
          element={
            <EnvGuard>
              <ConfigDefault>
                <ClusterHead />
              </ConfigDefault>
            </EnvGuard>
          }
        />
        <Route path="*" element={<Navigate to="/dev/manager?config=true" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
