import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'

interface User {
  id: string
  device_id: string
  device_name: string
  name?: string
  email?: string
  ai_providers?: Record<string, { provider: string; model: string; has_key: boolean }>
  profile_completed: boolean
  created_at: string
  last_login: string
}

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
}

// Load initial state from localStorage
const loadAuthState = (): AuthState => {
  const token = localStorage.getItem('token')
  const user = localStorage.getItem('user')
  
  if (token && user) {
    return {
      token,
      user: JSON.parse(user),
      isAuthenticated: true
    }
  }
  
  return {
    user: null,
    token: null,
    isAuthenticated: false
  }
}

const initialState: AuthState = loadAuthState()

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    login: (state, action: PayloadAction<{ user: User; token: string }>) => {
      state.user = action.payload.user
      state.token = action.payload.token
      state.isAuthenticated = true
      
      // Persist to localStorage
      localStorage.setItem('token', action.payload.token)
      localStorage.setItem('user', JSON.stringify(action.payload.user))
    },
    logout: (state) => {
      state.user = null
      state.token = null
      state.isAuthenticated = false
      
      // Clear localStorage
      localStorage.removeItem('token')
      localStorage.removeItem('user')
    },
    updateProfile: (state, action: PayloadAction<{ name: string; email: string }>) => {
      if (state.user) {
        state.user.name = action.payload.name
        state.user.email = action.payload.email
        
        // Update localStorage
        localStorage.setItem('user', JSON.stringify(state.user))
      }
    }
  }
})

export const { login, logout, updateProfile } = authSlice.actions
export default authSlice.reducer
