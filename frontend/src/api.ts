import type { AnalysisResult } from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

async function readResponse(response: Response): Promise<AnalysisResult> {
  if (!response.ok) {
    let message = `Analysis failed (${response.status}).`
    try {
      const body = await response.json()
      message = typeof body.detail === 'string' ? body.detail : message
    } catch { /* keep status message */ }
    throw new Error(message)
  }
  return response.json() as Promise<AnalysisResult>
}

export async function analyzeFrames(
  frames: string[],
  timestamps: number[],
  phases: Record<string, { start: number; end: number }> | null,
  roi: { x: number; y: number; width: number; height: number },
) {
  const response = await fetch(`${API_BASE}/api/analyze-frames`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frames, timestamps, phases, roi }),
  })
  return readResponse(response)
}

export async function analyzeVideo(
  file: File,
  phases: Record<string, { start: number; end: number }> | null,
  roi: { x: number; y: number; width: number; height: number },
) {
  const form = new FormData()
  form.append('file', file)
  if (phases) form.append('phases_json', JSON.stringify(phases))
  form.append('roi_json', JSON.stringify(roi))
  const response = await fetch(`${API_BASE}/api/analyze-video`, { method: 'POST', body: form })
  return readResponse(response)
}

export async function checkApi() {
  const response = await fetch(`${API_BASE}/api/health`)
  if (!response.ok) throw new Error('API is unavailable')
  return response.json() as Promise<{ status: string; name: string; version: string }>
}
