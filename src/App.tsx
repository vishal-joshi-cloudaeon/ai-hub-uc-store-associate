import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ManagerChat from './pages/ManagerChat'
import ClusterHead from './pages/ClusterHead'
import EnvGuard from './components/EnvGuard'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dev/manager" replace />} />
        <Route
          path="/:env/manager"
          element={
            <EnvGuard>
              <ManagerChat />
            </EnvGuard>
          }
        />
        <Route
          path="/:env/cluster-head"
          element={
            <EnvGuard>
              <ClusterHead />
            </EnvGuard>
          }
        />
        <Route path="*" element={<Navigate to="/dev/manager" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
