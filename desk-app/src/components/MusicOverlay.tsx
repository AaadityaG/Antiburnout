import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL

interface Video {
  video_id: string
  title: string
  channel: string
  thumbnail: string
}

interface MoodOption {
  id: string
  label: string
  emoji: string
  gradient: string
}

const MOODS: MoodOption[] = [
  { id: 'stressed', label: 'Stressed', emoji: '😰', gradient: 'from-blue-500/20 to-cyan-500/10' },
  { id: 'anxious', label: 'Anxious', emoji: '😟', gradient: 'from-purple-500/20 to-indigo-500/10' },
  { id: 'tired', label: 'Tired', emoji: '😴', gradient: 'from-amber-500/20 to-orange-500/10' },
  { id: 'sad', label: 'Sad', emoji: '😔', gradient: 'from-slate-400/20 to-blue-400/10' },
  { id: 'focus', label: 'Focus', emoji: '🎯', gradient: 'from-emerald-500/20 to-teal-500/10' },
  { id: 'happy', label: 'Happy', emoji: '😊', gradient: 'from-yellow-500/20 to-amber-500/10' },
  { id: 'sleep', label: 'Sleep', emoji: '🌙', gradient: 'from-indigo-500/20 to-violet-500/10' },
  { id: 'meditate', label: 'Meditate', emoji: '🧘', gradient: 'from-rose-500/20 to-pink-500/10' },
]

const AMBIENT_MOODS = new Set(['stressed', 'anxious', 'tired', 'sad', 'sleep', 'meditate'])

interface MusicOverlayProps {
  isOpen: boolean
  onClose: () => void
  currentTrack: Video | null
  isPlaying: boolean
  isMuted: boolean
  volume: number
  playerTime: { current: number; duration: number }
  onPlayTrack: (track: Video, trackList?: Video[], index?: number, mood?: string) => void
  onTogglePlay: () => void
  onToggleMute: () => void
  onVolumeChange: (vol: number) => void
  onSeek: (seconds: number) => void
  onNext: () => void
  onPrev: () => void
  onStop: () => void
}

