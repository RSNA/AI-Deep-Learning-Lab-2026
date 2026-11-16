# Teaching data attribution

This pack contains modified metadata from public source images and synthetic clinical records/reports.
Source images remain subject to their own terms. Repository privacy does not change those terms.
Do not attempt to identify or contact any source subject. Source identifiers in the provenance manifest are
public dataset identifiers, not invented clinical identities.

## RSNA–STR Pneumonia Detection Challenge / NIH ChestX-ray

Provider: NIH Clinical Center. Downloaded from the direct RSNA distribution, not through Kaggle.

- NIH download: https://nihcc.app.box.com/v/ChestXray-NIHCC
- RSNA download: https://www.rsna.org/education/ai-resources-and-training/ai-image-challenge/RSNA-Pneumonia-Detection-Challenge-2018
- Terms: https://www.rsna.org/-/media/files/rsna/education/ai-resources-and-training/ai-image-challenge/pneumonia-detection-challenge-terms-of-use-and-attribution.pdf
- Wang X, Peng Y, Lu L, Lu Z, Bagheri M, Summers RM. ChestX-ray8: Hospital-scale Chest X-ray Database and Benchmarks on Weakly-Supervised Classification and Localization of Common Thorax Diseases. IEEE CVPR, 3462–3471, 2017.
- Shih G, Wu CC, Halabi SS, et al. Augmenting the National Institutes of Health Chest Radiograph Dataset with Expert Annotations of Possible Pneumonia. Radiology: Artificial Intelligence, 2019. https://doi.org/10.1148/ryai.2019180041

Modifications: selected cases, synthetic patient/order identifiers and dates, consistent DICOM UID remapping,
removal of private tags, and one deliberately duplicated image under a new study identity. Original pixels are unchanged.
Reports are template-generated from annotations; they are not original radiologist reports.

## RIDER Lung CT

The Cancer Imaging Archive, accessed through NCI Imaging Data Commons.
Data DOI: https://doi.org/10.7937/K9/TCIA.2015.U1X8A5NR
Collection: https://www.cancerimagingarchive.net/collection/rider-lung-ct/
The selected IDC metadata lists **CC BY 4.0**: https://creativecommons.org/licenses/by/4.0/ .
Historical TCIA pages may list CC BY 3.0; the exact selected distribution and license are recorded in dataset-lock.json.
Selected complete diagnostic and localizer series; metadata modifications as above. Pixels unchanged.
No diagnostic report labels were supplied for these series: teaching reports describe the available images and acquisition limitations, with this provenance kept outside the report.

## PROSTATE-MRI

The Cancer Imaging Archive, accessed through NCI Imaging Data Commons.
Data DOI: https://doi.org/10.7937/K9/TCIA.2016.6046GUDV
Collection: https://www.cancerimagingarchive.net/collection/prostate-mri/
License: CC BY 3.0 https://creativecommons.org/licenses/by/3.0/ .
Two public subjects with complete selected T2 series; metadata modifications as above. Pixels unchanged.
Reports describe the provided sequences and their limitations, without inventing lesion findings.

## Archive and access infrastructure

Clark K, Vendt B, Smith K, et al. The Cancer Imaging Archive (TCIA): Maintaining and Operating a Public Information Repository. Journal of Digital Imaging, 2013. https://doi.org/10.1007/s10278-013-9622-7

IDC downloader: https://github.com/ImagingDataCommons/idc-index
Exact series, source DOIs, source licenses, selected RSNA ZIP members, and source hashes are recorded in
the hospital authoring repository’s `hospital/dataset-lock.json` (not included in this session export); the built pack manifest records every output hash and transformation.

The embedded `recovery-case.json` contains only teaching study-001 (one RSNA-source CXR) and fictional clinical resources from the same pack. It is compressed for notebook recovery and follows the image-source attribution above.
