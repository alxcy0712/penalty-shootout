# Goalkeeper markerless motion source

Author: Rafael Monteiro. “Data Kinematic analysis of soccer goalkeeper’s diving save in penalty effect of instructional video and laterality on performance”, Figshare (2023), DOI [10.6084/m9.figshare.23507793.v1](https://doi.org/10.6084/m9.figshare.23507793.v1).

License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Attribution must accompany redistributions and adaptations. No endorsement by the author is implied.

Retrieved 2026-09-25 from the official public API, https://api.figshare.com/v2/articles/23507793. Archive: https://ndownloader.figshare.com/files/41227368 (`working3d.zip`, MD5 `3f413fe026bcb9d4861ea7c7f988b6e5`). The author publishes its archive password in the dataset description. Access requires no email, account, purchase or upload.

Included original trials: N05D.3d and O05E.3d. Their SHA256 checksums:
- N05D: `49f6da874abf41a3ebf6dff2c314587039a9aa39175f96a81ae4374faafab613`
- O05E: `5e0400bd9f8b7c6563e10e28c512c88b1e2aac56e3bb1c64d47996045ea9f277`

The accompanying JSON files preserve the numeric frames at 120 Hz. Each raw row is 26 XYZ points: BODY_25 anatomical markers followed by centre of mass. Coordinate axes are anterior/posterior, mediolateral, vertical in metres. Processing uses the first 25 points.

Adaptations: symmetric five-tap binomial position filter, initial shoulder/face coordinate alignment, uniform scale to the target's 0.86 m leg, fixed-length limb retargeting, captured ankle/toe orientation, actual deformed-mesh floor clearance, quaternion continuity, Blender baked actions, Meshopt compression. The approved Quaternius-derived CC0 character is reused; its source/license remain in ../../quaternius-source/. The baked combined asset retains attribution to this motion dataset.

Reference: Monteiro et al. (2024), Scientific Reports, https://doi.org/10.1038/s41598-024-60074-x. Author PDF: https://scilabiocom.eeferp.usp.br/pdf/Monteiro2024.pdf. This is multi-camera markerless reconstruction, with possible occlusion/reconstruction errors. It contains neither ball tracking nor a complete catch/get-up sequence. This adaptation is an animation prototype, not a validated biomechanics measurement or match collision trajectory.
