
import os
import json
import cv2
import numpy as np
import base64
import sqlite3
import hashlib
import time
from werkzeug.utils import secure_filename
from flask import Flask, render_template, request, jsonify, send_from_directory, session, redirect, url_for
from ultralytics import YOLO
from shapely.geometry import Polygon as ShapelyPolygon

app = Flask(__name__)
app.secret_key = 'your-secret-key-change-this-in-production'

# Base directory relative to app.py
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, 'static')
UPLOAD_FOLDER = os.path.join(STATIC_DIR, 'uploads')
OBJECT_DIR = os.path.join(BASE_DIR, 'object')
DATABASE_DIR = os.path.join(BASE_DIR, 'database')

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['ALLOWED_EXTENSIONS'] = {'mp4', 'avi', 'mov', 'mkv'}

# Create directories
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OBJECT_DIR, exist_ok=True)
os.makedirs(DATABASE_DIR, exist_ok=True)

def hash_password(password):
    """Hash password using SHA-256"""
    return hashlib.sha256(password.encode()).hexdigest()

# Database setup
def init_db():
    conn = sqlite3.connect(os.path.join(DATABASE_DIR, 'users.db'))
    c = conn.cursor()
    
    # Create table if not exists with role column
    c.execute('''CREATE TABLE IF NOT EXISTS users 
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, 
                  username TEXT UNIQUE NOT NULL, 
                  email TEXT UNIQUE NOT NULL, 
                  password TEXT NOT NULL,
                  role TEXT DEFAULT 'user')''')
    
    # Check if role column exists, add if not
    try:
        c.execute("SELECT role FROM users LIMIT 1")
    except:
        c.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'")
    
    # Check if admin exists, if not create default accounts
    c.execute("SELECT COUNT(*) FROM users")
    if c.fetchone()[0] == 0:
        # Create default admin
        c.execute("INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)",
                  ('admin', 'admin@smartparking.com', hash_password('admin123'), 'admin'))
        # Create default user
        c.execute("INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)",
                  ('user', 'user@smartparking.com', hash_password('user123'), 'user'))
    
    conn.commit()
    conn.close()

init_db()

# Load YOLOv8 model
# Path should be relative to BASE_DIR for consistency
model_path = os.path.join(os.path.dirname(BASE_DIR), "Models", "yolov8m mAp 48", "weights", "best.pt")
model = YOLO(model_path)

# Polygon data file path
POLYGONS_FILE = os.path.join(OBJECT_DIR, "polygons_data.json")

# Global to track last processed frame per video and caching
video_states = {}

processed_cache = {}
current_admin_video = None
slot_occupancy_times = {} # Track when each slot became occupied {filename: {slot_idx: timestamp}}

def get_polygons_hash(polygons):
    """Generate a hash for polygons to detect changes"""
    return hashlib.md5(json.dumps(polygons).encode()).hexdigest()

def load_polygons_data():
    """Load all polygons data from JSON file"""
    try:
        with open(POLYGONS_FILE, 'r') as f:
            return json.load(f)
    except:
        save_polygons_data({})
        return {}

def save_polygons_data(data):
    """Save all polygons data to JSON file"""
    with open(POLYGONS_FILE, 'w') as f:
        json.dump(data, f, indent=2)

def get_video_polygons(filename):
    """Get polygons for a specific video"""
    data = load_polygons_data()
    return data.get(filename, [])

def save_video_polygons(filename, polygons):
    """Save polygons for a specific video"""
    data = load_polygons_data()
    data[filename] = polygons
    save_polygons_data(data)

def find_polygon_center(points):
    """Find the center of a polygon"""
    x_coords = [p[0] for p in points]
    y_coords = [p[1] for p in points]
    return (int(sum(x_coords) / len(points)), int(sum(y_coords) / len(points)))

def is_point_in_polygon(point, polygon):
    x, y = point
    n = len(polygon)
    inside = False
    p1x, p1y = polygon[0]
    for i in range(n + 1):
        p2x, p2y = polygon[i % n]
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    return inside

