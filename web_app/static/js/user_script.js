let currentFilename = "";
let refreshInterval;
let selectedSlot = -1;
let slotsStatus = [];
let parkingStats = {};
let lastLoadId = 0;
let polygons = []; // Add polygons array to store coordinates
let reservedSlots = new Map(); // Track reserved slots with details {index: {vehicleType, duration, time}}
let reservingIndex = -1;

const userCanvas = document.getElementById("userCanvas");
const userCtx = userCanvas ? userCanvas.getContext("2d") : null;

document.addEventListener("DOMContentLoaded", async () => {
  // Load stats first to know which video is "latest" according to backend
  await loadParkingStats(); 
  startAutoRefresh();
});

async function refreshData() {
  // Refresh current video stats/frame
  await loadParkingStats(currentFilename);
}

function startAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(refreshData, 1000); 
}

let lastFrameTime = 0;

async function loadParkingStats(filename) {
  const loadId = ++lastLoadId;
  try {
    const url = filename ? `/api/parking-stats?filename=${encodeURIComponent(filename)}` : "/api/parking-stats";
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    
    // Ignore if a newer request has started
    if (loadId !== lastLoadId) return;

    // Update currentFilename and dropdown if it was a "latest" fetch
    if (data.video) {
      const oldFilename = currentFilename;
      currentFilename = data.video;
      const selector = document.getElementById("videoSelector");
      if (selector && selector.value !== currentFilename) {
        selector.value = currentFilename;
      }
      // If video changed, we should probably reload stats list immediately
      if (oldFilename && oldFilename !== currentFilename) {
        selectedSlot = -1;
      }
    }

    // Fetch polygons if needed (when filename changes)
    if (data.video && (currentFilename !== data.video || polygons.length === 0)) {
        await loadPolygons(data.video);
    }

    parkingStats = data;
    slotsStatus = data.slots_status || [];
    
    updateStatsDisplay(data);
    createSlotsGrid(data);
    
    // Draw processed frame on canvas
    if (data.frame && userCtx) {
      const img = new Image();
      img.onload = () => {
        if (loadId !== lastLoadId) return;
        lastFrameTime = Date.now();
        userCtx.clearRect(0, 0, userCanvas.width, userCanvas.height);
        userCtx.drawImage(img, 0, 0, userCanvas.width, userCanvas.height);
        
        // Draw slot numbers and outlines (now that backend doesn't)
        drawPolygonsOnUserCanvas();
        
        hideNoFrameMessage();
      };
      img.onerror = () => {
        console.error("Failed to load frame image");
      };
      img.src = "data:image/jpeg;base64," + data.frame;
    } else if (userCtx) {
      // If no frame for 10 seconds, show message
      if (Date.now() - lastFrameTime > 10000) {
        showNoFrameMessage();
      }
    }
  } catch (error) {
    console.error("Failed to load parking stats:", error);
  }
}

async function loadPolygons(filename) {
    try {
        const response = await fetch(`/get-polygons?filename=${encodeURIComponent(filename)}`);
        const data = await response.json();
        if (data.polygons) {
            polygons = data.polygons;
        }
    } catch (error) {
        console.error("Failed to load polygons:", error);
    }
}

function drawPolygonsOnUserCanvas() {
    if (!userCtx || polygons.length === 0) return;
    
    polygons.forEach((poly, index) => {
        if (poly.length < 3) return;
        
        const isFree = slotsStatus[index];
        
        // Draw outline
        userCtx.strokeStyle = isFree ? "#00ff88" : "#ff4757";
        userCtx.lineWidth = 2;
        userCtx.beginPath();
        userCtx.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) {
            userCtx.lineTo(poly[i][0], poly[i][1]);
        }
        userCtx.closePath();
        userCtx.stroke();
        
        // Shading for user dashboard (since backend only provides raw frame)
        userCtx.fillStyle = isFree ? "rgba(0, 255, 136, 0.1)" : "rgba(255, 71, 87, 0.1)";
        userCtx.fill();
        
        // Draw slot number
        const centerX = poly.reduce((sum, p) => sum + p[0], 0) / poly.length;
        const centerY = poly.reduce((sum, p) => sum + p[1], 0) / poly.length;
        
        userCtx.fillStyle = "white";
        userCtx.font = "bold 16px Arial";
        userCtx.textAlign = "center";
        userCtx.textBaseline = "middle";
        userCtx.fillText((index + 1).toString(), centerX, centerY);
    });
}

function showNoFrameMessage() {
  if (!userCtx) return;
  userCtx.fillStyle = "rgba(0, 0, 0, 0.7)";
  userCtx.fillRect(0, 0, userCanvas.width, userCanvas.height);
  userCtx.fillStyle = "white";
  userCtx.font = "24px Segoe UI, Arial";
  userCtx.textAlign = "center";
  userCtx.fillText("Waiting for Admin to process frame...", userCanvas.width / 2, userCanvas.height / 2);
}

function hideNoFrameMessage() {
  // Logic to hide or clear message is handled by drawImage
}

