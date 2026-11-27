import matplotlib.pyplot as plt

def print_prompt(prompt, show_images=True, image_size=(4, 3)):
    """
    Print a structured prompt in a human-readable format with image display.
    
    Parameters:
    -----------
    prompt : list
        The structured prompt to print
    show_images : bool
        Whether to display the actual images
    image_size : tuple
        Size of displayed images in inches (width, height)
    """
    
    print("=" * 80)
    print("CONVERSATION PROMPT")
    print("=" * 80)
    
    for i, message in enumerate(prompt):
        role = message['role'].upper()
        print(f"\n[{role}]")
        print("-" * 40)
        
        for j, content in enumerate(message['content']):
            if content['type'] == 'text':
                #print(f"\nText Content {j+1}:")
                print(content['text'])
                
            elif content['type'] == 'image':
                image = content['image']
                #print(f"\nImage Content {j+1}:")
                if hasattr(image, 'mode') and hasattr(image, 'size'):
                    print(f"  📷 PIL Image - Mode: {image.mode}, Size: {image.size[0]}x{image.size[1]}")
                else:
                    print(f"  📷 Image object: {type(image)}")
                
                if show_images:
                    try:
                        plt.figure(figsize=image_size)
                        plt.imshow(image)
                        plt.axis('off')
                        #plt.title(f"Image Content {j+1} - {role}")
                        plt.tight_layout()
                        plt.show()
                    except Exception as e:
                        print(f"    ⚠️ Could not display image: {e}")
    
    print("\n" + "=" * 80)