def get_label_name(n):
    label = {0: "pedestrian", 1: "people", 2: "bicycle", 3: "car", 4: "van", 
             5: "truck", 6: "tricycle", 7: "awning-tricycle", 8: "bus", 9: "motor"}
    return label.get(n, "")

def get_video_time(frame_number, fps):
    """Convert frame number to HH:MM:SS video time"""
    if fps <= 0: return "00:00:00"
    total_seconds = int(frame_number / fps)
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

def process_frame(frame, polygon_data, filename=None, frame_number=0, show_boxes=False):
    if polygon_data is None:
        polygon_data = []
    
    mask_1 = np.zeros_like(frame)
    mask_2 = np.zeros_like(frame)
    results = model(frame, device='cpu')[0]
    occupied_indices = set()
    slot_vehicle_map = {} # Map slot index to vehicle type

    for detection in results.boxes.data.tolist():
        x1, y1, x2, y2, score, class_id = detection
        label_name = get_label_name(int(class_id))
        
        if label_name in ["bicycle", "car", "van", "truck", "tricycle", "awning-tricycle", "bus", "motor"]:
            # Draw bounding box for the vehicle only if show_boxes is True
            if show_boxes:
                cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
                cv2.putText(frame, f"{label_name} {score:.2f}", (int(x1), int(y1) - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
            
            car_polygon = [(int(x1), int(y1)), (int(x1), int(y2)), (int(x2), int(y2)), (int(x2), int(y1))]
            car_center = (int((x1 + x2) / 2), int((y1 + y2) / 2))
            car_shapely = ShapelyPolygon(car_polygon)
            
            for idx, poly in enumerate(polygon_data):
                if idx in occupied_indices:
                    continue
                
                # Method 1: Center Check (Quick)
                polygon_center = find_polygon_center(poly)
                if is_point_in_polygon(polygon_center, car_polygon) or is_point_in_polygon(car_center, poly):
                    occupied_indices.add(idx)
                    slot_vehicle_map[str(idx)] = label_name
                    continue
                
                # Method 2: Intersection Area Check (More robust)
                try:
                    slot_shapely = ShapelyPolygon(poly)
                    if not slot_shapely.is_valid:
                        slot_shapely = slot_shapely.buffer(0) # Fix invalid polygons
                    
                    intersection_area = car_shapely.intersection(slot_shapely).area
                    slot_area = slot_shapely.area
                    
                    # If more than 30% of the slot is covered by a car, it's occupied
                    if slot_area > 0 and (intersection_area / slot_area) > 0.3:
                        occupied_indices.add(idx)
                        slot_vehicle_map[str(idx)] = label_name
                except Exception as e:
                    print(f"Error calculating intersection for slot {idx}: {e}")
                    pass

    # Update occupancy times if filename is provided
    # Calculate video time from frame number instead of system time
    fps = 30 # Default if not known
    if filename:
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if os.path.exists(filepath):
            cap_temp = cv2.VideoCapture(filepath)
            fps = cap_temp.get(cv2.CAP_PROP_FPS) or 30
            cap_temp.release()
            
    v_time = get_video_time(frame_number, fps)
    if filename:
        if filename not in slot_occupancy_times:
            slot_occupancy_times[filename] = {}
        
        # If a slot is occupied now but wasn't before, mark the time
        for idx in occupied_indices:
            if str(idx) not in slot_occupancy_times[filename]:
                slot_occupancy_times[filename][str(idx)] = v_time
        
        # If a slot is free now but was occupied before, remove its time
        to_remove = []
        for idx_str in slot_occupancy_times[filename]:
            if int(idx_str) not in occupied_indices:
                to_remove.append(idx_str)
        for idx_str in to_remove:
            del slot_occupancy_times[filename][idx_str]

    for idx in occupied_indices:
        cv2.fillPoly(mask_1, [np.array(polygon_data[idx])], (0, 0, 255))

    for idx, poly in enumerate(polygon_data):
        if idx not in occupied_indices:
            cv2.fillPoly(mask_2, [np.array(poly)], (0, 255, 255))

    frame = cv2.addWeighted(mask_1, 0.2, frame, 1, 0)
    frame = cv2.addWeighted(mask_2, 0.2, frame, 1, 0)

    # Prepare return data including times
    times = slot_occupancy_times.get(filename, {}) if filename else {}
    return frame, len(polygon_data) - len(occupied_indices), list(occupied_indices), slot_vehicle_map, times

# Authentication routes
@app.route('/')
def index():
    return render_template('home.html')

@app.route('/home')
def home():
    return render_template('home.html')

@app.route('/dashboard')
def dashboard():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    
    # Get user role
    conn = sqlite3.connect(os.path.join(DATABASE_DIR, 'users.db'))
    c = conn.cursor()
    c.execute("SELECT role FROM users WHERE id = ?", (session['user_id'],))
    result = c.fetchone()
    conn.close()
    
    user_role = result[0] if result else 'user'
    session['role'] = user_role
    
    if user_role == 'admin':
        return render_template('index.html', logged_in=True, username=session.get('username'), role='admin')
    else:
        return render_template('user_dashboard.html', logged_in=True, username=session.get('username'), role='user')

@app.route('/user-dashboard')
def user_dashboard():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('user_dashboard.html', logged_in=True, username=session.get('username'))

@app.route('/admin-dashboard')
def admin_dashboard():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('index.html', logged_in=True, username=session.get('username'), role='admin')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        conn = sqlite3.connect(os.path.join(DATABASE_DIR, 'users.db'))
        c = conn.cursor()
        c.execute("SELECT id, username, role FROM users WHERE username = ? AND password = ?", 
                  (username, hash_password(password)))
        user = c.fetchone()
        conn.close()
        
        if user:
            session['user_id'] = user[0]
            session['username'] = user[1]
            session['role'] = user[2] if len(user) > 2 else 'user'
            return redirect(url_for('dashboard'))
        else:
            return render_template('login.html', error='Invalid username or password', page='login')
    
    return render_template('login.html', page='login')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username')
        email = request.form.get('email')
        password = request.form.get('password')
        confirm_password = request.form.get('confirm_password')
        role = request.form.get('role', 'user')
        
        if password != confirm_password:
            return render_template('login.html', error='Passwords do not match', page='register')
        
        if len(password) < 6:
            return render_template('login.html', error='Password must be at least 6 characters', page='register')
        
        try:
            conn = sqlite3.connect(os.path.join(DATABASE_DIR, 'users.db'))
            c = conn.cursor()
            c.execute("INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)",
                      (username, email, hash_password(password), role))
            conn.commit()
            conn.close()
            return render_template('login.html', success='Registration successful! Please login.', page='login')
        except sqlite3.IntegrityError:
            return render_template('login.html', error='Username or email already exists', page='register')
    
    return render_template('login.html', page='register')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/upload', methods=['POST'])
def upload_video():
    if 'user_id' not in session:
        return jsonify({'error': 'Please login first'}), 401
    
    if 'video' not in request.files:
        return jsonify({'error': 'No video file'}), 400
    
    file = request.files['video']
    if file.filename == '' or not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file'}), 400
    
    filename = secure_filename(file.filename)
    global current_admin_video
    current_admin_video = filename
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    
    return jsonify({'success': True, 'filename': filename, 'url': f'/static/uploads/{filename}'})

@app.route('/save-polygons', methods=['POST'])
def save_polygons():
    if 'user_id' not in session:
        return jsonify({'error': 'Please login first'}), 401
    
    data = request.json
    filename = data.get('filename', '')
    points = data.get('points', [])
    
    if not filename:
        return jsonify({'error': 'Filename required'}), 400
    
    if points and len(points) >= 3:
        # Get existing polygons for this video
        polygon_data = get_video_polygons(filename)
        polygon_data.append(points)
        save_video_polygons(filename, polygon_data)
        return jsonify({'success': True, 'count': len(polygon_data)})
    return jsonify({'error': 'Invalid polygon'}), 400

@app.route('/get-polygons', methods=['GET'])
def get_polygons():
    if 'user_id' not in session:
        return jsonify({'error': 'Please login first'}), 401
    
    filename = request.args.get('filename', '')
    if filename:
        polygons = get_video_polygons(filename)
    else:
        polygons = []
    return jsonify({'polygons': polygons})

@app.route('/clear-polygons', methods=['POST'])
def clear_polygons():
    if 'user_id' not in session:
        return jsonify({'error': 'Please login first'}), 401
    
    data = request.json
    filename = data.get('filename', '')
    
    if filename:
        save_video_polygons(filename, [])
    return jsonify({'success': True})

@app.route('/process-frame', methods=['POST'])
def process_frame_route():
    if 'user_id' not in session:
        return jsonify({'error': 'Please login first'}), 401
    
    data = request.json
    filename = data.get('filename')
    global current_admin_video
    current_admin_video = filename
    frame_number = data.get('frame_number', 0)
    
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found'}), 404
    
    cap = cv2.VideoCapture(filepath)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
    ret, frame = cap.read()
    cap.release()
    
    if not ret:
        return jsonify({'error': 'Failed to read frame'}), 400
    
    frame = cv2.resize(frame, (1280, 720))
    # Get polygons for the specific video
    polygon_data = get_video_polygons(filename)
    
    # Store the last processed frame number for this video
    if filename not in video_states:
        video_states[filename] = {}
    video_states[filename]['last_frame'] = frame_number
    
    # Process for admin with boxes
    processed_frame_admin, free_count, occupied_indices, slot_vehicle_map, occupancy_times = process_frame(frame.copy(), polygon_data, filename, frame_number, show_boxes=True)
    
    # Process for user/cache WITHOUT boxes
    processed_frame_user, _, _, _, _ = process_frame(frame, polygon_data, filename, frame_number, show_boxes=False)
    
    # Encode admin frame for immediate response
    _, buffer_admin = cv2.imencode('.jpg', processed_frame_admin)
    frame_base64_admin = base64.b64encode(buffer_admin).decode('utf-8')

    # Encode user frame for cache
    _, buffer_user = cv2.imencode('.jpg', processed_frame_user)
    frame_base64_user = base64.b64encode(buffer_user).decode('utf-8')
    
    # Update cache for the user dashboard with the CLEAN frame
    polygons_hash = get_polygons_hash(polygon_data)
    cache_key = f"{filename}_{frame_number}_{polygons_hash}"
    total = len(polygon_data)
    slots_status = [i not in occupied_indices for i in range(total)]
    
    user_result = {
        'total': total,
        'free': free_count,
        'occupied': len(occupied_indices),
        'slots_status': slots_status,
        'slot_vehicles': slot_vehicle_map,
        'occupancy_times': occupancy_times,
        'video': filename,
        'frame': frame_base64_user
    }
    processed_cache[cache_key] = {
        'data': user_result,
        'timestamp': time.time()
    }

    return jsonify({'frame': frame_base64_admin, 'free': free_count, 'occupied': list(occupied_indices), 'total': len(polygon_data), 'slot_vehicles': slot_vehicle_map, 'occupancy_times': occupancy_times})

@app.route('/get-video-info', methods=['GET'])
def get_video_info():
    if 'user_id' not in session:
        return jsonify({'error': 'Please login first'}), 401
    
    filename = request.args.get('filename')
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found'}), 404
    
    cap = cv2.VideoCapture(filepath)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.release()
    
    return jsonify({'total_frames': total_frames, 'fps': fps})

@app.route('/get-videos', methods=['GET'])
def get_videos():
    """Get list of available videos"""
    if 'user_id' not in session:
        return jsonify({'error': 'Please login first'}), 401
    
    uploads_dir = app.config['UPLOAD_FOLDER']
    videos = []
    
    if os.path.exists(uploads_dir):
        for filename in os.listdir(uploads_dir):
            if filename.lower().endswith(('.mp4', '.avi', '.mov', '.mkv')):
                videos.append(filename)
    
    return jsonify({'videos': videos})

@app.route('/api/clear-system', methods=['POST'])
def clear_system():
    if 'user_id' not in session or session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    
    global current_admin_video, video_states, processed_cache, slot_occupancy_times
    current_admin_video = None
    video_states = {}
    processed_cache = {}
    slot_occupancy_times = {}
    
    return jsonify({'success': True, 'message': 'System state cleared successfully'})

# Parking stats API for user dashboard
last_stats_time = 0
cached_stats = {}

@app.route('/api/parking-stats')
def get_parking_stats():
    global last_stats_time, cached_stats
    current_time = time.time()
    
    # Allow passing filename, otherwise use latest active admin video
    filename_param = request.args.get('filename')
    
    # Use cache only if no filename requested and within 5 seconds
    if not filename_param and current_time - last_stats_time < 5:
        if cached_stats and cached_stats.get('video'):
            return jsonify(cached_stats)
    
    uploads_dir = app.config['UPLOAD_FOLDER']
    
    # If no video is explicitly requested and no video is currently active,
    # return an empty state.
    latest_video = None
    if filename_param:
        latest_video = filename_param
    elif current_admin_video:
        latest_video = current_admin_video
    
    if not latest_video:
        return jsonify({
            'total': 0, 
            'free': 0, 
            'occupied': 0, 
            'slots_status': [], 
            'video': None,
            'message': 'No video currently active. Please upload or process a video from the admin dashboard.'
        })
    
    filepath = os.path.join(uploads_dir, latest_video)
    if not os.path.exists(filepath):
        return jsonify({'total': 0, 'free': 0, 'occupied': 0, 'slots_status': [], 'video': None})
        
    polygon_data = get_video_polygons(latest_video)
    polygons_hash = get_polygons_hash(polygon_data)
    
    # Use last processed frame if available, otherwise first frame
    frame_number = video_states.get(latest_video, {}).get('last_frame', 0)
    
    # Check if we have this specific frame processed in cache
    cache_key = f"{latest_video}_{frame_number}_{polygons_hash}"
    if cache_key in processed_cache:
        # Update cache timestamp to avoid being cleared if we implement clearing
        processed_cache[cache_key]['timestamp'] = time.time()
        return jsonify(processed_cache[cache_key]['data'])

    cap = cv2.VideoCapture(filepath)
    if frame_number > 0:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
    ret, frame = cap.read()
    cap.release()
    
    if not ret:
        return jsonify({'total': len(polygon_data), 'free': 0, 'occupied': 0, 'slots_status': [], 'video': latest_video})
    
    frame = cv2.resize(frame, (1280, 720))
    # Explicitly set show_boxes=False for user/stats view
    processed_frame, free_count, occupied_indices, slot_vehicle_map, occupancy_times = process_frame(frame, polygon_data, latest_video, frame_number, show_boxes=False)
    
    total = len(polygon_data)
    occupied_count = len(occupied_indices)
    slots_status = [i not in occupied_indices for i in range(total)]
    
    _, buffer = cv2.imencode('.jpg', processed_frame)
    frame_base64 = base64.b64encode(buffer).decode('utf-8')
    
    result = {
        'total': total,
        'free': free_count,
        'occupied': occupied_count,
        'slots_status': slots_status,
        'slot_vehicles': slot_vehicle_map,
        'occupancy_times': occupancy_times,
        'video': latest_video,
        'frame': frame_base64
    }
    
    # Store in cache
    processed_cache[cache_key] = {
        'data': result,
        'timestamp': time.time()
    }
    
    # Clean up old cache entries if it gets too large
    if len(processed_cache) > 100:
        # Remove 20 oldest entries
        sorted_keys = sorted(processed_cache.keys(), key=lambda k: processed_cache[k]['timestamp'])
        for k in sorted_keys[:20]:
            del processed_cache[k]

    if not filename_param:
        cached_stats = result
        last_stats_time = current_time
        
    return jsonify(result)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)

