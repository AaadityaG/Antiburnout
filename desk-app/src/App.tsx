import { useState, useCallback, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useSelector, useDispatch } from 'react-redux'
import { fetchSettings, updateSettings, clearSettings } from './store/settingsSlice'
import { fetchTipRecommendation, clearTip } from './store/tipSlice'
import { saveSession } from './store/activitySlice'
import type { RootState, AppDispatch } from './store'
import ProfileOverlay from './components/ProfileOverlay'
import LoginModal from './components/LoginModal'
import SettingsOverlay from './components/SettingsOverlay'
import InsightsOverlay from './components/InsightsOverlay'
import BreakView from './components/BreakView'
import ChatOverlay from './components/ChatOverlay'
import MusicOverlay from './components/MusicOverlay'
import HoverLabel from './components/HoverLabel'
import GestureController from './components/GestureController'

const API_URL = import.meta.env.VITE_API_URL

const AMBIENT_MOODS = new Set(['stressed', 'anxious', 'tired', 'sad', 'sleep', 'meditate'])

interface Video {
  video_id: string
  title: string
  channel: string
  thumbnail: string
}

declare global {
  interface Window {
    YT: any
    onYouTubeIframeAPIReady: () => void
  }
}

function App() {
  const dispatch = useDispatch<AppDispatch>()
  const { isAuthenticated, token } = useSelector((state: RootState) => state.auth)
  const settings = useSelector((state: RootState) => state.settings)

  const [timeRemaining, setTimeRemaining] = useState(1800 * 1000)
  const [isPaused, setIsPaused] = useState(false)
  const [isBreakActive, setIsBreakActive] = useState(false)
  const [breakTimeLeft, setBreakTimeLeft] = useState(90)
  const [isBreakPaused, setIsBreakPaused] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isInsightsOpen, setIsInsightsOpen] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [isMusicOpen, setIsMusicOpen] = useState(false)
  const [ambientStage, setAmbientStage] = useState<'off' | 'bg'>('off')

  const [currentTrack, setCurrentTrack] = useState<Video | null>(null)
  const [isMusicPlaying, setIsMusicPlaying] = useState(false)
  const [isMusicMuted, setIsMusicMuted] = useState(false)
  const [playlist, setPlaylist] = useState<Video[]>([])
  const [playlistIndex, setPlaylistIndex] = useState(-1)
  const [playerTime, setPlayerTime] = useState({ current: 0, duration: 0 })
  const [qualityLevels, setQualityLevels] = useState<{ label: string; index: number }[]>([])
  const [currentQuality, setCurrentQuality] = useState<string>('auto')
  const [showQualityPicker, setShowQualityPicker] = useState(false)
  const [cursorVisible, setCursorVisible] = useState(true)
  const [musicHover, setMusicHover] = useState(false)

  const ytPlayerRef = useRef<any>(null)
  const ytReadyRef = useRef(false)
  const ytContainerRef = useRef<HTMLDivElement>(null)
  const playlistRef = useRef<Video[]>([])
  const playlistIndexRef = useRef(-1)

  // Keep refs in sync with state for use in YouTube callbacks
  useEffect(() => { playlistRef.current = playlist }, [playlist])
  useEffect(() => { playlistIndexRef.current = playlistIndex }, [playlistIndex])

  // Auto-hide UI after 3s inactivity in ambient mode
  useEffect(() => {
    if (ambientStage !== 'bg') { setCursorVisible(true); return }
    let timer: ReturnType<typeof setTimeout>
    const onMove = () => { setCursorVisible(true); clearTimeout(timer); timer = setTimeout(() => setCursorVisible(false), 3000) }
    window.addEventListener('mousemove', onMove)
    timer = setTimeout(() => setCursorVisible(false), 3000)
    return () => { window.removeEventListener('mousemove', onMove); clearTimeout(timer) }
  }, [ambientStage])

  // Load YouTube IFrame API once
  useEffect(() => {
    if (window.YT && window.YT.Player) {
      ytReadyRef.current = true
      return
    }
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
    window.onYouTubeIframeAPIReady = () => {
      ytReadyRef.current = true
    }
  }, [])

  // Quality level helpers
  const refreshQualityLevels = useCallback(() => {
    try {
      const p = ytPlayerRef.current
      if (!p || !p.getAvailableQualityLevels) return
      const levels: { label: string; index: number }[] = p.getAvailableQualityLevels()
      setQualityLevels(levels)
      const current = p.getPlaybackQuality()
      setCurrentQuality(current || 'auto')
    } catch {}
  }, [])

  const handleSetQuality = useCallback((label: string) => {
    try {
      const p = ytPlayerRef.current
      if (!p) return
      p.setPlaybackQuality(label)
      setCurrentQuality(label)
      setShowQualityPicker(false)
    } catch {}
  }, [])

  // Close quality picker on outside click
  useEffect(() => {
    if (!showQualityPicker) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-quality-picker]')) setShowQualityPicker(false)
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [showQualityPicker])

  // Create or load video into the persistent player
  const loadVideo = useCallback((videoId: string) => {
    if (!ytContainerRef.current) return

    if (ytPlayerRef.current && ytPlayerRef.current.loadVideoById) {
      ytPlayerRef.current.loadVideoById(videoId)
      try { ytPlayerRef.current.setPlaybackQuality('highres') } catch {}
      return
    }

    const tryCreate = () => {
      if (!window.YT || !window.YT.Player || !ytContainerRef.current) {
        setTimeout(tryCreate, 200)
        return
      }
      ytPlayerRef.current = new window.YT.Player('yt-mini-container', {
        videoId,
        playerVars: {
          autoplay: 1,
          loop: 1,
          playlist: videoId,
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          rel: 0,
          cc_load_policy: 0,
          iv_load_policy: 3,
        },
        events: {
          onReady: () => {
            try {
              const p = ytPlayerRef.current
              p.setPlaybackQuality('highres')
              p.setOption('captions', 'track', {})
              refreshQualityLevels()
            } catch {}
            setIsMusicPlaying(true)
          },
          onStateChange: (e: any) => {
            if (e.data === window.YT.PlayerState.PLAYING) {
              setIsMusicPlaying(true)
              refreshQualityLevels()
            }
            if (e.data === window.YT.PlayerState.PAUSED) setIsMusicPlaying(false)
            if (e.data === window.YT.PlayerState.ENDED) {
              const pl = playlistRef.current
              const idx = playlistIndexRef.current
              if (pl.length > 0) {
                const next = (idx + 1) % pl.length
                const track = pl[next]
                setCurrentTrack(track)
                setPlaylistIndex(next)
                if (ytPlayerRef.current && ytPlayerRef.current.loadVideoById) {
                  ytPlayerRef.current.loadVideoById(track.video_id)
                  try { ytPlayerRef.current.setPlaybackQuality('highres') } catch {}
                }
              }
            }
          },
        },
      })
    }
    tryCreate()
  }, [])

  // Poll player time
  useEffect(() => {
    if (!isMusicPlaying || !ytPlayerRef.current) return
    const interval = setInterval(() => {
      try {
        const p = ytPlayerRef.current
        if (p && p.getCurrentTime && p.getDuration) {
          setPlayerTime({ current: p.getCurrentTime(), duration: p.getDuration() })
        }
      } catch {}
    }, 500)
    return () => clearInterval(interval)
  }, [isMusicPlaying])

  const handleSeek = useCallback((seconds: number) => {
    if (!ytPlayerRef.current) return
    ytPlayerRef.current.seekTo(seconds, true)
    setPlayerTime(prev => ({ ...prev, current: seconds }))
  }, [])

  const handlePlayTrack = useCallback((track: Video, trackList?: Video[], index?: number, mood?: string) => {
    setCurrentTrack(track)
    loadVideo(track.video_id)
    if (trackList && index !== undefined) {
      setPlaylist(trackList)
      setPlaylistIndex(index)
    }
    if (!isMusicOpen) setIsMusicOpen(true)
  }, [isMusicOpen, loadVideo, ambientStage])

  const handleToggleMusicPlay = useCallback(() => {
    if (!ytPlayerRef.current) return
    if (isMusicPlaying) {
      ytPlayerRef.current.pauseVideo()
    } else {
      ytPlayerRef.current.playVideo()
    }
  }, [isMusicPlaying])

  const handleToggleMute = useCallback(() => {
    if (!ytPlayerRef.current) return
    if (isMusicMuted) {
      ytPlayerRef.current.unMute()
    } else {
      ytPlayerRef.current.mute()
    }
    setIsMusicMuted(!isMusicMuted)
  }, [isMusicMuted])

  const handleNextTrack = useCallback(() => {
    if (playlist.length === 0) return
    const next = (playlistIndex + 1) % playlist.length
    const track = playlist[next]
    setCurrentTrack(track)
    setPlaylistIndex(next)
    loadVideo(track.video_id)
  }, [playlist, playlistIndex, loadVideo])

  const handlePrevTrack = useCallback(() => {
    if (playlist.length === 0) return
    const prev = playlistIndex <= 0 ? playlist.length - 1 : playlistIndex - 1
    const track = playlist[prev]
    setCurrentTrack(track)
    setPlaylistIndex(prev)
    loadVideo(track.video_id)
  }, [playlist, playlistIndex, loadVideo])

  const handleStopMusic = useCallback(() => {
    if (ytPlayerRef.current && ytPlayerRef.current.stopVideo) {
      ytPlayerRef.current.stopVideo()
    }
    setCurrentTrack(null)
    setIsMusicPlaying(false)
    setAmbientStage('off')
    setPlaylist([])
    setPlaylistIndex(-1)
  }, [])

  const handlePlayMusic = useCallback(async (mood: string, query?: string) => {
    try {
      let url: string
      if (query) {
        url = `${API_URL}/music/search?q=${encodeURIComponent(query)}&max_results=1`
      } else {
        const endpoint = AMBIENT_MOODS.has(mood) ? 'ambient' : 'mood'
        url = `${API_URL}/music/${endpoint}/${mood}?max_results=1`
      }
      const res = await fetch(url)
      const data = await res.json()
      if (data.videos && data.videos.length > 0) {
        const track = data.videos[0]
        setCurrentTrack(track)
        loadVideo(track.video_id)
      }
    } catch (err) {
      console.error('Failed to fetch music for mood:', err)
    }
  }, [loadVideo])

  const handleCloseMusicOverlay = useCallback(() => {
    setIsMusicOpen(false)
  }, [])

  // Fetch user settings when authenticated
  useEffect(() => {
    if (isAuthenticated && token) {
      dispatch(fetchSettings(token))
    }
  }, [isAuthenticated, token, dispatch])

  // Handle logout
  useEffect(() => {
    if (!isAuthenticated) {
      dispatch(clearSettings())
      dispatch(clearTip())
      setTimeRemaining(1800 * 1000)
      setBreakTimeLeft(90)
      setIsPaused(false)
      setIsBreakActive(false)
      setIsBreakPaused(false)
      hasInitializedTimer.current = false
      window.electronAPI?.sendResetTimer()
    }
  }, [isAuthenticated, dispatch])

  const hasInitializedTimer = useRef(false)

  useEffect(() => {
    if (isAuthenticated && token && !hasInitializedTimer.current && settings.fetched && settings.breakInterval > 0) {
      setTimeRemaining(settings.breakInterval * 1000)
      setBreakTimeLeft(settings.breakDuration)
      hasInitializedTimer.current = true

      window.electronAPI?.sendUpdateTimerSetting({
        interval: settings.breakInterval,
        duration: settings.breakDuration,
        autoStart: settings.autoStart,
        enableSound: settings.enableSound
      })
    }
  }, [isAuthenticated, token, settings.breakInterval, settings.breakDuration, settings.autoStart, settings.fetched])

  const handleApplySettings = useCallback((interval: number, duration: number, soundEnabled: boolean) => {
    window.electronAPI?.sendUpdateTimerSetting({
      interval, duration, autoStart: true, enableSound: soundEnabled
    })
    if (token) {
      dispatch(updateSettings({
        token, settings: {
          break_interval: interval, break_duration: duration, auto_start: true, enable_sound: soundEnabled
        }
      }))
    }
  }, [token, dispatch])

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000))
    const h = Math.floor(totalSeconds / 3600)
    const m = Math.floor((totalSeconds % 3600) / 60)
    const s = totalSeconds % 60
    if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const formatSeconds = (s: number): string => {
    if (!s || !isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const sessionCompletedRef = useRef(false)
  const sessionStartTimeRef = useRef<number>(0)

  useEffect(() => {
    if (!window.electronAPI) return
    const cleanupTimerUpdate = window.electronAPI.onTimerUpdate((time) => setTimeRemaining(time))
    const cleanupTimerReset = window.electronAPI.onTimerReset(() => {
      const elapsed = Math.floor((Date.now() - sessionStartTimeRef.current) / 1000)
      if (!sessionCompletedRef.current && token && elapsed > 10) {
        dispatch(saveSession({
          token, sessionDuration: elapsed, targetDuration: settings.breakInterval, completed: false, skipped: true
        }))
      }
      sessionCompletedRef.current = false
      setTimeRemaining(settings.breakInterval * 1000)
      setIsPaused(false)
    })
    const cleanupBreakTime = window.electronAPI.onBreakTime((data) => {
      sessionCompletedRef.current = true
      sessionStartTimeRef.current = Date.now()
      if (data.duration) setBreakTimeLeft(data.duration)
      setIsBreakActive(true)
      setIsBreakPaused(false)
    })
    const cleanupSettingsUpdated = window.electronAPI.onSettingsUpdated((data) => {
      setTimeRemaining(data.interval * 1000)
    })
    return () => { cleanupTimerUpdate(); cleanupTimerReset(); cleanupBreakTime(); cleanupSettingsUpdated() }
  }, [settings, token, dispatch])

  useEffect(() => {
    let interval: any = null
    if (isBreakActive && breakTimeLeft > 0 && !isBreakPaused) {
      interval = setInterval(() => {
        setBreakTimeLeft(prev => {
          if (prev <= 1) {
            setIsBreakActive(false)
            setIsBreakPaused(false)
            window.electronAPI?.sendTimerBreakComplete()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [isBreakActive, breakTimeLeft, isBreakPaused])

  const hasFetchedTip = useRef(false)
  useEffect(() => {
    if (!isBreakActive && timeRemaining > 0 && timeRemaining <= 5000 && token && !hasFetchedTip.current) {
      dispatch(fetchTipRecommendation(token))
      hasFetchedTip.current = true
    }
    if (isBreakActive === false && timeRemaining > 5000) hasFetchedTip.current = false
    if (!isBreakActive && timeRemaining === settings.breakInterval * 1000) dispatch(clearTip())
  }, [isBreakActive, timeRemaining, token, dispatch, settings.breakInterval])

  const togglePause = useCallback(() => {
    if (isPaused) window.electronAPI?.sendResumeTimer()
    else window.electronAPI?.sendPauseTimer()
    setIsPaused(!isPaused)
  }, [isPaused])

  const handleGesturePause = useCallback(() => {
    if (isPaused) return
    window.electronAPI?.sendPauseTimer()
    setIsPaused(true)
  }, [isPaused])

  const handleGestureResume = useCallback(() => {
    if (!isPaused) return
    window.electronAPI?.sendResumeTimer()
    setIsPaused(false)
  }, [isPaused])

  const resetTimer = useCallback(() => {
    window.electronAPI?.sendResetTimer()
    setIsPaused(false)
  }, [])

  const handleEndBreak = useCallback(() => {
    if (token) {
      const elapsedSeconds = Math.floor((settings.breakInterval * 1000 - timeRemaining) / 1000)
      dispatch(saveSession({
        token, sessionDuration: elapsedSeconds, targetDuration: settings.breakInterval, completed: true, skipped: false
      }))
    }
    setIsBreakActive(false)
    setIsBreakPaused(false)
    window.electronAPI?.sendResetTimer()
    window.electronAPI?.sendMinimizeToTray()
  }, [token, timeRemaining, settings.breakInterval, dispatch])

  const handlePauseBreak = useCallback(() => { setIsBreakPaused(true) }, [])
  const handleResumeBreak = useCallback(() => { setIsBreakPaused(false) }, [])

  const progress = ((settings.breakInterval * 1000 - timeRemaining) / (settings.breakInterval * 1000)) * 100
  const circumference = 2 * Math.PI * 270

  return (
    <div className="relative w-screen h-screen flex flex-col justify-center items-center text-center overflow-hidden font-sans">
      {/* Background - always shown, fades out to reveal video underneath */}
      <div
        className={`fixed inset-0 z-[-1] bg-cover bg-center bg-no-repeat transition-opacity duration-700 ${ambientStage !== 'off' ? 'opacity-0' : ''}`}
        style={{ backgroundImage: "url('nature_bg.png')", backgroundColor: "#0c140c" }}
      ></div>
      <div className={`fixed inset-0 bg-gradient-to-br from-black/40 via-transparent to-black/60 z-[0] transition-opacity duration-700 ${ambientStage === 'bg' ? 'opacity-0' : ''}`}></div>

      <div className="fixed top-0 left-0 right-0 h-20 drag-area z-50"></div>

      {/* Logo */}
        <div className={`fixed top-6 left-8 z-[100] drag-none select-none transition-opacity ${(ambientStage === 'bg' && !cursorVisible) ? 'duration-[8000ms] opacity-0 pointer-events-none' : 'duration-300 opacity-100'}`}>
          <span className="text-2xl font-semibold tracking-tight text-white/80">
            antiburnout<span className="text-emerald-400">.ai</span>
          </span>
        </div>

      <div className={`fixed top-8 right-8 flex gap-3 z-[100] drag-none transition-opacity ${(ambientStage === 'bg' && !cursorVisible) ? 'duration-[8000ms] opacity-0 pointer-events-none' : 'duration-300 opacity-100'}`}>
        {currentTrack && (
          <HoverLabel label={ambientStage === 'bg' ? 'Exit ambient' : 'Ambient'}>
            <button
              onClick={() => {
                if (ambientStage === 'bg') {
                  setAmbientStage('off')
                } else {
                  setAmbientStage('bg')
                }
              }}
              className={`w-10 h-10 rounded-xl border text-white flex items-center justify-center cursor-pointer ${
                ambientStage === 'bg'
                  ? 'bg-accent/20 border-accent/40 shadow-[0_0_20px_rgba(212,252,212,0.25)] animate-pulse-glow'
                  : 'bg-glass glass-blur border-white/10 hover:bg-accent/15 hover:border-accent/30 hover:shadow-[0_0_12px_rgba(212,252,212,0.15)]'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {ambientStage === 'bg' ? (
                  <><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></>
                ) : (
                  <><polygon points="5 3 19 12 5 21 5 3"/></>
                )}
              </svg>
            </button>
          </HoverLabel>
        )}
        <HoverLabel label="Minimize">
          <button onClick={() => window.electronAPI?.sendMinimizeToTray()} className="w-10 h-10 rounded-xl bg-glass glass-blur border border-white/10 text-white flex items-center justify-center hover:bg-white/20 cursor-pointer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/></svg>
          </button>
        </HoverLabel>
      </div>

      {/* Main UI */}
      <main className={`relative flex flex-col mt-24 items-center justify-center transition-opacity ${(ambientStage === 'bg' && !cursorVisible) || isBreakActive ? 'duration-[8000ms] opacity-0 pointer-events-none' : 'duration-300 opacity-100'}`}>
        <div className="relative mb-8 animate-breathe">
          <h1 className="font-mono text-[10rem] font-extralight leading-none tracking-tighter bg-gradient-to-b from-white to-accent bg-clip-text text-transparent drop-shadow-2xl">
            {formatTime(timeRemaining)}
          </h1>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[580px] h-[580px] z-[-1] -rotate-90">
            <svg viewBox="0 0 600 600" className="w-full h-full">
              <circle cx="300" cy="300" r="270" className="fill-none stroke-white/5 stroke-[4]" />
              <circle cx="300" cy="300" r="270"
                className="fill-none stroke-accent stroke-[4] transition-[stroke-dashoffset] duration-1000 ease-linear drop-shadow-[0_0_12px_var(--color-accent)]"
                strokeDasharray={circumference}
                strokeDashoffset={circumference - (progress / 100) * circumference}
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>

        <div className="flex items-center gap-3 p-6 bg-glass glass-blur border border-white/10 rounded-full text-xs font-bold uppercase tracking-[0.2em] text-accent">
          <span className={`w-2 h-2 rounded-full shadow-[0_0_8px] ${isPaused ? 'bg-yellow-400 shadow-yellow-400' : 'bg-green-400 shadow-green-400 animate-pulse'}`}></span>
          {isPaused ? 'Paused' : 'Next break in...'}
        </div>

        <div className="absolute -bottom-9/12 flex gap-4 items-center">
          <HoverLabel label="Reset">
            <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} onClick={resetTimer} className="w-14 h-14 rounded-full bg-glass glass-blur border border-white/20 text-white flex items-center justify-center hover:bg-accent hover:text-primary hover:border-accent/40 transition-colors cursor-pointer">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            </motion.button>
          </HoverLabel>
          <HoverLabel label={isPaused ? 'Resume' : 'Pause'}>
            <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} onClick={togglePause} className="w-14 h-14 rounded-full bg-glass glass-blur border border-white/20 text-white flex items-center justify-center hover:bg-accent hover:text-primary hover:border-accent/40 transition-colors cursor-pointer">
              {isPaused ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
              )}
            </motion.button>
          </HoverLabel>
          <HoverLabel label="Settings">
            <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} onClick={() => setIsSettingsOpen(true)} className="w-14 h-14 rounded-full bg-glass glass-blur border border-white/20 text-white flex items-center justify-center hover:bg-accent hover:text-primary hover:border-accent/40 transition-colors cursor-pointer">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </motion.button>
          </HoverLabel>
          <HoverLabel label="Profile">
            <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} onClick={() => setIsProfileOpen(true)} className="w-14 h-14 rounded-full bg-glass glass-blur border border-white/20 text-white flex items-center justify-center hover:bg-accent hover:text-primary hover:border-accent/40 transition-colors cursor-pointer">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </motion.button>
          </HoverLabel>
          <HoverLabel label="Insights">
            <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} onClick={() => setIsInsightsOpen(true)} className="w-14 h-14 rounded-full bg-glass glass-blur border border-white/20 text-white flex items-center justify-center hover:bg-accent hover:text-primary hover:border-accent/40 transition-colors cursor-pointer">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
            </motion.button>
          </HoverLabel>
          <div className="relative" onMouseEnter={() => setMusicHover(true)} onMouseLeave={() => setMusicHover(false)}>
            <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} onClick={() => currentTrack ? setIsMusicOpen(true) : setIsMusicOpen(true)} className="w-14 h-14 rounded-full bg-glass glass-blur border border-white/20 text-white flex items-center justify-center hover:bg-accent hover:text-primary hover:border-accent/40 transition-colors cursor-pointer">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            </motion.button>
            {musicHover && currentTrack && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-0 pb-3 w-full">
              <div className="py-2 px-3 rounded-xl bg-black/80 backdrop-blur-xl border border-white/15 shadow-[0_8px_32px_rgba(0,0,0,0.6)] flex flex-col gap-2 min-w-[160px]">
                <p className="text-[11px] text-white/40 truncate max-w-[140px]">{currentTrack.title}</p>
                <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full bg-accent/70 rounded-full" style={{ width: `${playerTime.duration > 0 ? (playerTime.current / playerTime.duration) * 100 : 0}%` }} />
                </div>
                <div className="flex items-center justify-center gap-2">
                  <button onClick={handlePrevTrack} className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white cursor-pointer">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
                  </button>
                  <button onClick={handleToggleMusicPlay} className="w-8 h-8 rounded-full bg-white/10 border border-white/15 text-white flex items-center justify-center hover:bg-accent hover:text-primary cursor-pointer">
                    {isMusicPlaying ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    )}
                  </button>
                  <button onClick={handleNextTrack} className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white cursor-pointer">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
                  </button>
                  <button onClick={handleStopMusic} className="w-7 h-7 rounded-full flex items-center justify-center text-white/30 hover:text-red-400 cursor-pointer">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
                  </button>
                  <button onClick={handleToggleMute} className="w-7 h-7 rounded-full flex items-center justify-center text-white/30 hover:text-white/70 cursor-pointer">
                    {isMusicMuted ? (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                    ) : (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                    )}
                  </button>
                </div>
              </div>
              </div>
            )}
          </div>
          <HoverLabel label="Agent">
            <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} onClick={() => setIsChatOpen(true)} className="relative w-14 h-14 rounded-full bg-gradient-to-br from-accent/25 to-green-600/20 glass-blur border border-accent/30 text-accent flex items-center justify-center cursor-pointer transition-all duration-300 animate-pulse-glow hover:from-accent/45 hover:to-green-500/30 hover:border-accent/60 hover:shadow-[0_0_30px_rgba(212,252,212,0.35)]">
              <span className="absolute inset-0 rounded-full border border-accent/10 animate-spin-slow" style={{ borderTopColor: 'rgba(212,252,212,0.4)' }} />
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="relative z-10"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24A2.5 2.5 0 0 1 9.5 2z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24A2.5 2.5 0 0 0 14.5 2z"/></svg>
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-accent/90 flex items-center justify-center z-20 shadow-[0_0_6px_rgba(212,252,212,0.5)]">
                <span className="text-[6px] font-black text-primary leading-none">AI</span>
              </span>
            </motion.button>
          </HoverLabel>
        </div>
      </main>

      {/* Overlays */}
      <SettingsOverlay isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} initialInterval={settings.breakInterval} initialDuration={settings.breakDuration} enableSound={settings.enableSound} onApply={handleApplySettings} />
      <InsightsOverlay isOpen={isInsightsOpen} onClose={() => setIsInsightsOpen(false)} />
      <BreakView isActive={isBreakActive} timeLeft={breakTimeLeft} isPaused={isBreakPaused} onPause={handlePauseBreak} onResume={handleResumeBreak} onEnd={handleEndBreak} enableSound={settings.enableSound} />
      <ChatOverlay isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} onPlayMusic={handlePlayMusic} />

      {/* Persistent YouTube player container - NEVER unmounts */}
      <div
        ref={ytContainerRef}
        className={`fixed pointer-events-auto overflow-hidden ${
          currentTrack && !isMusicOpen
            ? 'inset-0 z-[-2] !w-full !h-full !rounded-none !border-0 !shadow-none opacity-100'
            : 'inset-0 z-[-2] opacity-0 pointer-events-none'
        }`}
      >
        <div id="yt-mini-container" className="w-full h-full" />
      </div>

      {/* Music Overlay */}
      <MusicOverlay
        isOpen={isMusicOpen}
        onClose={handleCloseMusicOverlay}
        currentTrack={currentTrack}
        isPlaying={isMusicPlaying}
        isMuted={isMusicMuted}
        playerTime={playerTime}
        onPlayTrack={handlePlayTrack}
        onTogglePlay={handleToggleMusicPlay}
        onToggleMute={handleToggleMute}
        onSeek={handleSeek}
        onNext={handleNextTrack}
        onPrev={handlePrevTrack}
        onStop={handleStopMusic}
      />

      <ProfileOverlay isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
      {!isAuthenticated && <LoginModal isOpen={true} onClose={() => {}} />}

      <GestureController
        onPause={handleGesturePause}
        onResume={handleGestureResume}
        onReset={resetTimer}
        hidden={ambientStage === 'bg' && !cursorVisible}
      />
    </div>
  )
}

export default App
