import pandas as pd
import numpy as np
from sklearn.metrics import confusion_matrix
import matplotlib.pyplot as plt
import seaborn as sns

def analyze_errors(predictions, references, all_outputs=None, meta=None, max_invalid_examples=3):
    """
    Analyze prediction errors and display detailed statistics.
    
    Args:
        predictions: List of predicted classes (-1 for invalid predictions)
        references: List of true/reference classes
        all_outputs: Optional list of raw model outputs for invalid prediction examples
        meta: Optional DataFrame containing metadata with 'Pathology' column for subgroup analysis
        max_invalid_examples: Maximum number of invalid prediction examples to show (default: 3)
    
    Returns:
        dict: Dictionary containing analysis results with keys:
              - correct_predictions: list of correct prediction indices
              - incorrect_predictions: list of incorrect prediction indices  
              - invalid_predictions: list of invalid prediction indices
              - confusion_matrix: DataFrame containing the confusion matrix
              - prediction_df: DataFrame with predictions and references
              - subgroup_recall: Series with subgroup recall scores (sensitivity per class)
    """
    correct_predictions = []
    incorrect_predictions = []
    invalid_predictions = []
    
    for i, (pred, ref) in enumerate(zip(predictions, references)):
        if pred == -1:
            invalid_predictions.append(i)
        elif pred == ref:
            correct_predictions.append(i)
        else:
            incorrect_predictions.append(i)
    
    print("🔍 Error Analysis:")
    print("=" * 30)
    print(f"Correct predictions: {len(correct_predictions)}")
    print(f"Incorrect predictions: {len(incorrect_predictions)}")
    print(f"Invalid predictions: {len(invalid_predictions)}")
    
    # Create confusion matrix
    if incorrect_predictions or correct_predictions:
        print("\n📊 Confusion Matrix:")
        print("=" * 30)
        
        # Get all unique classes from both predictions and references
        all_classes = sorted(list(set(references + [p for p in predictions if p != -1])))
        
        # Filter out invalid predictions (-1) for confusion matrix
        valid_indices = [i for i, pred in enumerate(predictions) if pred != -1]
        valid_predictions = [predictions[i] for i in valid_indices]
        valid_references = [references[i] for i in valid_indices]
        
        if valid_predictions:
            cm = confusion_matrix(valid_references, valid_predictions, labels=all_classes)
            cm_df = pd.DataFrame(cm, index=all_classes, columns=all_classes)
            cm_df.index.name = 'True'
            cm_df.columns.name = 'Predicted'
            #print(cm_df)
            
            # Plot confusion matrix
            plt.figure(figsize=(10, 8))
            sns.heatmap(cm_df, annot=True, fmt='d', cmap='Blues', 
                       cbar_kws={'label': 'Count'})
            plt.title('Confusion Matrix', fontsize=16, pad=20)
            plt.xlabel('Predicted', fontsize=12)
            plt.ylabel('True', fontsize=12)
            plt.tight_layout()
            plt.show()
        else:
            print("No valid predictions to create confusion matrix")
            cm_df = None
    else:
        cm_df = None
    
    # Show examples of invalid predictions
    if invalid_predictions:
        print("\n⚠️ Examples of invalid predictions:")
        for idx in invalid_predictions[:max_invalid_examples]:
            true_class = references[idx]
            out = all_outputs[idx] if all_outputs else None
            if isinstance(out, list):  # A batch pipeline call gives one list per prompt
                out = out[0]
            raw_output = out["generated_text"] if out else "N/A"
            print(f"  True: {true_class}")
            print(f"  Raw output: '{raw_output}'")
    
    # Calculate recall metrics
    prediction_df = pd.DataFrame({'predictions': predictions, 'references': references})
    
    # Recall: For each true class, what fraction was correctly predicted
    # Compare in plain Python: pandas 3 cannot compare a mixed column (str and -1) with a str column.
    is_correct = pd.Series([p == r for p, r in zip(predictions, references)])
    subgroup_recall = is_correct.groupby(prediction_df['references']).mean()
    
    print("\n📊 Subgroup Recall:")
    print("=" * 30)
    
    # Use meta if provided, otherwise use unique values from references
    classes_to_analyze = meta.Pathology.unique() if meta is not None else pd.Series(references).unique()
    
    for class_name in classes_to_analyze:
        try:
            recall = subgroup_recall.loc[class_name] if class_name in subgroup_recall.index else 0.0
            print(f'{class_name} Recall: {recall:.2f}')
        except KeyError:
            print(f'{class_name} Recall: 0.00 (no correct predictions)')
    
    return {
        'correct_predictions': correct_predictions,
        'incorrect_predictions': incorrect_predictions,
        'invalid_predictions': invalid_predictions,
        'confusion_matrix': cm_df,
        'prediction_df': prediction_df,
        'subgroup_recall': subgroup_recall
    }