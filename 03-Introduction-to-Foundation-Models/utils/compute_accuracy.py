import pandas as pd
import numpy as np


def compute_accuracy(predictions, references):
    """Compute accuracy and other metrics"""
    # Filter out invalid predictions
    valid_indices = [i for i, pred in enumerate(predictions) if pred != -1]

    if not valid_indices:
        return {
            'accuracy': 0.0,
            'valid_predictions': 0,
            'total_samples': len(predictions),
            'correct_predictions': 0
        }

    valid_predictions = [predictions[i] for i in valid_indices]
    valid_references = [references[i] for i in valid_indices]

    correct = sum(1 for p, r in zip(valid_predictions, valid_references) if p == r)
    accuracy = correct / len(valid_predictions)

    return {
        'accuracy': accuracy,
        'valid_predictions': len(valid_predictions),
        'total_samples': len(predictions),
        'correct_predictions': correct
    }