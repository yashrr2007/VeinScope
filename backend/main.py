from __future__ import annotations

import base64
import json
import math
import tempfile
import uuid
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from skimage.filters import frangi
from skimage.morphology import skeletonize

APP_VERSION = "0.1.0"
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_ANALYSIS_FRAMES = 48
MAX_DIMENSION = 1600
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}

app = FastAPI(
    title="VeinScope API",
    version=APP_VERSION,
    description="Local research prototype for NIR-like image visualization and temporal feature analysis.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class PhaseRange(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(gt=0)


class Roi(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class AnalyzeFramesRequest(BaseModel):
    frames: list[str] = Field(min_length=1, max_length=MAX_ANALYSIS_FRAMES)
    timestamps: list[float] | None = None
    phases: dict[str, PhaseRange] | None = None
    roi: Roi | None = None


def decode_image(value: str) -> np.ndarray:
    encoded = value.split(",", 1)[1] if value.startswith("data:") and "," in value else value
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="A frame could not be decoded as base64 image data.") from exc
    if len(raw) > 12 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Each image frame must be smaller than 12 MB.")
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=422, detail="A frame is not a supported image.")
    h, w = image.shape[:2]
    scale = min(1.0, MAX_DIMENSION / max(h, w))
    if scale < 1:
        image = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return image


def encode_mask(mask: np.ndarray) -> str:
    rgba = np.zeros((*mask.shape, 4), dtype=np.uint8)
    rgba[mask > 0] = (67, 230, 190, 178)
    ok, buffer = cv2.imencode(".png", rgba)
    if not ok:
        return ""
    return "data:image/png;base64," + base64.b64encode(buffer).decode("ascii")


