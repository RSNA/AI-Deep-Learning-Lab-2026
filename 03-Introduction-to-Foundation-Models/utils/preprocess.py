import numpy as np
from PIL import Image

def preprocess(pil_image):
    """
    Convert a PIL image to 8-bit 3-channel RGB image while preserving dynamic range.
    
    Args:
        pil_image: PIL Image object (can be any bit depth, any number of channels)
    
    Returns:
        PIL Image object in RGB mode with 8-bit depth
    """
    # Convert PIL image to numpy array
    img_array = np.array(pil_image).astype(float)    
    
    # Handle different input dimensions
    if img_array.ndim == 2:  # Grayscale
        # Normalize to 0-255 range preserving dynamic range
        min_val = img_array.min()
        max_val = img_array.max()
        
        if max_val > min_val:  # Avoid division by zero
            normalized = ((img_array - min_val) * 255.0 / (max_val - min_val)).astype(np.uint8)
        else:
            normalized = np.zeros_like(img_array, dtype=np.uint8)
        
        # Convert to 3-channel by repeating grayscale values
        rgb_array = np.stack([normalized, normalized, normalized], axis=-1)
        
    elif img_array.ndim == 3:  # Multi-channel
        # Process each channel independently to preserve dynamic range
        channels = []
        for i in range(img_array.shape[2]):
            channel = img_array[:, :, i]
            min_val = channel.min()
            max_val = channel.max()
            
            if max_val > min_val:
                normalized_channel = ((channel - min_val) * 255.0 / (max_val - min_val)).astype(np.uint8)
            else:
                normalized_channel = np.zeros_like(channel, dtype=np.uint8)
            
            channels.append(normalized_channel)
        
        # If input has more or fewer than 3 channels, adjust accordingly
        if len(channels) == 1:  # Single channel
            rgb_array = np.stack([channels[0], channels[0], channels[0]], axis=-1)
        elif len(channels) == 3:  # Three channels 
            rgb_array = np.stack(channels[:3], axis=-1)
    
    else:
        raise ValueError(f"Unsupported image dimensions: {img_array.ndim}")
    
    # Convert back to PIL Image in RGB mode
    return Image.fromarray(rgb_array, mode='RGB')