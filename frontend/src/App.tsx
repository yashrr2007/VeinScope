import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, ArrowDownToLine, ArrowRight, BadgeCheck, Camera, Check, ChevronDown,
  CircleAlert, Clock3, FileImage, FileVideo, FlaskConical, Gauge, History,
  LayoutDashboard, LoaderCircle, Play, Plus, ScanLine, ShieldCheck, Sparkles,
  Trash2, Upload, Waves, X,
} from 'lucide-react'
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { analyzeFrames, analyzeVideo, checkApi } from './api'
import { fileToDataUrl, makeSyntheticFrames } from './demo'
import type { AnalysisResult, CandidateSummary, HistoryItem, InputFrame } from './types'

type Page = 'overview' | 'analysis' | 'history'
type Mode = 'demo' | 'upload' | 'camera'
type PhaseName = 'baseline' | 'response' | 'recovery'
type PhaseFields = Record<PhaseName, { start: string; end: string }>

const API_NOTE = 'NIR-sensitive camera required. An ordinary webcam may not capture vein patterns.'
const EMPTY_PHASES: PhaseFields = {
  baseline: { start: '', end: '' },
  response: { start: '', end: '' },
  recovery: { start: '', end: '' },
}
const HISTORY_KEY = 'veinscope.history.v1'
const FULL_ROI = { x: 0, y: 0, width: 1, height: 1 }

