// Parking Space Detection Web App - Matches main.py logic

let currentFilename = "";
let polygons = [];
let currentPoints = [];
let videoInfo = { totalFrames: 0, fps: 30 };
let occupiedSlots = new Set();
let currentSlotVehicles = {};
let isPlaying = false;
let playInterval = null;
let lastFrameImage = null; // Cache the last processed image from server

const vehicleIcons = {
  car: "fa-car",
  van: "fa-shuttle-van",
  truck: "fa-truck",
  bus: "fa-bus",
  bicycle: "fa-bicycle",
  motor: "fa-motorcycle",
  tricycle: "fa-motorcycle",
  "awning-tricycle": "fa-motorcycle",
};

const canvas = document.getElementById("videoCanvas");
const ctx = canvas.getContext("2d");
const video = document.getElementById("sourceVideo");

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  initEventListeners();
  // Show upload section by default
  showUpload();
});

function initEventListeners() {
  // Sidebar and Header buttons
  const uploadBtns = [
    document.getElementById("newVideoBtn"),
    document.getElementById("sidebarUpload"),
    document.getElementById("quickUpload"),
    document.getElementById("uploadNewBtn"),
  ];
  const refreshBtns = [
    document.getElementById("refreshBtn"),
    document.getElementById("sidebarRefresh"),
  ];
  const restartBtns = [
    document.getElementById("restartBtn"),
    document.getElementById("sidebarRestart"),
  ];
  const dashboardBtn = document.getElementById("sidebarDashboard");
  const settingsBtn = document.getElementById("sidebarSettings");

  uploadBtns.forEach((btn) => {
    if (btn) btn.addEventListener("click", () => {
      showUpload();
      setActiveLink("sidebarUpload");
    });
  });

  refreshBtns.forEach((btn) => {
    if (btn) btn.addEventListener("click", refreshData);
  });

  restartBtns.forEach((btn) => {
    if (btn) btn.addEventListener("click", restartProcess);
  });

  if (dashboardBtn) {
    dashboardBtn.addEventListener("click", (e) => {
      e.preventDefault();
      showDashboard();
      setActiveLink("sidebarDashboard");
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      showSettings();
      setActiveLink("sidebarSettings");
    });
  }

  // Quick actions
  const quickDetect = document.getElementById("quickDetect");
  const quickUndo = document.getElementById("quickUndo");
  const quickClear = document.getElementById("quickClear");

  if (quickDetect) quickDetect.addEventListener("click", processFrame);
  if (quickUndo) quickUndo.addEventListener("click", undoLast);
  if (quickClear) quickClear.addEventListener("click", clearAll);

  // Upload area click handler
  const uploadArea = document.getElementById("uploadArea");
  const videoInput = document.getElementById("videoInput");

  if (uploadArea && videoInput) {
    uploadArea.addEventListener("click", () => {
      videoInput.click();
    });

    videoInput.addEventListener("change", handleUpload);
  }

  canvas.addEventListener("click", handleCanvasClick);
  canvas.addEventListener("contextmenu", finishPolygon);

  // Button event listeners
  const saveBtn = document.getElementById("saveBtn");
  const undoBtn = document.getElementById("undoBtn");
  const clearBtn = document.getElementById("clearBtn");
  const processBtn = document.getElementById("processBtn");
  const playBtn = document.getElementById("playBtn");

  if (saveBtn) saveBtn.addEventListener("click", saveCurrentPolygon);
  if (undoBtn) undoBtn.addEventListener("click", undoLast);
  if (clearBtn) clearBtn.addEventListener("click", clearAll);
  if (processBtn) processBtn.addEventListener("click", processFrame);
  if (playBtn) playBtn.addEventListener("click", togglePlay);

  // Frame slider
  const frameSlider = document.getElementById("frameSlider");
  if (frameSlider) {
    frameSlider.addEventListener("input", handleFrameChange);
  }
}

