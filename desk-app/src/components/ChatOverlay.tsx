import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSelector, useDispatch } from 'react-redux'
import type { RootState, AppDispatch } from '../store'
import { fetchSessions, fetchSessionMessages, deleteSession, clearAllHistory, searchChatHistory, clearSearchResults } from '../store/chatSlice'
import { fetchKBDocuments } from '../store/kbSlice'
import axios from 'axios'
import ConfirmDialog from './ConfirmDialog'
import HoverLabel from './HoverLabel'
import KnowledgeBase from './KnowledgeBase'

const API_URL = import.meta.env.VITE_API_URL 

interface ChatOverlayProps {
  isOpen: boolean
  onClose: () => void
  onPlayMusic?: (mood: string, query?: string) => void
}

function ChatOverlay({ isOpen, onClose, onPlayMusic }: ChatOverlayProps) {
  const dispatch = useDispatch<AppDispatch>()
  const { token } = useSelector((state: RootState) => state.auth)
  const { sessions, isLoading } = useSelector((state: RootState) => state.chat)
  const { searchResults, isSearching } = useSelector((state: RootState) => state.chat)
  const { documents: kbDocuments } = useSelector((state: RootState) => state.kb)
  const user = useSelector((state: RootState) => state.auth.user)
  
  const [messages, setMessages] = useState<Array<{
    role: 'user' | 'assistant';
    content: string;
    recommendations?: any[];
    tools_used?: string[];
    token_usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
    model_config_info?: { max_tokens: number; temperature: number; context_window: number };
    model?: string;
  }>>([])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [selectedModelKey, setSelectedModelKey] = useState<string>('')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [semanticSearch, setSemanticSearch] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>()
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean
    title: string
    message: string
    onConfirm: () => void
    variant: 'primary' | 'danger'
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    variant: 'primary'
  })
  const [kbOpen, setKbOpen] = useState(false)
  const [showKbDropdown, setShowKbDropdown] = useState(false)
  const [kbFilter, setKbFilter] = useState('')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const processedAutoRef = useRef<Set<string>>(new Set())
  const [autoExecuteStatus, setAutoExecuteStatus] = useState<Record<string, 'pending' | 'success' | 'failed'>>({})
  const [executeErrors, setExecuteErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (isOpen && token) {
      dispatch(fetchSessions(token))
      dispatch(fetchKBDocuments(token))
    }
  }, [isOpen, token, dispatch])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  useEffect(() => {
    if (!window.electronAPI) return
    for (const msg of messages) {
      if (!msg.recommendations) continue
      for (const rec of msg.recommendations) {
        if (processedAutoRef.current.has(rec.id)) continue
        if (rec.action_type === 'auto_execute' && rec.execute_params) {
          processedAutoRef.current.add(rec.id)
          setAutoExecuteStatus(prev => ({ ...prev, [rec.id]: 'pending' }))
          ;(async () => {
            try {
              let result = { success: false }
              switch (rec.type) {
                case 'brightness':
                  result = await window.electronAPI.setSystemBrightness(rec.execute_params.target_brightness)
                  break
                case 'volume':
                  result = await window.electronAPI.setSystemVolume(rec.execute_params.target_volume)
                  break
              }
              setAutoExecuteStatus(prev => ({
                ...prev,
                [rec.id]: result.success ? 'success' : 'failed'
              }))
            } catch (e) {
              console.error('Auto-execute failed:', e)
              setAutoExecuteStatus(prev => ({ ...prev, [rec.id]: 'failed' }))
            }
          })()
        }
        if (rec.action_type === 'auto_play_music') {
          processedAutoRef.current.add(rec.id)
          onPlayMusic?.(rec.mood, rec.query)
        }
      }
    }
  }, [messages, onPlayMusic])

  const loadSessionMessages = async (sessionId: string) => {
    if (!token) return
    try {
      const session = await dispatch(fetchSessionMessages({ token, sessionId })).unwrap()
      const chatMessages = session.messages.flatMap((msg: any) => [
        { role: 'user' as const, content: msg.message },
        { role: 'assistant' as const, content: msg.response }
      ])
      setMessages(chatMessages)
      setActiveSessionId(sessionId)
    } catch (error) {
      console.error('Failed to load session:', error)
    }
  }

  const handleDeleteSession = (sessionId: string) => {
    if (!token) return
    setConfirmDialog({
      isOpen: true,
      title: 'Delete Conversation',
      message: 'Are you sure you want to delete this conversation? This action cannot be undone.',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await dispatch(deleteSession({ token, sessionId })).unwrap()
          if (activeSessionId === sessionId) {
            setMessages([])
            setActiveSessionId(null)
          }
          setConfirmDialog(prev => ({ ...prev, isOpen: false }))
        } catch (error) {
          console.error('Failed to delete session:', error)
          setConfirmDialog(prev => ({ ...prev, isOpen: false }))
        }
      }
    })
  }

  const handleClearHistory = () => {
    if (!token) return
    setConfirmDialog({
      isOpen: true,
      title: 'Clear All History',
      message: 'Are you sure you want to clear all chat history? This action cannot be undone.',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await dispatch(clearAllHistory(token)).unwrap()
          setMessages([])
          setActiveSessionId(null)
          setConfirmDialog(prev => ({ ...prev, isOpen: false }))
        } catch (error) {
          console.error('Failed to clear history:', error)
          setConfirmDialog(prev => ({ ...prev, isOpen: false }))
        }
      }
    })
  }

  const availableModels = user?.ai_providers || {}
  const modelKeys = Object.keys(availableModels)

  if (!selectedModelKey && modelKeys.length > 0) {
    setSelectedModelKey(modelKeys[0])
  }

  const currentModel = selectedModelKey ? availableModels[selectedModelKey]?.model : 'AI'

  const handleSend = async (overrideMessage?: string) => {
    const msgToSend = overrideMessage || input.trim()
    if (!msgToSend || !token) return

    const userMessage = msgToSend
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setInput('')
    setIsTyping(true)

    try {
      const conversationHistory = messages
        .filter(msg => !msg.content.startsWith('👋'))
        .slice(-10)
        .map(msg => ({
          role: msg.role,
          content: msg.content
        }))

      // Get real system metrics from Electron
      let brightness: number | null = null
      let volume: number | null = null
      if (window.electronAPI) {
        try {
          brightness = await window.electronAPI.getSystemBrightness()
        } catch (e) {
          console.log('Brightness not available:', e)
        }
        
        try {
          volume = await window.electronAPI.getSystemVolume()
        } catch (e) {
          console.log('Volume not available:', e)
        }
      }

      console.log('Sending chat with system metrics:', { brightness, volume })

      const response = await axios.post(`${API_URL}/chat/send`, {
        message: userMessage,
        conversation_history: conversationHistory,
        model_key: selectedModelKey,
        session_id: activeSessionId || undefined,
        brightness: brightness,
        volume: volume,
        local_hour: new Date().getHours()
      }, {
        params: { token }
      })

      console.log('Chat response received:', response.data)
      console.log('Recommendations:', response.data.recommendations)

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: response.data.response,
        recommendations: response.data.recommendations || [],
        tools_used: response.data.tools_used || [],
        token_usage: response.data.token_usage || undefined,
        model_config_info: response.data.model_config_info || undefined,
        model: response.data.model || undefined,
      }])

      if (response.data.session_id && !activeSessionId) {
        setActiveSessionId(response.data.session_id)
        dispatch(fetchSessions(token))
      }
    } catch (error: any) {
      console.error('Chat error:', error)
      const errorMessage = error.response?.data?.detail || 'Sorry, I couldn\'t process that. Please try again.'
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ ${errorMessage}`
      }])
    } finally {
      setIsTyping(false)
    }
  }

  const startNewChat = () => {
    setMessages([])
    setActiveSessionId(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (showKbDropdown) {
        setShowKbDropdown(false)
      } else {
        handleSend()
      }
    }
    if (e.key === 'Escape' && showKbDropdown) {
      setShowKbDropdown(false)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInput(value)
    
    if (value === '/kb') {
      setShowKbDropdown(true)
      setKbFilter('')
    } else if (value.startsWith('/kb ')) {
      setShowKbDropdown(true)
      setKbFilter(value.slice(4).toLowerCase())
    } else {
      setShowKbDropdown(false)
    }
  }

  const handleKbDocSelect = (filename: string) => {
    setInput(`[KB: ${filename}] `)
    setShowKbDropdown(false)
    inputRef.current?.focus()
  }

  const filteredKbDocs = useMemo(() => {
    if (!kbFilter) return kbDocuments
    return kbDocuments.filter(doc => 
      doc.filename.toLowerCase().includes(kbFilter)
    )
  }, [kbDocuments, kbFilter])

  const handleSemanticSearch = (query: string) => {
    setSearchQuery(query)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    if (!query.trim() || !semanticSearch) {
      dispatch(clearSearchResults())
      return
    }
    searchDebounceRef.current = setTimeout(() => {
      if (token) dispatch(searchChatHistory({ token, query: query.trim(), k: 5 }))
    }, 400)
  }

  const toggleSearchMode = () => {
    const newSemanticSearch = !semanticSearch
    if (semanticSearch && !newSemanticSearch) {
      dispatch(clearSearchResults())
    }
    setSemanticSearch(newSemanticSearch)
    if (searchQuery.trim() && newSemanticSearch && token) {
      dispatch(searchChatHistory({ token, query: searchQuery.trim(), k: 5 }))
    }
  }

  const loadSearchResult = (sessionId: string, content: string) => {
    const parsed = content.split('\n').reduce<{ role: 'user' | 'assistant'; content: string }[]>((acc, line) => {
      if (line.startsWith('User: ')) {
        acc.push({ role: 'user', content: line.slice(6) })
      } else if (line.startsWith('AI: ')) {
        acc.push({ role: 'assistant', content: line.slice(4) })
      } else if (acc.length > 0) {
        acc[acc.length - 1].content += '\n' + line
      }
      return acc
    }, [])

    setMessages(parsed.length > 0 ? parsed : [{ role: 'assistant', content }])
    setActiveSessionId(sessionId)
    setSemanticSearch(false)
    dispatch(clearSearchResults())
    setSearchQuery('')
    loadSessionMessages(sessionId)
  }

  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(${escapedQuery})`, 'gi')
    const parts = text.split(regex)
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <mark key={i} className="bg-accent/30 text-white rounded px-0.5">{part}</mark>
      ) : (
        part
      )
    )
  }

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions
    const q = searchQuery.toLowerCase()
    return sessions.filter(
      (s: any) =>
        s.first_message?.toLowerCase().includes(q) ||
        s.last_message?.toLowerCase().includes(q)
    )
  }, [sessions, searchQuery])

  const groupedSessions = useMemo(() => {
    const groups: Record<string, any[]> = {}
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    for (const s of filteredSessions) {
      const d = new Date(s.updated_at)
      let label: string
      if (d.toDateString() === today.toDateString()) {
        label = 'Today'
      } else if (d.toDateString() === yesterday.toDateString()) {
        label = 'Yesterday'
      } else {
        label = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      }
      if (!groups[label]) groups[label] = []
      groups[label].push(s)
    }
    return groups
  }, [filteredSessions])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="chat-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="fixed inset-0 bg-glass-heavy glass-blur-heavy z-[9999] flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 20 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-[1100px] h-[90vh] max-h-[800px] border border-white/10 rounded-[32px] shadow-2xl flex overflow-hidden"
          >
          {/* Sidebar - History */}
          <div className={`${sidebarOpen ? 'w-80' : 'w-0'} transition-[width] duration-200 border-r border-white/5 flex flex-col overflow-hidden shrink-0`}>
            <div className="flex items-center justify-between px-5 py-5 border-b border-white/5">
              <h3 className="text-sm font-medium text-white/80 tracking-wide">History</h3>
              {sessions.length > 0 && (
                <button
                  className="px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg cursor-pointer"
                  onClick={handleClearHistory}
                >
                  Clear all
                </button>
              )}
            </div>

            <div className="px-4 pt-3 pb-2">
              <div className="relative">
                <button
                  onClick={toggleSearchMode}
                  className={`absolute left-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md cursor-pointer transition-colors ${
                    semanticSearch ? 'text-accent bg-accent/10' : 'text-white/20 hover:text-white/40'
                  }`}
                  title={semanticSearch ? 'Switch to filter mode' : 'Switch to semantic search'}
                >
                  {semanticSearch ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                  )}
                </button>
                <input
                  type="text"
                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-accent/50 transition-[border-color]"
                  placeholder={semanticSearch ? 'Semantic Search...' : 'Search conversations...'}
                  value={searchQuery}
                  onChange={(e) => semanticSearch ? handleSemanticSearch(e.target.value) : setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4 custom-scrollbar">
              {isSearching ? (
                <div className="flex justify-center py-12">
                  <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                </div>
              ) : semanticSearch && searchResults.length > 0 ? (
                <div className="space-y-2 mt-2">
                  <p className="text-[10px] text-accent/60 uppercase tracking-wider px-1">Semantic Search Results</p>
                  {searchResults.map((result, idx) => (
                    <button
                      key={idx}
                      onClick={() => loadSearchResult(result.session_id, result.content)}
                      className="w-full text-left p-3 rounded-xl hover:bg-white/[0.04] border border-transparent hover:border-accent/20 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[10px] text-accent/50 font-mono">
                          {Math.round(result.score * 100)}% match
                        </span>
                        <span className="text-[10px] text-white/20">
                          {new Date(result.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                        <p className="text-xs text-white/60 line-clamp-3 leading-relaxed">{highlightMatch(result.content, searchQuery)}</p>
                    </button>
                  ))}
                </div>
              ) : semanticSearch && searchQuery.trim() ? (
                <div className="flex flex-col items-center justify-center py-12 text-white/30">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                  </svg>
                  <p className="mt-3 text-sm">No matching conversations</p>
                </div>
              ) : isLoading ? (
                <div className="flex justify-center py-12">
                  <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                </div>
              ) : Object.keys(groupedSessions).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-white/30">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/>
                  </svg>
                  <p className="mt-3 text-sm">{searchQuery ? 'No matching conversations' : 'No conversations yet'}</p>
                </div>
              ) : (
                Object.entries(groupedSessions).map(([dateLabel, dateSessions]) => (
                  <div key={dateLabel} className="mt-4 first:mt-0">
                    <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2 px-1">{dateLabel}</p>
                    <div className="space-y-1">
                      {(dateSessions as any[]).map((session: any) => (
                        <button
                          key={session.id}
                          onClick={() => loadSessionMessages(session.id)}
                          className={`w-full text-left p-3 rounded-xl cursor-pointer ${
                            activeSessionId === session.id
                              ? 'bg-accent/10 border border-accent/20'
                              : 'hover:bg-white/[0.04] border border-transparent'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                {activeSessionId === session.id && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0"></span>
                                )}
                                <p className="text-sm text-white/80 truncate">{session.first_message || 'New conversation'}</p>
                              </div>
                              <p className="text-xs text-white/30 mt-1 truncate">{session.last_message || ''}</p>
                            </div>
                            <div className="shrink-0 flex items-center gap-1.5">
                              <button
                                className="text-red-400/50 hover:text-red-300 cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteSession(session.id)
                                }}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                </svg>
                              </button>
            </div>
          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Main Chat Area */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Header */}
            <header className="px-6 py-4 flex items-center justify-between border-b border-white/5 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  className="w-9 h-9 rounded-full bg-glass glass-blur border border-white/20 text-white flex items-center justify-center hover:bg-accent hover:text-primary cursor-pointer shrink-0"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  title={sidebarOpen ? 'Hide history' : 'Show history'}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                  </svg>
                </button>

                <div className="w-9 h-9 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
                  <span className="text-base">🤖</span>
                </div>
                <div className="min-w-0 flex items-start flex-col">
                  <h2 className="text-lg font-medium text-white truncate">Wellness Agent</h2>
                  <p className="text-xs text-green-200/40 truncate">{currentModel}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {modelKeys.length > 1 && (
                  <select
                    className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-sm text-white focus:outline-none focus:border-accent cursor-pointer"
                    value={selectedModelKey}
                    onChange={(e) => setSelectedModelKey(e.target.value)}
                  >
                    {modelKeys.map(key => (
                      <option key={key} value={key} className="bg-bg-dark">
                        {availableModels[key]?.model}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  className="w-9 h-9 rounded-full bg-glass glass-blur border border-white/20 text-white flex items-center justify-center hover:bg-accent hover:text-primary cursor-pointer"
                  onClick={onClose}
                >
                  ✕
                </button>
              </div>
            </header>

            {/* Messages or Knowledge Base */}
            {kbOpen ? (
              <KnowledgeBase onBack={() => setKbOpen(false)} />
            ) : (
              <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center px-8">
                  <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-5">
                    <span className="text-3xl">💬</span>
                  </div>
                  <h3 className="text-xl font-light text-white/80 mb-2">Start a conversation</h3>
                  <p className="text-sm text-white/30 max-w-xs leading-relaxed mb-6">
                    Ask me anything about your break patterns, productivity tips, or just have a chat.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2 max-w-md">
                    {[
                      'Check my current settings if they are good for less burnout',
                      'I\'m feeling tired',
                      'Suggest a break activity',
                      'How\'s my activity today?',
                      'Reduce my eye strain',
                      'Play some calming music',
                    ].map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => handleSend(prompt)}
                        className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white/50 hover:text-white/80 hover:bg-white/10 hover:border-white/20 cursor-pointer transition-all"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((msg, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: idx === messages.length - 1 ? 0.05 : 0, ease: 'easeOut' }}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[80%] px-6 py-4 rounded-2xl text-base leading-relaxed text-left whitespace-pre-wrap ${msg.role === 'user' ? 'bg-accent/15 border border-accent/25 text-white rounded-br-md' : 'bg-white/[0.04] border border-white/[0.06] text-green-200/80 rounded-bl-md'}`}>
                        {msg.content}

                        {/* Tool usage indicators */}
                        {msg.tools_used && msg.tools_used.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-white/[0.06]">
                            {msg.tools_used.map((tool: string) => (
                              <span key={tool} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent/10 border border-accent/20 text-[11px] text-accent/80 font-medium">
                                {tool === 'check_system_settings' && '⚙️ Settings checked'}
                                {tool === 'get_user_activity' && '📊 Activity fetched'}
                                {tool === 'get_user_break_settings' && '⏰ Schedule fetched'}
                                {tool === 'get_break_tip' && '💡 Tip generated'}
                                {tool === 'recommend_music' && '🎵 Music recommended'}
                                {tool === 'kb_search' && '📚 Knowledge base searched'}
                                {!['check_system_settings', 'get_user_activity', 'get_user_break_settings', 'get_break_tip', 'recommend_music', 'kb_search'].includes(tool) && `🔧 ${tool}`}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Token usage and model info */}
                        {msg.token_usage && msg.role === 'assistant' && (
                          <div className="mt-2 pt-2 border-t border-white/[0.04]">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/30">
                              {msg.model && (
                                <span className="font-mono">{msg.model.split('/').pop()}</span>
                              )}
                              <span>
                                {msg.token_usage.input_tokens} in / {msg.token_usage.output_tokens} out
                              </span>
                              {msg.model_config_info && (
                                <span className="opacity-60">
                                  max {msg.model_config_info.max_tokens} · temp {msg.model_config_info.temperature}
                                </span>
                              )}
                              {msg.model_config_info && msg.model_config_info.context_window > 0 && (
                                <span className="opacity-60">
                                  {Math.round((msg.token_usage.total_tokens / msg.model_config_info.context_window) * 100)}% context
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {/* Render executable recommendations */}
                        {msg.recommendations && msg.recommendations.length > 0 && (
                          <div className="mt-4 space-y-3">
                            {msg.recommendations.filter((rec: any) => rec.action_type === 'auto_execute').length > 0 && (
                              <>
                                <div className="text-xs font-semibold text-white/60 uppercase tracking-wide">Applied Settings:</div>
                                {msg.recommendations.filter((rec: any) => rec.action_type === 'auto_execute').map((rec: any) => {
                              const execStatus = autoExecuteStatus[rec.id] || 'pending'
                              return (
                                  <div key={rec.id} className={`p-4 rounded-xl transition-all ${execStatus === 'failed' ? 'bg-red-500/5 border border-red-500/15' : 'bg-green-500/5 border border-green-500/15'}`}>
                                    <div className="flex items-start gap-3">
                                      <span className="text-2xl">
                                        {rec.type === 'brightness' ? '☀️' : rec.type === 'volume' ? '🔊' : '⏸️'}
                                      </span>
                                      <div className="flex-1">
                                        <div className="text-sm font-semibold text-white/90">{rec.title}</div>
                                        <div className="text-xs text-white/60 mt-1">{rec.message}</div>
                                        {execStatus === 'failed' ? (
                                          <div className="flex items-center gap-1.5 mt-2 text-red-400 text-xs font-medium">
                                            <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                                            Failed to apply - click Execute in recommendations below
                                          </div>
                                        ) : execStatus === 'success' ? (
                                          <div className="flex items-center gap-1.5 mt-2 text-green-400 text-xs font-medium">
                                            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                                            Applied
                                          </div>
                                        ) : (
                                          <div className="flex items-center gap-1.5 mt-2 text-yellow-400 text-xs font-medium">
                                            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse"></span>
                                            Applying...
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                              )
                            })}
                              </>
                            )}

                            {msg.recommendations.filter((rec: any) => rec.action_type === 'execute').length > 0 && (
                              <>
                                <div className="text-xs font-semibold text-white/60 uppercase tracking-wide">Recommended Actions:</div>
                                {msg.recommendations.filter((rec: any) => rec.action_type === 'execute').map((rec: any) => (
                                  <div key={rec.id} className="p-4 rounded-xl bg-white/5 border border-white/10 transition-all">
                                    <div className="flex items-start gap-3 mb-3">
                                      <span className="text-2xl">
                                        {rec.type === 'brightness' ? '☀️' : rec.type === 'volume' ? '🔊' : '⏸️'}
                                      </span>
                                      <div className="flex-1">
                                        <div className="text-sm font-semibold text-white/90">{rec.title}</div>
                                        <div className="text-xs text-white/60 mt-1">{rec.message}</div>
                                      </div>
                                    </div>
                                    {rec.execute_params && (
                                      <div className="flex gap-2 mt-3">
                                        <button
                                          className="flex-1 px-4 py-2 rounded-lg text-xs font-semibold bg-accent/20 border border-accent/30 text-accent hover:bg-accent/30 cursor-pointer transition-all"
                                          onClick={async (e) => {
                                            const btn = e.currentTarget
                                            try {
                                              if (window.electronAPI) {
                                                let result = { success: false }
                                                switch (rec.type) {
                                                  case 'brightness':
                                                    result = await window.electronAPI.setSystemBrightness(rec.execute_params.target_brightness)
                                                    break
                                                  case 'volume':
                                                    result = await window.electronAPI.setSystemVolume(rec.execute_params.target_volume)
                                                    break
                                                }
                                                if (result.success) {
                                                  btn.innerHTML = 'Applied!'
                                                  btn.className = 'flex-1 px-4 py-2 rounded-lg text-xs font-semibold bg-green-500/20 border border-green-500/30 text-green-400 cursor-default'
                                                  const parent = btn.parentElement
                                                  if (parent) {
                                                    const rejectBtn = parent.querySelector('button:last-child') as HTMLButtonElement
                                                    if (rejectBtn) {
                                                      rejectBtn.disabled = true
                                                      rejectBtn.className = 'flex-1 px-4 py-2 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/30 cursor-not-allowed'
                                                    }
                                                  }
                                                } else {
                                                  btn.innerHTML = 'Failed - retry'
                                                  btn.className = 'flex-1 px-4 py-2 rounded-lg text-xs font-semibold bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 cursor-pointer transition-all'
                                                  setTimeout(() => {
                                                    btn.innerHTML = 'Execute'
                                                    btn.className = 'flex-1 px-4 py-2 rounded-lg text-xs font-semibold bg-accent/20 border border-accent/30 text-accent hover:bg-accent/30 cursor-pointer transition-all'
                                                  }, 3000)
                                                }
                                              }
                                            } catch (error) {
                                              console.error('Failed to execute:', error)
                                              btn.innerHTML = 'Failed - retry'
                                              btn.className = 'flex-1 px-4 py-2 rounded-lg text-xs font-semibold bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 cursor-pointer transition-all'
                                              setTimeout(() => {
                                                btn.innerHTML = 'Execute'
                                                btn.className = 'flex-1 px-4 py-2 rounded-lg text-xs font-semibold bg-accent/20 border border-accent/30 text-accent hover:bg-accent/30 cursor-pointer transition-all'
                                              }, 3000)
                                            }
                                          }}
                                        >
                                          Execute
                                        </button>
                                        <button
                                          className="flex-1 px-4 py-2 rounded-lg text-xs font-semibold bg-white/10 border border-white/20 text-white/70 hover:bg-white/15 cursor-pointer transition-all"
                                          onClick={(e) => {
                                            const btn = e.currentTarget
                                            btn.innerHTML = 'Dismissed'
                                            btn.className = 'flex-1 px-4 py-2 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/40 cursor-default'
                                            const parent = btn.parentElement
                                            if (parent) {
                                              const execBtn = parent.querySelector('button:first-child') as HTMLButtonElement
                                              if (execBtn) {
                                                execBtn.disabled = true
                                                execBtn.className = 'flex-1 px-4 py-2 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/30 cursor-not-allowed'
                                              }
                                            }
                                          }}
                                        >
                                          Reject
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </>
                            )}

                            {msg.recommendations.filter((rec: any) => rec.action_type === 'auto_play_music').map((rec: any) => (
                              <div key={rec.id} className="p-4 rounded-xl bg-green-500/5 border border-green-500/15 transition-all">
                                <div className="flex items-start gap-3">
                                  <div className="w-10 h-10 rounded-xl bg-green-500/15 flex items-center justify-center shrink-0">
                                    <span className="text-xl">🎵</span>
                                  </div>
                                  <div className="flex-1">
                                    <div className="text-sm font-semibold text-white/90">{rec.title}</div>
                                    <div className="text-xs text-white/50 mt-1">{rec.message}</div>
                                    <div className="flex items-center gap-1.5 mt-2 text-green-400 text-xs font-medium">
                                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                                      Playing now...
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}

                            {msg.recommendations.filter((rec: any) => rec.action_type === 'play_music').map((rec: any) => (
                              <div key={rec.id} className="p-4 rounded-xl bg-accent/5 border border-accent/15 transition-all">
                                <div className="flex items-start gap-3 mb-3">
                                  <div className="w-10 h-10 rounded-xl bg-accent/15 flex items-center justify-center shrink-0">
                                    <span className="text-xl">🎵</span>
                                  </div>
                                  <div className="flex-1">
                                    <div className="text-sm font-semibold text-white/90">{rec.title}</div>
                                    <div className="text-xs text-white/50 mt-1">{rec.message}</div>
                                  </div>
                                </div>
                                <div className="flex gap-2 mt-3">
                                  <button
                                    className="flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold bg-accent/20 border border-accent/30 text-accent hover:bg-accent/30 cursor-pointer transition-all flex items-center justify-center gap-2"
                                    onClick={(e) => {
                                      const btn = e.currentTarget
                                      btn.innerHTML = 'Playing...'
                                      btn.className = 'flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold bg-green-500/20 border border-green-500/30 text-green-400 cursor-default flex items-center justify-center gap-2'
                                      const parent = btn.parentElement
                                      if (parent) {
                                        const dismissBtn = parent.querySelector('button:last-child') as HTMLButtonElement
                                        if (dismissBtn && dismissBtn !== btn) {
                                          dismissBtn.disabled = true
                                          dismissBtn.className = 'flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-white/30 cursor-not-allowed'
                                        }
                                      }
                                      onPlayMusic?.(rec.mood, rec.query)
                                    }}
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                    Play Music
                                  </button>
                                  <button
                                    className="flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold bg-white/10 border border-white/20 text-white/70 hover:bg-white/15 cursor-pointer transition-all"
                                    onClick={(e) => {
                                      const btn = e.currentTarget
                                      btn.innerHTML = 'Dismissed'
                                      btn.className = 'flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-white/40 cursor-default'
                                      const parent = btn.parentElement
                                      if (parent) {
                                        const playBtn = parent.querySelector('button:first-child') as HTMLButtonElement
                                        if (playBtn && playBtn !== btn) {
                                          playBtn.disabled = true
                                          playBtn.className = 'flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-white/30 cursor-not-allowed'
                                        }
                                      }
                                    }}
                                  >
                                    Not now
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                  <AnimatePresence>
                    {isTyping && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2 }}
                        className="flex justify-start"
                      >
                        <div className="bg-white/[0.04] border border-white/[0.06] px-5 py-3.5 rounded-2xl rounded-bl-md">
                          <div className="flex gap-1.5">
                            <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0 }} className="w-2 h-2 bg-accent/40 rounded-full" />
                            <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.15 }} className="w-2 h-2 bg-accent/40 rounded-full" />
                            <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.3 }} className="w-2 h-2 bg-accent/40 rounded-full" />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input */}
            <div className="px-6 py-4 border-t border-white/5">
              <div className="relative">
                <AnimatePresence>
                  {showKbDropdown && filteredKbDocs.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute bottom-full left-0 right-0 mb-2 bg-bg-dark border border-white/10 rounded-xl shadow-xl overflow-hidden z-50"
                    >
                      <div className="px-3 py-2 border-b border-white/5">
                        <p className="text-[11px] text-white/40 uppercase tracking-wider">Knowledge Base Documents</p>
                      </div>
                      <div className="max-h-48 overflow-y-auto custom-scrollbar">
                        {filteredKbDocs.map((doc) => (
                          <button
                            key={doc.doc_id}
                            onClick={() => handleKbDocSelect(doc.filename)}
                            className="w-full text-left px-4 py-2.5 hover:bg-white/5 flex items-center gap-3 transition-colors"
                          >
                            <span className={`text-[10px] font-bold tracking-wider ${
                              doc.file_type === 'pdf' ? 'text-red-400' :
                              doc.file_type === 'md' ? 'text-purple-400' : 'text-blue-400'
                            }`}>
                              {doc.file_type.toUpperCase()}
                            </span>
                            <span className="text-sm text-white/70 truncate">{doc.filename}</span>
                            <span className="text-[10px] text-white/30 ml-auto">{doc.total_chunks} chunks</span>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="flex gap-3 items-center">
                  <HoverLabel label="Knowledge Base" position="top">
                    <button
                      className={`w-12 h-12 rounded-full border flex items-center justify-center cursor-pointer transition-all shrink-0 ${
                        kbOpen
                          ? 'bg-accent/20 border-accent/30 text-accent'
                          : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80'
                      }`}
                      onClick={() => setKbOpen(!kbOpen)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                      </svg>
                    </button>
                  </HoverLabel>
                  <input
                    ref={inputRef}
                    type="text"
                    className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-base text-white focus:outline-none focus:border-accent/50 placeholder:text-white/20"
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder={showKbDropdown ? "Filter documents..." : "Type your message... (try /kb)"}
                  />
                  <HoverLabel label="New Chat" position="top">
                    <button
                      className="w-12 h-12 rounded-full bg-white/5 border border-white/10 text-white/60 flex items-center justify-center hover:bg-white/10 hover:text-white cursor-pointer shrink-0 transition-all"
                      onClick={startNewChat}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                    </button>
                  </HoverLabel>
                  <button
                    className="h-12 rounded-full bg-glass glass-blur border border-white/20 text-white font-medium px-6 hover:bg-accent hover:text-primary cursor-pointer shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                    onClick={() => handleSend()}
                    disabled={!input.trim() || isTyping}
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
              </>
            )}
          </div>
          </motion.div>
        </motion.div>
      )}

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText="Delete"
        cancelText="Cancel"
        confirmVariant={confirmDialog.variant}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
      />
    </AnimatePresence>
  )
}

export default ChatOverlay