function readHistory(): HistoryItem[] {
  try {
    const value = localStorage.getItem(HISTORY_KEY)
    return value ? JSON.parse(value) as HistoryItem[] : []
  } catch {
    return []
  }
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function parsePhases(enabled: boolean, fields: PhaseFields) {
  if (!enabled) return null
  const parsed: Record<string, { start: number; end: number }> = {}
  for (const name of ['baseline', 'response', 'recovery'] as PhaseName[]) {
    const start = Number(fields[name].start)
    const end = Number(fields[name].end)
    if (fields[name].start.trim() === '' || fields[name].end.trim() === '' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error(`Enter a valid start and end time for the ${name} phase.`)
    }
    parsed[name] = { start, end }
  }
  return parsed
}

function App() {
  const [page, setPage] = useState<Page>('overview')
  const [mode, setMode] = useState<Mode>('demo')
  const [file, setFile] = useState<File | null>(null)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [inputFrames, setInputFrames] = useState<InputFrame[]>([])
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null)
  const [activeFrame, setActiveFrame] = useState(0)
  const [overlayOn, setOverlayOn] = useState(true)
  const [overlayOpacity, setOverlayOpacity] = useState(0.66)
  const [loading, setLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [apiOnline, setApiOnline] = useState<boolean | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>(readHistory)
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraProgress, setCameraProgress] = useState(0)
  const [phasesEnabled, setPhasesEnabled] = useState(false)
  const [phaseFields, setPhaseFields] = useState<PhaseFields>(EMPTY_PHASES)
  const [roiFields, setRoiFields] = useState({ x: '0', y: '0', width: '100', height: '100' })
  const [roiOpen, setRoiOpen] = useState(false)
  const [qualityOnly, setQualityOnly] = useState(false)
  const [selectedHistory, setSelectedHistory] = useState<HistoryItem | null>(null)
  const cameraRef = useRef<HTMLVideoElement>(null)
  const uploadVideoRef = useRef<HTMLVideoElement>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const slideshowRef = useRef<number | null>(null)

  useEffect(() => {
    checkApi().then(() => setApiOnline(true)).catch(() => setApiOnline(false))
    const timer = window.setInterval(() => {
      checkApi().then(() => setApiOnline(true)).catch(() => setApiOnline(false))
    }, 15000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (file && file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file)
      setObjectUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    setObjectUrl(null)
  }, [file])

  useEffect(() => {
    if (cameraOn && cameraRef.current && cameraStreamRef.current) {
      cameraRef.current.srcObject = cameraStreamRef.current
      void cameraRef.current.play().catch(() => undefined)
    }
  }, [cameraOn, page])

  useEffect(() => () => {
    cameraStreamRef.current?.getTracks().forEach(track => track.stop())
    if (slideshowRef.current !== null) window.clearInterval(slideshowRef.current)
  }, [])

  useEffect(() => {
    if (result) setActiveFrame(current => Math.min(current, Math.max(0, result.frames.length - 1)))
  }, [result])

  const roi = useMemo(() => {
    const x = Math.max(0, Math.min(99, Number(roiFields.x) || 0)) / 100
    const y = Math.max(0, Math.min(99, Number(roiFields.y) || 0)) / 100
    const width = Math.max(1, Math.min(100 - x * 100, Number(roiFields.width) || 100)) / 100
    const height = Math.max(1, Math.min(100 - y * 100, Number(roiFields.height) || 100)) / 100
    return { x, y, width, height }
  }, [roiFields])

  const activeResultFrame = result?.frames[Math.min(activeFrame, Math.max(0, result.frames.length - 1))]
  const activeCandidate = result?.candidates.find(candidate => candidate.path_id === selectedCandidate) ?? result?.candidates[0]

  const saveSession = useCallback((analysis: AnalysisResult, title: string) => {
    const item: HistoryItem = {
      session_id: analysis.session_id,
      title,
      created_at: new Date().toISOString(),
      source: analysis.source,
      frame_count: analysis.frame_count,
      candidate_count: analysis.candidates.length,
    }
    setHistory(current => {
      const next = [item, ...current.filter(entry => entry.session_id !== item.session_id)].slice(0, 30)
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const acceptResult = useCallback((analysis: AnalysisResult, title: string) => {
    setResult(analysis)
    setActiveFrame(0)
    setSelectedCandidate(analysis.candidates[0]?.path_id ?? null)
    setPage('analysis')
    setSuccess(`Analysis complete · ${analysis.frame_count} frames processed locally.`)
    saveSession(analysis, title)
    setTimeout(() => setSuccess(''), 4500)
  }, [saveSession])

  const getPhases = () => parsePhases(phasesEnabled, phaseFields)

  const runFrames = async (frames: InputFrame[], title: string, source: string) => {
    if (!frames.length) throw new Error('No frames are ready to analyze.')
    if (frames.length > 48) throw new Error('Choose a shorter clip; the prototype analyzes up to 48 frames per session.')
    const phases = getPhases()
    const analysis = await analyzeFrames(frames.map(frame => frame.dataUrl), frames.map(frame => frame.time_s), phases, roi)
    analysis.source = source
    setInputFrames(frames)
    acceptResult(analysis, title)
  }

  const runAnalysis = async () => {
    setError('')
    setSuccess('')
    setLoading(true)
    setLoadingText('Checking frame quality and mapping candidate paths…')
    try {
      if (mode === 'upload' && file) {
        if (file.type.startsWith('video/')) {
          const phases = getPhases()
          const analysis = await analyzeVideo(file, phases, roi)
          acceptResult(analysis, file.name)
        } else if (file.type.startsWith('image/')) {
          const image = await fileToDataUrl(file)
          await runFrames([{ dataUrl: image, time_s: 0 }], file.name, 'uploaded-image')
        } else {
          throw new Error('Choose a supported image or video file.')
        }
      } else if (mode === 'camera') {
        if (!cameraOn || !cameraRef.current) throw new Error('Start the camera first, then capture a short frame sequence.')
        setLoadingText('Capturing a short local frame sequence…')
        const video = cameraRef.current
        const width = Math.min(960, video.videoWidth || 640)
        const height = Math.round(width * ((video.videoHeight || 480) / (video.videoWidth || 640)))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')!
        const captured: InputFrame[] = []
        const captureCount = 16
        for (let index = 0; index < captureCount; index += 1) {
          if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) throw new Error('Camera is not ready yet. Wait a moment and capture again.')
          ctx.drawImage(video, 0, 0, width, height)
          captured.push({ dataUrl: canvas.toDataURL('image/jpeg', 0.84), time_s: index * 0.18 })
          setCameraProgress(Math.round(((index + 1) / captureCount) * 100))
          await new Promise(resolve => window.setTimeout(resolve, 130))
        }
        setCameraProgress(0)
        setLoadingText('Analyzing captured frames locally…')
        await runFrames(captured, 'Camera capture', 'camera-capture')
      } else {
        if (!inputFrames.length) throw new Error('Load the built-in synthetic demo first.')
        await runFrames(inputFrames, 'Synthetic demo', 'synthetic-demo')
      }
    } catch (caught) {
      setError(messageFrom(caught))
    } finally {
      setLoading(false)
      setLoadingText('')
      setCameraProgress(0)
    }
  }

  const loadDemo = async (andAnalyze = true) => {
    setMode('demo')
    setFile(null)
    setError('')
    setResult(null)
    const frames = makeSyntheticFrames()
    setInputFrames(frames)
    setActiveFrame(0)
    setPage('analysis')
    if (andAnalyze) {
      setLoading(true)
      setLoadingText('Generating and analyzing synthetic frames…')
      try {
        const analysis = await analyzeFrames(frames.map(frame => frame.dataUrl), frames.map(frame => frame.time_s), null, roi)
        analysis.source = 'synthetic-demo'
        acceptResult(analysis, 'Synthetic demo')
      } catch (caught) {
        setError(messageFrom(caught))
      } finally {
        setLoading(false)
        setLoadingText('')
      }
    }
  }

  const chooseFile = async (selected: File | undefined) => {
    setError('')
    setSuccess('')
    setResult(null)
    setInputFrames([])
    setFile(selected ?? null)
    if (!selected) return
    if (selected.size > 100 * 1024 * 1024) {
      setFile(null)
      setError('The file is larger than the 100 MB upload limit.')
      return
    }
    if (selected.type.startsWith('image/')) {
      try {
        const dataUrl = await fileToDataUrl(selected)
        setInputFrames([{ dataUrl, time_s: 0 }])
      } catch (caught) {
        setError(messageFrom(caught))
      }
    }
  }

  const startCamera = async () => {
    setError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not available in this browser context.')
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 720 } }, audio: false })
      cameraStreamRef.current?.getTracks().forEach(track => track.stop())
      cameraStreamRef.current = stream
      setCameraOn(true)
      setSuccess('Camera connected. Confirm that the camera is NIR-sensitive for NIR capture.')
    } catch (caught) {
      setError(messageFrom(caught))
    }
  }

  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach(track => track.stop())
    cameraStreamRef.current = null
    setCameraOn(false)
  }

  const handleUploadVideoTime = () => {
    const video = uploadVideoRef.current
    if (!video || !result?.frames.length) return
    let nearestIndex = 0
    let smallest = Infinity
    result.frames.forEach((frame, index) => {
      const distance = Math.abs(frame.time_s - video.currentTime)
      if (distance < smallest) { smallest = distance; nearestIndex = index }
    })
    setActiveFrame(nearestIndex)
  }

  const playSynthetic = () => {
    if (!result || result.frames.length < 2) return
    if (slideshowRef.current !== null) {
      window.clearInterval(slideshowRef.current)
      slideshowRef.current = null
      return
    }
    slideshowRef.current = window.setInterval(() => {
      setActiveFrame(current => {
        const next = (current + 1) % result.frames.length
        return next
      })
    }, 250)
  }

  const updatePhase = (name: PhaseName, edge: 'start' | 'end', value: string) => {
    setPhaseFields(current => ({ ...current, [name]: { ...current[name], [edge]: value } }))
  }

  const downloadCsv = () => {
    if (!result) return
    const rows = [['path_id', 'visibility_rank', 'visibility_score', 'continuity_pct', 'apparent_width_px', 'stability_score', 'confidence_pct', 'experimental_response_score', 'time_s', 'detected_width_px']]
    result.candidates.forEach(candidate => {
      candidate.time_series.forEach(point => rows.push([
        candidate.path_id,
        String(candidate.visibility_rank),
        String(candidate.visibility_score),
        String(candidate.continuity_pct),
        String(candidate.mean_apparent_width_px),
        String(candidate.stability_score),
        String(candidate.confidence_pct),
        candidate.experimental_response_score == null ? '' : String(candidate.experimental_response_score),
        String(point.time_s),
        String(point.apparent_width_px),
      ]))
    })
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `veinscope-${result.session_id.slice(0, 8)}.csv`)
  }

  const downloadSummary = () => {
    if (!result) return
    const lines = [
      'VeinScope research prototype — analysis summary',
      `Session: ${result.session_id}`,
      `Source: ${result.source}`,
      `Frames analyzed: ${result.frame_count}`,
      `Candidate paths: ${result.candidates.length}`,
      '',
      'Candidate visibility summaries (not clinical access recommendations):',
      ...result.candidates.map(c => `${c.path_id}: visibility ${c.visibility_score}/100; continuity ${c.continuity_pct}%; stability ${c.stability_score}/100; mean apparent width ${c.mean_apparent_width_px}px; experimental response score ${c.experimental_response_score ?? 'not calculated'}`),
      '',
      'Limitations: NIR images alone do not establish vein depth, patency, or safety for access. The visibility ranking and any Vein Response Score are experimental, unvalidated research features and must not be used to choose an injection site.',
      'Synthetic demo data, when used, is generated and is not patient data.',
    ]
    downloadBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `veinscope-summary-${result.session_id.slice(0, 8)}.txt`)
  }

  const deleteHistory = (sessionId: string) => {
    setHistory(current => {
      const next = current.filter(item => item.session_id !== sessionId)
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      return next
    })
    if (selectedHistory?.session_id === sessionId) setSelectedHistory(null)
  }

  const openSavedSession = (item: HistoryItem) => {
    setSelectedHistory(item)
  }

  const nav = (target: Page) => {
    setPage(target)
    setError('')
    if (target !== 'analysis' && cameraOn) stopCamera()
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup" onClick={() => nav('overview')} role="button" tabIndex={0}>
          <div className="brand-mark"><Waves size={20} strokeWidth={2.1} /></div>
          <div><span className="brand-name">veinscope</span><span className="brand-caption">NIR research studio</span></div>
        </div>
        <div className="sidebar-section-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <button className={page === 'overview' ? 'nav-item active' : 'nav-item'} onClick={() => nav('overview')}><LayoutDashboard size={17} /><span>Overview</span></button>
          <button className={page === 'analysis' ? 'nav-item active' : 'nav-item'} onClick={() => nav('analysis')}><ScanLine size={17} /><span>Analysis studio</span>{result && <span className="nav-dot" />}</button>
          <button className={page === 'history' ? 'nav-item active' : 'nav-item'} onClick={() => nav('history')}><History size={17} /><span>Session history</span><span className="nav-count">{history.length}</span></button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-note">
          <div className="note-icon"><ShieldCheck size={16} /></div>
          <div><strong>Local by design</strong><span>Frames are processed by your local API. Session summaries stay in this browser.</span></div>
        </div>
        <div className="sidebar-footer"><span className="status-dot" /> Prototype v0.1 <span className="footer-sep">·</span> Research use</div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="breadcrumb"><span>VeinScope</span><ChevronDown size={14} className="crumb-chevron" /><strong>{page === 'overview' ? 'Overview' : page === 'analysis' ? 'Analysis studio' : 'Session history'}</strong></div>
          <div className="topbar-right">
            <span className={apiOnline ? 'api-pill online' : 'api-pill offline'}><span className="status-dot" />{apiOnline ? 'Local API connected' : apiOnline === false ? 'API offline' : 'Checking API'}</span>
            <button className="topbar-action" onClick={() => { void loadDemo(true) }}><Plus size={16} /> New analysis</button>
            <div className="avatar">VS</div>
          </div>
        </header>

        {apiOnline === false && <div className="api-banner"><CircleAlert size={18} /><div><strong>Local analysis service isn’t connected.</strong><span>Start the FastAPI backend using the README commands. Your files stay local; the demo will run as soon as the API is available.</span></div><button onClick={() => checkApi().then(() => setApiOnline(true)).catch(() => setApiOnline(false))}>Retry</button></div>}
        {success && <div className="toast success-toast"><Check size={16} />{success}<button onClick={() => setSuccess('')} aria-label="Dismiss"><X size={15} /></button></div>}

        {page === 'overview' && <OverviewPage onStart={() => { nav('analysis'); void loadDemo(false) }} onDemo={() => { void loadDemo(true) }} history={history} />}
        {page === 'analysis' && <AnalysisPage
          mode={mode} setMode={setMode} file={file} objectUrl={objectUrl} onFile={chooseFile}
          result={result} activeFrame={activeFrame} setActiveFrame={setActiveFrame}
          inputFrames={inputFrames} selectedCandidate={selectedCandidate} setSelectedCandidate={setSelectedCandidate}
          activeResultFrame={activeResultFrame} activeCandidate={activeCandidate}
          overlayOn={overlayOn} setOverlayOn={setOverlayOn} overlayOpacity={overlayOpacity} setOverlayOpacity={setOverlayOpacity}
          loading={loading} loadingText={loadingText} error={error} apiOnline={apiOnline}
          onAnalyze={() => void runAnalysis()} onLoadDemo={() => void loadDemo(false)}
          cameraOn={cameraOn} cameraRef={cameraRef} startCamera={() => void startCamera()} stopCamera={stopCamera}
          captureProgress={cameraProgress} onTimeUpdate={handleUploadVideoTime} uploadVideoRef={uploadVideoRef}
          phasesEnabled={phasesEnabled} setPhasesEnabled={setPhasesEnabled} phaseFields={phaseFields} updatePhase={updatePhase}
          roiFields={roiFields} setRoiFields={setRoiFields} roiOpen={roiOpen} setRoiOpen={setRoiOpen}
          qualityOnly={qualityOnly} setQualityOnly={setQualityOnly} onDownloadCsv={downloadCsv} onDownloadSummary={downloadSummary}
          onPlay={playSynthetic}
        />}
        {page === 'history' && <HistoryPage history={history} onDelete={deleteHistory} onOpen={openSavedSession} selected={selectedHistory} />}
      </main>
    </div>
  )
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

