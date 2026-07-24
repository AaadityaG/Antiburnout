import { configureStore } from '@reduxjs/toolkit'
import authReducer from './authSlice'
import settingsReducer from './settingsSlice'
import chatReducer from './chatSlice'
import tipReducer from './tipSlice'
import activityReducer from './activitySlice'
import kbReducer from './kbSlice'

export const store = configureStore({
  reducer: {
    auth: authReducer,
    settings: settingsReducer,
    chat: chatReducer,
    tips: tipReducer,
    activity: activityReducer,
    kb: kbReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false
    })
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
