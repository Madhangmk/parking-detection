# Parking Space Detection Web App Plan

## Project Overview

Convert the existing desktop parking space detection to a Flask web application with video upload functionality.

## Requirements

- Flask
- OpenCV
- NumPy
- Ultralytics (YOLO)
- Shapely

## Files to Create

### 1. app.py

- Flask backend
- Video upload handling
- Frame processing with YOLOv8
- Polygon data management
- API endpoints

### 2. templates/index.html

- Video upload form
- Canvas for polygon drawing
- Video player with overlay
- Controls (Save, Clear, Process)

### 3. static/css/style.css

- Responsive styling
- Canvas overlay styling
- Control buttons

### 4. static/js/script.js

- Canvas drawing for polygons
- Video frame capture
- AJAX calls to backend
- Real-time polygon visualization

## Functionality

1. Upload video file
2. Draw parking space polygons on video frame
3. Process video with YOLOv8 vehicle detection
4. Display free/occupied space count
5. Save polygon configurations

## API Endpoints

- POST /upload - Upload video
- POST /save-polygons - Save polygon data
- GET /get-polygons - Get saved polygons
- POST /process-frame - Process a single frame
- GET /video/<filename> - Stream processed video