function setActiveLink(id) {
  const links = document.querySelectorAll(".nav-link");
  links.forEach((link) => link.classList.remove("active"));
  const activeLink = document.getElementById(id);
  if (activeLink) activeLink.classList.add("active");
}

// Show Dashboard View
function showDashboard() {
  const uploadSection = document.getElementById("uploadSection");
  const videoSection = document.getElementById("videoSection");
  const overviewSection = document.getElementById("overviewSection");
  const statsSection = document.getElementById("statsSection");
  const settingsSection = document.getElementById("settingsSection");

  if (currentFilename) {
    if (uploadSection) uploadSection.style.display = "none";
    if (videoSection) videoSection.style.display = "block";
    if (overviewSection) overviewSection.style.display = "block";
    if (statsSection) statsSection.style.display = "grid";
    if (settingsSection) settingsSection.style.display = "none";
    drawCanvas();
  } else {
    showUpload();
  }
}

// Show Upload Section
function showUpload() {
  const uploadSection = document.getElementById("uploadSection");
  const videoSection = document.getElementById("videoSection");
  const overviewSection = document.getElementById("overviewSection");
  const statsSection = document.getElementById("statsSection");
  const settingsSection = document.getElementById("settingsSection");

  if (uploadSection) uploadSection.style.display = "block";
  if (videoSection) videoSection.style.display = "none";
  if (overviewSection) overviewSection.style.display = "none";
  if (statsSection) statsSection.style.display = "none";
  if (settingsSection) settingsSection.style.display = "none";
}

// Show Settings Section
function showSettings() {
  const uploadSection = document.getElementById("uploadSection");
  const videoSection = document.getElementById("videoSection");
  const overviewSection = document.getElementById("overviewSection");
  const statsSection = document.getElementById("statsSection");
  const settingsSection = document.getElementById("settingsSection");

  if (uploadSection) uploadSection.style.display = "none";
  if (videoSection) videoSection.style.display = "none";
  if (overviewSection) overviewSection.style.display = "none";
  if (statsSection) statsSection.style.display = "none";
  if (settingsSection) settingsSection.style.display = "block";
}

// Refresh Data
async function refreshData() {
  if (currentFilename) {
    const uploadSection = document.getElementById("uploadSection");
    const videoSection = document.getElementById("videoSection");
    const overviewSection = document.getElementById("overviewSection");
    const statsSection = document.getElementById("statsSection");

    if (uploadSection) uploadSection.style.display = "none";
    if (videoSection) videoSection.style.display = "block";
    if (overviewSection) overviewSection.style.display = "block";
    if (statsSection) statsSection.style.display = "grid";

    await loadSavedPolygons();
    await processFrame();
    updateDashboard();
  } else {
    showUpload();
  }
}

// Restart Process - Clear everything and go to upload
function restartProcess() {
  if (confirm("Are you sure you want to restart the process? All current data will be cleared from the view.")) {
    currentFilename = "";
    polygons = [];
    currentPoints = [];
    occupiedSlots = new Set();
    currentSlotVehicles = {};
    
    // Reset video
    video.src = "";
    
    // Reset stats display
    document.getElementById("totalSpaces").textContent = "0";
    document.getElementById("freeSpaces").textContent = "0";
    document.getElementById("occupiedSpaces").textContent = "0";
    document.getElementById("totalProgress").style.width = "0%";
    document.getElementById("freeProgress").style.width = "0%";
    document.getElementById("occupiedProgress").style.width = "0%";
    
    // Reset slots grid
    const grid = document.getElementById("slotsGrid");
    if (grid) {
      grid.innerHTML = `
        <div class="empty-slots">
          <i class="fas fa-parking"></i>
          <p>No parking slots defined</p>
          <p>Upload a video and draw polygons to define parking spaces</p>
        </div>
      `;
    }
    
    showUpload();
    setActiveLink("sidebarUpload");
  }
}