function OverviewPage({ onStart, onDemo, history }: { onStart: () => void; onDemo: () => void; history: HistoryItem[] }) {
  return (
    <div className="page-content overview-page">
      <div className="eyebrow"><span className="eyebrow-line" /> IMAGE ANALYSIS / 01</div>
      <section className="hero-grid">
        <div className="hero-copy">
          <div className="hero-kicker"><Sparkles size={14} /> COMPUTER VISION WORKBENCH</div>
          <h1>See the pattern.<br /><em>Study the change.</em></h1>
          <p className="hero-lede">A local research prototype for exploring NIR-like vein maps and how candidate paths appear across a short sequence.</p>
          <div className="hero-actions">
            <button className="button-primary" onClick={onStart}>Open analysis studio <ArrowRight size={17} /></button>
            <button className="button-secondary" onClick={onDemo}><Play size={15} fill="currentColor" /> Run synthetic demo</button>
          </div>
          <div className="hero-caption"><span className="status-dot" /> Local processing <span className="tiny-divider">·</span> No account needed <span className="tiny-divider">·</span> Demo data included</div>
        </div>
        <div className="hero-visual-card">
          <div className="visual-topline"><span><span className="live-dot" /> SYNTHETIC PREVIEW</span><span className="mono">FRAME 08 / 24</span></div>
          <VeinIllustration />
          <div className="visual-bottomline"><span><span className="legend-line" /> Candidate paths</span><span>Illustrative · not patient data</span></div>
        </div>
      </section>

      <div className="section-heading"><div><div className="eyebrow small">TWO ANALYSIS LAYERS</div><h2>From a frame to a time series</h2></div><span className="section-side-note">A transparent baseline, designed to be inspectable.</span></div>
      <section className="module-grid">
        <article className="module-card">
          <div className="module-number">01</div><div className="module-icon mint"><ScanLine size={19} /></div>
          <div className="module-text"><div className="module-overline">SPATIAL ANALYSIS</div><h3>NIR vein mapping</h3><p>Contrast normalization and ridge enhancement produce candidate paths, with apparent width, continuity, and image-quality context.</p></div>
          <div className="module-footer"><span>Classical CV baseline</span><ArrowRight size={15} /></div>
        </article>
        <article className="module-card">
          <div className="module-number">02</div><div className="module-icon violet"><Activity size={19} /></div>
          <div className="module-text"><div className="module-overline">TEMPORAL ANALYSIS</div><h3>Dynamic state assessment</h3><p>Tracks candidate paths over time and compares stability. Response features appear only when phases are explicitly marked.</p></div>
          <div className="module-footer"><span>Experimental score</span><ArrowRight size={15} /></div>
        </article>
        <article className="module-card compact-card">
          <div className="module-number">03</div><div className="module-icon amber"><Gauge size={19} /></div>
          <div className="module-text"><div className="module-overline">TRANSPARENT OUTPUTS</div><h3>Review the evidence</h3><p>Inspect overlays, quality flags, component scores, and exported measurements.</p></div>
          <div className="module-footer"><span>Human review stays central</span><ArrowRight size={15} /></div>
        </article>
      </section>

      <section className="overview-bottom">
        <div className="scope-card"><div className="scope-icon"><FlaskConical size={18} /></div><div><strong>Research prototype boundary</strong><p>VeinScope shows patterns in images. NIR alone does not establish depth, patency, or safe access. This prototype does not choose an injection point.</p></div><span className="scope-tag">NOT FOR CLINICAL USE</span></div>
        <div className="recent-card"><div className="recent-heading"><div><span className="eyebrow small">LOCAL ONLY</span><h3>Recent sessions</h3></div><button onClick={onDemo} aria-label="Run synthetic demo"><ArrowRight size={17} /></button></div>
          {history.length === 0 ? <div className="empty-recent"><Clock3 size={16} /> No saved analysis summaries yet.</div> : history.slice(0, 3).map(item => <div className="recent-row" key={item.session_id}><span className="recent-icon"><FileImage size={15} /></span><div><strong>{item.title}</strong><small>{new Date(item.created_at).toLocaleString()}</small></div><span className="recent-count">{item.candidate_count} paths</span></div>)}
        </div>
      </section>
      <div className="page-footnote"><ShieldCheck size={14} /> Images are not stored in session history. Only a short analysis summary is kept in this browser.</div>
    </div>
  )
}

