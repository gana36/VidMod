    def identify_objects_in_image(self, image_path: Path) -> List[str]:
        """
        Identify the main object(s) in an image crop.
        Returns a list of suggested object names for SAM3 segmentation.
        """
        from google.genai import types
        import json
        
        if not image_path.exists():
            raise FileNotFoundError(f"Image not found: {image_path}")
            
        logger.info(f"Analyzing image crop with Gemini: {image_path}")
        
        # Upload image (small, so fast)
        image_file = self.client.files.upload(file=image_path)
        
        prompt = """
        Analyze this image crop. Identify the single most prominent object, or list up to 3 distinctive objects visible.
        Return ONLY a JSON list of strings, e.g., ["coffee cup", "hand", "table"].
        Keep names simple and suitable for segmentation prompts (e.g., use "dog" instead of "golden retriever sitting").
        """
        
        try:
            response = self.client.models.generate_content(
                model="gemini-2.0-flash", # Fast model for interactivity
                contents=[
                    types.Content(
                        role="user",
                        parts=[
                            types.Part.from_uri(
                                file_uri=image_file.uri,
                                mime_type=image_file.mime_type
                            ),
                            types.Part.from_text(text=prompt)
                        ]
                    )
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json"
                )
            )
            
            if response.text:
                logger.info(f"Gemini object detection: {response.text}")
                return json.loads(response.text)
            return []
            
        except Exception as e:
            logger.error(f"Gemini object detection failed: {e}")
            return []
        finally:
            try:
                self.client.files.delete(name=image_file.name)
            except:
                pass
