import { useState, useCallback, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDispatch, useSelector } from 'react-redux'
import { login as loginAction, logout as logoutAction } from '../store/authSlice'
import type { RootState, AppDispatch } from '../store'
import axios from 'axios'
import ConfirmDialog from './ConfirmDialog'
import { useToast } from '../context/ToastContext'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function ProfileOverlay({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const dispatch = useDispatch<AppDispatch>()
  const { user, token } = useSelector((state: RootState) => state.auth)
  const { success, error } = useToast()
  
  const [profileName, setProfileName] = useState('')
  const [profileEmail, setProfileEmail] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)

  useEffect(() => {
    if (user) {
      setProfileName(user.name || '')
      setProfileEmail(user.email || '')
    }
  }, [user])

  const hasChanges = useMemo(() => {
    if (!user) return false
    return profileName !== (user.name || '') || profileEmail !== (user.email || '')
  }, [user, profileName, profileEmail])

  const saveProfile = useCallback(async () => {
    if (!token) return
    
    setIsSavingProfile(true)
    try {
      const response = await axios.put(`${API_URL}/auth/profile`, {
        name: profileName,
        email: profileEmail,
      }, {
        params: { token }
      })

      const updatedUser = response.data
      dispatch(loginAction({ user: updatedUser, token }))
      success('Profile Updated', 'Your profile has been saved successfully')
    } catch (err) {
      console.error('Failed to save profile:', err)
      error('Update Failed', 'Could not save your profile. Please try again.')
    } finally {
      setIsSavingProfile(false)
    }
  }, [token, profileName, profileEmail, dispatch])

  const handleLogout = useCallback(() => {
    setShowLogoutDialog(true)
  }, [])

  const confirmLogout = useCallback(() => {
    dispatch(logoutAction())
    setShowLogoutDialog(false)
    onClose()
  }, [dispatch, onClose])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="profile-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="fixed inset-0 bg-glass-heavy glass-blur-heavy z-[9999] flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 20 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-[600px] border border-white/10 rounded-[32px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
        >
        
        {/* Header */}
        <header className="px-10 pt-8 pb-6 flex justify-between items-center border-b border-white/5">
          <div className="flex flex-col items-start">
            <h2 className="text-3xl font-extralight text-white tracking-tight">Profile Settings</h2>
            <p className="text-sm text-green-200/50 mt-1 font-light">Edit your account</p>
          </div>
          <button 
            className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white flex items-center justify-center cursor-pointer"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <main className="flex-1 overflow-y-auto px-10 py-8 custom-scrollbar">
          <div className="p-8 bg-white/[0.02] border border-white/5 rounded-[20px]">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 mb-6">Personal Details</h3>
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase tracking-wider text-green-200/50">Name (Optional)</label>
                <input 
                  type="text" 
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3 text-white text-lg font-light focus:outline-none focus:border-accent placeholder:text-white/10"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="name"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase tracking-wider text-green-200/50">Email (Optional)</label>
                <input 
                  type="email" 
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3 text-white text-lg font-light focus:outline-none focus:border-accent placeholder:text-white/10"
                  value={profileEmail}
                  onChange={(e) => setProfileEmail(e.target.value)}
                  placeholder="email@example.com"
                />
              </div>
            </div>
          </div>
        </main>

        {/* Footer Actions */}
        <footer className="px-10 py-6 border-t border-white/5 flex items-center justify-between">
          <button 
            className="h-14 rounded-full bg-glass glass-blur border border-red-500/30 text-red-400 hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/50 font-medium px-8 cursor-pointer"
            onClick={handleLogout}
          >
            Logout
          </button>
          <button 
            className="h-14 rounded-full bg-glass glass-blur border border-white/20 text-white font-medium hover:bg-accent hover:text-primary px-8 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={saveProfile} 
            disabled={isSavingProfile || !hasChanges}
          >
            {isSavingProfile ? 'Saving...' : 'Save Profile'}
          </button>
        </footer>
      </motion.div>

      <ConfirmDialog
        isOpen={showLogoutDialog}
        title="Logout Session"
        message="Are you sure you want to logout? You'll need to login again to use the app."
        confirmText="Logout"
        cancelText="Cancel"
        confirmVariant="danger"
        onConfirm={confirmLogout}
        onCancel={() => setShowLogoutDialog(false)}
      />
      </motion.div>
      )}
    </AnimatePresence>
  )
}

export default ProfileOverlay