function VeinIllustration() {
  return <div className="illustration-stage">
    <div className="scan-corner corner-tl" /><div className="scan-corner corner-tr" /><div className="scan-corner corner-bl" /><div className="scan-corner corner-br" />
    <div className="scan-glow" />
    <svg viewBox="0 0 520 280" className="vein-svg" aria-label="Synthetic vein path illustration" role="img">
      <defs><filter id="glow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <path className="vein-shadow" d="M35 220 C100 185 150 175 208 143 S315 105 365 73 S440 55 488 32" />
      <path className="vein-path" d="M35 220 C100 185 150 175 208 143 S315 105 365 73 S440 55 488 32" />
      <path className="vein-path secondary" d="M70 46 C120 68 154 98 203 112 S270 144 324 191 S417 228 474 246" />
      <path className="vein-path thin" d="M224 143 C214 111 189 90 159 75" />
      <circle className="scan-point" cx="208" cy="143" r="5" /><circle className="scan-ring" cx="208" cy="143" r="12" />
      <circle className="scan-point second" cx="365" cy="73" r="4" />
      <text x="220" y="132" className="svg-label">PATH 01</text><text x="373" y="64" className="svg-label faint">TRACKED</text>
    </svg>
    <div className="visual-readout"><span>TRACK PERSISTENCE</span><strong>94.2<span>%</span></strong></div>
    <div className="visual-axis"><span>00:00</span><span className="axis-line" /><span>00:08</span></div>
  </div>
}

