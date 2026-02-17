import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppProvider } from '@/context/AppContext'
import { AppLayout } from '@/components/AppLayout'
import { Dashboard } from '@/pages/Dashboard'
import { Investments } from '@/pages/Investments'
import { Expenses } from '@/pages/Expenses'
import { History } from '@/pages/History'
import { Goals } from '@/pages/Goals'
import { More } from '@/pages/More'

function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/investments" element={<Investments />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/history" element={<History />} />
        <Route path="/goals" element={<Goals />} />
        <Route path="/more" element={<More />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <AppRoutes />
      </AppProvider>
    </BrowserRouter>
  )
}