// Upload Video
async function handleUpload(e) {
  const fileInput = e.target;
  const file = fileInput.files[0];
  if (!file) return;

  const uploadLoading = document.getElementById("uploadLoading");
  if (uploadLoading) {
    uploadLoading.style.display = "flex";
  }

  const formData = new FormData();
  formData.append("video", file);

  try {
    const response = await fetch("/upload", { method: "POST", body: formData });
    const data = await response.json();

    if (data.success) {
      currentFilename = data.filename;

      const uploadSection = document.getElementById("uploadSection");
      const videoSection = document.getElementById("videoSection");
      const overviewSection = document.getElementById("overviewSection");
      const statsSection = document.getElementById("statsSection");

      if (uploadSection) uploadSection.style.display = "none";
      if (videoSection) videoSection.style.display = "block";
      if (overviewSection) overviewSection.style.display = "block";
      if (statsSection) statsSection.style.display = "grid";

      await initializeVideo(data.url);

      // Load polygons for this video
      await loadSavedPolygons();

      // Automatically process the first frame to show occupied/free slots
      const frameSlider = document.getElementById("frameSlider");
      if (frameSlider) frameSlider.value = 0;
      await processFrame();
    } else {
      alert(data.error || "Upload failed");
    }
  } catch (error) {
    console.error(error);
    alert("Upload failed: " + error.message);
  }

  if (uploadLoading) {
    uploadLoading.style.display = "none";
  }
}

// Initialize Video
function initializeVideo(videoUrl) {
  return new Promise((resolve) => {
    // Clear state for new video
    lastFrameImage = null;
    
    // Set source and force load
    video.src = videoUrl;
    video.load();

    video.onloadedmetadata = async () => {
      try {
        const response = await fetch(`/get-video-info?filename=${encodeURIComponent(currentFilename)}`);
        const info = await response.json();

        videoInfo.totalFrames = info.total_frames || 0;
        videoInfo.fps = info.fps || 30;

        const frameSlider = document.getElementById("frameSlider");
        if (frameSlider) {
          frameSlider.max = (info.total_frames || 1) - 1;
          frameSlider.value = 0;
        }

        video.currentTime = 0;
        resolve();
      } catch (error) {
        console.error("Error fetching video info:", error);
        resolve();
      }
    };

    video.onseeked = () => {
      drawCanvas();
    };

    video.onerror = (e) => {
      console.error("Video loading error:", e);
      resolve();
    };
    
    // Fallback timeout if video never loads
    setTimeout(resolve, 3000);
  });
}

