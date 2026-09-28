# VeinScope

### NIR Vein Visualization & Temporal Image Analysis Research Prototype

VeinScope is a local computer-vision research prototype designed to explore **NIR-like vein visualization** and **temporal comparison of candidate vein-like paths** from images or short video sequences.

The system combines a React-based analysis workspace with a FastAPI backend that performs image preprocessing, ridge enhancement, candidate-path extraction, temporal tracking, and experimental feature scoring.

> **Research prototype — not for clinical use.**
> VeinScope does not determine vein depth, patency, injection safety, or a clinically suitable injection site.

---

## ✨ Features

* **NIR-like vein visualization**
* Image and video analysis
* Live camera input support
* Synthetic demo data for testing
* Candidate path detection
* Apparent vein width estimation in pixels
* Path continuity analysis
* Temporal candidate tracking
* Image-quality assessment
* Stability and visibility features
* Experimental response scoring
* Interactive candidate overlays
* Time-series visualization
* CSV export
* Analysis-summary export
* Local browser session history

---

## 🧠 System Overview

```text
                ┌─────────────────────┐
                │   NIR-Sensitive     │
                │      Camera         │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │ Image / Video Input │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │ Preprocessing       │
                │ • Grayscale         │
                │ • CLAHE             │
                │ • Quality Analysis  │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │ Frangi Ridge        │
                │ Enhancement         │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │ Candidate           │
                │ Segmentation        │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │ Skeletonization &   │
                │ Feature Extraction  │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │ Temporal Tracking   │
                │ of Candidate Paths  │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │ Visibility /        │
                │ Stability Features  │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │ React Analysis      │
                │ Dashboard            │
                └─────────────────────┘
```

---

## 🔬 Analysis Pipeline

### 1. Image Quality Assessment

Each frame is evaluated for:

* Blur
* Contrast
* Illumination variation
* Frame-to-frame motion

These measurements are used to identify image-quality conditions that may affect candidate-path analysis.

### 2. Contrast Enhancement

The backend applies **CLAHE (Contrast Limited Adaptive Histogram Equalization)** to improve local image contrast before ridge processing.

### 3. Ridge Enhancement

Vein-like dark ridge structures are enhanced using a **Frangi filter**.

This is a classical computer-vision baseline and is intended for research visualization rather than as a trained clinical vein classifier.

### 4. Candidate Extraction

The enhanced response is thresholded and processed using morphological operations and connected-component analysis.

Candidate features include:

* Bounding box
* Center position
* Apparent width
* Path length
* Branch count
* Confidence estimate

### 5. Skeletonization

Candidate structures are skeletonized to estimate the centerline and approximate path length.

### 6. Temporal Tracking

When multiple frames are available, candidate paths are tracked between frames based on their spatial positions.

The system generates time-series measurements such as:

* Apparent width
* Detection persistence
* Position
* Confidence

### 7. Feature Scoring

The prototype calculates experimental image-based features including:

* Visibility score
* Continuity
* Stability
* Width variation
* Confidence
* Experimental response score

These are **research features and not clinical measurements**.

---

## 🖥️ Application Modules

### Module 01 — NIR Vein Mapping

Processes individual frames to identify vein-like candidate paths and visualize their detected regions.

### Module 02 — Dynamic State Assessment

Tracks candidate paths across a sequence and compares their image-based properties over time.

### Module 03 — Evidence Review

Provides:

* Candidate comparison
* Quality indicators
* Overlay visualization
* Temporal charts
* CSV export
* Analysis summaries

---

## 🛠️ Technology Stack

### Frontend

| Technology   | Purpose                   |
| ------------ | ------------------------- |
| React        | User interface            |
| TypeScript   | Application logic         |
| Vite         | Development/build tooling |
| Recharts     | Time-series visualization |
| Lucide React | UI icons                  |

### Backend