function formatTime(s: number) {
  if (!s || !isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function MusicOverlay({ isOpen, onClose, currentTrack, isPlaying, isMuted, volume, playerTime, onPlayTrack, onTogglePlay, onToggleMute, onVolumeChange, onSeek, onNext, onPrev, onStop }: MusicOverlayProps) {
  const [selectedMood, setSelectedMood] = useState<MoodOption | null>(null)
  const [tracks, setTracks] = useState<Video[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const seekRef = useRef<HTMLInputElement>(null)

  const isTrackActive = (track: Video) => currentTrack?.video_id === track.video_id
  const progress = playerTime.duration > 0 ? (playerTime.current / playerTime.duration) * 100 : 0

  const fetchMoodMusic = async (mood: MoodOption) => {
    setSelectedMood(mood)
    setLoading(true)
    setTracks([])
    try {
      const endpoint = AMBIENT_MOODS.has(mood.id) ? 'ambient' : 'mood'
      const res = await axios.get(`${API_URL}/music/${endpoint}/${mood.id}`, { params: { max_results: 12 } })
      setTracks(res.data.videos)
      if (res.data.videos.length > 0 && !currentTrack) {
        onPlayTrack(res.data.videos[0], res.data.videos, 0, mood.id)
      }
    } catch (err) {
      console.error('Failed to fetch music:', err)
    } finally {
      setLoading(false)
    }
  }

  const searchMusic = async () => {
    if (!searchQuery.trim()) return
    setSelectedMood(null)
    setLoading(true)
    setTracks([])
    try {
      const res = await axios.get(`${API_URL}/music/search`, { params: { q: searchQuery.trim(), max_results: 12 } })
      setTracks(res.data.videos)
    } catch (err) {
      console.error('Failed to search music:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSeekChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value)
    onSeek(val)
  }, [onSeek])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="music-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="fixed inset-0 bg-glass-heavy glass-blur-heavy z-[9999] flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 20 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[1100px] h-[90vh] max-h-[800px] border border-white/10 rounded-[32px] shadow-2xl overflow-hidden flex"
          >
            {/* LEFT PANEL — Now Playing */}
            <div className="w-[420px] shrink-0 border-r border-white/[0.06] flex flex-col">
              {/* Album Art */}
              <div className="flex-1 flex items-center justify-center px-10 pt-10 pb-6">
                {currentTrack ? (
                  <div className="relative w-full max-w-[320px] aspect-square">
                    <img
                      src={currentTrack.thumbnail}
                      alt={currentTrack.title}
                      className="w-full h-full rounded-3xl object-cover shadow-[0_20px_60px_rgba(0,0,0,0.5)] ring-1 ring-white/10"
                    />
                    {isPlaying && (
                      <div className="absolute inset-0 rounded-3xl bg-black/20 flex items-center justify-center">
                        <span className="flex gap-1.5 items-end h-10">
                          <span className="w-1.5 bg-accent rounded-full animate-pulse" style={{ height: '40%' }} />
                          <span className="w-1.5 bg-accent rounded-full animate-pulse" style={{ height: '80%', animationDelay: '0.1s' }} />
                          <span className="w-1.5 bg-accent rounded-full animate-pulse" style={{ height: '55%', animationDelay: '0.2s' }} />
                          <span className="w-1.5 bg-accent rounded-full animate-pulse" style={{ height: '90%', animationDelay: '0.3s' }} />
                          <span className="w-1.5 bg-accent rounded-full animate-pulse" style={{ height: '35%', animationDelay: '0.15s' }} />
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-full max-w-[320px] aspect-square rounded-3xl bg-white/[0.03] border border-white/[0.06] flex flex-col items-center justify-center gap-4">
                    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-white/15"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                    <p className="text-base text-white/25">Select a track to play</p>
                  </div>
                )}
              </div>

              {/* Track Info */}
              {currentTrack && (
                <div className="px-10 pb-4">
                  <p className="text-xl font-semibold text-white truncate">{currentTrack.title}</p>
                  <p className="text-base text-white/40 truncate mt-1">{currentTrack.channel}</p>
                </div>
              )}

              {/* Seek Bar */}
              <div className="px-10 pb-2">
                <div className="relative h-2 group">
                  <div className="absolute inset-0 rounded-full bg-white/10" />
                  <div className="absolute left-0 top-0 h-full rounded-full bg-accent/70 transition-all" style={{ width: `${progress}%` }} />
                  <input
                    ref={seekRef}
                    type="range"
                    min={0}
                    max={playerTime.duration || 0}
                    step={0.1}
                    value={playerTime.current}
                    onChange={handleSeekChange}
                    className="seek-bar absolute inset-0 w-full opacity-0 cursor-pointer"
                    style={{ margin: 0, height: '100%' }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-accent shadow-[0_0_8px_rgba(212,252,212,0.5)] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                    style={{ left: `calc(${progress}% - 7px)` }}
                  />
                </div>
                <div className="flex justify-between mt-2">
                  <span className="text-xs text-white/30 tabular-nums">{formatTime(playerTime.current)}</span>
                  <span className="text-xs text-white/30 tabular-nums">{formatTime(playerTime.duration)}</span>
                </div>
              </div>

              {/* Transport Controls */}
              <div className="px-10 pb-7 flex items-center justify-center gap-3">
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => onSeek(Math.max(0, playerTime.current - 10))}
                  className="w-11 h-11 rounded-full flex items-center justify-center text-white/40 hover:text-white/80 transition-colors cursor-pointer"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/><text x="12" y="16" textAnchor="middle" fill="currentColor" stroke="none" fontSize="7" fontWeight="bold">10</text></svg>
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={onPrev}
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white/50 hover:text-white transition-colors cursor-pointer"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={onTogglePlay}
                  className="w-16 h-16 rounded-full bg-white/10 border border-white/15 text-white flex items-center justify-center hover:bg-accent hover:text-primary hover:border-accent/40 transition-all cursor-pointer"
                >
                  {isPlaying ? (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                  ) : (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  )}
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={onNext}
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white/50 hover:text-white transition-colors cursor-pointer"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => onSeek(Math.min(playerTime.duration, playerTime.current + 10))}
                  className="w-11 h-11 rounded-full flex items-center justify-center text-white/40 hover:text-white/80 transition-colors cursor-pointer"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/><text x="12" y="16" textAnchor="middle" fill="currentColor" stroke="none" fontSize="7" fontWeight="bold">10</text></svg>
                </motion.button>
              </div>

              {/* Bottom Row: Volume + Mute + Stop */}
              <div className="px-10 pb-6 flex items-center gap-3">
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={onToggleMute}
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-white/30 hover:text-white/70 transition-colors shrink-0 cursor-pointer"
                >
                  {isMuted || volume === 0 ? (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                  ) : volume < 50 ? (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                  ) : (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                  )}
                </motion.button>
                <div className="flex-1 relative group">
                  <div className="h-1.5 rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-accent/60 transition-all" style={{ width: `${isMuted ? 0 : volume}%` }} />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => onVolumeChange(parseInt(e.target.value))}
                    className="absolute inset-0 w-full opacity-0 cursor-pointer"
                    style={{ margin: 0, height: '100%' }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-accent shadow-[0_0_6px_rgba(212,252,212,0.4)] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                    style={{ left: `calc(${isMuted ? 0 : volume}% - 6px)` }}
                  />
                </div>
                <span className="text-xs text-white/25 tabular-nums w-8 text-right shrink-0">{isMuted ? 0 : volume}%</span>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={onStop}
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-white/30 hover:text-red-400 transition-colors shrink-0 cursor-pointer"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </motion.button>
              </div>
            </div>

            {/* RIGHT PANEL — Browse + Queue */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Header */}
              <div className="px-7 pt-6 pb-4 flex items-center gap-4 border-b border-white/5 shrink-0">
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                    <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                  </svg>
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-semibold text-white">{selectedMood ? selectedMood.label : 'Music'}</h2>
                  <p className="text-sm text-white/40">{selectedMood ? `${selectedMood.emoji} Mood` : 'Pick a mood or search'}</p>
                </div>
                {selectedMood && (
                  <button
                    onClick={() => { setSelectedMood(null); setTracks([]) }}
                    className="text-sm text-white/40 hover:text-white/70 transition-colors cursor-pointer"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>

              {/* Search */}
              <div className="px-7 pb-4 shrink-0">
                <div className="relative">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 pointer-events-none">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input
                    type="text"
                    className="w-full bg-white/5 border border-white/10 rounded-2xl pl-11 pr-9 py-3 text-base text-white placeholder:text-white/20 focus:outline-none focus:border-accent/30 focus:bg-white/[0.06] transition-all"
                    placeholder="Search artist, song, or genre..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchMusic()}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => { setSearchQuery(''); setTracks([]); setSelectedMood(null) }}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors cursor-pointer"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto custom-scrollbar px-7 pb-6">
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-24">
                    <div className="w-7 h-7 border-2 border-accent/20 border-t-accent rounded-full animate-spin mb-4" />
                    <p className="text-base text-white/30">Finding vibes...</p>
                  </div>
                ) : tracks.length === 0 ? (
                  /* Mood Grid */
                  <div>
                    <p className="text-sm text-white/30 uppercase tracking-widest font-medium mb-4">Pick your mood</p>
                    <div className="grid grid-cols-2 gap-3">
                      {MOODS.map((mood) => (
                        <button
                          key={mood.id}
                          onClick={() => fetchMoodMusic(mood)}
                          className={`relative p-5 rounded-2xl bg-gradient-to-br ${mood.gradient} border border-white/[0.06] hover:border-white/15 transition-all text-left cursor-pointer overflow-hidden group`}
                        >
                          <span className="text-3xl block mb-2">{mood.emoji}</span>
                          <h3 className="text-base font-medium text-white/90">{mood.label}</h3>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* Track List */
                  <div>
                    {/* Now Playing */}
                    {currentTrack && (
                      <div className="mb-6">
                        <p className="text-sm text-accent/60 uppercase tracking-widest font-medium mb-3 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                          Now Playing
                        </p>
                        <div className="flex items-center gap-4 p-4 rounded-2xl bg-accent/[0.07] border border-accent/15">
                          <img src={currentTrack.thumbnail} alt={currentTrack.title} className="w-16 h-16 rounded-xl object-cover shrink-0" />
                          <div className="min-w-0">
                            <p className="text-lg font-medium text-accent truncate">{currentTrack.title}</p>
                            <p className="text-sm text-white/40 truncate mt-1">{currentTrack.channel}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Tracks */}
                    <p className="text-sm text-white/30 uppercase tracking-widest font-medium mb-3">Up Next</p>
                    <div className="space-y-1.5 mb-6">
                      {tracks.map((track, i) => {
                        const active = isTrackActive(track)
                        return (
                          <button
                            key={track.video_id}
                            onClick={() => onPlayTrack(track, tracks, i, selectedMood?.id)}
                            className={`w-full flex items-center gap-4 p-3 rounded-2xl transition-all text-left cursor-pointer group ${
                              active ? 'bg-accent/10 border border-accent/20' : 'hover:bg-white/[0.04] border border-transparent'
                            }`}
                          >
                            <span className={`w-7 text-center text-sm tabular-nums shrink-0 ${active ? 'text-accent' : 'text-white/20 group-hover:text-white/40'}`}>
                              {active && isPlaying ? (
                                <span className="flex gap-0.5 items-end justify-center h-4">
                                  <span className="w-0.5 bg-accent rounded-full animate-pulse" style={{ height: '50%' }} />
                                  <span className="w-0.5 bg-accent rounded-full animate-pulse" style={{ height: '100%', animationDelay: '0.15s' }} />
                                  <span className="w-0.5 bg-accent rounded-full animate-pulse" style={{ height: '30%', animationDelay: '0.3s' }} />
                                </span>
                              ) : (i + 1)}
                            </span>
                            <img src={track.thumbnail} alt={track.title} className="w-12 h-12 rounded-xl object-cover shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className={`text-base font-medium truncate ${active ? 'text-accent' : 'text-white/80'}`}>{track.title}</p>
                              <p className="text-sm text-white/35 truncate mt-0.5">{track.channel}</p>
                            </div>
                            <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-white/30"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            </div>
                          </button>
                        )
                      })}
                    </div>

                    {/* Mood Switcher */}
                    <div className="pt-5 border-t border-white/[0.04]">
                      <p className="text-sm text-white/30 uppercase tracking-widest font-medium mb-3">Switch Mood</p>
                      <div className="flex gap-2.5 flex-wrap">
                        {MOODS.map((mood) => (
                          <button
                            key={mood.id}
                            onClick={() => fetchMoodMusic(mood)}
                            className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition-all cursor-pointer ${
                              selectedMood?.id === mood.id
                                ? 'bg-accent/15 border border-accent/25 text-accent'
                                : 'bg-white/[0.03] border border-white/[0.05] text-white/40 hover:text-white/60 hover:bg-white/[0.06]'
                            }`}
                          >
                            <span>{mood.emoji}</span>
                            <span>{mood.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default MusicOverlay
