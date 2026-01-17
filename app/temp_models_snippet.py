class BoundingBox(BaseModel):
    top: float
    left: float
    width: float
    height: float

class ObjectDetectionRequest(BaseModel):
    job_id: str
    timestamp: float
    box: BoundingBox

class ObjectDetectionResponse(BaseModel):
    suggestions: List[str]
