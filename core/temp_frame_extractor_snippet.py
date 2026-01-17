    def extract_frame_crop(
        self,
        video_path: Path,
        output_path: Path,
        timestamp: float,
        box: Optional[dict] = None
    ) -> Path:
        """
        Extract a frame and optionally crop it to a bounding box.
        
        Args:
            video_path: Path to video file
            output_path: Where to save the image
            timestamp: Time in seconds
            box: Optional dict {top, left, width, height} in percentages (0-100)
            
        Returns:
            Path to the saved image
        """
        # Get video dimensions first if we need to crop
        video_info = self.get_video_info(video_path)
        width = video_info['width']
        height = video_info['height']
        
        cmd = [self.ffmpeg_path, "-y"]
        
        # Seek first for speed
        cmd.extend(["-ss", str(timestamp)])
        cmd.extend(["-i", str(video_path)])
        
        # Build filter chain
        filters = []
        
        if box:
            # Convert percentage box to pixels
            crop_w = int(width * (box['width'] / 100))
            crop_h = int(height * (box['height'] / 100))
            crop_x = int(width * (box['left'] / 100))
            crop_y = int(height * (box['top'] / 100))
            
            # Ensure boundaries are valid
            crop_w = max(1, min(crop_w, width - crop_x))
            crop_h = max(1, min(crop_h, height - crop_y))
            
            filters.append(f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y}")
            
        if filters:
            cmd.extend(["-vf", ",".join(filters)])
            
        cmd.extend([
            "-vframes", "1",
            "-q:v", "2",  # High quality jpeg
            str(output_path)
        ])
        
        try:
            subprocess.run(cmd, capture_output=True, text=True, check=True)
            return output_path
        except subprocess.CalledProcessError as e:
            logger.error(f"Frame crop failed: {e.stderr}")
            raise RuntimeError(f"Failed to extract frame crop: {e.stderr}")