| Technology   | Purpose                              |
| ------------ | ------------------------------------ |
| Python       | Backend implementation               |
| FastAPI      | REST API                             |
| OpenCV       | Image/video processing               |
| NumPy        | Numerical processing                 |
| scikit-image | Frangi filtering and skeletonization |
| Pydantic     | Request validation                   |
| Uvicorn      | API server                           |

---

## 📁 Project Structure

```text
VeinScope/
│
├── backend/
│   ├── __init__.py
│   ├── main.py
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api.ts
│   │   ├── demo.ts
│   │   ├── main.tsx
│   │   ├── styles.css
│   │   └── types.ts
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.ts
│
├── .gitignore
└── README.md
```

---

## ⚙️ Requirements

### Backend

* Python 3.x
* pip

### Frontend

* Node.js
* npm

### Hardware

For actual NIR capture:

* NIR-sensitive camera
* USB connection or compatible camera interface

An ordinary webcam may not capture useful vein patterns.

---

## Analyze Frames

```http
POST /api/analyze-frames
```

Accepts:

* Base64 image frames
* Timestamps
* Optional phase definitions
* Optional region of interest

Returns:

* Frame quality information
* Candidate paths
* Visibility features
* Stability features
* Temporal measurements
* Experimental response score

---

## Analyze Video

```http
POST /api/analyze-video
```

Supported formats include:

```text
MP4
MOV
AVI
MKV
WebM
M4V
```

The backend samples frames from the uploaded video and performs the same candidate-path analysis pipeline.

---

# 📊 Outputs

For each detected candidate path, VeinScope can provide:

```text
Path ID
Visibility Rank
Visibility Score
Continuity
Mean Apparent Width
Width Variation
Mean Path Length
Stability Score
Confidence
Quality Flags
Experimental Response Score
Time Series
```

The application can also export:

```text
CSV Analysis Data
Analysis Summary
```

---

# 🛡️ Safety & Research Boundary

VeinScope is a **research and software-prototyping project**.

The system:

* Does not establish vein depth
* Does not establish vein patency
* Does not determine injection safety
* Does not replace clinical assessment
* Does not provide a clinically validated injection-site recommendation

Visibility ranking and temporal response features are experimental image-analysis outputs.

Do not use VeinScope to make medical decisions or perform an injection procedure.

---

# 🔐 Privacy

VeinScope is designed as a local prototype.

The frontend communicates with a local FastAPI analysis service, and session summaries are maintained in the browser.

The application is intended to avoid sending analysis data to a remote service during normal local operation.

Real patient images should not be uploaded to public repositories.

---

# 📈 Current Limitations

Current implementation limitations include:

* Classical computer-vision baseline rather than a trained deep-learning vein segmentation model
* Apparent width is measured in image pixels
* No physical pixel-to-mm calibration
* No depth estimation
* No blood-flow sensor
* No Doppler measurement
* No clinical validation
* No validated vein-patency measurement
* Experimental temporal response scoring
* Performance depends on image quality and camera characteristics

---

# 🚧 Future Development

Potential future improvements include:

* NIR-specific dataset integration
* Deep-learning vein segmentation
* Improved candidate-path tracking
* Pixel-to-mm calibration
* Camera calibration
* Improved temporal models
* More robust quality assessment
* Dataset-based validation
* Quantitative benchmarking
* Hardware-assisted NIR capture
* Clinical research validation

---

# 📚 Research Direction

VeinScope is structured as a computer-vision research prototype where the primary objective is to investigate:

> **How image-based candidate-path visibility and temporal feature changes can be extracted from NIR-like image sequences.**

The current implementation provides an interpretable classical-CV baseline that can later be compared against machine-learning or deep-learning approaches.

---

# 👤 Author

**Yashwanth Kumar R R**

GitHub:

https://github.com/yashrr2007

Project:

https://github.com/yashrr2007/VeinScope

---

## ⭐ Acknowledgement

VeinScope combines web-based visualization with classical computer-vision techniques to provide an interpretable environment for experimenting with NIR-like vein image analysis and temporal feature comparison.

---