type AnalysisProps = {
  mode: Mode; setMode: (mode: Mode) => void; file: File | null; objectUrl: string | null; onFile: (file: File | undefined) => void
  result: AnalysisResult | null; activeFrame: number; setActiveFrame: (n: number) => void; inputFrames: InputFrame[]
  selectedCandidate: string | null; setSelectedCandidate: (id: string | null) => void
  activeResultFrame: AnalysisResult['frames'][number] | undefined; activeCandidate: CandidateSummary | undefined
  overlayOn: boolean; setOverlayOn: (value: boolean) => void; overlayOpacity: number; setOverlayOpacity: (value: number) => void
  loading: boolean; loadingText: string; error: string; apiOnline: boolean | null
  onAnalyze: () => void; onLoadDemo: () => void
  cameraOn: boolean; cameraRef: React.RefObject<HTMLVideoElement | null>; startCamera: () => void; stopCamera: () => void
  captureProgress: number; onTimeUpdate: () => void; uploadVideoRef: React.RefObject<HTMLVideoElement | null>
  phasesEnabled: boolean; setPhasesEnabled: (value: boolean) => void; phaseFields: PhaseFields; updatePhase: (name: PhaseName, edge: 'start' | 'end', value: string) => void
  roiFields: { x: string; y: string; width: string; height: string }; setRoiFields: (value: { x: string; y: string; width: string; height: string }) => void
  roiOpen: boolean; setRoiOpen: (value: boolean) => void; qualityOnly: boolean; setQualityOnly: (value: boolean) => void
  onDownloadCsv: () => void; onDownloadSummary: () => void; onPlay: () => void
}

