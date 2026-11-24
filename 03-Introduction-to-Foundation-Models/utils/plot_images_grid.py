import matplotlib.pyplot as plt
import matplotlib.image as mpimg
import numpy as np
from math import ceil, sqrt
import os
from PIL import Image

def plot_images_grid(image_paths, titles=None, cols=None, figsize=None, 
                    cmap='gray', title_fontsize=10, suptitle=None, 
                    use_filename_as_title=False):
    """
    Plot multiple images in a grid layout using matplotlib from file paths.
    
    Parameters:
    -----------
    image_paths : list of str
        List of file paths to images to plot.
    titles : list, optional
        List of titles for each image. If None and use_filename_as_title is True,
        filenames will be used as titles.
    cols : int, optional
        Number of columns in the grid. If None, automatically calculated.
    figsize : tuple, optional
        Figure size (width, height). If None, automatically calculated.
    cmap : str, optional
        Colormap for grayscale images. Default is 'gray'.
    title_fontsize : int, optional
        Font size for subplot titles. Default is 10.
    suptitle : str, optional
        Main title for the entire figure.
    use_filename_as_title : bool, optional
        If True and titles is None, use filenames as titles. Default is False.
    
    Returns:
    --------
    fig, axes : matplotlib figure and axes objects
    """
    
    if len(image_paths) == 0:
        raise ValueError("No image paths provided")
    
    # Load images from file paths
    images = []
    for path in image_paths:
        if not os.path.exists(path):
            print(f"Warning: File not found: {path}")
            continue
            
        try:
            # Try to load with PIL first (more robust)
            img = Image.open(path)
            img_array = np.array(img)
            images.append(img_array)
        except Exception as e:
            try:
                # Fallback to matplotlib
                img = mpimg.imread(path)
                images.append(img)
            except Exception as e2:
                print(f"Error loading {path}: {e2}")
                continue
    
    if len(images) == 0:
        raise ValueError("No valid images could be loaded")
    
    n_images = len(images)
    
    # Generate titles from filenames if requested
    if titles is None and use_filename_as_title:
        titles = [os.path.basename(path) for path in image_paths[:n_images]]
    
    # Calculate grid dimensions
    if cols is None:
        cols = ceil(sqrt(n_images))
    rows = ceil(n_images / cols)
    
    # Calculate figure size if not provided
    if figsize is None:
        figsize = (cols * 3, rows * 3)
    
    # Create figure and subplots
    fig, axes = plt.subplots(rows, cols, figsize=figsize)
    
    # Handle single subplot case
    if n_images == 1:
        axes = [axes]
    elif rows == 1 or cols == 1:
        axes = axes.flatten()
    else:
        axes = axes.flatten()
    
    # Plot each image
    for i in range(n_images):
        img = images[i]
        
        # Determine if image is grayscale or color
        if len(img.shape) == 2 or (len(img.shape) == 3 and img.shape[2] == 1):
            # Grayscale image
            axes[i].imshow(img, cmap=cmap)
        else:
            # Color image
            axes[i].imshow(img)
        
        # Add title if provided
        if titles is not None and i < len(titles):
            axes[i].set_title(titles[i], fontsize=title_fontsize)
        
        # Remove axis ticks
        axes[i].set_xticks([])
        axes[i].set_yticks([])
    
    # Hide unused subplots
    for i in range(n_images, len(axes)):
        axes[i].axis('off')
    
    # Add main title if provided
    if suptitle:
        fig.suptitle(suptitle, fontsize=16)
    
    plt.tight_layout()
    return fig, axes