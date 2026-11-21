# API guide image

Generated using the built-in imagegen tool. Asset: `hospital-api-guide.png`.
The notebook embeds the image so it also works when uploaded alone to Colab.

## Final prompt

Use case: scientific-educational
Asset type: landscape teaching infographic embedded in an English beginner Colab notebook.
Primary request: A friendly Swagger-inspired illustrated API route menu titled "Your first hospital API calls". Crisp large legible typography, restrained teal and navy on warm white, rounded GET route cards, simple hospital and image icons. Show two clearly separated columns FHIR and DICOMweb, with a small authentication banner above. No real product logos.
Text verbatim:
"Your first hospital API calls"
"1. Authenticate"
"Authorization: Bearer <your token>"
"Your token is the access badge. Keep it private."
"2. FHIR: clinical context"
"GET /fhir/R4/Patient/{id}"
"Birth date and administrative gender"
"GET /fhir/R4/Encounter/{id}"
"Reason for visit"
"GET /fhir/R4/ServiceRequest/{id}"
"Reason for the examination"
"GET /fhir/R4/ImagingStudy/{id}"
"Study identifiers"
"GET /fhir/R4/DiagnosticReport/{id}"
"Report text"
"3. DICOMweb: images"
"QIDO-RS = find"
"GET /dicom-web/studies/{study}/series"
"List series"
"GET /dicom-web/studies/{study}/series/{series}/instances"
"List instances"
"WADO-RS = retrieve"
"GET /dicom-web/studies/{study}/series/{series}/instances/{instance}"
"Download a DICOM object"
"4. Build a training example"
"Chest X-ray + age + gender + visit reason"
"Target: findings only"
Constraints: Use exactly the endpoint spellings above, preserve braces, allow endpoint line wraps for readability. Show progression through numbers 1 to 4. Illustration is conceptual documentation, not a screenshot or interactive UI. No additional clinical assertions or invented API routes.
