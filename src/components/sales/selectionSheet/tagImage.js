/**
 * Browser-only image helpers for the Selection Sheet's tag scanner: crop the
 * photo to the box the person drew, then resize/rotate each pass for OCR.
 * (The text-reading rules are src/utils/stoneLabel.js.)
 */

export const preprocessImage = (file, degrees = 0) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Resize: cap at 1600px for speed and phone memory. The crop starts on
        // the whole photo, so a smaller cap shrinks tag text below what OCR reads.
        const MAX_DIM = 1600;
        let width = img.width;
        let height = img.height;

        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        // Adjust dimensions based on rotation angle
        if (degrees === 90 || degrees === 270) {
          canvas.width = height;
          canvas.height = width;
        } else {
          canvas.width = width;
          canvas.height = height;
        }

        // Apply rotation matrix
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((degrees * Math.PI) / 180);
        ctx.drawImage(img, -width / 2, -height / 2, width, height);

        canvas.toBlob((blob) => {
          resolve(blob);
        }, 'image/jpeg', 0.9);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const getCroppedImageBlob = (file, cropXPercent, cropYPercent, cropWidthPercent, cropHeightPercent) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const origWidth = img.width;
        const origHeight = img.height;

        const left = Math.round((cropXPercent / 100) * origWidth);
        const top = Math.round((cropYPercent / 100) * origHeight);
        const width = Math.round((cropWidthPercent / 100) * origWidth);
        const height = Math.round((cropHeightPercent / 100) * origHeight);

        const safeLeft = Math.max(0, Math.min(left, origWidth - 1));
        const safeTop = Math.max(0, Math.min(top, origHeight - 1));
        const safeWidth = Math.max(1, Math.min(width, origWidth - safeLeft));
        const safeHeight = Math.max(1, Math.min(height, origHeight - safeTop));

        canvas.width = safeWidth;
        canvas.height = safeHeight;

        ctx.drawImage(img, safeLeft, safeTop, safeWidth, safeHeight, 0, 0, safeWidth, safeHeight);

        canvas.toBlob((blob) => {
          resolve(blob);
        }, 'image/jpeg', 0.95);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};