def quality_report(gray: np.ndarray, previous_gray: np.ndarray | None) -> dict[str, Any]:
    blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    contrast = float(gray.std())
    tile_h = max(1, gray.shape[0] // 4)
    tile_w = max(1, gray.shape[1] // 4)
    tiles = [gray[y : y + tile_h, x : x + tile_w].mean()
             for y in range(0, gray.shape[0], tile_h)
             for x in range(0, gray.shape[1], tile_w)]
    illumination_spread = float(np.std(tiles)) if tiles else 0.0
    motion = 0.0
    if previous_gray is not None and previous_gray.shape == gray.shape:
        motion = float(cv2.absdiff(gray, previous_gray).mean())
    flags: list[str] = []
    if blur < 7:
        flags.append("possible-blur")
    if contrast < 10:
        flags.append("low-contrast")
    if illumination_spread > 45:
        flags.append("uneven-illumination")
    if motion > 28:
        flags.append("frame-motion")
    return {
        "blur_score": round(blur, 2),
        "contrast_score": round(contrast, 2),
        "illumination_spread": round(illumination_spread, 2),
        "motion_score": round(motion, 2),
        "flags": flags,
    }


def apply_roi(image: np.ndarray, roi: Roi | None) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    h, w = image.shape[:2]
    if roi is None:
        return image, (0, 0, w, h)
    x = min(w - 1, int(roi.x * w))
    y = min(h - 1, int(roi.y * h))
    rw = max(1, min(w - x, int(roi.width * w)))
    rh = max(1, min(h - y, int(roi.height * h)))
    return image[y : y + rh, x : x + rw], (x, y, rw, rh)


def classical_segment(image: np.ndarray, roi: Roi | None) -> tuple[np.ndarray, list[dict[str, Any]]]:
    gray_full = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray_crop, (ox, oy, rw, rh) = apply_roi(gray_full, roi)
    normalized = cv2.createCLAHE(clipLimit=2.1, tileGridSize=(8, 8)).apply(gray_crop)
    # Frangi enhances dark ridge-like structures. This baseline is a visualization aid,
    # not a trained or clinically validated vein classifier.
    ridge = frangi(normalized.astype(np.float32) / 255.0, sigmas=(1, 2, 3), black_ridges=True)
    if not np.isfinite(ridge).any() or float(ridge.max()) <= 1e-7:
        response = np.zeros_like(normalized, dtype=np.uint8)
    else:
        response = cv2.normalize(np.nan_to_num(ridge), None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    positive = response[response > 0]
    threshold = max(16, int(np.percentile(positive, 72))) if positive.size else 255
    mask_crop = np.where(response >= threshold, 255, 0).astype(np.uint8)
    mask_crop = cv2.morphologyEx(mask_crop, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(mask_crop, 8)
    mask_full = np.zeros_like(gray_full, dtype=np.uint8)
    candidates: list[dict[str, Any]] = []
    minimum_area = max(10, int(rw * rh * 0.000035))
    frame_diagonal = math.hypot(rw, rh)

    for label in range(1, count):
        x, y, bw, bh, area = [int(v) for v in stats[label]]
        if area < minimum_area:
            continue
        component = labels == label
        skeleton = skeletonize(component)
        sy, sx = np.nonzero(skeleton)
        skeleton_len = max(1, len(sx))
        if skeleton_len < 5:
            continue
        mask_full[oy : oy + rh, ox : ox + rw][component] = 255
        degree = cv2.filter2D(skeleton.astype(np.uint8), -1, np.ones((3, 3), np.uint8)) - skeleton.astype(np.uint8)
        branches = int(np.count_nonzero((degree >= 3) & skeleton))
        centroid_x = float(centroids[label][0] + ox)
        centroid_y = float(centroids[label][1] + oy)
        aspect = max(bw, bh) / max(1, min(bw, bh))
        apparent_width = float(area / skeleton_len)
        length_norm = min(1.0, skeleton_len / max(1.0, frame_diagonal * 0.28))
        confidence = float(np.clip(45 + 35 * length_norm + min(20, aspect * 2), 0, 96))
        candidates.append({
            "bbox": [x + ox, y + oy, bw, bh],
            "center_x": round(centroid_x, 2),
            "center_y": round(centroid_y, 2),
            "apparent_width_px": round(apparent_width, 2),
            "length_px": round(float(skeleton_len), 2),
            "branch_count": branches,
            "confidence_pct": round(confidence, 1),
        })

    candidates.sort(key=lambda c: (c["length_px"], c["confidence_pct"]), reverse=True)
    for idx, candidate in enumerate(candidates[:24], start=1):
        candidate["frame_candidate_id"] = f"F{idx}"
    return mask_full, candidates[:24]


def analyze_decoded_frames(
    images: list[np.ndarray],
    timestamps: list[float],
    phases: dict[str, PhaseRange] | None,
    roi: Roi | None,
) -> dict[str, Any]:
    frame_results: list[dict[str, Any]] = []
    previous_gray: np.ndarray | None = None
    for index, image in enumerate(images):
        mask, candidates = classical_segment(image, roi)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        quality = quality_report(gray, previous_gray)
        previous_gray = gray
        frame_results.append({
            "index": index,
            "time_s": round(float(timestamps[index]), 3),
            "width": int(image.shape[1]),
            "height": int(image.shape[0]),
            "mask_data_url": encode_mask(mask),
            "quality": quality,
            "candidates": candidates,
        })

    tracks: list[dict[str, Any]] = []
    diagonal = math.hypot(images[0].shape[1], images[0].shape[0])
    max_distance = max(25.0, diagonal * 0.09)
    for frame in frame_results:
        detections = frame["candidates"]
        used_tracks: set[int] = set()
        used_detections: set[int] = set()
        pairs: list[tuple[float, int, int]] = []
        for ti, track in enumerate(tracks):
            last = track["observations"][-1]
            if frame["index"] - last["frame_index"] > 2:
                continue
            for di, detection in enumerate(detections):
                dist = math.hypot(detection["center_x"] - last["center_x"], detection["center_y"] - last["center_y"])
                if dist <= max_distance:
                    pairs.append((dist, ti, di))
        for _, ti, di in sorted(pairs):
            if ti in used_tracks or di in used_detections:
                continue
            detection = detections[di]
            tracks[ti]["observations"].append({
                "frame_index": frame["index"], "time_s": frame["time_s"],
                "center_x": detection["center_x"], "center_y": detection["center_y"],
                "width_px": detection["apparent_width_px"], "length_px": detection["length_px"],
                "confidence_pct": detection["confidence_pct"], "quality_flags": frame["quality"]["flags"],
            })
            detection["path_id"] = tracks[ti]["path_id"]
            used_tracks.add(ti)
            used_detections.add(di)
        for di, detection in enumerate(detections):
            if di in used_detections:
                continue
            path_id = f"V{len(tracks) + 1:02d}"
            observation = {
                "frame_index": frame["index"], "time_s": frame["time_s"],
                "center_x": detection["center_x"], "center_y": detection["center_y"],
                "width_px": detection["apparent_width_px"], "length_px": detection["length_px"],
                "confidence_pct": detection["confidence_pct"], "quality_flags": frame["quality"]["flags"],
            }
            tracks.append({"path_id": path_id, "observations": [observation]})
            detection["path_id"] = path_id

    total_frames = max(1, len(frame_results))
    summaries: list[dict[str, Any]] = []
    for track in tracks:
        obs = track["observations"]
        widths = np.array([o["width_px"] for o in obs], dtype=float)
        centers = np.array([[o["center_x"], o["center_y"]] for o in obs], dtype=float)
        lengths = np.array([o["length_px"] for o in obs], dtype=float)
        confidences = np.array([o["confidence_pct"] for o in obs], dtype=float)
        continuity = 100.0 * len(obs) / total_frames
        width_cv = float(np.std(widths) / max(0.1, np.mean(widths)))
        drift = float(np.linalg.norm(centers - centers[0], axis=1).mean()) / max(1.0, diagonal)
        stability = float(np.clip(100 - width_cv * 65 - drift * 180, 0, 100))
        mean_confidence = float(confidences.mean())
        mean_length = float(lengths.mean())
        visibility = float(np.clip(
            0.45 * continuity
            + 0.30 * min(100, mean_length / max(1, diagonal * 0.28) * 100)
            + 0.25 * mean_confidence,
            0, 100,
        ))
        flags = sorted({flag for observation in obs for flag in observation["quality_flags"]})
        response_score: float | None = None
        score_components: dict[str, float] | None = None
        if phases and all(key in phases for key in ("baseline", "response", "recovery")):
            def phase_width(name: str) -> float | None:
                phase = phases[name]
                values = [o["width_px"] for o in obs if phase.start <= o["time_s"] <= phase.end]
                return float(np.mean(values)) if values else None
            baseline = phase_width("baseline")
            response = phase_width("response")
            recovery = phase_width("recovery")
            if baseline and response is not None and recovery is not None:
                relative_change = (response - baseline) / max(0.1, baseline)
                response_component = float(np.clip(50 + relative_change * 100, 0, 100))
                recovery_component = float(np.clip(100 - abs(recovery - baseline) / max(0.1, baseline) * 100, 0, 100))
                response_score = round(0.4 * response_component + 0.3 * recovery_component + 0.3 * stability, 1)
                score_components = {
                    "relative_width_change_pct": round(relative_change * 100, 1),
                    "response_component": round(response_component, 1),
                    "recovery_component": round(recovery_component, 1),
                    "stability_component": round(stability, 1),
                }
        summaries.append({
            "path_id": track["path_id"],
            "visibility_score": round(visibility, 1),
            "continuity_pct": round(continuity, 1),
            "mean_apparent_width_px": round(float(widths.mean()), 2),
            "width_variation_pct": round(width_cv * 100, 1),
            "mean_length_px": round(mean_length, 1),
            "stability_score": round(stability, 1),
            "confidence_pct": round(mean_confidence, 1),
            "quality_flags": flags,
            "experimental_response_score": response_score,
            "score_components": score_components,
            "time_series": [{
                "time_s": o["time_s"], "apparent_width_px": o["width_px"],
                "detected": True, "center_x": o["center_x"], "center_y": o["center_y"],
            } for o in obs],
        })
    summaries.sort(key=lambda x: x["visibility_score"], reverse=True)
    for rank, item in enumerate(summaries, start=1):
        item["visibility_rank"] = rank

    return {
        "session_id": str(uuid.uuid4()),
        "source": "local-video" if len(images) > 1 else "local-frames",
        "frame_count": len(frame_results),
        "experimental_score_note": "Experimental comparison index only; unvalidated and not a clinical recommendation.",
        "phases_used": {key: value.model_dump() for key, value in (phases or {}).items()},
        "frames": frame_results,
        "candidates": summaries,
    }


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "name": "VeinScope API", "version": APP_VERSION}


@app.post("/api/analyze-frames")
def analyze_frames(payload: AnalyzeFramesRequest) -> dict[str, Any]:
    if payload.timestamps and len(payload.timestamps) != len(payload.frames):
        raise HTTPException(status_code=422, detail="Provide one timestamp for each frame, or omit timestamps.")
    images = [decode_image(frame) for frame in payload.frames]
    times = payload.timestamps or [i / 4.0 for i in range(len(images))]
    return analyze_decoded_frames(images, times, payload.phases, payload.roi)


@app.post("/api/analyze-video")
async def analyze_video(
    file: UploadFile = File(...),
    phases_json: str | None = Form(default=None),
    roi_json: str | None = Form(default=None),
) -> dict[str, Any]:
    suffix = Path(file.filename or "video.mp4").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Upload an MP4, MOV, AVI, MKV, WebM, or M4V video.")
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Video must be 100 MB or smaller.")
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded video is empty.")
    try:
        phases_raw = json.loads(phases_json) if phases_json else None
        phases = {key: PhaseRange(**value) for key, value in phases_raw.items()} if phases_raw else None
        roi = Roi(**json.loads(roi_json)) if roi_json else None
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(status_code=422, detail="Phase or ROI settings could not be parsed.") from exc

    with tempfile.TemporaryDirectory(prefix="veinscope-") as temp_dir:
        path = Path(temp_dir) / f"upload{suffix}"
        path.write_bytes(raw)
        capture = cv2.VideoCapture(str(path))
        if not capture.isOpened():
            raise HTTPException(status_code=422, detail="The video could not be read. Try MP4 (H.264) or another supported format.")
        total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
        if total <= 0:
            capture.release()
            raise HTTPException(status_code=422, detail="The video contains no readable frames.")
        indexes = np.linspace(0, max(0, total - 1), num=min(MAX_ANALYSIS_FRAMES, total), dtype=int)
        images: list[np.ndarray] = []
        times: list[float] = []
        for index in indexes:
            capture.set(cv2.CAP_PROP_POS_FRAMES, int(index))
            ok, frame = capture.read()
            if not ok or frame is None:
                continue
            h, w = frame.shape[:2]
            scale = min(1.0, MAX_DIMENSION / max(h, w))
            if scale < 1:
                frame = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
            images.append(frame)
            times.append(float(index / fps) if fps > 0 else float(index))
        capture.release()
        if not images:
            raise HTTPException(status_code=422, detail="No frames could be sampled from this video.")
    result = analyze_decoded_frames(images, times, phases, roi)
    result["source"] = "uploaded-video"
    result["video_duration_s"] = round(float(total / fps), 3) if fps > 0 else None
    return result