// Draw Canvas - shows video frame + polygons + current points
function drawCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (lastFrameImage && lastFrameImage.complete) {
    // Use cached image from server if available
    ctx.drawImage(lastFrameImage, 0, 0, canvas.width, canvas.height);
  } else {
    // Fallback to video element
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch (e) {
      console.warn("Video not ready for drawing:", e);
    }
  }

  // Draw saved polygons (green - free spaces, red - occupied)
  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    if (polygon.length >= 3) {
      if (occupiedSlots.has(i)) {
        ctx.strokeStyle = "#ff4757";
        ctx.fillStyle = "rgba(255, 71, 87, 0.3)";
      } else {
        ctx.strokeStyle = "#00ff88";
        ctx.fillStyle = "rgba(0, 255, 136, 0.3)";
      }
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(polygon[0][0], polygon[0][1]);
      for (let j = 1; j < polygon.length; j++) {
        ctx.lineTo(polygon[j][0], polygon[j][1]);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Draw slot number
      const centerX =
        polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length;
      const centerY =
        polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length;
      ctx.fillStyle = "#fff";
      ctx.font = "bold 20px Arial";
      ctx.textAlign = "center";
      ctx.fillText((i + 1).toString(), centerX, centerY);
    }
  }

  // Draw current points being drawn (red dots)
  ctx.fillStyle = "#ff0000";
  for (const point of currentPoints) {
    ctx.beginPath();
    ctx.arc(point[0], point[1], 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Connect points with lines
  if (currentPoints.length > 1) {
    ctx.strokeStyle = "#ffff00";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(currentPoints[0][0], currentPoints[0][1]);
    for (let i = 1; i < currentPoints.length; i++) {
      ctx.lineTo(currentPoints[i][0], currentPoints[i][1]);
    }
    ctx.stroke();
  }

  // Update stats
  updateDashboard();
}

// Handle Canvas Click - add point
function handleCanvasClick(e) {
  if (!currentFilename) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const x = Math.round((e.clientX - rect.left) * scaleX);
  const y = Math.round((e.clientY - rect.top) * scaleY);

  currentPoints.push([x, y]);
  drawCanvas();
}

// Right click - finish polygon
function finishPolygon(e) {
  e.preventDefault();

  if (currentPoints.length >= 3) {
    // Add current points to polygons (like pressing S in desktop)
    polygons.push([...currentPoints]);
    currentPoints = [];
    drawCanvas();
    alert(`Parking space added! Total: ${polygons.length}`);
  }
}

// Save current polygon (like pressing S in desktop)
async function saveCurrentPolygon() {
  if (currentPoints.length < 3) {
    alert("Need at least 3 points to save a polygon!");
    return;
  }

  try {
    const response = await fetch("/save-polygons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: currentFilename,
        points: currentPoints,
      }),
    });
    const data = await response.json();

    if (data.success) {
      // Move current points to saved polygons
      polygons.push([...currentPoints]);
      currentPoints = [];
      drawCanvas();
      alert(`Saved! Total parking spaces: ${data.count}`);
    }
  } catch (error) {
    console.error(error);
    alert("Failed to save");
  }
}

// Load saved polygons for the current video
async function loadSavedPolygons() {
  try {
    const response = await fetch(
      `/get-polygons?filename=${encodeURIComponent(currentFilename)}`,
    );
    const data = await response.json();
    if (data.polygons) {
      polygons = data.polygons;
      drawCanvas();
    }
  } catch (error) {
    console.error(error);
    polygons = [];
  }
}

// Undo last point
function undoLastPoint() {
  if (currentPoints.length > 0) {
    currentPoints.pop();
  } else if (polygons.length > 0) {
    polygons.pop();
    occupiedSlots.clear();
  }
  drawCanvas();
}

// Undo last - alias for undoLastPoint
function undoLast() {
  undoLastPoint();
}

// Clear all
async function clearAll() {
  if (confirm("Clear all parking spaces?")) {
    polygons = [];
    currentPoints = [];
    occupiedSlots.clear();

    try {
      await fetch("/clear-polygons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: currentFilename }),
      });
    } catch (error) {
      console.error(error);
    }

    drawCanvas();
  }
}

// Process Frame - run YOLO detection
async function processFrame() {
  if (!currentFilename) {
    alert("No video loaded");
    return;
  }

  const frameNumber = parseInt(document.getElementById("frameSlider").value);
  const btn = document.getElementById("processBtn");

  btn.disabled = true;
  btn.textContent = "Processing...";

  try {
    const response = await fetch("/process-frame", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: currentFilename,
        frame_number: frameNumber,
      }),
    });

    const data = await response.json();

    if (data.frame) {
      // Update occupied slots and vehicles first
      occupiedSlots.clear();
      currentSlotVehicles = data.slot_vehicles || {};
      if (Array.isArray(data.occupied)) {
        data.occupied.forEach((idx) => occupiedSlots.add(idx));
      }

      const img = new Image();
      img.onload = () => {
        lastFrameImage = img;
        drawCanvas();
        updateDashboard();
      };
      img.src = "data:image/jpeg;base64," + data.frame;
    }
  } catch (error) {
    console.error(error);
    alert("Processing failed");
  }

  btn.disabled = false;
  btn.textContent = "⚡ Process Frame";
}

