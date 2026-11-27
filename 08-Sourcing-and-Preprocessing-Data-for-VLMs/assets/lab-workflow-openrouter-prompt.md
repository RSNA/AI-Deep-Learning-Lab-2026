# OpenRouter workflow diagram

Generated with the built-in image tool as an edit of `lab-workflow-overview.png`, November 23, 2026.

Prompt: Keep the hospital/RIS, FHIR, Orthanc/DICOMweb, Colab matching, report curation, image processing and training example unchanged. Replace the orange inference branch with image + clinical context → Hospital inference API (classroom token, shared cache; provider key stays on server) → GPT-6.1 Sol via OpenRouter → generated draft, compared with reference Findings. Never connect reference Findings to the model input. Preserve legibility and the teal/navy/orange design.

Final correction: Remove the arrowhead pointing into Image + clinical context; leave the source as a plain line and retain the arrowhead entering Hospital inference API. The branch flows from the prepared inputs to inference.
