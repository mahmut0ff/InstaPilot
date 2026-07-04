import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import '@fontsource-variable/inter'
import { AuthProvider } from './context/AuthContext'
import { AccountProvider } from './context/AccountContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Accounts from './pages/Accounts'
import Posts from './pages/Posts'
import Settings from './pages/Settings'
import Interactions from './pages/Interactions'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AccountProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/posts" element={<Posts />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/interactions" element={<Interactions />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AccountProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