function updateStatsDisplay(data) {
  const totalEl = document.getElementById('totalSpaces');
  const freeEl = document.getElementById('freeSpaces');
  const occupiedEl = document.getElementById('occupiedSpaces');
  
  if (totalEl) totalEl.textContent = data.total || 0;
  if (freeEl) freeEl.textContent = data.free || 0;
  if (occupiedEl) occupiedEl.textContent = data.occupied || 0;

  const total = data.total || 1;
  const freeProgress = document.getElementById('freeProgress');
  const occupiedProgress = document.getElementById('occupiedProgress');
  
  if (freeProgress) freeProgress.style.width = `${((data.free || 0) / total * 100)}%`;
  if (occupiedProgress) occupiedProgress.style.width = `${((data.occupied || 0) / total * 100)}%`;
}

function createSlotsGrid(data) {
  const grid = document.getElementById('userSlotsGrid');
  if (!grid) return;

  if (!data || !data.video) {
    grid.innerHTML = `
      <div class="empty-slots">
        <i class="fas fa-video-slash" style="font-size: 3rem; margin-bottom: 20px; opacity: 0.2;"></i>
        <p>${data.message || 'Waiting for Admin to upload and process a video...'}</p>
      </div>
    `;
    return;
  }

  const status = data.slots_status || [];
  const slotVehicles = data.slot_vehicles || {};
  const occupancyTimes = data.occupancy_times || {};

  const vehicleIcons = {
    'car': 'fa-car',
    'van': 'fa-shuttle-van',
    'truck': 'fa-truck',
    'bus': 'fa-bus',
    'bicycle': 'fa-bicycle',
    'motor': 'fa-motorcycle',
    'tricycle': 'fa-motorcycle',
    'awning-tricycle': 'fa-motorcycle'
  };

  if (status.length === 0) {
    grid.innerHTML = '<div class="empty-slots"><i class="fas fa-parking"></i><p>No parking slots defined yet</p></div>';
    return;
  }

  // Use a fragment to avoid multiple reflows
  const fragment = document.createDocumentFragment();

  status.forEach((isFree, index) => {
    const isReserved = reservedSlots.has(index);
    let slotStatusClass = isFree ? 'free' : 'occupied';
    if (isReserved && isFree) slotStatusClass = 'reserved';

    const slot = document.createElement('div');
    slot.className = `parking-slot ${slotStatusClass}${selectedSlot === index ? ' selected' : ''}`;
    slot.onclick = (e) => {
      e.stopPropagation();
      selectSlot(index);
    };
    
    const vehicleType = slotVehicles[index.toString()];
    let iconClass = isFree ? 'fa-car' : (vehicleIcons[vehicleType] || 'fa-car');
    
    // If reserved and free, show the reserved vehicle icon
    if (isReserved && isFree) {
        const res = reservedSlots.get(index);
        iconClass = vehicleIcons[res.vehicleType] || 'fa-car';
    }

    let slotContent = `
      <span class="slot-number">${index + 1}</span>
      <i class="fas ${iconClass} slot-icon"></i>
      <span class="slot-status">${isReserved && isFree ? 'Reserved' : (isFree ? 'Free' : 'Occupied')}</span>
    `;

    if (selectedSlot === index) {
      const displayStatus = isReserved && isFree ? 'Reserved' : (isFree ? 'Free' : 'Occupied');
      const statusClass = isReserved && isFree ? 'status-reserved' : (isFree ? 'status-free' : 'status-occupied');
      
      let timeLabel = "Occupied at:";
      let timeValue = "--:--";
      let vehicleInfo = "None";

      if (isReserved && isFree) {
        const res = reservedSlots.get(index);
        timeLabel = "Arriving in:";
        timeValue = `${res.duration} mins`;
        vehicleInfo = res.vehicleType.charAt(0).toUpperCase() + res.vehicleType.slice(1);
      } else if (!isFree) {
        timeLabel = "Occupied at:";
        timeValue = occupancyTimes[index.toString()] || 'N/A';
        vehicleInfo = (vehicleType || 'Vehicle').charAt(0).toUpperCase() + (vehicleType || 'Vehicle').slice(1);
      }

      slotContent += `
        <div class="slot-info-bubble">
          <div class="slot-info-header">
            <span class="slot-info-title">Slot Details</span>
            <i class="fas fa-info-circle" style="font-size: 0.7rem; opacity: 0.5;"></i>
          </div>
          <div class="slot-info-body">
            <div class="info-row">
              <span class="info-label">Slot Number:</span>
              <span class="info-value">#${index + 1}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Status:</span>
              <span class="info-value ${statusClass}">${displayStatus}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Vehicle:</span>
              <span class="info-value">${vehicleInfo}</span>
            </div>
            <div class="info-row">
              <span class="info-label">${timeLabel}</span>
              <span class="info-value">${timeValue}</span>
            </div>
          </div>
        </div>
      `;
    }

    slot.innerHTML = slotContent;
    fragment.appendChild(slot);
  });

  grid.innerHTML = '';
  grid.appendChild(fragment);

  const lastUpdated = document.getElementById('lastUpdated');
  if (lastUpdated) lastUpdated.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
}