// Update dashboard with slot information
function updateDashboard() {
  const total = polygons.length || 0;
  const occupied = occupiedSlots.size;
  const free = Math.max(0, total - occupied);

  document.getElementById("totalSpaces").textContent = total;
  document.getElementById("freeSpaces").textContent = free;
  document.getElementById("occupiedSpaces").textContent = occupied;

  // Update progress bars
  const totalProgress = document.getElementById("totalProgress");
  const freeProgress = document.getElementById("freeProgress");
  const occupiedProgress = document.getElementById("occupiedProgress");

  if (totalProgress) totalProgress.style.width = total > 0 ? "100%" : "0%";
  if (freeProgress)
    freeProgress.style.width = total > 0 ? (free / total) * 100 + "%" : "0%";
  if (occupiedProgress)
    occupiedProgress.style.width =
      total > 0 ? (occupied / total) * 100 + "%" : "0%";

  const slotsGrid = document.getElementById("slotsGrid");
  if (slotsGrid) {
    slotsGrid.innerHTML = "";
    for (let i = 0; i < total; i++) {
      const slot = document.createElement("div");
      const isOccupied = occupiedSlots.has(i);
      slot.className = "parking-slot " + (isOccupied ? "occupied" : "free");

      const vehicleType = currentSlotVehicles[i.toString()];
      const iconClass = !isOccupied
        ? "fa-car"
        : vehicleIcons[vehicleType] || "fa-car";

      slot.innerHTML = `
        <span class="slot-number">${i + 1}</span>
        <i class="fas ${iconClass} slot-icon"></i>
        <span class="slot-status">${isOccupied ? "Occupied" : "Free"}</span>
      `;
      slotsGrid.appendChild(slot);
    }
  }
}

let sliderTimeout;

// Handle frame slider
function handleFrameChange(e) {
  const frameNumber = parseInt(e.target.value);
  document.getElementById("frameNumber").textContent = frameNumber;
  
  // Clear cached image as we moved the slider
  lastFrameImage = null;
  video.currentTime = frameNumber / videoInfo.fps;
  
  // Auto-process after 200ms of inactivity
  if (sliderTimeout) clearTimeout(sliderTimeout);
  sliderTimeout = setTimeout(() => {
    processFrame();
  }, 200);
}

function togglePlay() {
  if (isPlaying) {
    stopPlay();
  } else {
    startPlay();
  }
}

function startPlay() {
  if (!currentFilename) return;
  isPlaying = true;
  const playBtn = document.getElementById("playBtn");
  if (playBtn) {
    playBtn.innerHTML = '<i class="fas fa-pause"></i> Auto Pause';
    playBtn.style.background = "linear-gradient(135deg, #ff4757, #ee5a5a)";
  }

  playInterval = setInterval(async () => {
    const frameSlider = document.getElementById("frameSlider");
    if (!frameSlider) return;

    let nextFrame = parseInt(frameSlider.value) + 10; // Jump 10 frames for smoother "real-time" feel
    if (nextFrame >= videoInfo.totalFrames) {
      nextFrame = 0; // Loop video
    }

    frameSlider.value = nextFrame;
    document.getElementById("frameNumber").textContent = nextFrame;
    video.currentTime = nextFrame / videoInfo.fps;

    // Process the frame
    await processFrame();

    if (!isPlaying) stopPlay();
  }, 1000); // Process every 1 second
}

function stopPlay() {
  isPlaying = false;
  if (playInterval) {
    clearInterval(playInterval);
    playInterval = null;
  }
  const playBtn = document.getElementById("playBtn");
  if (playBtn) {
    playBtn.innerHTML = '<i class="fas fa-play"></i> Auto Play';
    playBtn.style.background = "linear-gradient(135deg, #4361ee, #4895ef)";
  }
}
