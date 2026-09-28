export type Quality = {
  blur_score: number
  contrast_score: number
  illumination_spread: number
  motion_score: number
  flags: string[]
}

export type FrameCandidate = {
  frame_candidate_id: string
  path_id?: string
  bbox: [number, number, number, number]
  center_x: number
  center_y: number
  apparent_width_px: number
  length_px: number
  branch_count: number
  confidence_pct: number
}

export type FrameResult = {
  index: number
  time_s: number
  width: number
  height: number
  mask_data_url: string
  quality: Quality
  candidates: FrameCandidate[]
}

export type TimePoint = {
  time_s: number
  apparent_width_px: number
  detected: boolean
  center_x: number
  center_y: number
}

export type CandidateSummary = {
  path_id: string
  visibility_rank: number
  visibility_score: number
  continuity_pct: number
  mean_apparent_width_px: number
  width_variation_pct: number
  mean_length_px: number
  stability_score: number
  confidence_pct: number
  quality_flags: string[]
  experimental_response_score: number | null
  score_components: Record<string, number> | null
  time_series: TimePoint[]
}

export type AnalysisResult = {
  session_id: string
  source: string
  frame_count: number
  experimental_score_note: string
  phases_used: Record<string, { start: number; end: number }>
  video_duration_s?: number | null
  frames: FrameResult[]
  candidates: CandidateSummary[]
}

export type HistoryItem = {
  session_id: string
  title: string
  created_at: string
  source: string
  frame_count: number
  candidate_count: number
}

export type InputFrame = { dataUrl: string; time_s: number }