function selectSlot(index) {
  if (selectedSlot === index) {
    selectedSlot = -1; // Deselect if clicking same slot
  } else {
    selectedSlot = index;
  }
  createSlotsGrid(parkingStats);
}

function getFreeSlots() {
  if (!slotsStatus || slotsStatus.length === 0) {
    showToast("No parking slots information available.");
    return;
  }
  
  const modal = document.getElementById('freeSlotsModal');
  const tableBody = document.getElementById('freeSlotsTableBody');
  const noFreeSlotsMsg = document.getElementById('noFreeSlotsMessage');
  const table = document.querySelector('.slots-table');
  
  if (!modal || !tableBody) return;
  
  tableBody.innerHTML = '';
  let freeCount = 0;
  
  slotsStatus.forEach((isFree, index) => {
    if (isFree) {
      freeCount++;
      const row = document.createElement('tr');
      const isReserved = reservedSlots.has(index);
      row.innerHTML = `
        <td><i class="fas fa-parking" style="color: var(--primary-light); margin-right: 10px;"></i>Slot ${index + 1}</td>
        <td><span class="status-badge free"><span class="slot-circle-indicator free"></span>Available</span></td>
        <td>
          <button class="btn btn-sm btn-primary" 
            onclick="reserveSlot(${index})" 
            ${isReserved ? 'disabled' : ''}
            style="background: ${isReserved ? '#666' : 'var(--primary-color)'}; border: none; font-size: 0.75rem; padding: 5px 15px; border-radius: 6px; cursor: ${isReserved ? 'not-allowed' : 'pointer'};">
            ${isReserved ? 'Reserved' : 'Reserve'}
          </button>
        </td>
      `;
      tableBody.appendChild(row);
    }
  });
  
  if (freeCount === 0) {
    if (table) table.style.display = 'none';
    if (noFreeSlotsMsg) noFreeSlotsMsg.style.display = 'block';
  } else {
    if (table) table.style.display = 'table';
    if (noFreeSlotsMsg) noFreeSlotsMsg.style.display = 'none';
  }
  
  modal.style.display = 'flex';
}

function reserveSlot(index) {
  if (reservedSlots.has(index)) {
    showToast(`Slot ${index + 1} is already reserved!`);
    return;
  }
  
  reservingIndex = index;
  document.getElementById('reservingSlotNumber').textContent = index + 1;
  openModal('reservationModal');
  closeModal('freeSlotsModal');
}

function confirmReservation() {
  const vehicleType = document.getElementById('resVehicleType').value;
  const duration = document.getElementById('resDuration').value;
  
  if (!duration || duration < 1) {
    showToast("Please enter a valid duration");
    return;
  }

  reservedSlots.set(reservingIndex, {
    vehicleType: vehicleType,
    duration: duration,
    timestamp: new Date().toLocaleTimeString()
  });

  showToast(`Slot ${reservingIndex + 1} has been reserved! Arriving in ${duration} mins.`);
  closeModal('reservationModal');
  
  // Highlight the reserved slot in the grid
  selectedSlot = reservingIndex;
  reservingIndex = -1;
  createSlotsGrid(parkingStats);
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'flex';
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'none';
}

function closeFreeSlotsModal() {
  closeModal('freeSlotsModal');
}

// Close modal or deselect slot when clicking outside
window.onclick = function(event) {
  const freeModal = document.getElementById('freeSlotsModal');
  const resModal = document.getElementById('reservationModal');
  if (event.target == freeModal) freeModal.style.display = "none";
  if (event.target == resModal) resModal.style.display = "none";
  
  // If we clicked something that isn't a parking slot, deselect
  if (!event.target.closest('.parking-slot')) {
    if (selectedSlot !== -1) {
      selectedSlot = -1;
      createSlotsGrid(parkingStats);
    }
  }
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; top: 20px; right: 20px; background: #4361ee; color: white; 
    padding: 15px 20px; border-radius: 8px; z-index: 10000; 
    box-shadow: 0 4px 12px rgba(0,0,0,0.3); font-weight: 500;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) document.body.removeChild(toast);
  }, 3000);
}

window.addEventListener("beforeunload", () => {
  if (refreshInterval) clearInterval(refreshInterval);
});

// Restart Process - Reset to initial state
async function restartProcess() {
  if (confirm("Are you sure you want to restart the view? It will reload the latest available video.")) {
    currentFilename = "";
    selectedSlot = -1;
    slotsStatus = [];
    polygons = [];
    reservedSlots.clear();
    
    // Reset display
    updateStatsDisplay({ total: 0, free: 0, occupied: 0 });
    
    const grid = document.getElementById("userSlotsGrid");
    if (grid) {
      grid.innerHTML = '<div class="empty-slots"><i class="fas fa-parking"></i><p>Reloading parking slots...</p></div>';
    }
    
    // Clear canvas
    if (userCtx) {
      userCtx.clearRect(0, 0, userCanvas.width, userCanvas.height);
    }
    
    // Reload latest
    await loadParkingStats();
  }
}
