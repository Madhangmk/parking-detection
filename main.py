import cv2
import numpy as np
from functions import find_polygon_center, save_object, load_object, is_point_in_polygon, get_label_name
from ultralytics import YOLO
from shapely.geometry import Polygon as ShapelyPolygon


# Load a pretrained YOLOv8n model
model = YOLO("Models/yolov8m mAp 48/weights/best.pt")


# List to store points
polygon_data = load_object()
points = []


def draw_polygon(event, x, y, flags, param):
    if event == cv2.EVENT_LBUTTONUP:
        points.append((x, y))


# Create a black image, a window and bind the function to window
cap = cv2.VideoCapture(
    "Media/3858833-hd_1920_1080_24fps.mp4","Media/InShot_20240404_145221338.mp4")
cv2.namedWindow("image")
cv2.setMouseCallback("image", draw_polygon)

while 1:
    ret, frame = cap.read()
    if not ret:
        break

    frame = cv2.resize(frame, (1280, 720))

    mask_1 = np.zeros_like(frame)
    mask_2 = np.zeros_like(frame)

    results = model(frame, device='cpu')[0]

    occupied_indices = set()

    for detection in results.boxes.data.tolist():
        x1, y1, x2, y2, score, class_id = detection
        label_name = get_label_name(class_id)
        if label_name in ["bicycle", "car", "van", "truck", "tricycle", "awning-tricycle", "bus", "motor"]:

            car_polygon = [(int(x1), int(y1)), (int(x1), int(
                y2)), (int(x2), int(y2)), (int(x2), int(y1))]
            car_center = (int((x1 + x2) / 2), int((y1 + y2) / 2))
            car_shapely = ShapelyPolygon(car_polygon)

            for cou, i in enumerate(polygon_data):
                if cou in occupied_indices:
                    continue

                poligon_center = find_polygon_center(i)

                # Method 1: Center Check
                is_present = is_point_in_polygon(poligon_center, car_polygon) or is_point_in_polygon(car_center, i)

                if not is_present:
                    # Method 2: Intersection Area Check
                    try:
                        slot_shapely = ShapelyPolygon(i)
                        if not slot_shapely.is_valid:
                            slot_shapely = slot_shapely.buffer(0)
                        
                        intersection_area = car_shapely.intersection(slot_shapely).area
                        slot_area = slot_shapely.area
                        
                        if slot_area > 0 and (intersection_area / slot_area) > 0.3:
                            is_present = True
                    except:
                        pass

                if is_present == True:
                    occupied_indices.add(cou)
                    cv2.fillPoly(mask_1, [np.array(i)], (0, 0, 255))

    for idx, i in enumerate(polygon_data):
        if idx not in occupied_indices:
            cv2.fillPoly(mask_2, [np.array(i)], (0, 255, 255))

    cv2.putText(frame,
                f'Total space : {len(polygon_data)}',
                (50, 50),
                cv2.FONT_HERSHEY_SIMPLEX, 1,
                (8, 210, 255),
                2,
                cv2.LINE_4)

    cv2.putText(frame,
                f'Free space : {len(polygon_data) - len(occupied_indices)}',
                (50, 100),
                cv2.FONT_HERSHEY_SIMPLEX, 1,
                (8, 210, 90),
                3,
                cv2.LINE_4)

    frame = cv2.addWeighted(mask_1, 0.2, frame, 1, 0)
    frame = cv2.addWeighted(mask_2, 0.2, frame, 1, 0)

    for x, y in points:
        cv2.circle(frame, (x, y), 3, (0, 0, 255), -1)

    cv2.imshow("image", frame)

    wail_key = cv2.waitKey(1)

    if wail_key == ord("s") or wail_key == ord("S"):
        if len(points) > 0:
            polygon_data.append(points)
            points = []
            save_object(polygon_data)

    elif wail_key == ord("r") or wail_key == ord("R"):
        try:
            polygon_data.pop()
            save_object(polygon_data)
        except:
            pass
    elif wail_key & 0xFF == ord("q") or wail_key & 0xFF == ord("Q"):
        break

cap.release()
cv2.destroyAllWindows()
