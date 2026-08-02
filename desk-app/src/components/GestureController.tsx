import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision'
import type { GestureRecognizerResult } from '@mediapipe/tasks-vision'
import HoverLabel from './HoverLabel'

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL_PATH = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task'

const GESTURE_ACTIONS: Record<string, { label: string; emoji: string }> = {
  Thumb_Up: { label: 'Resume', emoji: '👍' },
  Thumb_Down: { label: 'Pause', emoji: '👎' },
  Open_Palm: { label: 'Reset', emoji: '🖐️' },
}

const HOLD_FRAMES = 12
const COOLDOWN_MS = 2000

type Status = 'off' | 'starting' | 'active' | 'error'

interface GestureControllerProps {
  onPause: () => void
  onResume: () => void
  onReset: () => void
}

function GestureController({ onPause, onResume, onReset }: GestureControllerProps) {
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState<Status>('off')
  const [currentGesture, setCurrentGesture] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [restartKey, setRestartKey] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const recognizerRef = useRef<GestureRecognizer | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const enabledRef = useRef(false)
  const holdCountRef = useRef(0)
  const lastGestureRef = useRef<string | null>(null)
  const displayedGestureRef = useRef<string | null>(null)
  const cooldownUntilRef = useRef(0)
  const handlersRef = useRef({ onPause, onResume, onReset })

  useEffect(() => {
    handlersRef.current = { onPause, onResume, onReset }
  }, [onPause, onResume, onReset])

  const stopCamera = useCallback(() => {
    enabledRef.current = false
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    recognizerRef.current?.close()
    recognizerRef.current = null
    displayedGestureRef.current = null
    setCurrentGesture(null)
  }, [])

  const fireAction = useCallback((gesture: string) => {
    const action = GESTURE_ACTIONS[gesture]
    if (!action) return
    setLastAction(action.label)
    setTimeout(() => setLastAction(null), 1500)
    if (gesture === 'Thumb_Up') handlersRef.current.onResume()
    else if (gesture === 'Thumb_Down') handlersRef.current.onPause()
    else if (gesture === 'Open_Palm') handlersRef.current.onReset()
  }, [])

  const onDetect = useCallback(
    (result: GestureRecognizerResult) => {
      const gesture = result.gestures?.[0]?.[0]?.categoryName ?? null
      const score = result.gestures?.[0]?.[0]?.score ?? 0
      const normalized = gesture && score >= 0.6 ? gesture : null
      if (normalized !== displayedGestureRef.current) {
        displayedGestureRef.current = normalized
        setCurrentGesture(normalized)
      }

      if (!normalized || !GESTURE_ACTIONS[normalized]) {
        holdCountRef.current = 0
        lastGestureRef.current = null
        return
      }

      if (lastGestureRef.current === normalized) {
        holdCountRef.current += 1
      } else {
        lastGestureRef.current = normalized
        holdCountRef.current = 1
      }

      const now = performance.now()
      if (holdCountRef.current >= HOLD_FRAMES && now >= cooldownUntilRef.current) {
        fireAction(normalized)
        cooldownUntilRef.current = now + COOLDOWN_MS
        holdCountRef.current = 0
        lastGestureRef.current = null
      }
    },
    [fireAction]
  )

  const handleToggle = useCallback(() => {
    if (enabled) {
      setStatus('off')
      setEnabled(false)
    } else {
      setStatus('starting')
      setEnabled(true)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        const vision = await FilesetResolver.forVisionTasks(WASM_BASE)
        const recognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
          cannedGesturesClassifierOptions: {
            maxResults: 1,
            categoryAllowlist: ['Thumb_Up', 'Thumb_Down', 'Open_Palm'],
          },
        })
        if (cancelled) {
          recognizer.close()
          return
        }
        recognizerRef.current = recognizer
        enabledRef.current = true
        setStatus('active')

        const loop = () => {
          if (!enabledRef.current) return
          const video = videoRef.current
          if (video && video.readyState >= 2) {
            const result = recognizer.recognizeForVideo(video, performance.now())
            onDetect(result)
          }
          rafRef.current = requestAnimationFrame(loop)
        }
        rafRef.current = requestAnimationFrame(loop)
      } catch (e) {
        if (cancelled) return
        setStatus('error')
        const err = e as Error
        setError(err?.name === 'NotAllowedError' ? 'Camera permission denied' : err?.message || 'Camera failed to start')
      }
    }

    start()

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [enabled, restartKey, stopCamera, onDetect])

  useEffect(() => {
    if (!enabled) return
    const onVisibility = () => {
      if (document.hidden) {
        stopCamera()
      } else {
        setRestartKey((k) => k + 1)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [enabled, stopCamera])

  const statusMeta = {
    off: { label: 'Gesture control off', dot: 'bg-white/30' },
    starting: { label: 'Starting camera…', dot: 'bg-yellow-400 animate-pulse' },
    active: { label: currentGesture ? GESTURE_ACTIONS[currentGesture]?.label ?? 'Gesture seen' : 'Camera on · watching', dot: 'bg-green-400 animate-pulse' },
    error: { label: error || 'Camera error', dot: 'bg-red-400' },
  }[status]

  return (
    <div className="fixed bottom-6 left-6 z-[90] flex flex-col gap-2 items-start">
      <AnimatePresence>
        {lastAction && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.9 }}
            transition={{ duration: 0.2 }}
            className="px-3 py-1.5 rounded-full bg-accent/20 border border-accent/40 text-accent text-xs font-bold uppercase tracking-wider shadow-[0_0_20px_rgba(212,252,212,0.25)]"
          >
            {GESTURE_ACTIONS[Object.keys(GESTURE_ACTIONS).find((k) => GESTURE_ACTIONS[k].label === lastAction) || '']?.emoji} {lastAction}
          </motion.div>
        )}
      </AnimatePresence>

      <HoverLabel label={enabled ? 'Disable gesture control' : 'Control timer with your webcam'}>
        <button
          onClick={handleToggle}
          className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border backdrop-blur-xl transition-all cursor-pointer ${
            enabled
              ? 'bg-accent/15 border-accent/30 text-accent shadow-[0_0_16px_rgba(212,252,212,0.2)]'
              : 'bg-black/50 border-white/10 text-white/50 hover:bg-black/60 hover:text-white/80'
          }`}
        >
          <span className="relative flex w-2.5 h-2.5">
            <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${enabled ? 'bg-green-400' : 'bg-white/20'}`}></span>
            <span className={`relative inline-flex rounded-full w-2.5 h-2.5 ${statusMeta.dot}`}></span>
          </span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
          <span className="text-xs font-semibold tracking-wide">
            {enabled ? 'Gesture ON' : 'Gesture'}
          </span>
        </button>
      </HoverLabel>

      <AnimatePresence>
        {enabled && status !== 'off' && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-[11px] text-white/60 backdrop-blur-xl max-w-[240px] leading-relaxed"
          >
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`}></span>
              <span>{statusMeta.label}</span>
            </div>
            {status === 'active' && (
              <div className="mt-2 pt-2 border-t border-white/10 flex items-center gap-3 text-white/40">
                <span>👍 Resume</span>
                <span>👎 Pause</span>
                <span>🖐️ Reset</span>
              </div>
            )}
            {status === 'active' && (
              <p className="mt-1.5 text-[10px] text-white/25">Local-only · nothing leaves your device</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-0 h-0 opacity-0 pointer-events-none absolute"
      />
    </div>
  )
}

export default GestureController
