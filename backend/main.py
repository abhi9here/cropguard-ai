from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
from PIL import Image
import io
import json
import os
from openai import OpenAI

app = FastAPI(title="CropGuard AI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "models", "crop_disease_model.tflite")
CLASS_NAMES_PATH = os.path.join(BASE_DIR, "models", "class_names.json")
FRONTEND_DIR = os.path.join(os.path.dirname(BASE_DIR), "frontend")

interpreter = None
class_names = {}

@app.on_event("startup")
async def startup_event():
    global interpreter, class_names
    
    print("Loading class names...")
    if os.path.exists(CLASS_NAMES_PATH):
        with open(CLASS_NAMES_PATH, "r") as f:
            class_names = json.load(f)
        print(f"Loaded {len(class_names)} classes.")
    else:
        print(f"WARNING: Class names not found at {CLASS_NAMES_PATH}")

    print("Loading TFLite model...")
    if os.path.exists(MODEL_PATH):
        try:
            import tflite_runtime.interpreter as tflite
            interpreter = tflite.Interpreter(model_path=MODEL_PATH)
            interpreter.allocate_tensors()
            print("TFLite model loaded successfully!")
        except Exception as e:
            print(f"Error loading model: {e}")
    else:
        print(f"WARNING: Model not found at {MODEL_PATH}")

def preprocess_image(image_bytes):
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    image = image.resize((224, 224))
    image_array = np.array(image, dtype=np.float32) / 255.0
    return np.expand_dims(image_array, axis=0)

@app.post("/api/predict")
async def predict(file: UploadFile = File(...)):
    if interpreter is None:
        raise HTTPException(status_code=503, detail="Model is not loaded. Please ensure the model file exists.")
    
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File provided is not an image.")

    try:
        image_bytes = await file.read()
        image_tensor = preprocess_image(image_bytes)
        
        input_details = interpreter.get_input_details()
        output_details = interpreter.get_output_details()
        interpreter.set_tensor(input_details[0]['index'], image_tensor)
        interpreter.invoke()
        predictions = interpreter.get_tensor(output_details[0]['index'])
        
        predicted_index = str(np.argmax(predictions[0]))
        confidence = float(np.max(predictions[0]))
        
        disease_name = class_names.get(predicted_index, "Unknown")
        is_low_confidence = confidence < 0.5
        
        return {
            "success": True,
            "disease_name": disease_name,
            "confidence": confidence,
            "is_low_confidence": is_low_confidence
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ExplainRequest(BaseModel):
    disease_name: str
    language: str = "English"

@app.post("/api/explain")
async def explain(request: ExplainRequest):
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Groq API Key is not configured. Set GROQ_API_KEY environment variable.")
    
    client = OpenAI(
        api_key=api_key,
        base_url="https://api.groq.com/openai/v1",
    )
    
    prompt = f"""
    You are an expert agricultural AI assistant. 
    A farmer's crop has just been diagnosed with the following disease: {request.disease_name}.
    
    Please provide a response in **{request.language}** that includes:
    1. A brief, easy to understand explanation of what this disease is.
    2. Immediate actions the farmer should take right now to save the current crop.
    3. Prevention strategies for the next season.
    
    Keep the tone encouraging, professional, and helpful. Format with clear bullet points.
    If the {request.disease_name} indicates the plant is 'healthy', just congratulate them and give basic maintenance tips.
    """
    
    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": f"You are an expert agricultural advisor who explains crop diseases in {request.language}."},
                {"role": "user", "content": prompt}
            ],
        )
        return {"explanation": response.choices[0].message.content}
    except Exception as e:
        print(f"ERROR from Groq API: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
