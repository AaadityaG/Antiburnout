import { useCallback, useEffect, useRef, useState } from 'react'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import type { HandLandmarkerResult } from '@mediapipe/tasks-vision'
import HoverLabel from './HoverLabel'

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL_PATH = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

const PINCH_CLOSE = 0.55
const PINCH_OPEN = 0.55
const CLICK_MAX_MOVE = 120
const CLOSED_STUCK_MS = 600
const SMOOTHING_TIME_MS = 24
const SNAP_DISTANCE = 400

type Status = 'off' | 'starting' | 'active' | 'error'

interface AirPointerProps {
  hidden?: boolean
}

function AirPointer({ hidden = false }: AirPointerProps) {
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState<Status>('off')
  const [error, setError] = useState('')
  const [pinching, setPinching] = useState(false)
  const [handLost, setHandLost] = useState(false)
  const [restartKey, setRestartKey] = useState(0)
  const handLostRef = useRef(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const reticleRef = useRef<HTMLDivElement>(null)
  const landmarkerRef = useRef<HandLandmarker | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  const enabledRef = useRef(false)
  const initializedRef = useRef(false)
  const targetRef = useRef({ x: 0, y: 0 })
  const smoothedRef = useRef({ x: 0, y: 0 })
  const lastFrameTimeRef = useRef(0)
  const hoveredRef = useRef<Element | null>(null)
  const pinchStateRef = useRef<'open' | 'closed'>('open')
  const mouseDownRef = useRef(false)
  const downElRef = useRef<Element | null>(null)
  const pinchStartTimeRef = useRef(0)
  const pinchStartPosRef = useRef({ x: 0, y: 0 })

  const stopCamera = useCallback(() => {
    enabledRef.current = false
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    landmarkerRef.current?.close()
    landmarkerRef.current = null
    initializedRef.current = false
    hoveredRef.current = null
    pinchStateRef.current = 'open'
    mouseDownRef.current = false
    downElRef.current = null
    setPinching(false)
    handLostRef.current = false
    setHandLost(false)
    if (reticleRef.current) reticleRef.current.style.opacity = '0'
  }, [])

  const handleToggle = useCallback(() => {
    if (enabled) {
      setStatus('off')
      setEnabled(false)
    } else {
      setStatus('starting')
      setEnabled(true)
    }
  }, [enabled])

  const handleFrame = useCallback((result: HandLandmarkerResult) => {
    const video = videoRef.current
    const landmarks = result.landmarks?.[0]
    if (!video || !landmarks) {
    pinchStateRef.current = 'open'
    mouseDownRef.current = false
    downElRef.current = null
    setPinching(false)
    if (!handLostRef.current) {
      handLostRef.current = true
      setHandLost(true)
    }
    return
  }

    const rect = video.getBoundingClientRect()
    const vw = video.videoWidth || rect.width
    const vh = video.videoHeight || rect.height
    const scale = Math.max(rect.width / vw, rect.height / vh)
    const dw = vw * scale
    const dh = vh * scale
    const ox = rect.left + (rect.width - dw) / 2
    const oy = rect.top + (rect.height - dh) / 2
    const tx = ox + (1 - landmarks[8].x) * dw
    const ty = oy + landmarks[8].y * dh

    const now = performance.now()
    const dt = Math.min(now - lastFrameTimeRef.current, 100) || 16
    lastFrameTimeRef.current = now

    const prev = smoothedRef.current
    if (!initializedRef.current ||
        Math.abs(tx - prev.x) > SNAP_DISTANCE ||
        Math.abs(ty - prev.y) > SNAP_DISTANCE) {
      smoothedRef.current = { x: tx, y: ty }
      initializedRef.current = true
    } else {
      const alpha = 1 - Math.exp(-dt / SMOOTHING_TIME_MS)
      smoothedRef.current = {
        x: prev.x + (tx - prev.x) * alpha,
        y: prev.y + (ty - prev.y) * alpha,
      }
    }
    targetRef.current = { x: tx, y: ty }
    const pos = smoothedRef.current

    const el = document.elementFromPoint(pos.x, pos.y)
    if (el !== hoveredRef.current) {
      const prev = hoveredRef.current
      if (prev) {
        prev.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, relatedTarget: el, clientX: pos.x, clientY: pos.y }))
        prev.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, relatedTarget: el, clientX: pos.x, clientY: pos.y, pointerId: 1 }))
        prev.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: el, clientX: pos.x, clientY: pos.y }))
        prev.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: el, clientX: pos.x, clientY: pos.y, pointerId: 1 }))
      }
      if (el) {
        el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, relatedTarget: prev, clientX: pos.x, clientY: pos.y, pointerId: 1 }))
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, relatedTarget: prev, clientX: pos.x, clientY: pos.y }))
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: prev, clientX: pos.x, clientY: pos.y }))
        el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: prev, clientX: pos.x, clientY: pos.y, pointerId: 1 }))
      }
      hoveredRef.current = el
    }

    if (reticleRef.current) {
      reticleRef.current.style.left = `${pos.x}px`
      reticleRef.current.style.top = `${pos.y}px`
      reticleRef.current.style.opacity = '1'
    }
    if (handLostRef.current) {
      handLostRef.current = false
      setHandLost(false)
    }

    const dist = Math.hypot(landmarks[4].x - landmarks[8].x, landmarks[4].y - landmarks[8].y)
    const handSpan = Math.hypot(landmarks[0].x - landmarks[9].x, landmarks[0].y - landmarks[9].y) || 1
    const pinchRatio = dist / handSpan
    if (pinchStateRef.current === 'open') {
      if (pinchRatio < PINCH_CLOSE) {
        pinchStateRef.current = 'closed'
        pinchStartTimeRef.current = now
        pinchStartPosRef.current = { x: pos.x, y: pos.y }
        mouseDownRef.current = true
        const downEl = hoveredRef.current ?? document.elementFromPoint(pos.x, pos.y)
        downElRef.current = downEl
        downEl?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: pos.x, clientY: pos.y, pointerId: 1, button: 0 }))
        downEl?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: pos.x, clientY: pos.y, button: 0 }))
        setPinching(true)
      }
    } else if (now - pinchStartTimeRef.current > CLOSED_STUCK_MS) {
      pinchStateRef.current = 'open'
      const stuckEl = downElRef.current
      downElRef.current = null
      mouseDownRef.current = false
      stuckEl?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: pos.x, clientY: pos.y, pointerId: 1, button: 0 }))
      stuckEl?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: pos.x, clientY: pos.y, button: 0 }))
      setPinching(false)
    } else if (pinchRatio > PINCH_OPEN) {
      pinchStateRef.current = 'open'
      const downEl = downElRef.current
      downElRef.current = null
      if (mouseDownRef.current) {
        mouseDownRef.current = false
        const moved = Math.hypot(pos.x - pinchStartPosRef.current.x, pos.y - pinchStartPosRef.current.y)
        if (downEl && moved <= CLICK_MAX_MOVE) {
          downEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: pos.x, clientY: pos.y, pointerId: 1, button: 0 }))
          downEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: pos.x, clientY: pos.y, button: 0 }))
          downEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: pos.x, clientY: pos.y, button: 0 }))
        }
      }
      setPinching(false)
    }
  }, [])

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
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        })
        if (cancelled) {
          landmarker.close()
          return
        }
        landmarkerRef.current = landmarker
        enabledRef.current = true
        setStatus('active')

        const loop = () => {
          if (!enabledRef.current) return
          const video = videoRef.current
          if (video && video.readyState >= 2) {
            handleFrame(landmarker.detectForVideo(video, performance.now()))
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
  }, [enabled, restartKey, stopCamera, handleFrame])

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
    off: { label: 'Air pointer off', dot: 'bg-white/30' },
    starting: { label: 'Starting camera…', dot: 'bg-yellow-400 animate-pulse' },
    active: { label: handLost ? 'Move hand into view' : 'Camera on · watching', dot: handLost ? 'bg-white/40' : 'bg-green-400 animate-pulse' },
    error: { label: error || 'Camera error', dot: 'bg-red-400' },
  }[status]

  return (
    <>
      {enabled && (
        <div className="fixed inset-0 z-[-1] pointer-events-none">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover -scale-x-100"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-black/50 via-black/25 to-black/50"></div>
        </div>
      )}

      {enabled && status !== 'off' && status !== 'error' && (
        <div
          ref={reticleRef}
          className="pointer-events-none fixed z-[10002]"
          style={{ left: -999, top: -999, opacity: 0 }}
        >
          <div className={`relative w-14 h-14 transition-all duration-150 ${handLost ? 'opacity-30' : 'opacity-100'} ${pinching ? 'scale-75' : 'scale-100'}`}>
            <div className={`absolute inset-0 rounded-full border-2 transition-colors ${
              pinching
                ? 'border-white bg-accent/30 shadow-[0_0_30px_rgba(212,252,212,0.9)]'
                : 'border-accent/80 shadow-[0_0_20px_rgba(212,252,212,0.5)]'
            }`}></div>
            <div className="absolute inset-1 rounded-full border border-accent/30"></div>
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full transition-colors ${pinching ? 'bg-white' : 'bg-accent'}`}></div>
            <div className="absolute -inset-2 rounded-full border border-dashed border-white/10 animate-spin-slow"></div>
          </div>
        </div>
      )}

      <div className={`fixed bottom-6 left-6 z-[90] flex flex-col gap-2 items-start transition-opacity ${hidden ? 'duration-[8000ms] opacity-0 pointer-events-none' : 'duration-300 opacity-100'}`}>
        <HoverLabel label={enabled ? 'Disable air pointer' : 'Control the app with your hand'}>
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
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
          </svg>
          <span className="text-xs font-semibold tracking-wide">
            {enabled ? 'Pointer ON' : 'Air Pointer'}
          </span>
        </button>
      </HoverLabel>

      {enabled && status !== 'off' && (
        <div className="px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-[11px] text-white/60 backdrop-blur-xl max-w-[240px] leading-relaxed">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`}></span>
            <span>{statusMeta.label}</span>
          </div>
          {status === 'active' && (
            <div className="mt-2 pt-2 border-t border-white/10 flex items-center gap-3 text-white/40">
              <span>👉 Point</span>
              <span>🤏 Pinch to click</span>
            </div>
          )}
          {status === 'active' && (
            <p className="mt-1.5 text-[10px] text-white/25">Local-only · nothing leaves your device</p>
          )}
        </div>
      )}

      {status === 'error' && (
        <div className="px-3 py-2 rounded-xl bg-red-950/70 border border-red-500/30 text-[11px] text-red-300 backdrop-blur-xl max-w-[240px] leading-relaxed">
          {error} — click the toggle to retry.
        </div>
      )}
      </div>
    </>
  )
}

export default AirPointer
