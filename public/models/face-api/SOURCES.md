# Self-hosted face models

Copied without modification from the `model/` directory in the published npm package `@vladmandic/face-api@1.7.15`:

- `ssd_mobilenetv1_model.bin` and its weights manifest: face detection.
- `face_landmark_68_model.bin` and its weights manifest: alignment landmarks.
- `face_recognition_model.bin` and its weights manifest: 128-dimensional face descriptors.

Upstream: https://github.com/vladmandic/face-api

Package: https://www.npmjs.com/package/@vladmandic/face-api/v/1.7.15

The upstream MIT `LICENSE` is included here. `checksums.json` records SHA-256 for the model binaries and manifests. Only these three model families are loaded by Recall. The upstream repository is archived; see `docs/PEOPLE.md` for maintenance and accuracy limitations.