function AnalysisPage(props: AnalysisProps) {
  const { mode, setMode, file, objectUrl, onFile, result, activeFrame, setActiveFrame, inputFrames, selectedCandidate, setSelectedCandidate,
    activeResultFrame, activeCandidate, overlayOn, setOverlayOn, overlayOpacity, setOverlayOpacity, loading, loadingText, error, apiOnline,
    onAnalyze, onLoadDemo, cameraOn, cameraRef, startCamera, stopCamera, captureProgress, onTimeUpdate, uploadVideoRef,
    phasesEnabled, setPhasesEnabled, phaseFields, updatePhase, roiFields, setRoiFields, roiOpen, setRoiOpen, qualityOnly, setQualityOnly,
    onDownloadCsv, onDownloadSummary, onPlay } = props
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isUploadedVideo = mode === 'upload' && Boolean(file?.type.startsWith('video/'))
  const isUploadedImage = mode === 'upload' && Boolean(file?.type.startsWith('image/'))
  const selectedFrame = result?.frames[Math.min(activeFrame, Math.max(0, (result?.frames.length ?? 1) - 1))]
  const sourceStill = inputFrames[Math.min(activeFrame, Math.max(0, inputFrames.length - 1))]
  const flags = selectedFrame?.quality.flags ?? []
  const phaseDuration = result?.video_duration_s ?? (result?.frames.at(-1)?.time_s ?? 0)

  return <div className="page-content analysis-page">
    <div className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-line" /> ANALYSIS WORKSPACE / 02</div><h1>Analysis studio</h1><p>Map candidate paths, then inspect their stability across the sampled sequence.</p></div><div className="title-actions"><span className="local-badge"><span className="status-dot" /> LOCAL WORKSPACE</span>{result && <button className="button-small" onClick={onDownloadSummary}><ArrowDownToLine size={15} /> Export summary</button>}</div></div>

    <div className="prototype-alert"><div className="alert-symbol"><CircleAlert size={17} /></div><div><strong>Research prototype · not for clinical use</strong><span>Visibility rankings and response scores are experimental image features. They do not identify a safe injection point.</span></div><span className="alert-tag">REVIEW REQUIRED</span></div>

    <div className="studio-grid">
      <section className="panel input-panel">
        <div className="panel-heading"><div><span className="panel-kicker">01 / INPUT SOURCE</span><h2>Choose a capture</h2></div><span className="panel-step">SOURCE</span></div>
        <div className="mode-tabs" role="tablist" aria-label="Input mode">
          <button className={mode === 'demo' ? 'mode-tab selected' : 'mode-tab'} onClick={() => setMode('demo')}><Sparkles size={15} /> Demo</button>
          <button className={mode === 'upload' ? 'mode-tab selected' : 'mode-tab'} onClick={() => setMode('upload')}><Upload size={15} /> Upload</button>
          <button className={mode === 'camera' ? 'mode-tab selected' : 'mode-tab'} onClick={() => setMode('camera')}><Camera size={15} /> Camera</button>
        </div>
        {mode === 'demo' && <div className="source-box demo-box"><div className="source-illustration"><div className="demo-wave"><Waves size={24} /></div><span className="demo-chip">GENERATED DATA</span></div><div className="source-box-copy"><strong>Explore with a synthetic clip</strong><p>24 generated grayscale frames with scripted pattern changes. The clip is illustrative, not physiological or patient data.</p><button className="text-button" onClick={onLoadDemo}><Sparkles size={14} /> Load demo frames <ArrowRight size={15} /></button></div></div>}
        {mode === 'upload' && <div className="upload-box" onClick={() => fileInputRef.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); onFile(event.dataTransfer.files[0]) }} role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') fileInputRef.current?.click() }}>
          <input ref={fileInputRef} type="file" accept="video/mp4,video/quicktime,video/x-msvideo,video/webm,video/x-matroska,image/*" onChange={event => onFile(event.target.files?.[0])} hidden />
          <div className="upload-icon"><Upload size={19} /></div><strong>{file ? file.name : 'Drop a video or image here'}</strong><span>{file ? `${(file.size / (1024 * 1024)).toFixed(1)} MB · ${isUploadedVideo ? 'video' : 'image'}` : 'or browse from your computer'}</span><small>MP4 · MOV · AVI · WebM · PNG · JPG <b>·</b> up to 100 MB</small>
        </div>}
        {mode === 'camera' && <div className="camera-source">
          <div className="camera-frame">{cameraOn ? <video ref={cameraRef} autoPlay muted playsInline /> : <div className="camera-placeholder"><Camera size={24} /><span>Camera preview will appear here</span></div>}{cameraOn && <span className="camera-live"><span className="live-dot" /> CAMERA CONNECTED</span>}</div>
          <div className="camera-actions">{cameraOn ? <button className="button-secondary compact" onClick={stopCamera}><X size={14} /> Stop camera</button> : <button className="button-secondary compact" onClick={startCamera}><Camera size={14} /> Start camera</button>}<span>Camera access is optional</span></div>
          <div className="inline-info"><CircleAlert size={14} />{API_NOTE}</div>
        </div>}

        <details className="advanced-controls" open={roiOpen} onToggle={event => setRoiOpen((event.currentTarget as HTMLDetailsElement).open)}>
          <summary>Advanced capture settings <ChevronDown size={15} /></summary>
          <div className="roi-controls"><div className="roi-caption"><strong>Region of interest</strong><span>Percent of frame, from top-left</span></div><div className="roi-grid">
            {(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{key}<div className="input-with-unit"><input type="number" min={key === 'x' || key === 'y' ? 0 : 1} max={100} value={roiFields[key]} onChange={event => setRoiFields({ ...roiFields, [key]: event.target.value })} /><span>%</span></div></label>)}
          </div></div>
          <div className="phase-settings"><label className="toggle-row"><input type="checkbox" checked={phasesEnabled} onChange={event => setPhasesEnabled(event.target.checked)} /><span className="toggle-ui" /><span><strong>Mark baseline / response / recovery phases</strong><small>Only enable for a defined recording protocol. Times are seconds.</small></span></label>
            {phasesEnabled && <div className="phase-grid">{(['baseline', 'response', 'recovery'] as PhaseName[]).map(name => <div className="phase-cell" key={name}><strong>{name}</strong><label>Start <input type="number" min="0" step="0.1" placeholder="0.0" value={phaseFields[name].start} onChange={event => updatePhase(name, 'start', event.target.value)} /></label><label>End <input type="number" min="0" step="0.1" placeholder="1.0" value={phaseFields[name].end} onChange={event => updatePhase(name, 'end', event.target.value)} /></label></div>)}</div>}
          </div>
        </details>
        <div className="source-footer"><span><ShieldCheck size={14} /> Files are processed locally</span><button className="button-primary analyze-button" disabled={loading || apiOnline === false || (mode === 'upload' && !file) || (mode === 'camera' && !cameraOn) || (mode === 'demo' && !inputFrames.length)} onClick={onAnalyze}>{loading ? <><LoaderCircle className="spin" size={16} /> Analyzing</> : <><ScanLine size={16} /> Analyze sequence</>}</button></div>
        {loading && <div className="progress-note"><span className="progress-track"><i /></span>{cameraProgress ? `Capturing frames ${cameraProgress}%` : loadingText}</div>}
        {error && <div className="inline-error"><CircleAlert size={15} />{error}</div>}
        {apiOnline === false && <div className="inline-error muted-error"><CircleAlert size={15} />Start the API server before analyzing. See README.</div>}
      </section>

      <section className="panel viewer-panel">
        <div className="panel-heading"><div><span className="panel-kicker">02 / SPATIAL MAPPING</span><h2>Candidate paths</h2></div><div className="viewer-controls"><button className={overlayOn ? 'icon-toggle on' : 'icon-toggle'} onClick={() => setOverlayOn(!overlayOn)} title="Toggle mask overlay"><Waves size={16} /></button><button className="button-outline tiny" onClick={() => setQualityOnly(!qualityOnly)}>{qualityOnly ? 'Show all paths' : 'Quality flags'}</button></div></div>
        <div className="viewer-stage">
          {(isUploadedVideo && objectUrl) ? <div className="media-frame" style={{ aspectRatio: `${selectedFrame?.width ?? 16} / ${selectedFrame?.height ?? 9}` }}>
            <video ref={uploadVideoRef} src={objectUrl} controls onTimeUpdate={onTimeUpdate} onLoadedMetadata={onTimeUpdate} />
            {overlayOn && selectedFrame?.mask_data_url && <img className="mask-overlay" style={{ opacity: overlayOpacity }} src={selectedFrame.mask_data_url} alt="Detected candidate path overlay" />}
            {result && selectedFrame && <CandidateBoxes frame={selectedFrame} selected={selectedCandidate} />}
            {!result && <div className="viewer-empty-overlay">Run analysis to view path overlays.</div>}
          </div> : (sourceStill && selectedFrame) ? <div className="media-frame" style={{ aspectRatio: `${selectedFrame.width} / ${selectedFrame.height}` }}>
            <img className="source-image" src={sourceStill.dataUrl} alt={mode === 'demo' ? 'Synthetic NIR-like demo frame' : 'Selected input frame'} />
            {overlayOn && selectedFrame.mask_data_url && <img className="mask-overlay" style={{ opacity: overlayOpacity }} src={selectedFrame.mask_data_url} alt="Detected candidate path overlay" />}
            <CandidateBoxes frame={selectedFrame} selected={selectedCandidate} />
          </div> : <div className="viewer-empty"><div className="empty-scan"><ScanLine size={23} /></div><strong>Your image space</strong><span>Load synthetic frames, an image, or a video to map candidate paths.</span></div>}
          {result && selectedFrame && <div className="frame-badge"><span className="live-dot" />{result.source === 'synthetic-demo' ? 'SYNTHETIC' : 'FRAME'} <b>{String(selectedFrame.index + 1).padStart(2, '0')}</b><span>/ {result.frame_count}</span></div>}
        </div>
        {result && <div className="viewer-bottom-controls"><div className="playback-controls">{!isUploadedVideo && <button className="play-button" onClick={onPlay} aria-label="Play frame sequence"><Play size={14} fill="currentColor" /></button>}<span className="time-code">{selectedFrame?.time_s.toFixed(2) ?? '0.00'} s</span><input className="frame-scrubber" type="range" min={0} max={Math.max(0, result.frames.length - 1)} value={activeFrame} onChange={event => setActiveFrame(Number(event.target.value))} /><span className="time-total">{result.frames.length} FRAMES</span></div><div className="opacity-control"><span>OVERLAY</span><input type="range" min={0.1} max={1} step={0.05} value={overlayOpacity} onChange={event => setOverlayOpacity(Number(event.target.value))} disabled={!overlayOn} /></div></div>}
        {result && selectedFrame && <div className="quality-strip"><div className="quality-heading"><span className={flags.length ? 'quality-indicator warn' : 'quality-indicator'} />FRAME QUALITY</div><span>Blur <b>{selectedFrame.quality.blur_score}</b></span><span>Contrast <b>{selectedFrame.quality.contrast_score}</b></span><span>Illumination <b>{selectedFrame.quality.illumination_spread}</b></span>{flags.length ? <span className="quality-flags">{flags.join(' · ')}</span> : <span className="quality-good">No flags</span>}</div>}
        <div className="viewer-legend"><span><i className="legend-chip mint-chip" /> Segmented ridge pixels</span><span><i className="legend-chip outline-chip" /> Tracked candidate boundary</span><span className="legend-disclaimer">Apparent width is image-based · px</span></div>
      </section>
    </div>

    {result && <>
      <section className="metrics-row"><MetricCard label="CANDIDATE PATHS" value={String(result.candidates.length).padStart(2, '0')} note="Tracked across sampled frames" icon={<Waves size={16} />} /><MetricCard label="FRAMES ANALYZED" value={String(result.frame_count).padStart(2, '0')} note="Sampled from local source" icon={<FileVideo size={16} />} /><MetricCard label="TOP VISIBILITY" value={result.candidates[0] ? `${result.candidates[0].visibility_score}` : '—'} note={result.candidates[0] ? `${result.candidates[0].path_id} · experimental rank` : 'No path detected'} icon={<Gauge size={16} />} /><MetricCard label="SELECTED PATH STABILITY" value={activeCandidate ? `${activeCandidate.stability_score}` : '—'} note="0–100 image stability feature" icon={<Activity size={16} />} /></section>
      <div className="results-grid">
        <section className="panel candidates-panel"><div className="panel-heading result-heading"><div><span className="panel-kicker">03 / COMPARISON</span><h2>Candidate path summary</h2></div><button className="button-outline tiny" onClick={onDownloadCsv}><ArrowDownToLine size={14} /> CSV</button></div>
          <div className="table-wrap"><table><thead><tr><th>PATH</th><th>VISIBILITY<br />RANK</th><th>CONTINUITY</th><th>APPARENT WIDTH</th><th>STABILITY</th><th>CONFIDENCE</th><th>FLAGS</th></tr></thead><tbody>
            {result.candidates.filter(candidate => !qualityOnly || candidate.quality_flags.length > 0).map(candidate => <tr className={selectedCandidate === candidate.path_id ? 'selected-row' : ''} key={candidate.path_id} onClick={() => setSelectedCandidate(candidate.path_id)}>
              <td><span className="path-id"><i />{candidate.path_id}</span></td><td><span className="rank-pill">#{candidate.visibility_rank}</span><span className="table-score">{candidate.visibility_score}</span></td><td><div className="table-bar-cell"><span>{candidate.continuity_pct}%</span><i><b style={{ width: `${candidate.continuity_pct}%` }} /></i></div></td><td><span className="mono-value">{candidate.mean_apparent_width_px} <small>px</small></span></td><td><ScoreBar value={candidate.stability_score} /></td><td><span className="confidence-value">{candidate.confidence_pct}%</span></td><td>{candidate.quality_flags.length ? <span className="flag-pill">{candidate.quality_flags.length} flags</span> : <span className="clean-pill">Clear</span>}</td>
            </tr>)}
            {result.candidates.length === 0 && <tr><td colSpan={7} className="empty-table">No candidate paths were detected. Try another image, adjust the region of interest, or improve frame contrast.</td></tr>}
            {qualityOnly && result.candidates.length > 0 && result.candidates.every(candidate => !candidate.quality_flags.length) && <tr><td colSpan={7} className="empty-table">No candidate paths have quality flags.</td></tr>}
          </tbody></table></div>
          <div className="table-foot"><span><CircleAlert size={13} /> Visibility rank sorts image features; it is not a clinical suitability score.</span><span>Click a row to inspect its time series</span></div>
        </section>
        <section className="panel temporal-panel"><div className="panel-heading"><div><span className="panel-kicker">04 / TEMPORAL ANALYSIS</span><h2>Dynamic path features</h2></div><span className="chart-legend"><i /> {activeCandidate?.path_id ?? 'No selection'}</span></div>
          {activeCandidate ? <>
            <div className="chart-subtitle"><span>Apparent width over sampled frames</span><span>px <i className="chart-arrow">↗</i></span></div>
            <div className="chart-box"><ResponsiveContainer width="100%" height="100%"><LineChart data={activeCandidate.time_series} margin={{ top: 12, right: 10, left: -18, bottom: 0 }}><CartesianGrid stroke="#e8ece8" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="time_s" tickFormatter={value => `${Number(value).toFixed(1)}s`} tick={{ fill: '#82908a', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={22} /><YAxis tick={{ fill: '#82908a', fontSize: 10 }} axisLine={false} tickLine={false} width={38} /><Tooltip contentStyle={{ border: '1px solid #dfe7e1', borderRadius: 10, boxShadow: '0 8px 24px rgba(30,48,38,.08)', fontSize: 12 }} formatter={(value: number) => [`${value.toFixed(2)} px`, 'Apparent width']} labelFormatter={value => `${Number(value).toFixed(2)} seconds`} /><Line type="monotone" dataKey="apparent_width_px" stroke="#159e79" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#159e79', stroke: '#fff', strokeWidth: 2 }} /></LineChart></ResponsiveContainer></div>
            <div className="temporal-stats"><div><span>WIDTH VARIATION</span><strong>{activeCandidate.width_variation_pct}%</strong></div><div><span>MEAN PATH LENGTH</span><strong>{activeCandidate.mean_length_px} <small>px</small></strong></div><div><span>DETECTIONS</span><strong>{activeCandidate.continuity_pct}<small>%</small></strong></div></div>
          </> : <div className="empty-chart">Analyze a sequence to see temporal features.</div>}
        </section>
      </div>
      <section className="response-card"><div className="response-intro"><div className="response-icon"><Activity size={18} /></div><div><span className="panel-kicker">EXPERIMENTAL COMPARISON INDEX</span><h2>Vein Response Score</h2><p>Only calculated when baseline, response, and recovery phases are marked. It is a configurable engineering feature with no clinical validation.</p></div></div><div className="response-value-area">{activeCandidate?.experimental_response_score == null ? <div className="score-not-ready"><span className="score-dash">—</span><div><strong>Not calculated</strong><small>Mark all three recording phases to enable the experimental index.</small></div></div> : <><div className="response-score-value">{activeCandidate.experimental_response_score}<small>/ 100</small></div><div className="response-components">{Object.entries(activeCandidate.score_components ?? {}).map(([key, value]) => <div key={key}><span>{key.replaceAll('_', ' ')}</span><b>{value}{key.includes('pct') ? '%' : ''}</b></div>)}</div></>}</div><div className="response-disclaimer"><ShieldCheck size={16} /><span>For comparative research only. Does not predict cannulation success or identify a safe access site.</span></div></section>
      <div className="results-actions"><div><strong>Export your measurements</strong><span>CSV includes per-path summaries and sampled width observations.</span></div><div><button className="button-secondary" onClick={onDownloadCsv}><ArrowDownToLine size={15} /> Export CSV</button><button className="button-outline" onClick={onDownloadSummary}><FileImage size={15} /> Download summary</button></div></div>
    </>}
    {!result && <div className="analysis-empty-state"><div className="empty-state-icon"><ScanLine size={19} /></div><div><strong>Ready when you are</strong><span>{loading ? loadingText : 'Choose a source and analyze it to see candidate paths and temporal features.'}</span></div><div className="empty-state-safe"><ShieldCheck size={15} /> Local-first · No patient details collected</div></div>}
  </div>
}

function CandidateBoxes({ frame, selected }: { frame: AnalysisResult['frames'][number]; selected: string | null }) {
  return <svg className="candidate-boxes" viewBox={`0 0 ${frame.width} ${frame.height}`} preserveAspectRatio="none" aria-label="Candidate path bounds">
    {frame.candidates.map((candidate, index) => {
      const [x, y, width, height] = candidate.bbox
      const active = candidate.path_id === selected
      const label = candidate.path_id ?? `F${index + 1}`
      return <g key={`${candidate.frame_candidate_id}-${index}`} className={active ? 'candidate-box active' : 'candidate-box'}><rect x={x} y={y} width={width} height={height} rx={8} /><rect className="candidate-label-bg" x={x} y={Math.max(1, y - 22)} width={50} height={18} rx={5} /><text x={x + 7} y={Math.max(14, y - 9)}>{label}</text><circle cx={candidate.center_x} cy={candidate.center_y} r={4} /></g>
    })}
  </svg>
}

function MetricCard({ label, value, note, icon }: { label: string; value: string; note: string; icon: React.ReactNode }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><small>{note}</small></article>
}

function ScoreBar({ value }: { value: number }) {
  return <div className="score-bar"><span>{value}</span><i><b style={{ width: `${value}%` }} /></i></div>
}

function HistoryPage({ history, onDelete, onOpen, selected }: { history: HistoryItem[]; onDelete: (id: string) => void; onOpen: (item: HistoryItem) => void; selected: HistoryItem | null }) {
  return <div className="page-content history-page">
    <div className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-line" /> LOCAL STORAGE / 03</div><h1>Session history</h1><p>Only analysis summaries are saved here. Source images and video are not stored in history.</p></div><span className="local-badge"><span className="status-dot" /> THIS BROWSER ONLY</span></div>
    <section className="panel history-panel"><div className="panel-heading"><div><span className="panel-kicker">RECENT ANALYSES</span><h2>{history.length} saved {history.length === 1 ? 'session' : 'sessions'}</h2></div><button className="button-outline tiny" onClick={() => { if (confirm('Delete all saved session summaries from this browser?')) history.forEach(item => onDelete(item.session_id)) }} disabled={!history.length}><Trash2 size={14} /> Clear history</button></div>
      {history.length ? <div className="history-list">{history.map(item => <article className={selected?.session_id === item.session_id ? 'history-row selected' : 'history-row'} key={item.session_id}>
        <div className="history-file-icon">{item.source.includes('video') ? <FileVideo size={18} /> : <FileImage size={18} />}</div><div className="history-name"><strong>{item.title}</strong><span>{new Date(item.created_at).toLocaleString()}</span></div><span className="history-meta"><b>{item.candidate_count}</b> paths</span><span className="history-meta"><b>{item.frame_count}</b> frames</span><span className="history-source">{item.source.replaceAll('-', ' ')}</span><button className="row-open" onClick={() => onOpen(item)}>Details <ArrowRight size={14} /></button><button className="delete-icon" onClick={() => onDelete(item.session_id)} aria-label={`Delete ${item.title}`}><Trash2 size={15} /></button>
      </article>)}</div> : <div className="history-empty"><div className="empty-scan"><History size={21} /></div><strong>No analysis summaries yet</strong><span>Run a demo or analyze a local file to see it here.</span></div>}
    </section>
    {selected && <section className="panel history-detail"><div className="panel-heading"><div><span className="panel-kicker">SESSION DETAIL</span><h2>{selected.title}</h2></div><button className="icon-toggle" onClick={() => onOpen(selected)} aria-label="Close details"><X size={16} /></button></div><div className="detail-grid"><div><span>Created</span><strong>{new Date(selected.created_at).toLocaleString()}</strong></div><div><span>Input source</span><strong>{selected.source.replaceAll('-', ' ')}</strong></div><div><span>Frames</span><strong>{selected.frame_count}</strong></div><div><span>Candidate paths</span><strong>{selected.candidate_count}</strong></div></div><p className="history-detail-note"><CircleAlert size={14} /> The saved item contains summary metadata only. The original image/video is not available from session history.</p></section>}
    <div className="storage-actions"><div><ShieldCheck size={17} /><span><strong>Where is this stored?</strong><small>Summary metadata is stored in this browser’s localStorage. Clear browser site data or use “Clear history” to remove it.</small></span></div><span className="storage-code">{HISTORY_KEY}</span></div>
  </div>
}

export default App
